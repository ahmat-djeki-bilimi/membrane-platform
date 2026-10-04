import os
from typing import Any


class CliType:
    def convert(self, value: str) -> Any:
        raise NotImplementedError

    def get_metavar(self) -> str:
        return 'VALUE'


class _IntType(CliType):
    def convert(self, value: str) -> int:
        try:
            return int(value)
        except (ValueError, TypeError):
            raise SystemExit(f"Error: '{value}' is not a valid integer.") from None

    def get_metavar(self) -> str:
        return 'INTEGER'


class _BoolType(CliType):
    def convert(self, value: str) -> bool:
        if value.lower() in ('true', '1', 'yes', 'y'):
            return True
        if value.lower() in ('false', '0', 'no', 'n'):
            return False
        raise SystemExit(f"Error: '{value}' is not a valid boolean.") from None

    def get_metavar(self) -> str:
        return 'BOOLEAN'


class _UnprocessedType(CliType):
    def convert(self, value: str) -> str:
        return value

    def get_metavar(self) -> str:
        return 'ARGS'


INT = _IntType()
BOOL = _BoolType()
UNPROCESSED = _UnprocessedType()


class IntRange(CliType):
    def __init__(self, min_value: int, max_value: int):
        self.min_value = min_value
        self.max_value = max_value

    def convert(self, value: str) -> int:
        try:
            int_value = int(value)
        except (ValueError, TypeError):
            raise SystemExit(f"Error: '{value}' is not a valid integer.") from None

        if int_value < self.min_value or int_value > self.max_value:
            raise SystemExit(f'Error: {int_value} is not in the range {self.min_value}..{self.max_value}.') from None
        return int_value

    def get_metavar(self) -> str:
        return 'INTEGER RANGE'


class Path(CliType):
    def __init__(self, exists: bool = False):
        self.exists = exists

    def convert(self, value: str) -> str:
        if self.exists and not os.path.exists(value):
            raise SystemExit(f"Error: Path '{value}' does not exist.") from None
        return value

    def get_metavar(self) -> str:
        return 'PATH'
