import threading
import time

from biolib.typing_utils import Callable
from biolib.compute_node.job_worker.utils import ComputeProcessException
from biolib.compute_node.utils import SystemExceptionCodes


class JobLegacyInputWaitTimeout(threading.Thread):

    def __init__(self, job_uuid: str, input_max_wait_in_seconds: int, send_system_exception: Callable[[int], None]):
        threading.Thread.__init__(self, daemon=True)
        self._job_uuid = job_uuid
        self._input_max_wait_in_seconds = input_max_wait_in_seconds
        self._send_system_exception = send_system_exception
        self._stop_event = threading.Event()

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        time.sleep(self._input_max_wait_in_seconds)

        if not self._stop_event.is_set():
            raise ComputeProcessException(
                biolib_error_code=SystemExceptionCodes.FAILED_TO_GET_REQUIRED_DATA_FOR_COMPUTE.value,
                may_contain_user_data=False,
                original_error=Exception(f'Job "{self._job_uuid}" exceeded max wait time for legacy input.'),
                send_system_exception=self._send_system_exception,
            )
