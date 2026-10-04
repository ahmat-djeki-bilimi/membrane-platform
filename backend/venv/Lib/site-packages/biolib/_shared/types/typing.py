import sys

# import and expose everything from the typing module
from typing import *  # noqa:F403 pylint: disable=wildcard-import, unused-wildcard-import

if sys.version_info < (3, 8):  # noqa: UP036
    from typing_extensions import Literal, TypedDict  # pylint: disable=unused-import

if sys.version_info >= (3, 11):
    from typing import NotRequired  # pylint: disable=unused-import
else:
    # Runtime mock: type checking must run on Python >= 3.11
    class NotRequired:  # type: ignore[no-redef,assignment]  # pylint: disable=function-redefined
        def __class_getitem__(cls, item):  # type: ignore[override]
            return item
