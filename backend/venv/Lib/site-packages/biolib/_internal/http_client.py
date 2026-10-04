import http.client
import json
import platform
import shutil
import socket
import ssl
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

from biolib.biolib_logging import logger_no_user_data
from biolib.typing_utils import Dict, Literal, Optional, Union, cast

_HttpMethod = Literal['GET', 'POST', 'PATCH', 'PUT', 'DELETE']


def _create_ssl_context():
    context = ssl.create_default_context()
    try:
        if platform.system() == 'Darwin':
            certificates = subprocess.check_output('security find-certificate -a -p', shell=True).decode('utf-8')
            context.load_verify_locations(cadata=certificates)
    except BaseException:
        pass
    return context


class HttpError(urllib.error.HTTPError):
    def __init__(self, http_error: urllib.error.HTTPError):
        super().__init__(
            url=http_error.url,
            code=http_error.code,
            msg=http_error.msg,  # type: ignore
            hdrs=http_error.hdrs,  # type: ignore
            fp=http_error.fp,
        )

    def __str__(self):
        response_text = self.read().decode('utf-8')
        return f'{self.code} Error: {response_text} for url: {self.url}'


class HttpResponse:
    def __init__(self, response, response_path) -> None:
        self.headers: Dict[str, str] = dict(response.headers)
        self.status_code: int = int(response.status)
        self.response_path = response_path
        if self.response_path:
            with open(self.response_path, 'wb') as out_file:
                shutil.copyfileobj(response, out_file)
        else:
            self.content: bytes = response.read()
        self.url: str = response.geturl()

    @property
    def text(self) -> str:
        if self.response_path:
            with open(self.response_path, 'rb') as fp:
                return cast(str, fp.read().decode('utf-8'))
        else:
            return cast(str, self.content.decode('utf-8'))

    def json(self):
        return json.loads(self.text)


class HttpClient:
    ssl_context = None

    @staticmethod
    def request(
        url: str,
        method: Optional[_HttpMethod] = None,
        data: Optional[Union[Dict, bytes]] = None,
        headers: Optional[Dict[str, str]] = None,
        retries: int = 5,
        timeout_in_seconds: Optional[int] = None,
        response_path: Optional[str] = None,
        retry_on_http_500: Optional[bool] = False,
        max_content_length_in_bytes: Optional[int] = None,
    ) -> HttpResponse:
        if not HttpClient.ssl_context:
            HttpClient.ssl_context = _create_ssl_context()
        headers_to_send = headers or {}
        if isinstance(data, dict):
            headers_to_send['Accept'] = 'application/json'
            headers_to_send['Content-Type'] = 'application/json'

        request = urllib.request.Request(
            url=url,
            data=json.dumps(data).encode() if isinstance(data, dict) else data,
            headers=headers_to_send,
            method=method or 'GET',
        )
        if timeout_in_seconds is None:
            timeout_in_seconds = 60 if isinstance(data, dict) else 180  # TODO: Calculate timeout based on data size

        last_error: Optional[Exception] = None
        for retry_count in range(retries + 1):
            if retry_count > 0:
                time.sleep(5 * retry_count)
                logger_no_user_data.debug(f'Retrying HTTP {method} request...')
            try:
                with urllib.request.urlopen(
                    request,
                    context=HttpClient.ssl_context,
                    timeout=timeout_in_seconds,
                ) as response:
                    if max_content_length_in_bytes:
                        content_length = response.getheader('Content-Length')
                        if not content_length:
                            raise ValueError('No Content-Length in response headers')

                        if int(content_length) > max_content_length_in_bytes:
                            raise ValueError(f'Content-Length exceeds {max_content_length_in_bytes} bytes')

                    return HttpResponse(response, response_path)

            except urllib.error.HTTPError as error:
                if error.code == 429:
                    logger_no_user_data.warning(f'HTTP {method} request failed with status 429 for "{url}"')
                    last_error = error
                elif error.code == 500 and retry_on_http_500:
                    logger_no_user_data.warning(f'HTTP {method} request failed with status 500 for "{url}"')
                    last_error = error
                elif error.code == 502:
                    logger_no_user_data.warning(f'HTTP {method} request failed with status 502 for "{url}"')
                    last_error = error
                elif error.code == 503:
                    logger_no_user_data.warning(f'HTTP {method} request failed with status 503 for "{url}"')
                    last_error = error
                elif error.code == 504:
                    logger_no_user_data.warning(f'HTTP {method} request failed with status 504 for "{url}"')
                    last_error = error
                else:
                    raise HttpError(error) from None

            except urllib.error.URLError as error:
                if isinstance(error.reason, socket.timeout):
                    if retry_count > 0:
                        logger_no_user_data.warning(f'HTTP {method} request failed with read timeout for "{url}"')
                    last_error = error
                else:
                    raise error

            except socket.timeout as error:
                if retry_count > 0:
                    logger_no_user_data.warning(f'HTTP {method} request failed with read timeout for "{url}"')
                last_error = error

            except http.client.IncompleteRead as error:
                logger_no_user_data.warning(
                    f'HTTP {method} request failed with incomplete read for "{url}": {repr(error)}'
                )
                last_error = error

        raise last_error or Exception(f'HTTP {method} request failed after {retries} retries for "{url}"')
