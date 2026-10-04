from biolib.typing_utils import TypedDict, Dict, List, Literal

UuidStr = str
DiskPath = str
DockerImageUri = str


class LargeFileSystemCache(TypedDict):
    last_used_at: str
    size_bytes: int
    state: Literal['downloading', 'ready']
    storage_partition_uuid: UuidStr
    uuid: UuidStr


class StoragePartition(TypedDict):
    allocated_size_bytes: int
    path: str
    total_size_bytes: int
    uuid: UuidStr


class LfsCacheStateDict(TypedDict):
    storage_partitions: Dict[UuidStr, StoragePartition]
    large_file_systems: Dict[UuidStr, LargeFileSystemCache]


class DockerImageInfo(TypedDict):
    last_used_at: str
    estimated_image_size_bytes: int
    state: Literal['pulling', 'ready']
    active_jobs: List[UuidStr]
    uri: str


DockerImageCacheStateDict = Dict[DockerImageUri, DockerImageInfo]
