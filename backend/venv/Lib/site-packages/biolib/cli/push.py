import logging
import sys
from typing import Optional

from biolib._internal import cli
from biolib._internal.errors import AuthenticationError
from biolib._internal.push_application import push_application
from biolib.biolib_logging import logger, logger_no_user_data


@cli.command(help='Push an application to BioLib')
@cli.argument('uri')
@cli.option('--path', default='.', required=False)
@cli.option('--copy-images-from-version', required=False)
@cli.option('--dev', is_flag=True, default=False, required=False)
@cli.option('--pre-release', is_flag=True, default=False, required=False)
@cli.option(
    '--dry-run',
    is_flag=True,
    default=False,
    required=False,
    help='Perform validation without pushing',
)
def push(uri, path: str, copy_images_from_version: Optional[str], dev: bool, pre_release: bool, dry_run: bool) -> None:
    logger.configure(default_log_level=logging.INFO)
    logger_no_user_data.configure(default_log_level=logging.INFO)
    set_as_active = True
    set_as_published = True
    if dev and pre_release:
        print('Error: you cannot set both --dev and --pre-release, please select one.')
        exit(1)
    elif dev:
        set_as_active = False
        set_as_published = False
    elif pre_release:
        set_as_active = False
        set_as_published = True
    try:
        push_application(
            app_path=path,
            app_uri=uri,
            app_version_to_copy_images_from=copy_images_from_version,
            set_as_active=set_as_active,
            set_as_published=set_as_published,
            dry_run=dry_run,
        )
    except AuthenticationError as error:
        print(error.message, file=sys.stderr)
        exit(1)
