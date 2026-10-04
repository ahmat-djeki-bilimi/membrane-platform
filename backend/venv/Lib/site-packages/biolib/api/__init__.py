from biolib._internal.http_client import HttpClient

from .client import ApiClient as _ApiClient

_client = _ApiClient()
client = _client
