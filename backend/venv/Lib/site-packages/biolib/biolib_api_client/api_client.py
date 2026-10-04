import os
from datetime import datetime, timezone
from json.decoder import JSONDecodeError

from biolib._internal.http_client import HttpClient
from biolib._internal.utils.auth import decode_jwt_without_checking_signature
from biolib._runtime.runtime import Runtime
from biolib.biolib_errors import BioLibError
from biolib.biolib_logging import logger, logger_no_user_data
from biolib.typing_utils import Optional, TypedDict

from .user_state import UserState


class UserTokens(TypedDict):
    access: str
    refresh: str


class _ApiClient:
    def __init__(self, base_url: str, access_token: Optional[str] = None):
        self.base_url: str = base_url
        self.access_token: Optional[str] = access_token  # TODO: Deprecate passing access_token in constructor
        self.refresh_token: Optional[str] = None
        self.resource_deploy_key: Optional[str] = None

        self._user_state = UserState()
        self._sign_in_attempted: bool = False

    @property
    def is_signed_in(self) -> bool:
        return bool(self.refresh_token or self.resource_deploy_key)

    def set_user_tokens(self, user_tokens: UserTokens) -> None:
        with self._user_state as user_state:
            user_state['refresh_token'] = user_tokens['refresh']

        self.access_token = user_tokens['access']
        self.refresh_token = user_tokens['refresh']

    def sign_out(self) -> None:
        api_token = os.getenv('BIOLIB_TOKEN', default=None)
        if api_token:
            print('To sign out unset the environment variable "BIOLIB_TOKEN"')

        self.access_token = None
        self.refresh_token = None

        with self._user_state as user_state:
            user_state['refresh_token'] = None

    def refresh_access_token(self) -> None:
        if not self.is_signed_in or self.resource_deploy_key:
            return

        if self.access_token:
            decoded_token = decode_jwt_without_checking_signature(self.access_token)
            if datetime.now(tz=timezone.utc).timestamp() < decoded_token['payload']['exp'] - 60:  # 60 second buffer
                # Token has not expired yet
                return

        # TODO: Implement nicer error handling
        try:
            response = HttpClient.request(
                method='POST',
                url=f'{self.base_url}/api/user/token/refresh/',
                data={'refresh': self.refresh_token},
            )
        except Exception as exception:
            logger.error('Sign in with refresh token failed')
            raise exception

        try:
            response_dict = response.json()
        except JSONDecodeError as error:
            logger.error('Could not decode response from server as JSON:')
            raise BioLibError(response.text) from error

        self.access_token = response_dict['access']

    def attempt_sign_in(self) -> None:
        if not self._sign_in_attempted:
            self._attempt_sign_in()
            self._sign_in_attempted = True

    def _attempt_sign_in(self) -> None:
        api_token = os.getenv('BIOLIB_TOKEN', default=None)

        if api_token:
            if api_token.startswith('bld_'):
                self.resource_deploy_key = api_token
            else:
                self.sign_in_with_api_token(api_token)
        else:
            with self._user_state as user_state:
                refresh_token_from_state = user_state['refresh_token']

            # TODO: Handle expired refresh token
            if refresh_token_from_state:
                logger_no_user_data.debug('ApiClient: Signing in with refresh token from user state...')
                self.refresh_token = refresh_token_from_state
                try:
                    self.refresh_access_token()
                except Exception:  # pylint: disable=broad-except
                    self.refresh_token = None
                    with self._user_state as user_state:
                        user_state['refresh_token'] = None

    def sign_in_with_api_token(self, api_token: str) -> None:
        logger_no_user_data.debug('ApiClient: Signing in with BIOLIB_TOKEN...')
        try:
            response = HttpClient.request(
                method='POST',
                url=f'{self.base_url}/api/user/api_tokens/exchange/',
                data={'token': api_token},
            )
        except Exception as exception:
            logger.error('Sign in with API token failed')
            raise exception
        try:
            json_response = response.json()
        except JSONDecodeError as error:
            logger.error('Could not decode response from server as JSON')
            raise BioLibError(response.text) from error

        self.access_token = json_response['access_token']
        self.refresh_token = json_response['refresh_token']


class BiolibApiClient:
    api_client: Optional[_ApiClient] = None

    @staticmethod
    def initialize(base_url: str, access_token: Optional[str] = None):
        BiolibApiClient.api_client = _ApiClient(base_url=base_url, access_token=access_token)

    @staticmethod
    def get(attempt_sign_in: bool = True) -> _ApiClient:
        api_client = BiolibApiClient.api_client
        if api_client:
            if attempt_sign_in:
                api_client.attempt_sign_in()
            return api_client

        raise BioLibError('Attempted to use uninitialized API client')

    @staticmethod
    def refresh_auth_token():
        api_client = BiolibApiClient.get()
        api_client.refresh_access_token()

    @staticmethod
    def is_reauthentication_needed() -> bool:
        api_client = BiolibApiClient.get()
        if not api_client.is_signed_in and not Runtime.check_is_environment_biolib_app():
            return True
        else:
            return False

    @staticmethod
    def assert_is_signed_in(authenticated_action_description: str) -> None:
        if BiolibApiClient.is_reauthentication_needed():
            raise BioLibError(
                f'You must be signed in to {authenticated_action_description}. '
                f'Please set the environment variable "BIOLIB_TOKEN"'
            )
