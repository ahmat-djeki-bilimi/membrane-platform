import os
import shutil
import time
import zipfile

import docker.types  # type: ignore

from biolib import utils
from biolib.biolib_errors import BioLibError
from biolib.biolib_logging import logger_no_user_data
from biolib.compute_node.job_worker.cache_state import LfsCacheState
from biolib.compute_node.job_worker.cache_types import LargeFileSystemCache, StoragePartition
from biolib.typing_utils import TypedDict, Optional, Callable

from biolib.biolib_api_client import LargeFileSystemMapping
from biolib.utils import download_presigned_s3_url


class StatusUpdate(TypedDict):
    progress: int
    log_message: str


class LargeFileSystemAttachResponse(TypedDict):
    aws_ebs_volume_id: str
    device_name: str


class DeviceInfo(TypedDict):
    attached_device_name: str
    aws_ebs_volume_id: str
    nvme_device_name: str


class LargeFileSystemError(BioLibError):
    pass


class LargeFileSystem:

    def __init__(
            self,
            job_id: str,
            lfs_mapping: LargeFileSystemMapping,
            send_status_update: Callable[[StatusUpdate], None],
    ):
        if not utils.IS_RUNNING_IN_CLOUD:
            raise LargeFileSystemError('Large File System is currently not supported in local compute environments')

        if lfs_mapping['size_bytes'] is None:
            raise LargeFileSystemError('Error: You attempted to attach an LFS without a known size.')

        self._job_id: str = job_id
        self._lfs_mapping: LargeFileSystemMapping = lfs_mapping
        self._path_on_disk: Optional[str] = None
        self._path_on_disk_for_write: Optional[str] = None
        self._send_status_update: Callable[[StatusUpdate], None] = send_status_update

    @property
    def uuid(self) -> str:
        return self._lfs_mapping['uuid']

    @property
    def docker_mount(self) -> docker.types.Mount:
        if not self._path_on_disk:
            raise LargeFileSystemError('LargeFileSystem not initialized')

        return docker.types.Mount(
            read_only=True,
            source=self._path_on_disk,
            target=self._lfs_mapping['to_path'],
            type='bind',
        )

    def initialize(self) -> None:
        if self._path_on_disk:
            logger_no_user_data.debug(f'LFS {self.uuid} is already initialized')
            return

        lfs_size_bytes = self._lfs_mapping['size_bytes']
        logger_no_user_data.debug(f'Initializing LFS {self.uuid} of size {lfs_size_bytes} bytes...')

        readonly_cache_state = LfsCacheState().get_read_only_dict_without_lock()
        if readonly_cache_state:
            readonly_lfs: Optional[LargeFileSystemCache] = readonly_cache_state['large_file_systems'].get(self.uuid)
            if readonly_lfs and readonly_lfs['state'] == 'ready':
                logger_no_user_data.debug(f'LFS {self.uuid} found to be ready in cache')
                storage_partition = readonly_cache_state['storage_partitions'][readonly_lfs['storage_partition_uuid']]
                self._path_on_disk = f"{storage_partition['path']}/lfs/{self.uuid}/data"
                self._path_on_disk_for_write = f'{LfsCacheState().storage_path_for_write}/lfs/{self.uuid}/data'
                return

        lfs_is_already_downloading = False
        with LfsCacheState() as cache_state:
            lfs_cache: Optional[LargeFileSystemCache] = cache_state['large_file_systems'].get(self.uuid)

            if lfs_cache is None:
                logger_no_user_data.debug(f'LFS {self.uuid} was not found in cache')
                storage_partition_to_use: Optional[StoragePartition] = None
                logger_no_user_data.debug(f"Storage partitions to check: {cache_state['storage_partitions'].values()}")

                for storage_partition in cache_state['storage_partitions'].values():
                    free_space_bytes = storage_partition['total_size_bytes'] - storage_partition['allocated_size_bytes']
                    if lfs_size_bytes < free_space_bytes:
                        storage_partition_to_use = storage_partition
                        break

                if storage_partition_to_use is None:
                    raise LargeFileSystemError('No storage partition with space available')
                else:
                    storage_partition_to_use['allocated_size_bytes'] += lfs_size_bytes

                cache_state['large_file_systems'][self.uuid] = LargeFileSystemCache(
                    last_used_at=LfsCacheState.get_timestamp_now(),
                    size_bytes=lfs_size_bytes,
                    state='downloading',
                    storage_partition_uuid=storage_partition_to_use['uuid'],
                    uuid=self.uuid,
                )

                self._path_on_disk = f"{storage_partition_to_use['path']}/lfs/{self.uuid}/data"
                self._path_on_disk_for_write = f'{LfsCacheState().storage_path_for_write}/lfs/{self.uuid}/data'
                logger_no_user_data.debug(f'Using path {self._path_on_disk} for LFS')

            else:
                logger_no_user_data.debug(f"LFS {self.uuid} found in cache with state {lfs_cache['state']}")
                lfs_cache['last_used_at'] = LfsCacheState.get_timestamp_now()
                storage_partition = cache_state['storage_partitions'][lfs_cache['storage_partition_uuid']]
                self._path_on_disk = f"{storage_partition['path']}/lfs/{self.uuid}/data"
                self._path_on_disk_for_write = f'{LfsCacheState().storage_path_for_write}/lfs/{self.uuid}/data'

                if lfs_cache['state'] == 'ready':
                    return
                else:
                    lfs_is_already_downloading = True

        # TODO: Come up with better status reporting such that the progress values below make sense
        if lfs_is_already_downloading:
            self._send_status_update(StatusUpdate(
                progress=30,
                log_message=f'Waiting for Large File System "{self.uuid}" to be ready...',
            ))
            self._wait_for_lfs_to_be_ready()
            self._send_status_update(StatusUpdate(progress=33, log_message=f'Large File System "{self.uuid}" ready.'))
        else:
            self._send_status_update(StatusUpdate(
                progress=30,
                log_message=f'Downloading Large File System "{self.uuid}"...',
            ))

            try:
                self._download_and_unzip()
            except Exception as error:
                logger_no_user_data.error(
                    f'Failed to download LFS {self.uuid} got error: {error}. Cleaning up LFS cache state...'
                )
                self._remove_from_state()
                raise error

            self._send_status_update(StatusUpdate(
                progress=33,
                log_message=f'Large File System "{self.uuid}" downloaded.',
            ))
            with LfsCacheState() as cache_state:
                cache_state['large_file_systems'][self.uuid]['state'] = 'ready'
                logger_no_user_data.debug(f'LFS cache state: {cache_state}')

        logger_no_user_data.debug(f'LFS {self.uuid} is initialized')

    def _remove_from_state(self) -> None:
        with LfsCacheState() as cache_state:
            lfs = cache_state['large_file_systems'][self.uuid]
            storage_partition = cache_state['storage_partitions'][lfs['storage_partition_uuid']]
            storage_partition['allocated_size_bytes'] -= lfs['size_bytes']

            cache_state['large_file_systems'].pop(self.uuid)
            logger_no_user_data.debug(f'LFS cache state: {cache_state}')

        logger_no_user_data.debug('Cleaned up LFS cache state')

    def _wait_for_lfs_to_be_ready(self) -> None:
        # Timeout after 15 min
        for _ in range(180):
            time.sleep(5)
            with LfsCacheState() as cache_state:
                if cache_state['large_file_systems'][self.uuid]['state'] == 'ready':
                    return

        raise LargeFileSystemError(f'Waiting for Large File System "{self.uuid}" downloading timed out')

    def _download_and_unzip(self) -> None:
        logger_no_user_data.debug(f'Starting download and unzip of LFS {self.uuid}')
        lfs_size_bytes = self._lfs_mapping['size_bytes']
        tmp_storage_dir: Optional[str] = None

        for path in LfsCacheState().tmp_storage_paths:
            disk_usage = shutil.disk_usage(path)
            logger_no_user_data.debug(f'Path {path} has disk usage: {disk_usage}')
            if lfs_size_bytes < disk_usage.free:
                tmp_storage_dir = path

        if tmp_storage_dir is None:
            raise LargeFileSystemError('No temporary storage available for downloading Large File System')

        tmp_data_zip_path = f'{tmp_storage_dir}/lfs-{self.uuid}-data.zip'
        logger_no_user_data.debug(f'Downloading LFS zip to path {tmp_data_zip_path}...')

        try:
            download_presigned_s3_url(
                presigned_url=self._lfs_mapping['presigned_download_url'],
                output_file_path=tmp_data_zip_path,
            )
        except Exception as error:
            logger_no_user_data.error(
                f'Failed to download Large File System data.zip got error: {error}. Removing tmp_data_zip_path...'
            )
            if os.path.exists(tmp_data_zip_path):
                os.remove(tmp_data_zip_path)
                logger_no_user_data.debug(f'Removed {tmp_data_zip_path}')

            raise LargeFileSystemError(f'Failed to download Large File System data.zip got error: {error}') from error

        try:
            logger_no_user_data.debug(f'Extracting {tmp_data_zip_path} to {self._path_on_disk_for_write} ...')
            with zipfile.ZipFile(tmp_data_zip_path, 'r') as zip_ref:
                zip_ref.extractall(self._path_on_disk_for_write)
        except Exception as error:
            logger_no_user_data.error(
                f'Failed to unzip {tmp_data_zip_path} got error: {error}. '
                f'Removing {self._path_on_disk_for_write}...'
            )
            if self._path_on_disk_for_write is not None and os.path.exists(self._path_on_disk_for_write):
                shutil.rmtree(self._path_on_disk_for_write)

            raise error
        finally:
            os.remove(tmp_data_zip_path)
            logger_no_user_data.debug(f'Removed {tmp_data_zip_path}')
