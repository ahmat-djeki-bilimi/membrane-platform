import json
from typing import Any, Dict, Iterator, List, Optional, Union

from biolib import api
from biolib._internal.http_client import HttpResponse
from biolib._internal.utils import base64_encode_string
from biolib._internal.utils.auth import decode_jwt_without_checking_signature
from biolib._runtime.runtime import Runtime
from biolib.biolib_api_client import BiolibApiClient
from biolib.biolib_errors import BioLibError


def _get_index_basic_auth_header() -> Optional[str]:
    if Runtime.check_is_environment_biolib_app():
        return None

    deprecated_api_client = BiolibApiClient.get()
    deprecated_api_client.refresh_access_token()
    access_token = deprecated_api_client.access_token
    if not access_token:
        return None

    decoded_token = decode_jwt_without_checking_signature(access_token)
    user_uuid: Optional[str] = decoded_token['payload'].get('public_id')
    if not user_uuid:
        return None

    normalized_user_uuid = user_uuid.replace('-', '_')
    credentials = f'biolib_user|{normalized_user_uuid}:{access_token}'
    return f'Basic {base64_encode_string(credentials)}'


class IndexQueryResult:
    """Result wrapper for index query responses."""

    def __init__(self, response: HttpResponse, data_format: str):
        self._response = response
        self._data_format = data_format
        self._json_data: Optional[Dict[str, Any]] = None
        if data_format == 'json':
            content = self._response.content
            if content:
                self._json_data = json.loads(content.decode('utf-8'))

    def iter_rows(self) -> Iterator[Dict[str, Any]]:
        """Return an iterator over the rows in the query result.

        Returns:
            Iterator[Dict[str, Any]]: An iterator yielding each row as a dictionary.
        """
        if self._json_data is None:
            raise BioLibError('iter_rows() is only available when data_format is "json"')
        return iter(self._json_data['data'])


def query_index(
    query: str,
    data: Optional[Union[List[Dict[str, Any]], bytes]] = None,
    data_format: str = 'json',
) -> IndexQueryResult:
    """Query the BioLib index with a SQL-like query.

    Args:
        query: The SQL query string to execute.
        data: Optional input data. If data_format is "json", this should be a list of
            dictionaries that will be JSON encoded. Otherwise, pass raw bytes.
        data_format: The format for the query. Defaults to "json".

    Returns:
        IndexQueryResult: A result object wrapping the query response.

    Raises:
        BioLibError: If the query fails or returns a non-successful HTTP status code.
    """
    data_format = data_format.lower()

    params: Dict[str, Union[str, int]] = {'default_format': data_format.upper()}
    if data is not None:
        params['query'] = query

    if data is not None:
        if data_format == 'json':
            body: bytes = '\n'.join(json.dumps(item, ensure_ascii=False) for item in data).encode('utf-8')
        else:
            body = data  # type: ignore[assignment]
    else:
        body = query.encode('utf-8')

    response = api.client.post(
        path='proxy/index',
        data=body,
        params=params,
        headers={
            'Content-Type': 'text/plain; charset=utf-8',
            'Authorization': _get_index_basic_auth_header(),
        },
        authenticate=False,
    )

    if response.status_code < 200 or response.status_code >= 300:
        raise BioLibError(f'Index query failed with status code {response.status_code}: {response.text}')

    return IndexQueryResult(response, data_format)
