import time
from collections import OrderedDict
from pathlib import Path

from biolib import api
from biolib._internal.utils import open_browser_window_from_notebook
from biolib._internal.utils.experiment import fetch_experiment_by_uri
from biolib._shared.types import DeprecatedExperimentDict, ExperimentDict, ResourceDetailedDict
from biolib.api.client import ApiClient
from biolib.biolib_api_client import BiolibApiClient
from biolib.biolib_errors import BioLibError, WaitTimeoutError
from biolib.jobs.job import Job
from biolib.jobs.job_result import PathFilter
from biolib.jobs.types import JobsPaginatedResponse
from biolib.tables import BioLibTable
from biolib.typing_utils import Dict, List, Optional, Union
from biolib.utils import IS_RUNNING_IN_NOTEBOOK


class Experiment:
    _BIOLIB_EXPERIMENTS: List['Experiment'] = []

    # Columns to print in table when showing Job
    _table_columns_to_row_map = OrderedDict(
        {
            'Name': {'key': 'name', 'params': {}},
            'Job Count': {'key': 'job_count', 'params': {}},
            'Created At': {'key': 'created_at', 'params': {}},
        }
    )

    def __init__(
        self,
        uri: str,
        _resource_dict: Optional[ResourceDetailedDict] = None,
        _api_client: Optional[ApiClient] = None,
    ):
        self._api_client = _api_client or api.client
        self._resource_dict: ResourceDetailedDict = _resource_dict or self._get_or_create_resource_dict(uri)

    def __enter__(self):
        Experiment._BIOLIB_EXPERIMENTS.append(self)

    def __exit__(self, type, value, traceback):  # pylint: disable=redefined-builtin
        Experiment._BIOLIB_EXPERIMENTS.pop()

    def __str__(self):
        return f'Experiment: {self.uri}'

    def __repr__(self):
        return f'Experiment: {self.uri}'

    @property
    def uuid(self) -> str:
        return self._resource_dict['uuid']

    @property
    def id(self) -> str:
        return self.uuid

    @property
    def name(self) -> str:
        return self._resource_dict['name']

    @property
    def uri(self) -> str:
        return self._resource_dict['uri']

    @property
    def _experiment_dict(self) -> DeprecatedExperimentDict:
        if not self._resource_dict['experiment']:
            raise ValueError(f'Resource {self.uri} is not an Experiment')

        return self._resource_dict['experiment']

    @staticmethod
    def get_experiment_in_context() -> Optional['Experiment']:
        if Experiment._BIOLIB_EXPERIMENTS:
            return Experiment._BIOLIB_EXPERIMENTS[-1]
        return None

    # Prints a table listing info about experiments accessible to the user
    @staticmethod
    def show_experiments(count: int = 25) -> None:
        pagniated_response = api.client.get(path='/experiments/', params={'page_size': str(count)}).json()
        experiment_dicts: List[ExperimentDict] = pagniated_response['results']
        BioLibTable(
            columns_to_row_map=Experiment._table_columns_to_row_map,
            rows=experiment_dicts,
            title='Experiments',
        ).print_table()

    @staticmethod
    def get_by_uri(uri: str) -> 'Experiment':
        resource_dict = fetch_experiment_by_uri(uri=uri)
        return Experiment(uri=resource_dict['uri'], _resource_dict=resource_dict)

    def wait(self, timeout: Optional[int] = None) -> None:
        deadline = time.monotonic() + timeout if timeout is not None else None
        self._refetch()
        while self._experiment_dict['job_running_count'] > 0:
            if deadline is not None and time.monotonic() >= deadline:
                raise WaitTimeoutError(f'Experiment {self.name} did not finish within {timeout} seconds')
            print(f"Waiting for {self._experiment_dict['job_running_count']} jobs to finish", end='\r')
            time.sleep(5)
            self._refetch()

        print(f'All jobs of experiment {self.name} have finished')

    def add_job(self, job: Optional[Union[Job, str]] = None, job_id: Optional[str] = None) -> None:
        if job_id is not None:
            print(
                'WARNING: job_id argument is deprecated and may be removed in a future release.'
                'Please use job argument instead.'
            )
        elif isinstance(job, Job):
            job_id = job.id
        elif isinstance(job, str):
            job_id = job
        elif job is None and job_id is None:
            raise BioLibError('A job ID or job object must be provided to add job')
        self._api_client.post(
            path=f'/experiments/{self.uuid}/jobs/',
            data={'job_uuid': job_id},
        )

    def remove_job(self, job: Union[Job, str]) -> None:
        if isinstance(job, Job):
            job_id = job.id
        elif isinstance(job, str):
            job_id = job
        else:
            raise BioLibError('A job ID or job object must be provided to remove job')

        self._api_client.delete(path=f'/experiments/{self.uuid}/jobs/{job_id}/')

    def mount_files(self, mount_path: str) -> None:
        try:
            # Only attempt to import FUSE dependencies when strictly necessary
            from biolib._internal.fuse_mount import (  # pylint: disable=import-outside-toplevel
                ExperimentFuseMount as _ExperimentFuseMount,
            )
        except ImportError as error:
            raise ImportError(
                'Failed to import FUSE mounting utils. Please ensure FUSE is installed on your system.'
            ) from error

        _ExperimentFuseMount.mount_experiment(experiment=self, mount_path=mount_path)

    def export_job_list(self, export_format='dicts'):
        valid_formats = ('dicts', 'dataframe')
        if export_format not in valid_formats:
            raise BioLibError(f'Format can only be one of {valid_formats}')

        job_dict_list = [job.to_dict() for job in self.get_jobs()]
        if export_format == 'dicts':
            return job_dict_list

        elif export_format == 'dataframe':
            try:
                import pandas as pd  # type: ignore  # pylint: disable=import-outside-toplevel
            except ImportError as error:
                raise ImportError(
                    'Pandas must be installed to use this method. '
                    'Alternatively, use .get_jobs() to get a list of job objects.'
                ) from error

            jobs_df = pd.DataFrame.from_dict(job_dict_list)
            jobs_df.started_at = pd.to_datetime(jobs_df.started_at)
            jobs_df.created_at = pd.to_datetime(jobs_df.created_at)
            jobs_df.finished_at = pd.to_datetime(jobs_df.finished_at)
            return jobs_df

    # Prints a table containing info about this experiment
    def show(self) -> None:
        BioLibTable(
            columns_to_row_map=Experiment._table_columns_to_row_map,
            rows=[dict(**self._experiment_dict, name=self.name, created_at=self._resource_dict['created_at'])],
            title=f'Experiment: {self.name}',
        ).print_table()

    # Prints a table listing info about the jobs in this experiment
    def show_jobs(self) -> None:
        response: JobsPaginatedResponse = self._api_client.get(
            path=f'/experiments/{self.uuid}/jobs/',
            params=dict(page_size=10),
        ).json()
        jobs: List[Job] = [Job(job_dict) for job_dict in response['results']]

        BioLibTable(
            columns_to_row_map=Job.table_columns_to_row_map,
            rows=[job._job_dict for job in jobs],  # pylint: disable=protected-access
            title=f'Jobs in experiment: "{self.name}"',
        ).print_table()

    def get_jobs(self, status: Optional[str] = None) -> List[Job]:
        job_states = ['in_progress', 'completed', 'failed', 'cancelled']
        if status is not None and status not in job_states:
            raise Exception('Invalid status filter')

        url = f'/experiments/{self.uuid}/jobs/'
        params: Dict[str, Union[str, int]] = dict(page_size=1_000)
        if status:
            params['status'] = status

        response: JobsPaginatedResponse = self._api_client.get(url, params=params).json()
        jobs: List[Job] = [Job(job_dict) for job_dict in response['results']]

        for page_number in range(2, response['page_count'] + 1):
            page_response: JobsPaginatedResponse = self._api_client.get(
                url, params=dict(**params, page=page_number)
            ).json()
            jobs.extend([Job(job_dict) for job_dict in page_response['results']])

        return jobs

    def get_results(self, status: Optional[str] = None) -> List[Job]:
        r"""Get a list of results in this experiment, optionally filtered by status.

        Args:
            status (str, optional): Filter results by status. One of:
                'in_progress', 'completed', 'failed', 'cancelled'

        Returns:
            List[Job]: List of result objects in this experiment

        Example::

            >>> # Get all results in the experiment
            >>> results = experiment.get_results()
            >>> # Get only completed results
            >>> completed_results = experiment.get_results(status='completed')
        """
        return self.get_jobs(status=status)

    def save_completed_results(
        self,
        output_dir: Optional[str] = None,
        path_filter: Optional[PathFilter] = None,
        skip_file_if_exists: bool = False,
        overwrite: bool = False,
    ) -> None:
        r"""Save all completed results in this experiment to local folders.

        Creates a folder structure with the experiment name as the root directory,
        containing a subfolder for each completed result. Only results with
        'completed' status will be saved.

        Args:
            output_dir (str, optional): Base directory where the experiment folder
                will be created. If None, uses the current working directory.
            path_filter (PathFilter, optional): Filter to select which files in the results to save.
                Can be a glob pattern string or a callable function.
            skip_file_if_exists (bool, optional): Whether to skip files that already exist
                locally instead of raising an error. Defaults to False.
            overwrite (bool, optional): Whether to overwrite existing files.
                Defaults to False.

        Example::

            >>> # Save all completed results to current directory
            >>> experiment.save_completed_results()
            >>> # This creates: ./experiment_name/result_1/, ./experiment_name/result_2/, etc.

            >>> # Save to specific directory
            >>> experiment.save_completed_results(output_dir="/path/to/save")
            >>> # This creates: /path/to/save/experiment_name/result_1/, etc.
        """
        base_dir = Path(output_dir) if output_dir else Path.cwd()

        if base_dir == Path('/'):
            raise BioLibError("Cannot save experiment results to root directory '/'")

        experiment_folder = base_dir / self.name
        experiment_folder.mkdir(parents=True, exist_ok=True)

        completed_results: List[Job] = []
        failed_results = False
        print('Getting experiment status...')
        for result in self.get_results():
            if result.get_status() == 'completed':
                completed_results.append(result)
            elif result.get_status() != 'in_progress':
                failed_results = True

        if failed_results:
            print(
                'WARNING: Found failed or cancelled results in the experiment. '
                'Please verify you have all your results, and consider removing the failed ones.'
            )
        if not completed_results:
            print(f"No completed results found in experiment '{self.name}'")
            return

        print(f"Saving {len(completed_results)} completed results from experiment '{self.name}' to {experiment_folder}")

        for result in completed_results:
            result_name = result.get_name()
            result_folder = experiment_folder / result_name

            result_folder.mkdir(parents=True, exist_ok=True)

            result.save_files(
                output_dir=str(result_folder),
                path_filter=path_filter,
                skip_file_if_exists=skip_file_if_exists,
                overwrite=overwrite,
            )

    def rename(self, destination: str) -> None:
        r"""Rename this experiment to a new URI.

        Args:
            destination (str): The new URI for the experiment
                (e.g., 'username/new-experiment-name').

        Example::

            >>> experiment = biolib.get_experiment(uri='username/my-experiment')
            >>> experiment.rename('username/my-renamed-experiment')
            >>> print(experiment.uri)
            'username/my-renamed-experiment'
        """
        self._api_client.patch(f'/resources/{self.uuid}/', data={'uri': destination})
        self._refetch()

    def _get_resource_dict_by_uuid(self, uuid: str) -> ResourceDetailedDict:
        resource_dict: ResourceDetailedDict = self._api_client.get(f'/resources/{uuid}/').json()
        if not resource_dict['experiment']:
            raise ValueError('Resource from URI is not an experiment')

        return resource_dict

    def _get_or_create_resource_dict(self, uri: str) -> ResourceDetailedDict:
        response_dict = self._api_client.post(path='/experiments/', data={'uri' if '/' in uri else 'name': uri}).json()
        return self._get_resource_dict_by_uuid(uuid=response_dict['uuid'])

    def _refetch(self) -> None:
        self._resource_dict = self._get_resource_dict_by_uuid(uuid=self._resource_dict['uuid'])

    def open_browser(self) -> None:
        """Open a browser window to view this experiment.

        If running in a notebook, this will attempt to open a new browser window.
        Otherwise, it will print a URL that you can copy and paste.
        """
        api_client = BiolibApiClient.get()
        url_to_open = f'{api_client.base_url}/experiments/{self.id}/'

        if IS_RUNNING_IN_NOTEBOOK:
            print(f'Opening experiment page at: {url_to_open}')
            print('If your browser does not open automatically, click on the link above.')
            open_browser_window_from_notebook(url_to_open)
        else:
            print('Please copy and paste the following link into your browser:')
            print(url_to_open)
