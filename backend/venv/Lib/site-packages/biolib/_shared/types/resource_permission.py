from .resource import ResourceDict
from .typing import TypedDict


class ResourcePermissionDict(TypedDict):
    uuid: str
    created_at: str
    action: str
    resource: ResourceDict
    target_resource: ResourceDict


class ResourcePermissionDetailedDict(ResourcePermissionDict):
    pass
