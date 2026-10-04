from .result import ResultDict
from .typing import Optional, TypedDict


class ResultCounts(TypedDict):
    cancelled: int
    completed: int
    failed: int
    in_progress: int
    queued: int
    total: int


class DeprecatedExperimentDict(TypedDict):
    # Note: fields on this TypedDict are deprecated
    job_count: int
    job_running_count: int


class ExperimentDict(DeprecatedExperimentDict):
    uuid: Optional[str]
    name: Optional[str]
    account_uuid: Optional[str]
    created_at: Optional[str]
    finished_at: Optional[str]
    last_created_at: Optional[str]
    last_created_result: Optional[ResultDict]
    result_counts: ResultCounts


class ExperimentDetailedDict(ExperimentDict):
    pass
