import json
import os
import shutil
import uuid

from biolib.biolib_logging import logger_no_user_data
from biolib.compute_node.job_worker.cache_types import LfsCacheStateDict, UuidStr, StoragePartition, \
    DockerImageCacheStateDict
from biolib.typing_utils import Dict, List, cast, Optional
from biolib.utils.cache_state import CacheState, CacheStateError


class DockerCacheStateError(CacheStateError):
    pass


class LfsCacheState(CacheState):

    def __init__(self) -> None:
        super().__init__()

        self._storage_path_for_write: str = self._get_storage_path_for_write()
        self._storage_paths: List[str] = self._get_storage_paths()
        self._tmp_storage_paths: List[str] = self._get_tmp_storage_paths()

    @property
    def storage_paths(self) -> List[str]:
        return self._storage_paths

    @property
    def storage_path_for_write(self) -> str:
        return self._storage_path_for_write

    @property
    def tmp_storage_paths(self) -> List[str]:
        return self._tmp_storage_paths

    @property
    def main_lfs_storage_path(self) -> str:
        return self._storage_paths[0]

    @property
    def _state_path(self) -> str:
        state_path = os.environ.get('BIOLIB_LFS_STATE_PATH')
        if not state_path:
            raise CacheStateError('Environment variable "BIOLIB_LFS_STATE_PATH" not set')

        return state_path

    def get_read_only_dict_without_lock(self) -> Optional[LfsCacheStateDict]:
        try:
            if not os.path.isfile(self._state_path):
                return None
            with open(self._state_path, mode='r') as file:
                return cast(LfsCacheStateDict, json.load(file))
        except BaseException:
            return None

    def _get_default_state(self) -> LfsCacheStateDict:
        return LfsCacheStateDict(
            large_file_systems={},
            storage_partitions=self._get_storage_partitions_from_env(),
        )

    @staticmethod
    def _get_tmp_storage_paths() -> List[str]:
        lfs_tmp_storage_path_env_key = 'BIOLIB_LFS_TMP_STORAGE_PATHS'
        lfs_tmp_storage_paths = os.environ.get(lfs_tmp_storage_path_env_key)
        if not lfs_tmp_storage_paths:
            raise CacheStateError(f'Environment variable "{lfs_tmp_storage_path_env_key}" not set')

        lfs_tmp_storage_paths_list = lfs_tmp_storage_paths.split(',')
        for lfs_tmp_storage_path in lfs_tmp_storage_paths_list:
            if not os.path.isdir(lfs_tmp_storage_path):
                raise CacheStateError(f'LFS temporary storage path {lfs_tmp_storage_path} is not a directory')

        return lfs_tmp_storage_paths_list

    @staticmethod
    def _get_storage_paths() -> List[str]:
        lfs_storage_path_env_key = 'BIOLIB_LFS_STORAGE_PATHS'
        lfs_storage_paths = os.environ.get(lfs_storage_path_env_key)
        logger_no_user_data.debug(f'LFS storage paths: {lfs_storage_paths}')

        # It is essential to check like this so we catch if it is None and if it is empty string
        if not lfs_storage_paths:
            raise CacheStateError(f'Environment variable "{lfs_storage_path_env_key}" not set')

        lfs_storage_paths_list = lfs_storage_paths.split(',')
        for lfs_storage_path in lfs_storage_paths_list:
            if not os.path.isdir(lfs_storage_path):
                raise CacheStateError(f'LFS storage path {lfs_storage_path} is not a directory')

        return lfs_storage_paths_list

    @staticmethod
    def _get_storage_path_for_write() -> str:
        lfs_storage_path_for_write = os.environ.get('BIOLIB_LFS_WRITE_STORAGE_PATH')
        logger_no_user_data.debug(f'lfs_storage_path_for_write={lfs_storage_path_for_write}')

        if not lfs_storage_path_for_write:
            raise CacheStateError('Environment variable "BIOLIB_LFS_WRITE_STORAGE_PATH" not set')

        if not os.path.isdir(lfs_storage_path_for_write):
            raise CacheStateError(f'LFS storage path {lfs_storage_path_for_write} is not a directory')

        return lfs_storage_path_for_write

    def _get_storage_partitions_from_env(self) -> Dict[UuidStr, StoragePartition]:
        storage_states: Dict[UuidStr, StoragePartition] = {}
        for lfs_storage_path in self._storage_paths:
            uuid_str = str(uuid.uuid4())
            disk_usage = shutil.disk_usage(lfs_storage_path)
            storage_states[uuid_str] = StoragePartition(
                allocated_size_bytes=0,
                path=lfs_storage_path,
                total_size_bytes=disk_usage.free,
                uuid=uuid_str,
            )

        return storage_states


class DockerImageCacheState(CacheState):
    @property
    def _state_path(self) -> str:
        return f'{self._user_cache_dir}/docker-cache-state.json'

    def _get_default_state(self) -> DockerImageCacheStateDict:
        return {}
