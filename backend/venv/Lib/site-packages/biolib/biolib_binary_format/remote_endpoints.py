from datetime import datetime, timedelta, timezone

from biolib.biolib_api_client.biolib_job_api import BiolibJobApi
from biolib.biolib_binary_format.utils import RemoteEndpoint

# from urllib.parse import urlparse, parse_qs
from biolib.biolib_logging import logger
from biolib.typing_utils import Literal


class RemoteJobStorageEndpoint(RemoteEndpoint):
    def __init__(self, job_uuid: str, job_auth_token: str, storage_type: Literal['input', 'output']):
        self._expires_at = None
        self._job_auth_token = job_auth_token
        self._job_uuid = job_uuid
        self._presigned_url = None
        self._storage_type: Literal['input', 'output'] = storage_type

    def get_remote_url(self):
        if not self._presigned_url or not self._expires_at or datetime.now(timezone.utc) > self._expires_at:
            self._presigned_url = BiolibJobApi.get_job_storage_download_url(
                job_auth_token=self._job_auth_token,
                job_uuid=self._job_uuid,
                storage_type='results' if self._storage_type == 'output' else 'input',
            )
            self._expires_at = datetime.now(timezone.utc) + timedelta(minutes=8)
            # TODO: Use expires at from url
            # parsed_url = urlparse(self._presigned_url)
            # query_params = parse_qs(parsed_url.query)
            # time_at_generation = datetime.datetime.strptime(query_params['X-Amz-Date'][0], '%Y%m%dT%H%M%SZ')
            # self._expires_at = time_at_generation + timedelta(seconds=int(query_params['X-Amz-Expires'][0]))
            logger.debug(f'Job "{self._job_uuid}" fetched presigned URL with expiry at {self._expires_at.isoformat()}')

        return self._presigned_url
