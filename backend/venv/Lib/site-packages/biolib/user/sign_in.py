import time
import webbrowser

from biolib._internal.utils import open_browser_window_from_notebook
from biolib.biolib_api_client import BiolibApiClient
from biolib.biolib_api_client.auth import BiolibAuthChallengeApi
from biolib.biolib_logging import logger_no_user_data
from biolib.utils import IS_RUNNING_IN_NOTEBOOK


def sign_out() -> None:
    api_client = BiolibApiClient.get(attempt_sign_in=False)
    api_client.sign_out()


def sign_in(open_in_default_browser: bool = False) -> None:
    if not BiolibApiClient.is_reauthentication_needed():
        logger_no_user_data.info('Already signed in')
        return

    api_client = BiolibApiClient.get()
    auth_challenge = BiolibAuthChallengeApi.create_auth_challenge()
    auth_challenge_token = auth_challenge['token']

    client_type = 'notebook' if IS_RUNNING_IN_NOTEBOOK else 'cli'

    frontend_sign_in_url = f'{api_client.base_url}/sign-in/request/{client_type}/?token={auth_challenge_token}'

    if IS_RUNNING_IN_NOTEBOOK:
        print(f'Opening authorization page at: {frontend_sign_in_url}')
        print('If your browser does not open automatically, click on the link above.')
        open_browser_window_from_notebook(frontend_sign_in_url)
    elif open_in_default_browser:
        print(f'Opening authorization page at: {frontend_sign_in_url}')
        print('If your browser does not open automatically, click on the link above.')
        webbrowser.open(frontend_sign_in_url)
    else:
        print('Please copy and paste the following link into your browser:')
        print(frontend_sign_in_url)

    for _ in range(100):
        time.sleep(3)
        auth_challenge_status = BiolibAuthChallengeApi.get_auth_challenge_status(token=auth_challenge_token)

        if auth_challenge_status['state'] != 'awaiting':
            break

    user_tokens = auth_challenge_status.get('user_tokens')
    if user_tokens:
        api_client.set_user_tokens(user_tokens)
        print('Successfully signed in!')

    else:
        print(f"Sign in failed. Got state: {auth_challenge_status['state']}\nPlease try again")
