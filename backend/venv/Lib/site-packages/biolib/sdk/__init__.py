from typing import Any, Dict, List, Optional, Union

# Imports to hide and use as private internal utils
from biolib._data_record.data_record import DataRecord as _DataRecord
from biolib._index.index import Index as _Index
from biolib._index.query_result import IndexQueryResult
from biolib._index.query_result import query_index as _query_index
from biolib._internal.push_application import push_application as _push_application
from biolib._internal.push_application import set_app_version_as_active as _set_app_version_as_active
from biolib._runtime.runtime import Runtime as _Runtime
from biolib._session.session import Session as _Session
from biolib.app import BioLibApp as _BioLibApp

# Classes to expose as public API
Runtime = _Runtime


def get_session(
    refresh_token: str,
    base_url: Optional[str] = None,
    client_type: Optional[str] = None,
    experiment: Optional[str] = None,
) -> _Session:
    return _Session.get_session(
        refresh_token=refresh_token,
        base_url=base_url,
        client_type=client_type,
        experiment=experiment,
    )


def push_app_version(uri: str, path: str) -> _BioLibApp:
    push_data = _push_application(
        app_uri=uri,
        app_path=path,
        app_version_to_copy_images_from=None,
        set_as_active=False,
        set_as_published=False,
    )
    if not push_data:
        raise Exception('Failed to push application; please check the logs for more details')

    uri = f'{push_data["app_uri"]}:{push_data["sematic_version"]}'
    return _BioLibApp(uri)


def set_app_version_as_default(app_version: _BioLibApp) -> None:
    app_version_uuid = app_version.version['public_id']
    _set_app_version_as_active(app_version_uuid)


def get_app_version_pytest_plugin(app_version: _BioLibApp):
    try:
        import pytest  # type: ignore # pylint: disable=import-outside-toplevel,import-error
    except BaseException:
        raise Exception('Failed to import pytest; please make sure it is installed') from None

    class AppVersionFixturePlugin:
        def __init__(self, app_version_ref):
            self.app_version_ref = app_version_ref

        @pytest.fixture(scope='session')
        def app_version(self, request):  # pylint: disable=unused-argument
            return self.app_version_ref

    return AppVersionFixturePlugin(app_version)


def create_data_record(
    destination: str,
    data_path: str,
    name: Optional[str] = None,
    record_type: Optional[str] = None,
) -> _DataRecord:
    return _DataRecord.create(
        destination=f'{destination}/{name}' if name else destination,
        data_path=data_path,
        record_type=record_type,
    )


def get_index(uri: str) -> _Index:
    return _Index.get_by_uri(uri)


def query_index(
    query: str,
    data: Optional[Union[List[Dict[str, Any]], bytes]] = None,
    data_format: str = 'json',
) -> IndexQueryResult:
    return _query_index(query=query, data=data, data_format=data_format)
