import os
import shutil
import sys

from biolib._internal.templates import templates


def add_copilot_prompts(force: bool, silent: bool = False) -> None:
    current_working_directory = os.getcwd()
    config_file_path = f'{current_working_directory}/.biolib/config.yml'
    if not os.path.exists(config_file_path):
        err_string = """
Error: Current directory has not been initialized as a BioLib application.
       Please run the \"biolib init\" command first"""
        print(err_string, file=sys.stderr)
        exit(1)
    source_path = os.path.join(templates.copilot_template(), '.github')
    destination_path = os.path.join(current_working_directory, '.github')

    conflicting_files = []
    files_to_overwrite = set()

    for root, _, filenames in os.walk(source_path):
        relative_dir = os.path.relpath(root, source_path)
        destination_dir = os.path.join(destination_path, relative_dir)
        for filename in filenames:
            source_file = os.path.join(root, filename)
            destination_file = os.path.join(destination_dir, filename)
            if os.path.exists(destination_file) and not force:
                with open(source_file, 'rb') as fsrc, open(destination_file, 'rb') as fdest:
                    if fsrc.read() != fdest.read():
                        conflicting_files.append(os.path.relpath(destination_file, current_working_directory))

    if conflicting_files:
        print('The following files already exist and would be overwritten:')
        for conflicting_file in conflicting_files:
            print(f'  {conflicting_file}')
        print()

        for conflicting_file in conflicting_files:
            choice = input(f'Overwrite {conflicting_file}? [y/N]: ').lower().strip()
            if choice in ['y', 'yes']:
                files_to_overwrite.add(conflicting_file)

    for root, _, filenames in os.walk(source_path):
        relative_dir = os.path.relpath(root, source_path)
        destination_dir = os.path.join(destination_path, relative_dir)
        for filename in filenames:
            source_file = os.path.join(root, filename)
            destination_file = os.path.join(destination_dir, filename)
            relative_file_path = os.path.relpath(destination_file, current_working_directory)

            if not os.path.exists(destination_file) or force or relative_file_path in files_to_overwrite:
                os.makedirs(destination_dir, exist_ok=True)
                shutil.copy2(source_file, destination_file)

    if not silent:
        print(f'Prompt and instruction files added to {destination_path}/')
