import re
from urllib.parse import urlparse

import biolib.utils
from biolib.typing_utils import Optional, Tuple


def parse_result_id_or_url(result_id_or_url: str, default_token: Optional[str] = None) -> Tuple[str, Optional[str]]:
    result_id_or_url = result_id_or_url.strip()

    if '/' not in result_id_or_url:
        return (result_id_or_url, default_token)

    if not result_id_or_url.startswith('http://') and not result_id_or_url.startswith('https://'):
        result_id_or_url = 'https://' + result_id_or_url

    parsed_url = urlparse(result_id_or_url)

    if biolib.utils.BIOLIB_BASE_URL:
        expected_base = urlparse(biolib.utils.BIOLIB_BASE_URL)
        if parsed_url.scheme != expected_base.scheme or parsed_url.netloc != expected_base.netloc:
            raise ValueError(f'URL must start with {biolib.utils.BIOLIB_BASE_URL}, got: {result_id_or_url}')

    pattern = r'/results?/(?P<uuid>[a-f0-9-]+)/?(?:\?token=(?P<token>[^&]+))?'
    match = re.search(pattern, result_id_or_url, re.IGNORECASE)

    if not match:
        raise ValueError(f'URL must be in format <base_url>/results/<UUID>/?token=<token>, got: {result_id_or_url}')

    uuid = match.group('uuid')
    token = match.group('token') or default_token

    return (uuid, token)
