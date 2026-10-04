from __future__ import annotations

import os
from typing import Callable, Iterator

import biolib.api as api
from biolib._internal.file_utils import get_files_and_size_of_directory, get_iterable_zip_stream
from biolib.biolib_errors import BioLibError
from biolib.biolib_logging import logger
from biolib.typing_utils import Dict, List, Optional, Sequence, Tuple, Union
from biolib.utils import MultiPartUploader


def _upload_from_iterator(
    payload_iterator: Iterator[bytes],
    payload_size_in_bytes: int,
    resource_uuid: Optional[str] = None,
    resource_version_uuid: Optional[str] = None,
    use_process_pool: bool = False,
    publish: bool = False,
    on_progress: Optional[Callable[[int, int], None]] = None,
) -> str:
    if (resource_uuid is None) == (resource_version_uuid is None):
        raise ValueError('Must provide exactly one of resource_uuid or resource_version_uuid')

    if resource_version_uuid is None:
        response = api.client.post(
            path='/lfs/versions/',
            data={'resource_uuid': resource_uuid},
        )
        resource_version_uuid = response.json()['uuid']

    multipart_uploader = MultiPartUploader(
        use_process_pool=use_process_pool,
        get_presigned_upload_url_request={
            'headers': None,
            'requires_biolib_auth': True,
            'path': f'/lfs/versions/{resource_version_uuid}/presigned_upload_url/',
        },
        complete_upload_request={
            'headers': None,
            'requires_biolib_auth': True,
            'path': f'/lfs/versions/{resource_version_uuid}/complete_upload/',
        },
        on_progress=on_progress,
    )
    multipart_uploader.upload(payload_iterator=payload_iterator, payload_size_in_bytes=payload_size_in_bytes)

    if publish:
        api.client.patch(
            path=f'/resources/versions/{resource_version_uuid}/',
            data={'state': 'published', 'set_as_active': True},
        )

    return resource_version_uuid


def validate_data_path_and_get_files_and_size_of_directory(data_path: str) -> Tuple[List[str], int]:
    assert os.path.isdir(data_path), f'The path "{data_path}" is not a directory.'

    if os.path.realpath(data_path) == '/':
        raise BioLibError('Pushing your root directory is not possible')

    original_working_dir = os.getcwd()
    os.chdir(data_path)
    files_to_zip, data_size_in_bytes = get_files_and_size_of_directory(directory=os.getcwd())
    os.chdir(original_working_dir)

    if data_size_in_bytes > 4_500_000_000_000:
        raise BioLibError('Attempted to push directory with a size larger than the limit of 4.5 TB')

    return files_to_zip, data_size_in_bytes


def push_data_path(
    data_size_in_bytes: int,
    files_to_zip: Sequence[Union[str, Dict[str, bytes]]],
    data_path: Optional[str] = None,
    resource_uuid: Optional[str] = None,
    resource_version_uuid: Optional[str] = None,
    chunk_size_in_mb: Optional[int] = None,
    publish: bool = False,
) -> str:
    if (resource_uuid is None) == (resource_version_uuid is None):
        raise ValueError('Must provide exactly one of resource_uuid or resource_version_uuid')

    if data_path is None:
        assert all(
            isinstance(entry, dict) for entry in files_to_zip
        ), 'All files_to_zip entries must be dicts when data_path is None'

    original_working_dir = os.getcwd()
    if data_path:
        os.chdir(data_path)

    min_chunk_size_bytes = 10_000_000
    chunk_size_in_bytes: int
    if chunk_size_in_mb:
        chunk_size_in_bytes = chunk_size_in_mb * 1_000_000  # Convert megabytes to bytes
        if chunk_size_in_bytes < min_chunk_size_bytes:
            logger.warning('Specified chunk size is too small, using minimum of 10 MB instead.')
            chunk_size_in_bytes = min_chunk_size_bytes
    else:
        # Calculate chunk size based on max chunk count of 10_000, using 9_000 to be on the safe side
        chunk_size_in_bytes = max(min_chunk_size_bytes, int(data_size_in_bytes / 9_000))

    data_size_in_mb = round(data_size_in_bytes / 10**6)
    logger.info(f'Zipping {len(files_to_zip)} files, in total ~{data_size_in_mb}mb of data')

    iterable_zip_stream = get_iterable_zip_stream(files=files_to_zip, chunk_size=chunk_size_in_bytes)

    new_resource_version_uuid = _upload_from_iterator(
        payload_iterator=iterable_zip_stream,
        payload_size_in_bytes=data_size_in_bytes,
        resource_uuid=resource_uuid,
        resource_version_uuid=resource_version_uuid,
        use_process_pool=True,
        publish=publish,
    )

    if data_path:
        os.chdir(original_working_dir)
    return new_resource_version_uuid
