from .typing import TypedDict


class ResourceDeployKeyDict(TypedDict):
    uuid: str
    created_at: str
    name: str


class ResourceDeployKeyWithSecretDict(ResourceDeployKeyDict):
    secret_key: str
