from docker.models.networks import Network

from biolib.biolib_api_client.app_types import Module
from biolib.biolib_api_client.job_types import CloudJob, CreatedJobDict
from biolib.compute_node.job_worker.large_file_system import LargeFileSystem
from biolib.compute_node.remote_host_proxy import RemoteHostProxy
from biolib.compute_node.webserver.webserver_types import ComputeNodeInfo
from biolib.typing_utils import Callable, Dict, List, Optional, TypedDict


class StatusUpdate(TypedDict):
    progress: int
    log_message: str


class RemoteExecuteOptions(TypedDict):
    biolib_base_url: str
    job: CreatedJobDict
    result_name_prefix: Optional[str]
    root_job_id: str


SendStatusUpdateType = Callable[[StatusUpdate], None]
SendSystemExceptionType = Callable[[int], None]
SendStdoutAndStderrType = Callable[[bytes], None]


class LocalExecutorOptions(TypedDict):
    access_token: str
    biolib_base_url: str
    compute_node_info: Optional[ComputeNodeInfo]
    internal_network: Optional[Network]
    job: CreatedJobDict
    cloud_job: Optional[CloudJob]
    large_file_systems: Dict[str, LargeFileSystem]
    module: Module
    module_input_path: str
    module_output_path: str
    remote_host_proxies: List[RemoteHostProxy]
    root_job_id: str
    runtime_zip_bytes: Optional[bytes]  # TODO: replace this with a module_source_serialized
    send_status_update: SendStatusUpdateType
    send_system_exception: SendSystemExceptionType
    send_stdout_and_stderr: SendStdoutAndStderrType


class MetadataToSaveOutput(TypedDict):
    arguments: List[str]
    startup_error_string: Optional[str]
