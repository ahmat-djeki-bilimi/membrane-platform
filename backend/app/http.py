"""Client HTTP partagé pour les services externes, avec nouvelles tentatives."""

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

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
    return _session.get(url, timeout=timeout, **kwargs)


def post(url: str, timeout: float = 30, **kwargs) -> requests.Response:
    return _session.post(url, timeout=timeout, **kwargs)
