import contextlib
import json
import os
import socket
import time
from typing import List, Optional

from docker.errors import NotFound
from docker.models.networks import Network

from biolib import utils
from biolib.biolib_docker_client import BiolibDockerClient
from biolib.biolib_logging import logger_no_user_data
from biolib.compute_node.job_worker.network_alloc import _allocate_network_with_retries


class NetworkBuffer:
    BUFFER_SIZE = 25
    NETWORK_NAME_PREFIX = 'biolib-remote-host-network-'
    NETWORK_LABEL = 'biolib-role=remote-host-network'

    _BIOLIB_DIR = '/biolib' if utils.IS_RUNNING_IN_CLOUD else '/tmp/biolib'
    _NETWORKS_FILE = os.path.join(_BIOLIB_DIR, 'remote-host-networks.json')
    _LOCK_FILE = os.path.join(_BIOLIB_DIR, 'remote-host-networks.lock')
    _LOCK_TIMEOUT_SECONDS = 60
    _STALE_LOCK_THRESHOLD_SECONDS = 600

    _instance: Optional['NetworkBuffer'] = None

    def __init__(self):
        os.makedirs(self._BIOLIB_DIR, exist_ok=True)
        self._docker = BiolibDockerClient.get_docker_client()

    @classmethod
    def get_instance(cls) -> 'NetworkBuffer':
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def _acquire_lock(self) -> None:
        start_time = time.time()
        retry_count = 0

        while time.time() - start_time < self._LOCK_TIMEOUT_SECONDS:
            try:
                with open(self._LOCK_FILE, 'x') as lock_file:
                    lock_info = {
                        'pid': os.getpid(),
                        'hostname': socket.gethostname(),
                        'started_at': time.time(),
                    }
                    json.dump(lock_info, lock_file)
                return
            except FileExistsError:
                if retry_count == 0:
                    self._check_and_remove_stale_lock()

                time.sleep(0.5)
                retry_count += 1

        raise RuntimeError(
            f'Failed to acquire network buffer lock after {self._LOCK_TIMEOUT_SECONDS}s: {self._LOCK_FILE}'
        )

    def _check_and_remove_stale_lock(self) -> None:
        try:
            if not os.path.exists(self._LOCK_FILE):
                return

            lock_mtime = os.path.getmtime(self._LOCK_FILE)
            lock_age = time.time() - lock_mtime

            if lock_age > self._STALE_LOCK_THRESHOLD_SECONDS:
                try:
                    with open(self._LOCK_FILE) as f:
                        lock_info = json.load(f)
                        lock_pid = lock_info.get('pid')

                        if lock_pid:
                            try:
                                os.kill(lock_pid, 0)
                                logger_no_user_data.warning(
                                    f'Lock file is old ({lock_age:.0f}s) but process {lock_pid} is still alive'
                                )
                                return
                            except (OSError, ProcessLookupError):
                                pass

                except (json.JSONDecodeError, KeyError, ValueError):
                    pass

                logger_no_user_data.warning(
                    f'Removing stale lock file (age: {lock_age:.0f}s, threshold: {self._STALE_LOCK_THRESHOLD_SECONDS}s)'
                )
                os.remove(self._LOCK_FILE)

        except Exception as error:
            logger_no_user_data.debug(f'Error checking stale lock: {error}')

    def _release_lock(self) -> None:
        with contextlib.suppress(FileNotFoundError):
            os.remove(self._LOCK_FILE)

    def _read_available_networks(self) -> List[str]:
        if not os.path.exists(self._NETWORKS_FILE):
            return []

        try:
            with open(self._NETWORKS_FILE) as f:
                network_ids = json.load(f)
                if not isinstance(network_ids, list):
                    logger_no_user_data.error(
                        f'Invalid network buffer file format (expected list, got {type(network_ids).__name__})'
                    )
                    self._backup_corrupted_file()
                    return []
                return network_ids
        except json.JSONDecodeError as error:
            logger_no_user_data.error(f'Corrupted network buffer file: {error}')
            self._backup_corrupted_file()
            return []
        except Exception as error:
            logger_no_user_data.error(f'Failed to read network buffer file: {error}')
            return []

    def _write_available_networks(self, network_ids: List[str]) -> None:
        temp_file = f'{self._NETWORKS_FILE}.tmp'
        try:
            with open(temp_file, 'w') as f:
                json.dump(network_ids, f, indent=2)
                f.flush()
                os.fsync(f.fileno())

            os.replace(temp_file, self._NETWORKS_FILE)
        except Exception as error:
            logger_no_user_data.error(f'Failed to write network buffer file: {error}')
            with contextlib.suppress(FileNotFoundError):
                os.remove(temp_file)
            raise

    def _backup_corrupted_file(self) -> None:
        try:
            timestamp = int(time.time())
            backup_path = f'{self._NETWORKS_FILE}.corrupt-{timestamp}'
            os.rename(self._NETWORKS_FILE, backup_path)
            logger_no_user_data.error(f'Backed up corrupted file to {backup_path}')
        except Exception as error:
            logger_no_user_data.error(f'Failed to backup corrupted file: {error}')

    def allocate_networks(self, job_id: str, count: int) -> List[Network]:
        try:
            self._acquire_lock()

            available_ids = self._read_available_networks()
            allocated: List[Network] = []

            for _ in range(count):
                network = None

                while available_ids and network is None:
                    net_id = available_ids.pop(0)
                    try:
                        network = self._docker.networks.get(net_id)
                        logger_no_user_data.debug(
                            f'Allocated network {network.id} ({network.name}) from buffer for job {job_id}'
                        )
                    except NotFound:
                        logger_no_user_data.warning(
                            f'Network {net_id} in buffer file no longer exists in Docker, skipping'
                        )
                        network = None

                if network is None:
                    logger_no_user_data.debug(f'Buffer exhausted, creating network on-the-fly for job {job_id}')
                    network = self._create_network()

                allocated.append(network)

            self._write_available_networks(available_ids)
            return allocated

        except RuntimeError as error:
            logger_no_user_data.warning(f'Lock acquisition failed: {error}. Creating networks on-the-fly.')
            allocated = []
            for _ in range(count):
                network = self._create_network()
                allocated.append(network)
            return allocated

        finally:
            self._release_lock()

    def fill_buffer(self) -> int:
        try:
            self._acquire_lock()

            available_ids = self._read_available_networks()
            current_count = len(available_ids)
            needed = self.BUFFER_SIZE - current_count

            if needed <= 0:
                logger_no_user_data.debug(
                    f'Buffer already has {current_count} available networks (target: {self.BUFFER_SIZE})'
                )
                return 0

            logger_no_user_data.debug(
                f'Filling buffer: current={current_count}, target={self.BUFFER_SIZE}, creating={needed}'
            )

            created_count = 0
            for _ in range(needed):
                try:
                    network = self._create_network()
                    if network.id:
                        available_ids.append(network.id)
                        created_count += 1
                        logger_no_user_data.debug(f'Created buffer network {network.id} ({created_count}/{needed})')
                    else:
                        logger_no_user_data.error('Created network has no ID, skipping')
                except Exception as error:
                    logger_no_user_data.error(f'Failed to create buffer network: {error}')
                    continue

            self._write_available_networks(available_ids)
            logger_no_user_data.debug(f'Buffer fill complete: created {created_count} networks')
            return created_count

        finally:
            self._release_lock()

    def _create_network(self) -> Network:
        network = _allocate_network_with_retries(
            name_prefix=self.NETWORK_NAME_PREFIX,
            docker_client=self._docker,
            internal=True,
            driver='bridge',
            labels={'biolib-role': 'remote-host-network'},
        )
        return network
