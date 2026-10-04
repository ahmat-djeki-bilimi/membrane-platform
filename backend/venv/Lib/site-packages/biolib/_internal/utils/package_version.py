def get_package_version() -> str:
    try:
        from importlib.metadata import PackageNotFoundError, version  # pylint: disable=import-outside-toplevel
    except ImportError:
        from importlib_metadata import (  # type: ignore[import-not-found,no-redef,assignment]  # pylint: disable=import-outside-toplevel
            PackageNotFoundError,
            version,
        )

    try:
        return version('pybiolib')
    except PackageNotFoundError:
        return '0.0.0'
