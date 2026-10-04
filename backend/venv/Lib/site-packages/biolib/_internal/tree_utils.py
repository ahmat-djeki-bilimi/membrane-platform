"""Utilities for displaying file trees and formatting file sizes."""

from typing import Any, Dict, List, Optional, Union

from biolib.biolib_binary_format.utils import LazyLoadedFile


def format_size(size_bytes: int) -> str:
    """Convert bytes to human-readable format (e.g., 2.5KB).

    Args:
        size_bytes: File size in bytes

    Returns:
        Human-readable string representation of the file size
    """
    if size_bytes < 1024:
        return f'{size_bytes}B'
    elif size_bytes < 1024 * 1024:
        return f'{size_bytes/1024:.1f}KB'
    elif size_bytes < 1024 * 1024 * 1024:
        return f'{size_bytes/(1024*1024):.1f}MB'
    else:
        return f'{size_bytes/(1024*1024*1024):.1f}GB'


def build_tree_str(
    data: Dict[str, Any],
    prefix: str = '',
    tree_lines: Optional[List[str]] = None,
    blue: str = '\033[34m',
    white: str = '\033[90m',  # Changed from white (37m) to dark gray (90m) for better visibility on light backgrounds
    reset: str = '\033[0m',
) -> List[str]:
    """Build a string representation of a file tree with color-coded directories and files.

    Args:
        data: Hierarchical tree structure of directories and files
        prefix: Line prefix for indentation and tree structure characters
        tree_lines: List to accumulate tree lines
        blue: ANSI color code for directories
        white: ANSI color code for files (defaults to dark gray for visibility on light backgrounds)
        reset: ANSI color code to reset color

    Returns:
        List of tree lines for display
    """
    if tree_lines is None:
        tree_lines = []

    # Get sorted items, keeping directories first
    items = sorted([(k, v) for k, v in data.items() if k != '__files__'])
    files_list = sorted(data.get('__files__', []), key=lambda f: f['name'])

    # Add directories
    for i, (key, value) in enumerate(items):
        is_last_dir = i == len(items) - 1 and not files_list

        if is_last_dir:
            tree_lines.append(f'{prefix}└── {blue}{key}{reset}')
            build_tree_str(value, prefix + '    ', tree_lines, blue, white, reset)
        else:
            tree_lines.append(f'{prefix}├── {blue}{key}{reset}')
            build_tree_str(value, prefix + '│   ', tree_lines, blue, white, reset)

    # Add files with their sizes
    for i, file in enumerate(files_list):
        is_last = i == len(files_list) - 1
        size_str = format_size(file['size'])
        file_name = file['name']

        if is_last:
            tree_lines.append(f'{prefix}└── {white}{file_name} ({size_str}){reset}')
        else:
            tree_lines.append(f'{prefix}├── {white}{file_name} ({size_str}){reset}')

    return tree_lines


def build_tree_from_files(files: List[LazyLoadedFile]) -> Dict[str, Union[Dict[str, Any], List[Dict[str, Any]]]]:
    """Build a hierarchical tree structure from a list of files.

    Args:
        files: List of files to organize into a tree

    Returns:
        Hierarchical tree structure of directories and files
    """
    tree: Dict[str, Union[Dict[str, Any], List[Dict[str, Any]]]] = {}
    for file in files:
        parts = file.path.lstrip('/').split('/')
        current: Dict[str, Union[Dict[str, Any], List[Dict[str, Any]]]] = tree
        for i, part in enumerate(parts):
            if i == len(parts) - 1:  # This is a file
                if '__files__' not in current:
                    current['__files__'] = []
                files_list = current['__files__']
                assert isinstance(files_list, list)
                files_list.append({'name': part, 'size': file.length})
            else:  # This is a directory
                if part not in current:
                    current[part] = {}
                dir_dict = current[part]
                assert isinstance(dir_dict, dict)
                current = dir_dict
    return tree
