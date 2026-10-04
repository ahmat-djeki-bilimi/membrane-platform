import os


def init_template() -> str:
    return os.path.join(os.path.dirname(__file__), 'init_template')


def copilot_template() -> str:
    return os.path.join(os.path.dirname(__file__), 'copilot_template')


def gui_template() -> str:
    return os.path.join(os.path.dirname(__file__), 'gui_template')


def dashboard_template() -> str:
    return os.path.join(os.path.dirname(__file__), 'dashboard_template')


def gitignore_template() -> str:
    return os.path.join(os.path.dirname(__file__), 'gitignore_template')


def github_workflow_template() -> str:
    return os.path.join(os.path.dirname(__file__), 'github_workflow_template')
