from .typing import Literal, NotRequired, Optional, TypedDict


class ResourceVersionAssetsDict(TypedDict):
    download_url: str
    size_bytes: int


class ResourceVersionDict(TypedDict):
    uuid: str
    semantic_version: str
    state: Literal['published', 'unpublished']
    created_at: str
    git_branch_name: NotRequired[str]
    git_commit_hash: NotRequired[str]


class ResourceVersionDetailedDict(ResourceVersionDict):
    assets: Optional[ResourceVersionAssetsDict]
