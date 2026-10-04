from .typing import TypedDict


class FileZipMetadataDict(TypedDict):
    header_start: int
    size_on_disk: int


class FileNodeDict(TypedDict):
    dir_path: str
    is_dir: bool
    name: str
    size: int


class ZipFileNodeDict(FileNodeDict):
    zip_meta: FileZipMetadataDict
