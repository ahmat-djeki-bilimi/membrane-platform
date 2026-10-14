"""Client HTTP partagé pour les services externes, avec nouvelles tentatives."""

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from app import provenance

USER_AGENT = "MemProtScope/1.0 (analyse de protéines membranaires)"

_session = requests.Session()
_session.headers["User-Agent"] = USER_AGENT
_retries = Retry(
    total=3,
    backoff_factor=0.5,
    status_forcelist=(429, 500, 502, 503, 504),
    allowed_methods=("GET", "POST"),
)
_session.mount("https://", HTTPAdapter(max_retries=_retries))


def get(url: str, timeout: float = 30, **kwargs) -> requests.Response:
    try:
        response = _session.get(url, timeout=timeout, **kwargs)
    except Exception as error:
        provenance.record_failure(url, error)
        raise
    provenance.record_response(url, response)
    return response


def post(url: str, timeout: float = 30, **kwargs) -> requests.Response:
    try:
        response = _session.post(url, timeout=timeout, **kwargs)
    except Exception as error:
        provenance.record_failure(url, error)
        raise
    provenance.record_response(url, response)
    return response
