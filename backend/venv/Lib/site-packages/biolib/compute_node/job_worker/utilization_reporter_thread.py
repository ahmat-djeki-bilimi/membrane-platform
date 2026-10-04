import threading
import time
import subprocess
from datetime import datetime, timezone

from docker.models.containers import Container  # type: ignore

import biolib.api.client
from biolib.biolib_logging import logger_no_user_data
from biolib.typing_utils import List, TypedDict, Optional, Dict, cast


class UtilizationMetricSample(TypedDict):
    cpu_usage_in_percent: float
    gpu_usage_in_percent: Optional[float]
    memory_usage_in_percent: float


class AggregatedUtilizationMetrics(TypedDict):
    cpu_average_usage_in_percent: float
    cpu_max_usage_in_percent: float
    gpu_average_usage_in_percent: Optional[float]
    gpu_max_usage_in_percent: Optional[float]
    memory_average_usage_in_percent: float
    memory_max_usage_in_percent: float
    recorded_at: str
    sampling_period_in_milliseconds: int


class CpuUsage(TypedDict):
    total_usage: float


class _CpuStats(TypedDict, total=False):
    cpu_usage: CpuUsage


class CpuStats(_CpuStats, total=False):
    system_cpu_usage: float


class MemoryStats(TypedDict, total=False):
    usage: float
    limit: float


class ContainerStats(TypedDict):
    cpu_stats: CpuStats
    memory_stats: MemoryStats


class UtilizationReporterThread(threading.Thread):
    def __init__(self, container: Container, job_uuid: str, compute_node_auth_token: str, include_gpu_stats: bool):
        super().__init__(daemon=False)  # Do not run as daemon thread to ensure final reporting request goes through
        self._container_object: Container = container
        self._job_uuid: str = job_uuid
        self._compute_node_auth_token: str = compute_node_auth_token

        self._sampling_period_in_milliseconds = 1_000
        self._samples_between_writes = 60
        self._attempt_to_get_gpu_stats = include_gpu_stats

    def run(self) -> None:
        try:
            self._run_helper()
        except BaseException as error:
            logger_no_user_data.exception(f'UtilizationReporterThread hit error: {error}')

    def _run_helper(self) -> None:
        logger_no_user_data.debug(f'Job "{self._job_uuid}" utilization metrics reporter thread started')
        prev_cpu_usage: float = 0.0
        prev_cpu_system_usage: float = 0.0
        metric_samples: List[UtilizationMetricSample] = []
        while True:
            stats = self._get_container_stats()
            if not stats:
                break

            cpu_total_usage = stats['cpu_stats']['cpu_usage']['total_usage']
            cpu_system_usage = stats['cpu_stats'].get('system_cpu_usage', 0.0)

            # Calculate CPU usage
            cpu_usage_delta_ns = cpu_total_usage - prev_cpu_usage
            cpu_system_usage_delta_ns = cpu_system_usage - prev_cpu_system_usage

            cpu_usage_in_percent = 0.0
            if cpu_system_usage_delta_ns:
                cpu_usage_in_percent = (cpu_usage_delta_ns / cpu_system_usage_delta_ns) * 100

            # Set previous usage
            prev_cpu_usage = cpu_total_usage
            prev_cpu_system_usage = cpu_system_usage

            memory_usage_in_percent = 0.0
            if 'usage' in stats['memory_stats'] and 'limit' in stats['memory_stats']:
                memory_usage_in_percent = stats['memory_stats']['usage'] / stats['memory_stats']['limit'] * 100

            gpu_usage_in_percent = self._get_gpu_utilization_in_percent()

            metric_sample = UtilizationMetricSample(
                cpu_usage_in_percent=cpu_usage_in_percent,
                memory_usage_in_percent=memory_usage_in_percent,
                gpu_usage_in_percent=gpu_usage_in_percent,
            )
            metric_samples.append(metric_sample)

            if len(metric_samples) >= self._samples_between_writes:
                self._report_aggregated_utilization_metric(metric_samples)
                metric_samples = []

            time.sleep(self._sampling_period_in_milliseconds / 1_000)

        logger_no_user_data.debug(f'Job "{self._job_uuid}" reporting remaining samples after container has exited')
        self._report_aggregated_utilization_metric(metric_samples)
        logger_no_user_data.debug(f'Job "{self._job_uuid}" utilization metrics reporter thread exiting')

    def _get_gpu_utilization_in_percent(self) -> Optional[float]:
        if not self._attempt_to_get_gpu_stats:
            return None
        try:
            cmd = 'nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader'
            utilization = subprocess.check_output(cmd, shell=True, stderr=subprocess.DEVNULL).decode('utf-8')
            utilization_for_each_gpu = [float(x.replace(' %', '')) for x in utilization.strip().split('\n')]
            utilization_for_first_gpu = utilization_for_each_gpu[0]
            return utilization_for_first_gpu
        except BaseException as error:
            logger_no_user_data.exception(f'Failed to get GPU utilization got error: {error}')
            self._attempt_to_get_gpu_stats = False
            return None

    def _get_container_stats(self) -> Optional[ContainerStats]:
        try:
            return cast(ContainerStats, self._container_object.stats(stream=False))
        except BaseException:
            # Assume the container no longer exists and return None
            return None

    def _get_aggregated_utilization_metric_from_metric_samples(
            self,
            metric_samples: List[UtilizationMetricSample],
    ) -> AggregatedUtilizationMetrics:
        cpu_max_usage_in_percent: float = 0.0
        cpu_usage_in_percent_sum: float = 0.0
        gpu_max_usage_in_percent: Optional[float] = None
        gpu_usage_in_percent_sum: Optional[float] = None
        memory_max_usage_in_percent: float = 0.0
        memory_usage_in_percent_sum: float = 0.0

        for metric_sample in metric_samples:
            cpu_max_usage_in_percent = max(cpu_max_usage_in_percent, metric_sample['cpu_usage_in_percent'])
            cpu_usage_in_percent_sum += metric_sample['cpu_usage_in_percent']
            memory_max_usage_in_percent = max(memory_max_usage_in_percent, metric_sample['memory_usage_in_percent'])
            memory_usage_in_percent_sum += metric_sample['memory_usage_in_percent']

            if metric_sample['gpu_usage_in_percent'] is not None:
                if gpu_max_usage_in_percent is None:
                    gpu_max_usage_in_percent = 0.0
                if gpu_usage_in_percent_sum is None:
                    gpu_usage_in_percent_sum = 0.0

                gpu_max_usage_in_percent = max(gpu_max_usage_in_percent, metric_sample['gpu_usage_in_percent'])
                gpu_usage_in_percent_sum += metric_sample['gpu_usage_in_percent']

        cpu_average_usage_in_percent = cpu_usage_in_percent_sum / len(metric_samples)
        memory_average_usage_in_percent = memory_usage_in_percent_sum / len(metric_samples)
        gpu_average_usage_in_percent = gpu_usage_in_percent_sum / len(metric_samples) \
            if gpu_usage_in_percent_sum is not None else None

        return AggregatedUtilizationMetrics(
            cpu_average_usage_in_percent=cpu_average_usage_in_percent,
            cpu_max_usage_in_percent=cpu_max_usage_in_percent,
            gpu_average_usage_in_percent=gpu_average_usage_in_percent,
            gpu_max_usage_in_percent=gpu_max_usage_in_percent,
            memory_average_usage_in_percent=memory_average_usage_in_percent,
            memory_max_usage_in_percent=memory_max_usage_in_percent,
            recorded_at=datetime.now(timezone.utc).isoformat(),
            sampling_period_in_milliseconds=self._sampling_period_in_milliseconds * self._samples_between_writes,
        )

    def _report_aggregated_utilization_metric(self, metric_samples: List[UtilizationMetricSample]) -> None:
        if len(metric_samples) == 0:
            logger_no_user_data.debug(f'Job "{self._job_uuid}" no metric samples to aggregate. Skipping reporting.')
            return

        aggregated_metrics = self._get_aggregated_utilization_metric_from_metric_samples(metric_samples)
        logger_no_user_data.debug(f'Job "{self._job_uuid}" reporting aggregated metrics {aggregated_metrics}')

        try:
            biolib.api.client.post(
                path=f'/internal/compute-nodes/jobs/{self._job_uuid}/utilization-metrics/',
                headers={'Compute-Node-Auth-Token': self._compute_node_auth_token},
                data=cast(Dict, aggregated_metrics),
            )
        except BaseException as error:
            logger_no_user_data.error(
                f'Job "{self._job_uuid}" failed to report metrics: {aggregated_metrics} got error: {error}'
            )
