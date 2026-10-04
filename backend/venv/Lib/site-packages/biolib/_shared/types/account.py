from .typing import TypedDict


class AccountDict(TypedDict):
    uuid: str
    handle: str
    display_name: str
    description: str


class AccountDetailedDict(AccountDict):
    bio: str
