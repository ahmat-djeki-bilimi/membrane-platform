from .account import AccountDict
from .typing import Optional, TypedDict


class EnterpriseSettingsDict(TypedDict):
    account_uuid: str
    dashboard_message: Optional[str]
    docs_message: Optional[str]
    featured_dashboard_app_version_uuid: Optional[str]


class UserDict(TypedDict):
    uuid: str
    account: AccountDict


class UserDetailedDict(UserDict):
    email: str
    enterprise_settings: Optional[EnterpriseSettingsDict]
