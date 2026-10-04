from .experiment import DeprecatedExperimentDict
from .resource_version import ResourceVersionDetailedDict
from .typing import Literal, NotRequired, Optional, TypedDict


class SemanticVersionDict(TypedDict):
    major: int
    minor: int
    patch: int


class ResourceUriDict(TypedDict):
    account_handle_normalized: str
    account_handle: str
    resource_name_normalized: Optional[str]
    resource_name: Optional[str]
    resource_prefix: Optional[str]
    version: Optional[SemanticVersionDict]
    tag: Optional[str]


ResourceTypeLiteral = Literal['app', 'data-record', 'experiment', 'index']


class ResourceDict(TypedDict):
    uuid: str
    uri: str
    name: str
    created_at: str
    description: str
    account_uuid: str


class ResourceDetailedDict(ResourceDict):
    type: ResourceTypeLiteral
    version: NotRequired[ResourceVersionDetailedDict]
    experiment: Optional[DeprecatedExperimentDict]
