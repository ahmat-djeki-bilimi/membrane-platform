import os
import shutil
import subprocess
import sys

from biolib import (
    biolib_errors,
    utils,  # Import like this to let BASE_URL_IS_PUBLIC_BIOLIB be set correctly
)
from biolib._internal import cli
from biolib._internal.add_copilot_prompts import add_copilot_prompts
from biolib._internal.add_gui_files import add_gui_files
from biolib._internal.file_utils import copy_file_with_replacements
from biolib._internal.http_client import HttpClient, HttpError
from biolib._internal.string_utils import normalize_for_docker_tag
from biolib._internal.templates import templates
from biolib._internal.utils import get_pip_command
from biolib.api import client as api_client
from biolib.biolib_api_client.api_client import BiolibApiClient
from biolib.biolib_api_client.biolib_app_api import BiolibAppApi
from biolib.biolib_logging import logger_no_user_data
from biolib.typing_utils import Dict, List, Optional, Set
from biolib.user.sign_in import sign_in
from biolib.utils import BIOLIB_PACKAGE_VERSION


def _get_latest_pypi_version() -> Optional[str]:
    try:
        response = HttpClient.request(
            url='https://pypi.org/pypi/pybiolib/json',
            timeout_in_seconds=5,
            retries=1,
        )
        data = response.json()
        version = data.get('info', {}).get('version')
        if isinstance(version, str):
            return version
        return None
    except Exception as error:
        logger_no_user_data.debug(f'Failed to fetch latest version from PyPI: {error}')
        return None


def _is_current_version_outdated(current: str, latest: str) -> bool:
    try:
        current_parts = [int(x) for x in current.split('.')]
        latest_parts = [int(x) for x in latest.split('.')]
        return current_parts < latest_parts
    except (ValueError, AttributeError):
        return False


def _check_version_and_prompt_upgrade() -> bool:
    latest_version = _get_latest_pypi_version()
    if latest_version and _is_current_version_outdated(BIOLIB_PACKAGE_VERSION, latest_version):
        print(f'A newer version of pybiolib is available: {latest_version} (current: {BIOLIB_PACKAGE_VERSION})')
        pip_command = get_pip_command()
        print(f'To upgrade, run: {pip_command} install --upgrade pybiolib')
        print()
        continue_input = input('Do you want to continue with the current version? [y/N]: ')
        if continue_input.lower() not in ['y', 'yes']:
            print('Please upgrade pybiolib and run `biolib init` again.')
            return False
    return True


def _prompt_for_app_uri(prompt_text: str) -> Optional[str]:
    app_uri = input(prompt_text)

    if app_uri and not app_uri.startswith('@'):
        try:
            response = api_client.get('system/enterprise/config/', authenticate=False)
            config = response.json()
            prefix = config.get('resource_hostname_prefix')
            if prefix:
                app_uri = f'@{prefix}/{app_uri}'
                print(f'Detected enterprise deployment, using URI: {app_uri}')
        except HttpError as error:
            if error.code not in [404, 501]:
                print(f'Warning: Could not detect enterprise configuration: {error}')
        except Exception as error:
            print(f'Warning: Could not detect enterprise configuration: {error}')

    return app_uri if app_uri else None


def _validate_or_create_app(app_uri: str) -> bool:
    try:
        if BiolibApiClient.is_reauthentication_needed():
            sign_in_input = input('You need to sign in to validate/create apps. Would you like to sign in? [y/N]: ')
            if sign_in_input.lower() in ['y', 'yes']:
                sign_in()
            else:
                print('Skipping app validation and creation. You can set the URI in .biolib/config.yml later.')
                return False

        BiolibAppApi.get_by_uri(app_uri)
        print(f'App {app_uri} already exists.')
    except biolib_errors.NotFound:
        create_app_input = input(f'App {app_uri} does not exist. Would you like to create it? [y/N]: ')
        if create_app_input.lower() in ['y', 'yes']:
            try:
                BiolibAppApi.create_app(app_uri)
                print(f'Successfully created app {app_uri}')
            except Exception as error:
                print(f'Failed to create app {app_uri}: {str(error)}')
                print('You can create the app manually later or set the URI in .biolib/config.yml')
        else:
            print('App creation skipped. You can create the app manually later or set the URI in .biolib/config.yml')
    except Exception as error:
        print(f'Failed to validate app {app_uri}: {str(error)}')
        print('Continuing with initialization...')

    return True


def _find_conflicting_files(template_dir: str, cwd: str) -> List[str]:
    conflicting_files: List[str] = []
    for root, dirs, filenames in os.walk(template_dir):
        dirs[:] = [d for d in dirs if '__pycache__' not in d]
        relative_dir = os.path.relpath(root, template_dir)
        destination_dir = cwd if relative_dir == '.' else os.path.join(cwd, relative_dir)

        for filename in filenames:
            source_file = os.path.join(root, filename)
            destination_file = os.path.join(destination_dir, filename)
            if os.path.exists(destination_file):
                with open(source_file, 'rb') as fsrc, open(destination_file, 'rb') as fdest:
                    if fsrc.read() != fdest.read():
                        conflicting_files.append(os.path.relpath(destination_file, cwd))
    return conflicting_files


def _prompt_for_overwrites(conflicting_files: List[str]) -> Set[str]:
    files_to_overwrite: Set[str] = set()
    if conflicting_files:
        print('The following files already exist and would be overwritten:')
        for conflicting_file in conflicting_files:
            print(f'  {conflicting_file}')
        print()

        for conflicting_file in conflicting_files:
            choice = input(f'Overwrite {conflicting_file}? [y/N]: ').lower().strip()
            if choice in ['y', 'yes']:
                files_to_overwrite.add(conflicting_file)
    return files_to_overwrite


def _copy_template_files(
    template_dir: str,
    cwd: str,
    files_to_overwrite: Set[str],
    replacements: Dict[str, str],
) -> None:
    for root, dirs, filenames in os.walk(template_dir):
        dirs[:] = [d for d in dirs if '__pycache__' not in d]
        relative_dir = os.path.relpath(root, template_dir)
        destination_dir = os.path.join(cwd, relative_dir)

        os.makedirs(destination_dir, exist_ok=True)

        for filename in filenames:
            if utils.BASE_URL_IS_PUBLIC_BIOLIB and filename == 'biolib.yml':
                continue

            source_file = os.path.join(root, filename)
            destination_file = os.path.join(destination_dir, filename)
            relative_file_path = os.path.relpath(destination_file, cwd)

            if not os.path.exists(destination_file) or relative_file_path in files_to_overwrite:
                copy_file_with_replacements(source_file, destination_file, replacements)


def _create_readme_if_needed(cwd: str, app_name: Optional[str]) -> None:
    readme_path = os.path.join(cwd, 'README.md')
    if not os.path.exists(readme_path) and app_name:
        with open(readme_path, 'w') as readme_file:
            readme_file.write(f'# {app_name}\n')


def _copy_gitignore(cwd: str) -> None:
    gitignore_template_dir = templates.gitignore_template()
    source_file = os.path.join(gitignore_template_dir, '.gitignore')
    destination_file = os.path.join(cwd, '.gitignore')
    if not os.path.exists(destination_file):
        shutil.copy2(source_file, destination_file)


def _copy_github_workflow(cwd: str, replacements: Dict[str, str]) -> None:
    workflow_template_dir = templates.github_workflow_template()
    source_file = os.path.join(workflow_template_dir, '.github', 'workflows', 'biolib.yml')
    destination_dir = os.path.join(cwd, '.github', 'workflows')
    destination_file = os.path.join(destination_dir, 'biolib.yml')

    if not os.path.exists(destination_file):
        os.makedirs(destination_dir, exist_ok=True)
        copy_file_with_replacements(source_file, destination_file, replacements)


def _prompt_and_run_yarn_install() -> None:
    yarn_install_input = input('Do you want to run yarn install? [Y/n]: ')
    if yarn_install_input.lower() not in ['n', 'no']:
        print('Running yarn install...')
        try:
            subprocess.run(['yarn', 'install'], check=True)
            print('yarn install completed successfully.')
        except FileNotFoundError:
            print(
                'Error: yarn is not installed or not found in PATH. Please install yarn and run yarn install manually.'
            )
        except subprocess.CalledProcessError as error:
            print(f'yarn install failed with exit code {error.returncode}. Please run yarn install manually.')
        except Exception as error:
            print(f'yarn install failed: {error}. Please run yarn install manually.')


def _create_dashboard_dockerfile(cwd: str) -> None:
    gui_template_dir = templates.gui_template()
    gui_dockerfile = os.path.join(gui_template_dir, 'Dockerfile')
    destination_file = os.path.join(cwd, 'Dockerfile')

    if not os.path.exists(destination_file):
        with open(gui_dockerfile) as f:
            lines = f.readlines()

        gui_builder_lines = []
        for line in lines:
            gui_builder_lines.append(line)
            if line.strip() == 'RUN yarn build':
                break

        dist_export_stage = '\nFROM scratch AS dist_export\nCOPY --from=gui_builder /home/biolib/gui/dist /dist\n'
        with open(destination_file, 'w') as f:
            f.writelines(gui_builder_lines)
            f.write(dist_export_stage)


def _copy_gui_files_for_dashboard(cwd: str, replacements: Dict[str, str]) -> None:
    gui_template_dir = templates.gui_template()
    gui_root_files = ['package.json', 'vite.config.mts', '.yarnrc.yml']

    for root, _, filenames in os.walk(gui_template_dir):
        relative_dir = os.path.relpath(root, gui_template_dir)

        for filename in filenames:
            if filename == 'Dockerfile':
                continue

            if filename in gui_root_files:
                destination_dir = cwd
            else:
                if relative_dir == '.':
                    destination_dir = os.path.join(cwd, 'gui')
                else:
                    destination_dir = os.path.join(cwd, 'gui', relative_dir)

            source_file = os.path.join(root, filename)
            destination_file = os.path.join(destination_dir, filename)

            if not os.path.exists(destination_file):
                os.makedirs(destination_dir, exist_ok=True)
                copy_file_with_replacements(source_file, destination_file, replacements)


def _init_dashboard() -> None:
    if not _check_version_and_prompt_upgrade():
        return

    cwd = os.getcwd()
    app_uri = _prompt_for_app_uri('What URI do you want to create the dashboard under? (leave blank to skip): ')
    app_name = app_uri.split('/')[-1] if app_uri else None

    if app_uri:
        if not _validate_or_create_app(app_uri):
            return
    else:
        print(
            'Remember to set the app URI in the .biolib/config.yml file later, '
            'and update the .github/workflows/biolib.yml file.'
        )

    dashboard_template_dir = templates.dashboard_template()

    try:
        conflicting_files = _find_conflicting_files(dashboard_template_dir, cwd)
        files_to_overwrite = _prompt_for_overwrites(conflicting_files)

        replace_app_uri = app_uri if app_uri else 'PUT_APP_URI_HERE'
        replace_app_name = app_name if app_name else 'biolib-dashboard'

        replacements = {
            'BIOLIB_REPLACE_APP_URI': replace_app_uri,
            'BIOLIB_REPLACE_APP_NAME': replace_app_name,
            'BIOLIB_REPLACE_BUILD_COMMAND': 'docker build --target dist_export -o type=local,dest=. .',
        }

        _copy_template_files(dashboard_template_dir, cwd, files_to_overwrite, replacements)
        _create_readme_if_needed(cwd, app_name)
        _copy_gitignore(cwd)
        _copy_github_workflow(cwd, replacements)
        _create_dashboard_dockerfile(cwd)
        _copy_gui_files_for_dashboard(cwd, replacements)
        _prompt_and_run_yarn_install()

        print('Dashboard template initialized successfully.')

    except KeyboardInterrupt:
        print('\nInit command cancelled.', file=sys.stderr)
        exit(1)


@cli.command(help='Initialize a BioLib project', hidden=True)
@cli.argument('template_type', required=False, default=None)
def init(template_type: Optional[str]) -> None:
    if template_type == 'dashboard':
        _init_dashboard()
        return

    if template_type is not None:
        print(f"Unknown template type: '{template_type}'. Available templates: dashboard")
        print('Run `biolib init` without arguments for the default Python application template.')
        return

    if not _check_version_and_prompt_upgrade():
        return

    cwd = os.getcwd()
    app_uri = _prompt_for_app_uri('What URI do you want to create the application under? (leave blank to skip): ')
    app_name = app_uri.split('/')[-1] if app_uri else None
    docker_tag = normalize_for_docker_tag(app_name) if app_name else None

    if app_uri:
        if not _validate_or_create_app(app_uri):
            return
    else:
        print(
            'Remember to set the app URI in the .biolib/config.yml file later, '
            'and docker image name in the .biolib/config.yml and .github/workflows/biolib.yml files.'
        )

    advanced_setup_input = input('Do you want to set up advanced features like Copilot and GUI? [y/N]: ')
    advanced_setup = advanced_setup_input.lower() == 'y'
    include_copilot = False
    include_gui = False
    if advanced_setup:
        copilot_enabled_input = input('Do you want to include Copilot instructions and prompts? [y/N]: ')
        include_copilot = copilot_enabled_input.lower() == 'y'
        include_gui_input = input('Do you want to include GUI setup? [y/N]: ')
        include_gui = include_gui_input.lower() == 'y'

    init_template_dir = templates.init_template()

    try:
        conflicting_files = _find_conflicting_files(init_template_dir, cwd)
        files_to_overwrite = _prompt_for_overwrites(conflicting_files)

        replace_app_uri = app_uri if app_uri else 'PUT_APP_URI_HERE'
        replace_app_name = app_name if app_name else 'biolib-app'
        build_tag = docker_tag if docker_tag else 'PUT_DOCKER_TAG_HERE'

        gui_config = "main_output_file: '/result.html'\n" if include_gui else ''
        gui_mv_command = 'mv result.html output/result.html\n' if include_gui else ''
        replacements = {
            'BIOLIB_REPLACE_PYBIOLIB_VERSION': BIOLIB_PACKAGE_VERSION,
            'BIOLIB_REPLACE_APP_URI': replace_app_uri,
            'BIOLIB_REPLACE_DOCKER_TAG': build_tag,
            'BIOLIB_REPLACE_APP_NAME': replace_app_name,
            'BIOLIB_REPLACE_BUILD_COMMAND': f'docker build -t {build_tag}:latest .',
            'BIOLIB_REPLACE_GUI_CONFIG\n': gui_config,
            'BIOLIB_REPLACE_GUI_MV_COMMAND\n': gui_mv_command,
        }

        _copy_template_files(init_template_dir, cwd, files_to_overwrite, replacements)
        _create_readme_if_needed(cwd, app_name)
        _copy_gitignore(cwd)
        _copy_github_workflow(cwd, replacements)

        if include_copilot:
            add_copilot_prompts(force=False, silent=True)

        if include_gui:
            add_gui_files(replacements, force=False, silent=True)
            _prompt_and_run_yarn_install()

    except KeyboardInterrupt:
        print('\nInit command cancelled.', file=sys.stderr)
        exit(1)
