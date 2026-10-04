# pylint: disable=unsubscriptable-object
import threading
import time

from biolib.biolib_logging import logger
from biolib.compute_node.job_worker.utils import ComputeProcessException
from biolib.compute_node.utils import SystemExceptionCodes


class JobMaxRuntimeTimerThread(threading.Thread):

    def __init__(self,  job_worker, max_runtime_in_seconds):
        threading.Thread.__init__(self, daemon=True)
        self._job_worker = job_worker
        self._max_runtime_in_seconds = max_runtime_in_seconds

    def run(self) -> None:
        time.sleep(self._max_runtime_in_seconds)
        # Only raise exception and trigger clean up if the job has not already been cleaned up
        if not self._job_worker.is_cleaning_up:
            logger.debug("Job exceeded max run time. Raising exception")
            raise ComputeProcessException(
                original_error=Exception('Exceeded max job run time'),
                biolib_error_code=SystemExceptionCodes.EXCEEDED_MAX_JOB_RUNTIME.value,
                send_system_exception=self._job_worker.send_system_exception,
                may_contain_user_data=False
            )
        else:
            return
