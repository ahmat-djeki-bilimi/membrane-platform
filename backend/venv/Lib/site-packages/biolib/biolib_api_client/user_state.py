from biolib.biolib_logging import logger_no_user_data
from biolib.typing_utils import Optional, TypedDict
from biolib.utils.cache_state import CacheState

# TODO: Save job keys in the user state instead of a separate state file
# UuidStr = str
# class JobStateType(TypedDict):
#     job_uuid: UuidStr
#     aes_key: Optional[str]


class UserStateType(TypedDict):
    refresh_token: Optional[str]
    # jobs: Dict[UuidStr, JobStateType]


class UserState(CacheState[UserStateType]):
    def __init__(self) -> None:
        super().__init__(fail_fast_on_lock_acquire=True)
        self._is_in_memory_only: bool = False

    @property
    def _state_path(self) -> str:
        return f'{self._user_cache_dir}/user-state.json'

    def _get_default_state(self) -> UserStateType:
        return UserStateType(refresh_token=None)

    def __enter__(self) -> UserStateType:
        if self._is_in_memory_only:
            if self._state is None:
                self._state = self._get_default_state()
            return self._state
        try:
            return super().__enter__()
        except Exception as error:
            logger_no_user_data.warning(
                f'UserState: Could not access state file, continuing with in-memory state only. '
                f'Login state will not persist across Python processes. Error: {error}'
            )
            self._is_in_memory_only = True
            if self._state is None:
                self._state = self._get_default_state()
            return self._state

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        if self._is_in_memory_only:
            return
        try:
            super().__exit__(exc_type, exc_val, exc_tb)
        except Exception as error:
            logger_no_user_data.warning(
                f'UserState: Could not write state file. '
                f'Login state will not persist across Python processes. Error: {error}'
            )
            self._is_in_memory_only = True
