# ruff: noqa: I001
# Imports to hide
import os
from urllib.parse import urlparse as _urlparse

from biolib import typing_utils as _typing_utils
from biolib.app import BioLibApp as _BioLibApp

# TODO: Fix ignore of type
from biolib.app.search_apps import search_apps  # type: ignore
from biolib.biolib_errors import BioLibError, WaitTimeoutError
from biolib.biolib_logging import logger as _logger, logger_no_user_data as _logger_no_user_data
from biolib.experiments.experiment import Experiment
from biolib.biolib_api_client import BiolibApiClient as _BioLibApiClient, App
from biolib.jobs.job import Result as _Result
from biolib import user as _user
from biolib.typing_utils import List, Optional, cast as _cast
from biolib._data_record.data_record import DataRecord as _DataRecord
from biolib._internal.utils.job_url import parse_result_id_or_url as _parse_result_id_or_url

import biolib.api
import biolib.app
import biolib.cli
import biolib.sdk
import biolib.utils

# ------------------------------------ Function definitions for public Python API ------------------------------------


def call_cli() -> None:
    biolib.cli.cli_entrypoint()


def load(uri: str, suppress_version_warning: bool = False) -> _BioLibApp:
    r"""Load a BioLib application by its URI or website URL.

    Args:
        uri (str): The URI or website URL of the application to load. Can be either:
            - App URI (e.g., 'biolib/myapp:1.0.0')
            - Website URL (e.g., 'https://biolib.com/biolib/myapp/')
        suppress_version_warning (bool): If True, don't print a warning when no version is specified.
            Defaults to False.

    Returns:
        BioLibApp: The loaded application object

    Example::

        >>> # Load by URI
        >>> app = biolib.load('biolib/myapp:1.0.0')
        >>> # Load by website URL
        >>> app = biolib.load('https://biolib.com/biolib/myapp/')
        >>> result = app.cli('--help')
    """
    return _BioLibApp(uri, suppress_version_warning=suppress_version_warning)


def search(
    search_query: Optional[str] = None,
    team: Optional[str] = None,
    count: int = 100,
) -> List[str]:
    r"""Search for BioLib applications.

    Args:
        search_query (str, optional): Search query string
        team (str, optional): Filter by team name
        count (int): Maximum number of results to return. Defaults to 100.

    Returns:
        List[str]: List of application URIs matching the search criteria

    Example::

        >>> # Search all apps
        >>> apps = biolib.search()
        >>> # Search by query
        >>> alignment_apps = biolib.search('alignment')
        >>> # Search team's apps
        >>> team_apps = biolib.search(team='myteam')
    """
    apps: List[str] = search_apps(search_query, team, count)
    return apps


def get_job(job_id: str, job_token: Optional[str] = None) -> _Result:
    r"""Get a job by its ID or full URL.

    Args:
        job_id (str): The UUID of the job to retrieve, or a full URL to the job.
            Can be either:
            - Job UUID (e.g., 'abc123')
            - Full URL (e.g., 'https://biolib.com/result/abc123/?token=xyz789')
            - Full URL with token parameter (e.g., 'biolib.com/result/abc123/token=xyz789')
        job_token (str, optional): Authentication token for accessing the job.
            Only needed for jobs that aren't owned by the current user.
            If the URL contains a token, this parameter is ignored.

    Returns:
        Job: The job object

    Example::

        >>> # Get by UUID
        >>> job = biolib.get_job('abc123')
        >>> # Get with explicit token
        >>> job = biolib.get_job('abc123', job_token='xyz789')
        >>> # Get by full URL with token
        >>> job = biolib.get_job('https://biolib.com/result/abc123/?token=xyz789')
        >>> # Get by URL with inline token format
        >>> job = biolib.get_job('biolib.com/result/abc123/token=xyz789')
    """
    uuid, token = _parse_result_id_or_url(job_id, job_token)
    return _Result.create_from_uuid(uuid=uuid, auth_token=token)


def get_result(result_id: str, result_token: Optional[str] = None) -> _Result:
    r"""Get a result by its ID or full URL.

    Args:
        result_id (str): The UUID of the result to retrieve, or a full URL to the result.
            Can be either:
            - Result UUID (e.g., 'abc123')
            - Full URL (e.g., 'https://biolib.com/result/abc123/?token=xyz789')
            - Full URL with token parameter (e.g., 'biolib.com/result/abc123/token=xyz789')
        result_token (str, optional): Authentication token for accessing the result.
            Only needed for results that aren't owned by the current user.
            If the URL contains a token, this parameter is ignored.

    Returns:
        Result: The result object

    Example::

        >>> # Get by UUID
        >>> result = biolib.get_result('abc123')
        >>> # Get with explicit token
        >>> result = biolib.get_result('abc123', result_token='xyz789')
        >>> # Get by full URL with token
        >>> result = biolib.get_result('https://biolib.com/result/abc123/?token=xyz789')
        >>> # Get by URL with inline token format
        >>> result = biolib.get_result('biolib.com/result/abc123/token=xyz789')
    """
    uuid, token = _parse_result_id_or_url(result_id, result_token)
    return _Result.create_from_uuid(uuid=uuid, auth_token=token)


def get_data_record(uri: str) -> _DataRecord:
    r"""Get a data record by its URI.

    Args:
        uri (str): The URI of the data record to retrieve

    Returns:
        DataRecord: The data record object

    Example::

        >>> record = biolib.get_data_record('biolib/data/sequences:1.0.0')
    """
    return _DataRecord.get_by_uri(uri)


def fetch_jobs(count: int = 25, status: Optional[str] = None) -> List[_Result]:
    r"""Fetch a list of jobs from the server.

    Args:
        count (int): Maximum number of jobs to fetch. Defaults to 25.
        status (str, optional): Filter jobs by status. One of:
            'in_progress', 'completed', 'failed', 'cancelled'

    Returns:
        List[Job]: List of job objects matching the criteria

    Example::

        >>> # Get last 10 completed jobs
        >>> jobs = biolib.fetch_jobs(10, status='completed')
        >>> # Get last 100 jobs of any status
        >>> all_jobs = biolib.fetch_jobs(100)
    """
    return _Result.fetch_jobs(count, status)


def fetch_data_records(uri: Optional[str] = None, count: Optional[int] = None) -> List[_DataRecord]:
    r"""Fetch a list of data records from the server.

    Args:
        uri (str, optional): Filter records by URI prefix
        count (int, optional): Maximum number of records to fetch

    Returns:
        List[DataRecord]: List of data record objects matching the criteria

    Example::

        >>> # Get all records
        >>> records = biolib.fetch_data_records()
        >>> # Get records with URI prefix
        >>> seq_records = biolib.fetch_data_records('biolib/data/sequences')
    """
    return _DataRecord.fetch(uri, count)


def get_experiment(uri: Optional[str] = None, name: Optional[str] = None) -> Experiment:
    r"""Get an experiment by its URI or name.

    Args:
        uri (str, optional): The URI of the experiment
        name (str, optional): The name of the experiment

    Returns:
        Experiment: The experiment object

    Raises:
        ValueError: If neither or both uri and name are provided

    Example::

        >>> # Get by URI
        >>> exp = biolib.get_experiment(uri='biolib/experiments/analysis')
        >>> # Get by name
        >>> exp = biolib.get_experiment(name='sequence-analysis')
    """
    if (not uri and not name) or (uri and name):
        raise ValueError('Must provide either uri or name')

    return Experiment.get_by_uri(uri=_cast(str, uri or name))


def show_jobs(count: int = 25) -> None:
    r"""Display a table of recent jobs.

    Args:
        count (int): Maximum number of jobs to display. Defaults to 25.

    Example::

        >>> biolib.show_jobs()  # Show last 25 jobs
        >>> biolib.show_jobs(100)  # Show last 100 jobs
    """
    _Result.show_jobs(count=count)


def show_experiments(count: int = 25) -> None:
    r"""Display a table of experiments.

    Args:
        count (int): Maximum number of experiments to display. Defaults to 25.

    Example::

        >>> biolib.show_experiments()  # Show last 25 experiments
        >>> biolib.show_experiments(100)  # Show last 100 experiments
    """
    Experiment.show_experiments(count=count)


def sign_in() -> None:
    _user.sign_in()


def sign_out() -> None:
    _user.sign_out()


def login() -> None:
    r"""Alias for :func:`sign_in`.

    Example::

        >>> biolib.login()  # Same as biolib.sign_in()
    """
    sign_in()


def logout() -> None:
    r"""Alias for :func:`sign_out`.

    Example::

        >>> biolib.logout()  # Same as biolib.sign_out()
    """
    sign_out()


def set_api_base_url(api_base_url: str) -> None:
    r"""Set the base URL for the BioLib API.

    Args:
        api_base_url (str): The base URL for the BioLib API

    Example::

        >>> biolib.set_api_base_url('https://biolib.com')

    Note:
        This will also update related configuration like site hostname
        and environment flags.
    """
    _BioLibApiClient.initialize(base_url=api_base_url)
    biolib.utils.BIOLIB_BASE_URL = api_base_url
    biolib.utils.BIOLIB_SITE_HOSTNAME = _urlparse(api_base_url).hostname
    biolib.utils.BASE_URL_IS_PUBLIC_BIOLIB = api_base_url.endswith('biolib.com') or (
        os.environ.get('BIOLIB_ENVIRONMENT_IS_PUBLIC_BIOLIB', '').upper() == 'TRUE'
    )


def set_base_url(base_url: str) -> None:
    r"""Alias for :func:`set_api_base_url`.

    Args:
        base_url (str): The base URL for the BioLib API

    Example::

        >>> biolib.set_base_url('https://biolib.com')
    """
    return set_api_base_url(base_url)


def set_api_token(api_token: str) -> None:
    r"""Sign in using an API token.

    Args:
        api_token (str): The API token to authenticate with

    Example::

        >>> biolib.set_api_token('my-api-token')
        # Signed in using API token
    """
    api_client = _BioLibApiClient.get()
    api_client.sign_in_with_api_token(api_token)


def set_log_level(level: _typing_utils.Union[str, int]) -> None:
    r"""Set the logging level for BioLib.

    Args:
        level (Union[str, int]): The log level to use. Can be a string
            ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL') or an integer
            level from the logging module.

    Example::

        >>> biolib.set_log_level('DEBUG')  # Enable debug logging
        >>> biolib.set_log_level('WARNING')  # Only show warnings and errors
    """
    _logger.setLevel(level)
    _logger_no_user_data.setLevel(level)


def _configure_requests_certificates():
    biolib_ca_bundle = os.getenv('BIOLIB_CA_BUNDLE')
    if biolib_ca_bundle:
        os.environ['REQUESTS_CA_BUNDLE'] = biolib_ca_bundle
        if not os.getenv('SSL_CERT_FILE'):
            os.environ['SSL_CERT_FILE'] = biolib_ca_bundle
        return

    if os.getenv('REQUESTS_CA_BUNDLE'):
        if not os.getenv('SSL_CERT_FILE'):
            # set SSL_CERT_FILE to urllib use same certs
            os.environ['SSL_CERT_FILE'] = os.getenv('REQUESTS_CA_BUNDLE')
        return  # don't change REQUESTS_CA_BUNDLE if manually configured

    certs_to_check = [
        '/etc/ssl/certs/ca-certificates.crt',
        '/etc/pki/tls/certs/ca-bundle.crt',
        '/etc/ssl/ca-bundle.pem',
        '/etc/pki/tls/cacert.pem',
        '/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem',
        '/etc/ssl/cert.pem',
    ]

    for cert in certs_to_check:
        if os.path.exists(cert):
            os.environ['REQUESTS_CA_BUNDLE'] = cert
            if not os.getenv('SSL_CERT_FILE'):
                os.environ['SSL_CERT_FILE'] = cert
            return


# -------------------------------------------------- Configuration ---------------------------------------------------
__version__ = biolib.utils.BIOLIB_PACKAGE_VERSION
_DEFAULT_LOG_LEVEL = 'INFO' if biolib.utils.IS_RUNNING_IN_NOTEBOOK else 'WARNING'
_logger.configure(default_log_level=_DEFAULT_LOG_LEVEL)
_logger_no_user_data.configure(default_log_level=_DEFAULT_LOG_LEVEL)
_configure_requests_certificates()

set_api_base_url(biolib.utils.load_base_url_from_env())
