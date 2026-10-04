from biolib.typing_utils import TypedDict


class ComputeNodeInfo(TypedDict):
    auth_token: str
    ip_address: str
    public_id: str
    pybiolib_version: str


class ShutdownTimes(TypedDict):
    auto_shutdown_time_in_seconds: int


class WebserverConfig(TypedDict):
    base_url: str
    compute_node_info: ComputeNodeInfo
    is_dev: bool
    shutdown_times: ShutdownTimes
