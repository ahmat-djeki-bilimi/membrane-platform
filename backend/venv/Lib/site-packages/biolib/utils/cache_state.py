import abc
import json
import os
import time
from datetime import datetime, timezone

from biolib._internal.utils.app_dirs import get_user_cache_dir
from biolib.biolib_errors import BioLibError
from biolib.biolib_logging import logger_no_user_data
from biolib.typing_utils import Generic, Optional, TypeVar

StateType = TypeVar('StateType')  # pylint: disable=invalid-name


class CacheStateError(BioLibError):
    pass


class CacheState(abc.ABC, Generic[StateType]):
    @property
    @abc.abstractmethod
    def _state_path(self) -> str:
        raise NotImplementedError

    @abc.abstractmethod
    def _get_default_state(self) -> StateType:
        raise NotImplementedError

    @property
    def _user_cache_dir(self) -> str:
        user_cache_dir: str = get_user_cache_dir()
        os.makedirs(user_cache_dir, exist_ok=True)
        return user_cache_dir

    @property
    def _state_lock_path(self) -> str:
        return f'{self._state_path}.lock'

    def __init__(self, fail_fast_on_lock_acquire: bool = False) -> None:
        self._state: Optional[StateType] = None
        self._fail_fast_on_lock_acquire: bool = fail_fast_on_lock_acquire

    def __enter__(self) -> StateType:
        logger_no_user_data.debug(f'CacheState: Entering state path: {self._state_path}...')
        try:
            self._acquire_state_lock()
            if os.path.exists(self._state_path):
                with open(self._state_path, mode='r') as file:
                    self._state = json.loads(file.read())
            else:
                self._state = self._get_default_state()
                with open(self._state_path, mode='w') as file:
                    file.write(json.dumps(self._state))

            # Check for type checking
            if self._state is None:
                raise CacheStateError('Internal state is not defined')
        except BaseException as error:  # pylint: disable=broad-except
            logger_no_user_data.debug(f'Could not get LFS lock, got error: {error}...')
            raise error
        return self._state

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        with open(self._state_path, mode='w') as file:
            file.write(json.dumps(self._state))

        self._release_state_lock()
        logger_no_user_data.debug(f'CacheState: Exited state path: {self._state_path}')

    def _acquire_state_lock(self) -> None:
        for _ in range(10):
            try:
                lock_file = open(self._state_lock_path, mode='x')
                lock_file.close()
                return
            except BaseException as error:  # pylint: disable=broad-except
                logger_no_user_data.debug(f'Failed to acquire lock file "{self._state_lock_path}". Got error: {error}')
                if self._fail_fast_on_lock_acquire:
                    raise CacheStateError(f'Failed to acquire lock file "{self._state_lock_path}": {error}') from error

            time.sleep(0.5)

        raise CacheStateError(f'Cache state timed out waiting to acquire lock file "{self._state_lock_path}"')

    def _release_state_lock(self) -> None:
        if os.path.exists(self._state_lock_path):
            os.remove(self._state_lock_path)
        else:
            raise CacheStateError('Cache state was not locked.')

    @staticmethod
    def get_timestamp_now() -> str:
        return datetime.now(timezone.utc).isoformat()
