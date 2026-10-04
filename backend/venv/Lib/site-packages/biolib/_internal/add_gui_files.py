import os

from biolib._internal.file_utils import copy_file_with_replacements
from biolib._internal.templates import templates
from biolib.typing_utils import Dict


def add_gui_files(replacements: Dict[str, str], force=False, silent=False) -> None:
    cwd = os.getcwd()
    template_dir = templates.gui_template()

    root_files = ['package.json', 'Dockerfile', 'vite.config.mts', '.yarnrc.yml']

    conflicting_files = []
    files_to_overwrite = set()

    for root, _, filenames in os.walk(template_dir):
        relative_dir = os.path.relpath(root, template_dir)

        for filename in filenames:
            if filename in root_files:
                destination_dir = cwd
            else:
                if relative_dir == '.':
                    destination_dir = os.path.join(cwd, 'gui')
                else:
                    destination_dir = os.path.join(cwd, 'gui', relative_dir)

            source_file = os.path.join(root, filename)
            destination_file = os.path.join(destination_dir, filename)

            if filename == 'Dockerfile':
                continue

            if os.path.exists(destination_file) and not force:
                with open(source_file, 'rb') as fsrc, open(destination_file, 'rb') as fdest:
                    if fsrc.read() != fdest.read():
                        conflicting_files.append(os.path.relpath(destination_file, cwd))

    if conflicting_files:
        print('The following files already exist and would be overwritten:')
        for conflicting_file in conflicting_files:
            print(f'  {conflicting_file}')
        print()

        for conflicting_file in conflicting_files:
            choice = input(f'Overwrite {conflicting_file}? [y/N]: ').lower().strip()
            if choice in ['y', 'yes']:
                files_to_overwrite.add(conflicting_file)

    for root, _, filenames in os.walk(template_dir):
        relative_dir = os.path.relpath(root, template_dir)

        for filename in filenames:
            if filename in root_files:
                destination_dir = cwd
            else:
                if relative_dir == '.':
                    destination_dir = os.path.join(cwd, 'gui')
                else:
                    destination_dir = os.path.join(cwd, 'gui', relative_dir)

            source_file = os.path.join(root, filename)
            destination_file = os.path.join(destination_dir, filename)
            relative_file_path = os.path.relpath(destination_file, cwd)

            should_force = force or filename == 'Dockerfile'
            if not os.path.exists(destination_file) or should_force or relative_file_path in files_to_overwrite:
                os.makedirs(destination_dir, exist_ok=True)
                copy_file_with_replacements(source_file, destination_file, replacements)

    gitignore_path = os.path.join(cwd, '.gitignore')
    with open(gitignore_path, 'a') as gitignore_file:
        gitignore_file.write('\n# gui\n')
        gitignore_file.write('.yarn\n')
        gitignore_file.write('dist\n')
        gitignore_file.write('yarn.lock\n')
        gitignore_file.write('tsconfig.tsbuildinfo\n')
        gitignore_file.write('node_modules\n')

    if not silent:
        print('gui files added to project root and gui/ subdirectory')
