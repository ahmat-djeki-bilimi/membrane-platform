import time
from pathlib import Path

from biolib._internal.utils import PathFilter, filter_lazy_loaded_files
from biolib.biolib_binary_format import ModuleOutputV2
from biolib.biolib_binary_format.remote_endpoints import RemoteJobStorageEndpoint
from biolib.biolib_binary_format.remote_stream_seeker import StreamSeeker
from biolib.biolib_binary_format.utils import LazyLoadedFile, RemoteIndexableBuffer
from biolib.biolib_errors import BioLibError
from biolib.biolib_logging import logger
from biolib.typing_utils import Dict, List, Optional


class JobResult:
    def __init__(
        self,
        job_uuid: str,
        job_auth_token: str,
        module_output: Optional[ModuleOutputV2] = None,
    ):
        self._job_uuid: str = job_uuid
        self._job_auth_token: str = job_auth_token

        self._module_output: Optional[ModuleOutputV2] = module_output

    def get_stdout(self) -> bytes:
        return self._get_module_output().get_stdout()

    def get_stderr(self) -> bytes:
        return self._get_module_output().get_stderr()

    def get_exit_code(self) -> int:
        return self._get_module_output().get_exit_code()

    def save_files(
        self,
        output_dir: str,
        path_filter: Optional[PathFilter] = None,
        skip_file_if_exists: bool = False,
        overwrite: bool = False,
        flat: bool = False,
    ) -> None:
        module_output = self._get_module_output()
        output_files = module_output.get_files()
        filtered_output_files = filter_lazy_loaded_files(output_files, path_filter) if path_filter else output_files

        if len(filtered_output_files) == 0:
            logger.debug('No output files to save')
            return

        if flat:
            basename_to_paths: Dict[str, List[str]] = {}
            for file in filtered_output_files:
                basename = Path(file.path).name
                if basename not in basename_to_paths:
                    basename_to_paths[basename] = []
                basename_to_paths[basename].append(file.path)

            duplicates = {basename: paths for basename, paths in basename_to_paths.items() if len(paths) > 1}

            if duplicates:
                max_shown = 3
                error_parts = []
                sorted_basenames = sorted(duplicates.keys())

                for basename in sorted_basenames[:max_shown]:
                    paths = duplicates[basename]
                    error_parts.append(f'  {basename}: ({", ".join(paths)})')

                error_message = 'Cannot save files in flat mode: duplicate filenames detected:\n' + '\n'.join(
                    error_parts
                )

                if len(duplicates) > max_shown:
                    remaining = len(duplicates) - max_shown
                    error_message += f'\n  (and {remaining} more)'

                raise BioLibError(error_message)

        major_gap_threshold = 50_000
        n = len(filtered_output_files)

        next_break_end = [0] * n
        if n > 0:
            next_break_end[n - 1] = filtered_output_files[n - 1].start + filtered_output_files[n - 1].length
            for i in range(n - 2, -1, -1):
                end_i = filtered_output_files[i].start + filtered_output_files[i].length
                gap = filtered_output_files[i + 1].start - end_i
                if gap >= major_gap_threshold:
                    next_break_end[i] = end_i
                else:
                    next_break_end[i] = next_break_end[i + 1]

        total_files_data_to_download_in_bytes = 0
        file_read_ahead_map = {}
        for i, file in enumerate(filtered_output_files):
            total_files_data_to_download_in_bytes += file.length
            end_i = file.start + file.length
            read_ahead_bytes = max(0, next_break_end[i] - end_i)
            file_read_ahead_map[i] = read_ahead_bytes

        # Assume files are in order
        first_file = filtered_output_files[0]
        last_file = filtered_output_files[len(filtered_output_files) - 1]
        stream_seeker = StreamSeeker(
            files_data_start=first_file.start,
            files_data_end=last_file.start + last_file.length,
            max_chunk_size=min(total_files_data_to_download_in_bytes, 10_000_000),
            upstream_buffer=module_output.buffer,
        )

        logger.info(f'Saving {len(filtered_output_files)} files to {output_dir}...')
        for file_index, file in enumerate(filtered_output_files):
            if flat:
                destination_file_path = Path(output_dir) / Path(file.path).name
            else:
                # Remove leading slash of file_path
                destination_file_path = Path(output_dir) / Path(file.path.lstrip('/'))

            if destination_file_path.exists():
                if skip_file_if_exists:
                    logger.info(f'Skipping {destination_file_path} as a file with that name already exists locally.')
                    continue
                elif not overwrite:
                    raise BioLibError(f'File {destination_file_path} already exists. Set overwrite=True to overwrite.')
                else:
                    destination_file_path.rename(
                        f'{destination_file_path}.biolib-renamed.{time.strftime("%Y%m%d%H%M%S")}'
                    )

            dir_path = destination_file_path.parent
            if dir_path:
                dir_path.mkdir(parents=True, exist_ok=True)

            # write content to temporary (partial) file
            partial_path = destination_file_path.with_suffix(
                destination_file_path.suffix + f'.{self._job_uuid}.partial_biolib_download'
            )
            file_start = file.start
            data_to_download = file.length
            if partial_path.exists():
                data_already_downloaded = partial_path.stat().st_size
                file_start += data_already_downloaded
                data_to_download -= data_already_downloaded

            read_ahead_bytes = file_read_ahead_map[file_index]

            with open(partial_path, mode='ab') as partial_file:
                for chunk in stream_seeker.seek_and_read(
                    file_start=file_start, file_length=data_to_download, read_ahead_bytes=read_ahead_bytes
                ):
                    partial_file.write(chunk)

            # rename partial file to actual file name
            partial_path.rename(destination_file_path)

    def get_output_file(self, filename) -> LazyLoadedFile:
        files = self._get_module_output().get_files()
        filtered_files = filter_lazy_loaded_files(files, path_filter=filename)
        if not filtered_files:
            raise BioLibError(f'File {filename} not found in results.')

        if len(filtered_files) != 1:
            raise BioLibError(f'Found multiple results for filename {filename}.')

        return filtered_files[0]

    def list_output_files(self, path_filter: Optional[PathFilter] = None) -> List[LazyLoadedFile]:
        files = self._get_module_output().get_files()
        if not path_filter:
            return files

        return filter_lazy_loaded_files(files, path_filter)

    def _get_module_output(self) -> ModuleOutputV2:
        if self._module_output is None:
            remote_job_storage_endpoint = RemoteJobStorageEndpoint(
                job_auth_token=self._job_auth_token,
                job_uuid=self._job_uuid,
                storage_type='output',
            )
            buffer = RemoteIndexableBuffer(endpoint=remote_job_storage_endpoint)
            self._module_output = ModuleOutputV2(buffer)

        return self._module_output
