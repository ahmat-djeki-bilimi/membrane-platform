import mimetypes
import os
import random
import re
import subprocess
import urllib.parse

import biolib.api
from biolib import biolib_errors
from biolib._internal.http_client import HttpError
from biolib.api.client import ApiClient
from biolib.biolib_api_client import AppGetResponse
from biolib.biolib_logging import logger
from biolib.typing_utils import Optional
from biolib.utils import load_base_url_from_env


def encode_multipart(data, files):
    boundary = f'----------{random.randint(0, 1000000000)}'
    line_array = []

    for key, value in data.items():
        if value is not None:
            line_array.append(f'--{boundary}')
            line_array.append(f'Content-Disposition: form-data; name="{key}"')
            line_array.append('')
            line_array.append(value)

    for key, (filename, value) in files.items():
        line_array.append(f'--{boundary}')
        line_array.append(f'Content-Disposition: form-data; name="{key}"; filename="{filename}"')
        line_array.append(f'Content-Type: {mimetypes.guess_type(filename)[0] or "application/octet-stream"}')
        line_array.append('')
        line_array.append('')
        line_array.append(value)

    line_array.append(f'--{boundary}--')
    line_array.append('')

    data_encoded = b'\r\n'.join([line.encode() if isinstance(line, str) else line for line in line_array])
    return f'multipart/form-data; boundary={boundary}', data_encoded


def _get_git_branch_name() -> str:
    try:
        github_actions_branch_name = os.getenv('GITHUB_REF_NAME')
        if github_actions_branch_name:
            return github_actions_branch_name

        gitlab_ci_branch_name = os.getenv('CI_COMMIT_REF_NAME')
        if gitlab_ci_branch_name:
            return gitlab_ci_branch_name

        result = subprocess.run(['git', 'branch', '--show-current'], check=True, stdout=subprocess.PIPE, text=True)
        return result.stdout.strip()
    except BaseException:
        return ''


def _get_git_commit_hash() -> str:
    try:
        github_actions_commit_hash = os.getenv('GITHUB_SHA')
        if github_actions_commit_hash:
            return github_actions_commit_hash

        gitlab_ci_commit_hash = os.getenv('CI_COMMIT_SHA')
        if gitlab_ci_commit_hash:
            return gitlab_ci_commit_hash

        result = subprocess.run(['git', 'rev-parse', 'HEAD'], check=True, stdout=subprocess.PIPE, text=True)
        return result.stdout.strip()
    except BaseException:
        return ''


def _get_git_repository_url() -> str:
    try:
        result = subprocess.run(['git', 'remote', 'get-url', 'origin'], check=True, stdout=subprocess.PIPE, text=True)
        return result.stdout.strip()
    except BaseException:
        return ''


def _get_resource_uri_from_str(input_str: str) -> str:
    parsed_base_url = urllib.parse.urlparse(load_base_url_from_env())
    parsed_uri = urllib.parse.urlparse(input_str)
    if parsed_uri.netloc != '' and parsed_base_url.netloc != parsed_uri.netloc:
        raise biolib_errors.ValidationError(f'Invalid URI. The hostname "{parsed_base_url.netloc}" is not recognized.')
    elif parsed_uri.netloc != '' and parsed_uri.path[1] != '@':
        uri = f'@{parsed_uri.netloc}{parsed_uri.path}'
    elif parsed_uri.netloc == '' and parsed_uri.path.startswith(parsed_base_url.netloc):
        uri = f'@{parsed_uri.path}'
    else:
        uri = parsed_uri.path
    uri = uri.strip('/')
    # Replace frontend version path with app_uri compatible version (if supplied)
    uri = re.sub(r'/version/(?P<version>(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*))(/)?$', r':\g<version>', uri)
    return uri


class BiolibAppApi:
    @staticmethod
    def get_by_uri(uri: str, api_client: Optional[ApiClient] = None) -> AppGetResponse:
        uri = _get_resource_uri_from_str(uri)
        api = api_client or biolib.api.client
        try:
            response = api.get(path='/app/', params={'uri': uri})
            app_response: AppGetResponse = response.json()
            return app_response

        except HttpError as error:
            if error.code == 404:
                raise biolib_errors.NotFound(f'Application {uri} not found.') from None

            raise error

    @staticmethod
    def create_app(uri: str):
        uri = _get_resource_uri_from_str(uri)
        try:
            response = biolib.api.client.post(path='/resources/apps/', data={'uri': uri})
            return response.json()
        except HttpError as error:
            raise error

    @staticmethod
    def push_app_version(
        app_id,
        zip_binary,
        author,
        app_name,
        set_as_active,
        app_version_id_to_copy_images_from: Optional[str],
        semantic_version: Optional[str],
    ):
        try:
            data = {
                'app': app_id,
                'set_as_active': 'true' if set_as_active else 'false',
                'state': 'published',
                'app_version_id_to_copy_images_from': app_version_id_to_copy_images_from,
                'git_branch_name': _get_git_branch_name(),
                'git_commit_hash': _get_git_commit_hash(),
                'git_repository_url': _get_git_repository_url(),
            }
            if semantic_version:
                data['semantic_version'] = semantic_version

            content_type, data_encoded = encode_multipart(
                data=data,
                files={
                    'source_files_zip': ('source_files.zip', zip_binary),
                },
            )
            response = biolib.api.client.post(
                path='/app_versions/',
                data=data_encoded,
                headers={'Content-Type': content_type},
            )
        except Exception as error:
            logger.error(f'Push failed for {author}/{app_name}:')
            raise error

        # TODO: When response includes the version number, print the URL for the new app version
        logger.info(f'Initialized new app version for {author}/{app_name}.')
        return response.json()
