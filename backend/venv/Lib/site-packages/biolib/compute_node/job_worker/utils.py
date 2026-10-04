import subprocess

from biolib.biolib_logging import logger, logger_no_user_data
from biolib import utils
from biolib.typing_utils import Callable


class ComputeProcessException(Exception):
    def __init__(self, original_error: Exception, biolib_error_code,
                 # Not using SendSystemExceptionType since importing it leads to many circular import problems
                 # TODO: Fix circular import problems when importing SendSystemExceptionType
                 send_system_exception: Callable[[int], None],
                 may_contain_user_data: bool = True):
        super().__init__()

        if not may_contain_user_data:
            logger_no_user_data.error(str(original_error))
        else:
            logger_no_user_data.debug('Hit a ComputeProcessException that may contain user data')
            logger.error(str(original_error))

        send_system_exception(biolib_error_code)


def log_disk_and_memory_usage_info() -> None:
    if not utils.IS_DEV:
        disk_usage_info = subprocess.run(['df', '-h'], check=False, capture_output=True)
        memory_usage_info = subprocess.run(['free', '-h', '--si'], check=False, capture_output=True)

        logger_no_user_data.debug(disk_usage_info)
        logger_no_user_data.debug(memory_usage_info)
