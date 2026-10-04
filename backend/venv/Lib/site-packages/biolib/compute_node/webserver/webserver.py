# pylint: disable=unsubscriptable-object

import json
import logging
import os
import tempfile
import time

from docker.models.networks import Network  # type: ignore
from flask import Flask, Response, jsonify, request

from biolib import utils
from biolib.biolib_api_client import BiolibApiClient
from biolib.biolib_binary_format import SavedJob
from biolib.biolib_docker_client import BiolibDockerClient
from biolib.biolib_logging import TRACE, logger, logger_no_user_data
from biolib.compute_node.cloud_utils.cloud_utils import CloudUtils
from biolib.compute_node.utils import BIOLIB_PROXY_NETWORK_NAME
from biolib.compute_node.webserver import webserver_utils
from biolib.compute_node.webserver.compute_node_results_proxy import ComputeNodeResultsProxy
from biolib.compute_node.webserver.gunicorn_flask_application import GunicornFlaskApplication
from biolib.compute_node.webserver.webserver_utils import get_job_compute_state_or_404
from biolib.typing_utils import Optional

app = Flask(__name__)

if utils.IS_RUNNING_IN_CLOUD:
    _BIOLIB_TMP_DIR = '/biolib/tmp'
    os.makedirs(_BIOLIB_TMP_DIR, exist_ok=True)
else:
    _BIOLIB_TMP_DIR = tempfile.TemporaryDirectory().name


@app.route('/hello/')
def hello():
    return 'Hello'


@app.route('/health/')
def health():
    return 'biolib-compute-node is running', 200


@app.route('/v1/job/', methods=['POST'])
def save_job():
    saved_job = json.loads(request.data.decode())

    # TODO: figure out why this shallow validate method is used
    if not webserver_utils.validate_saved_job(saved_job):
        return jsonify({'job': 'Invalid job'}), 400

    job_id = saved_job['job']['public_id']
    job_temporary_dir = os.path.join(_BIOLIB_TMP_DIR, job_id)
    os.makedirs(job_temporary_dir)
    saved_job['BASE_URL'] = BiolibApiClient.get().base_url
    saved_job['job_temporary_dir'] = job_temporary_dir

    compute_state = webserver_utils.get_compute_state(webserver_utils.UNASSIGNED_COMPUTE_PROCESSES)
    compute_state['job_id'] = job_id
    compute_state['job'] = saved_job['job']
    compute_state['job_temporary_dir'] = job_temporary_dir

    webserver_utils.JOB_ID_TO_COMPUTE_STATE_DICT[job_id] = compute_state

    if utils.IS_RUNNING_IN_CLOUD:
        config = CloudUtils.get_webserver_config()
        saved_job['compute_node_info'] = config['compute_node_info']
        compute_state['cloud_job_id'] = saved_job['cloud_job']['public_id']
        compute_state['cloud_job'] = saved_job['cloud_job']

        webserver_utils.update_auto_shutdown_time()

    saved_job_bbf_package = SavedJob().serialize(json.dumps(saved_job))
    send_package_to_compute_process(job_id, saved_job_bbf_package)

    return '', 201


@app.route('/v1/job/<job_id>/start/', methods=['POST'])
def start_compute(job_id):
    module_input_package = request.data

    if 'AES-Key-String' in request.headers:
        compute_state = webserver_utils.JOB_ID_TO_COMPUTE_STATE_DICT[job_id]
        compute_state['aes_key_string_b64'] = request.headers['AES-Key-String']

    send_package_to_compute_process(job_id, module_input_package)
    return '', 201


@app.route('/v1/job/<job_id>/', methods=['DELETE'])
def terminate_job(job_id: str) -> Response:
    compute_state = get_job_compute_state_or_404(job_id)
    # TODO: Consider BBF package
    compute_state['received_messages_queue'].put(b'CANCEL_JOB')
    return Response()


@app.route('/v1/job/<job_id>/status/')
def status(job_id):
    # TODO Implement auth token
    return_full_logs = request.args.get('logs') == 'full'

    compute_state = get_job_compute_state_or_404(job_id)
    current_status = compute_state['status'].copy()
    response_data = current_status
    response_data['is_completed'] = compute_state['is_completed']

    if current_status['stdout_and_stderr_packages_b64']:
        compute_state['streamed_logs_packages_b64'] = (
            compute_state['streamed_logs_packages_b64'] + current_status['stdout_and_stderr_packages_b64']
        )

        compute_state['status']['stdout_and_stderr_packages_b64'] = []

    if current_status['status_updates']:
        compute_state['previous_status_updates'].extend(current_status['status_updates'])
        compute_state['status']['status_updates'] = []

    if return_full_logs:
        response_data['streamed_logs_packages_b64'] = compute_state['streamed_logs_packages_b64']
        response_data['previous_status_updates'] = compute_state['previous_status_updates']

    return jsonify(response_data)


@app.route('/v1/job/<job_id>/result/')
def result():
    return 410, 'This endpoint is no longer available. Please update pybiolib by running `pip3 install -U pybiolib`'


def send_package_to_compute_process(job_id, package_bytes):
    compute_state = get_job_compute_state_or_404(job_id)
    message_queue = compute_state['messages_to_send_queue']
    message_queue.put(package_bytes)


def start_webserver(
    host: str,
    port: int,
    tls_pem_certificate_path: Optional[str] = None,
    tls_pem_key_path: Optional[str] = None,
) -> None:
    def worker_exit(server, worker):  # pylint: disable=unused-argument
        active_compute_states = (
            list(webserver_utils.JOB_ID_TO_COMPUTE_STATE_DICT.values()) + webserver_utils.UNASSIGNED_COMPUTE_PROCESSES
        )
        logger.debug(f'Sending terminate signal to {len(active_compute_states)} compute processes')
        if active_compute_states:
            for compute_state in active_compute_states:
                if compute_state['worker_thread']:
                    compute_state['worker_thread'].terminate()
            time.sleep(2)

        if utils.IS_RUNNING_IN_CLOUD:
            try:
                logger_no_user_data.debug('Stopping ComputeNodeResultsProxy...')
                ComputeNodeResultsProxy.stop_proxy()
            except BaseException:
                logger_no_user_data.exception('Failed to stop ComputeNodeResultsProxy')

            try:
                logger_no_user_data.debug(f'Removing Docker network {BIOLIB_PROXY_NETWORK_NAME}')
                docker_client = BiolibDockerClient.get_docker_client()
                biolib_proxy_network: Network = docker_client.networks.get(BIOLIB_PROXY_NETWORK_NAME)
                biolib_proxy_network.remove()
                logger_no_user_data.debug(f'Successfully removed Docker network {BIOLIB_PROXY_NETWORK_NAME}')
            except BaseException:
                logger_no_user_data.exception(f'Failed to clean up network {BIOLIB_PROXY_NETWORK_NAME}')

    def post_fork(server, worker):  # pylint: disable=unused-argument
        logger.info('Started compute node')

        if utils.IS_RUNNING_IN_CLOUD:
            logger.debug('Initializing webserver...')
            config = CloudUtils.get_webserver_config()
            utils.IS_DEV = config['is_dev']
            BiolibApiClient.initialize(config['base_url'])

            biolib_proxy_network: Optional[Network] = None
            try:
                logger_no_user_data.debug(f'Creating Docker network {BIOLIB_PROXY_NETWORK_NAME}')
                docker_client = BiolibDockerClient.get_docker_client()
                biolib_proxy_network = docker_client.networks.create(
                    name=BIOLIB_PROXY_NETWORK_NAME,
                    internal=False,
                    driver='bridge',
                )
                logger_no_user_data.debug(f'Successfully created Docker network {BIOLIB_PROXY_NETWORK_NAME}')
            except BaseException:
                logger_no_user_data.exception(f'Failed to create Docker network {BIOLIB_PROXY_NETWORK_NAME}')

            if biolib_proxy_network:
                try:
                    logger_no_user_data.debug('Starting ComputeNodeResultsProxy...')
                    ComputeNodeResultsProxy.start_proxy(tls_pem_certificate_path, tls_pem_key_path)
                except BaseException:
                    logger_no_user_data.exception('Failed to start ComputeNodeResultsProxy')

                CloudUtils.initialize()
                webserver_utils.start_auto_shutdown_timer()
            else:
                logger_no_user_data.error(
                    f'Docker network {BIOLIB_PROXY_NETWORK_NAME} was not created, shutting down...'
                )
                CloudUtils.deregister_and_shutdown(error='unknown_error')

    if logger.level == TRACE:
        gunicorn_log_level_name = 'DEBUG'
    elif logger.level == logging.DEBUG:
        gunicorn_log_level_name = 'INFO'
    elif logger.level == logging.INFO:
        gunicorn_log_level_name = 'WARNING'
    else:
        gunicorn_log_level_name = logging.getLevelName(logger.level)

    options = {
        'bind': f'{host}:{port}',
        'certfile': tls_pem_certificate_path,
        'graceful_timeout': 4,
        'keyfile': tls_pem_key_path,
        'loglevel': gunicorn_log_level_name,
        'post_fork': post_fork,
        'ssl_version': 'TLSv1_2',
        'timeout': '7200',  # Reduce to 300 when frontend no longer downloads from webserver
        'worker_exit': worker_exit,
        'workers': 1,
    }

    GunicornFlaskApplication(app, options).run()
