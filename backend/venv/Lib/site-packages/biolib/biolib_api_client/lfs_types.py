from biolib.typing_utils import TypedDict


class DataRecordVersion(TypedDict):
    presigned_download_url: str
    size_bytes: int
    uri: str
    uuid: str


class DataRecordInfo(TypedDict):
    uri: str
    uuid: str


class DataRecordVersionInfo(TypedDict):
    resource_uri: str
    resource_uuid: str
    resource_version_uuid: str
