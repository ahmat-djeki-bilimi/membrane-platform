import os
import sys


def get_user_cache_dir() -> str:
    app_name = 'pybiolib'
    app_author = 'biolib'
    system = sys.platform
    if system == 'win32':
        path = os.environ.get('LOCALAPPDATA', os.path.expanduser('~'))
        path = os.path.join(path, app_author, app_name, 'Cache')
    elif system == 'darwin':
        path = os.path.join(os.path.expanduser('~/Library/Caches'), app_name)
    else:
        path = os.environ.get('XDG_CACHE_HOME', os.path.expanduser('~/.cache'))
        path = os.path.join(path, app_name)
    return path
