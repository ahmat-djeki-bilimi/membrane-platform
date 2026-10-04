from biolib.typing_utils import List, Literal, Optional, TypedDict

JobState = Literal['in_progress', 'completed', 'failed', 'cancelled']


class _BaseCloudJobDict(TypedDict):
    created_at: str
    finished_at: Optional[str]
    uuid: str
    error_code: int


class CloudJobDict(_BaseCloudJobDict):
    started_at: Optional[str]
    compute_node_url: Optional[str]


class CloudJobStartedDict(_BaseCloudJobDict):
    started_at: str
    compute_node_url: str


class Result(TypedDict):
    name: str


class JobDict(TypedDict):
    app_uri: str
    arguments_override_command: bool
    auth_token: str
    created_at: str
    ended_at: Optional[str]
    requested_machine: str
    runtime_seconds: int
    main_result: Result
    started_at: str
    state: JobState
    uuid: str
    cloud_job: Optional[CloudJobDict]


class BasePaginatedResponse(TypedDict):
    current_page_number: int
    object_count: int
    page_count: int
    page_size: int


class JobsPaginatedResponse(BasePaginatedResponse):
    results: List[JobDict]
