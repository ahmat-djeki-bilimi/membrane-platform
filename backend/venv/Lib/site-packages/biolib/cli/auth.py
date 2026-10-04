import logging
import sys

from biolib import api
from biolib._internal import cli
from biolib.biolib_api_client.api_client import BiolibApiClient
from biolib.biolib_logging import logger, logger_no_user_data
from biolib.user import sign_in, sign_out


@cli.command(help='Login your to BioLib account with web browser')
@cli.option(
    '-w',
    is_flag=True,
    default=False,
    required=False,
    type=bool,
    help='Automatically open the login page in the default web browser',
)
def login(w: bool) -> None:  # pylint: disable=invalid-name
    logger.configure(default_log_level=logging.INFO)
    logger_no_user_data.configure(default_log_level=logging.INFO)
    sign_in(open_in_default_browser=w)


@cli.command(help='Logout of your BioLib account')
def logout() -> None:
    logger.configure(default_log_level=logging.INFO)
    logger_no_user_data.configure(default_log_level=logging.INFO)
    sign_out()


@cli.command(help='Prints out the full name of the user logged in')
def whoami() -> None:
    client = BiolibApiClient.get()
    if client.is_signed_in:
        response = api.client.get(path='/users/me/')
        user_dict = response.json()
        email = user_dict['email']
        display_name = user_dict['account']['display_name']

        print(f'Name: {display_name}\nEmail: {email}\nLogged into: {client.base_url}')
    else:
        print('Not logged in', file=sys.stderr)
        exit(1)
