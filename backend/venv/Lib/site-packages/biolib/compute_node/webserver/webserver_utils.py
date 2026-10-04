import time
from datetime import datetime, timedelta
from multiprocessing import Process

from werkzeug.exceptions import NotFound

from biolib import utils
from biolib.biolib_logging import logger_no_user_data
from biolib.compute_node.cloud_utils import CloudUtils
from biolib.typing_utils import Dict, List
from biolib.compute_node.webserver.worker_thread import WorkerThread


JOB_ID_TO_COMPUTE_STATE_DICT: Dict = {}
UNASSIGNED_COMPUTE_PROCESSES: List = []


def get_job_compute_state_or_404(job_id: str):
    compute_state = JOB_ID_TO_COMPUTE_STATE_DICT.get(job_id)
    if compute_state:
        return compute_state

    raise NotFound('Job not found')


def get_compute_state(unassigned_compute_processes):
    if len(unassigned_compute_processes) == 0:
        start_compute_process(unassigned_compute_processes)

    return unassigned_compute_processes.pop()


def start_compute_process(unassigned_compute_processes):
    compute_state = {
        'job_id': None,
        'job': None,
        'cloud_job_id': None,
        'cloud_job': None,
        'streamed_logs_packages_b64': [],
        'previous_status_updates': [],
        'is_completed': False,
        'status': {
            'status_updates': [
                {
                    'progress': 10,
                    'log_message': 'Initializing'
                }
            ],
            'stdout_and_stderr_packages_b64': []
        },
        'progress': 0,
        'job_temporary_dir': '',
        'received_messages_queue': None,
        'messages_to_send_queue': None,
        'worker_process': None
    }

    WorkerThread(compute_state).start()
    unassigned_compute_processes.append(compute_state)


def validate_saved_job(saved_job):
    if 'app_version' not in saved_job['job']:
        return False

    if 'access_token' not in saved_job:
        return False

    if 'module_name' not in saved_job:
        return False

    return True


def start_auto_shutdown_timer() -> None:
    if not utils.IS_RUNNING_IN_CLOUD:
        logger_no_user_data.error('Not running in cloud so skipping auto shutdown time start')
        return

    update_auto_shutdown_time()

    timer = CloudAutoShutdownTimer()
    timer.start()
    logger_no_user_data.debug(f"Started auto shutdown timer on pid: {timer.pid}")


def update_auto_shutdown_time() -> None:
    if not utils.IS_RUNNING_IN_CLOUD:
        logger_no_user_data.error('Not running in cloud so skipping auto shutdown time update')
        return

    webserver_config = CloudUtils.get_webserver_config()
    auto_shutdown_buffer = webserver_config['shutdown_times']['auto_shutdown_time_in_seconds']  # pylint: disable=unsubscriptable-object

    if JOB_ID_TO_COMPUTE_STATE_DICT:
        highest_max_job_compute_state = max(
            JOB_ID_TO_COMPUTE_STATE_DICT.values(),
            key=lambda compute_state: compute_state['cloud_job']['max_runtime_in_seconds']  # type: ignore
        )
        highest_max_job_runtime = highest_max_job_compute_state['cloud_job']['max_runtime_in_seconds']
    else:
        highest_max_job_runtime = 0

    auto_shutdown_time = datetime.now() + timedelta(seconds=highest_max_job_runtime) + timedelta(
        seconds=auto_shutdown_buffer
    )
    auto_shutdown_time_isoformat = datetime.isoformat(auto_shutdown_time)

    with open(CloudAutoShutdownTimer.SHUTDOWN_TIMESTAMP_FILE_PATH, 'w') as auto_shutdown_time_file:
        auto_shutdown_time_file.write(auto_shutdown_time_isoformat)

    logger_no_user_data.debug(f'Extending auto shutdown timer to: {auto_shutdown_time_isoformat}')


class CloudAutoShutdownTimer(Process):
    SHUTDOWN_TIMESTAMP_FILE_PATH = '/tmp/auto_shutdown_time.timestamp'

    def _get_auto_shutdown_time(self) -> datetime:
        with open(self.SHUTDOWN_TIMESTAMP_FILE_PATH, mode='r') as file:
            return datetime.fromisoformat(file.read())

    def run(self) -> None:
        auto_shutdown_time = self._get_auto_shutdown_time()
        while datetime.now() < auto_shutdown_time:
            time.sleep(60)
            auto_shutdown_time = self._get_auto_shutdown_time()

        logger_no_user_data.debug(f'Hit auto shutdown timer since {datetime.now()} > {auto_shutdown_time}')
        CloudUtils.deregister_and_shutdown()
