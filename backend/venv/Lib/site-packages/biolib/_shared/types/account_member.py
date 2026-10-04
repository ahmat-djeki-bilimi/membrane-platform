from .typing import Literal, TypedDict
from .user import UserDict


class AccountMemberDict(TypedDict):
    user: UserDict
    role: Literal['member', 'admin']
    added_at: str
