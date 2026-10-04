import json
from typing import Any, Dict

from biolib import api
from biolib._shared.types import ResourceDetailedDict
from biolib.biolib_api_client import BiolibApiClient
from biolib.biolib_api_client.biolib_app_api import _get_resource_uri_from_str
from biolib.biolib_logging import logger


class Index:
    def __init__(self, _internal_state: ResourceDetailedDict):
        self._state = _internal_state

    def __repr__(self) -> str:
        return f'Index: {self._state["uri"]}'

    @property
    def uri(self) -> str:
        return self._state['uri']

    @property
    def id(self) -> str:
        return f'{self._state["account_uuid"]}.{self._state["uuid"]}'.replace('-', '_')

    @staticmethod
    def get_by_uri(uri: str) -> 'Index':
        normalized_uri = _get_resource_uri_from_str(uri)
        response: ResourceDetailedDict = api.client.get(path='/resource/', params={'uri': normalized_uri}).json()
        if response['type'] != 'index':
            raise Exception(f'Resource "{response["uri"]}" is not an Index')
        return Index(_internal_state=response)

    @staticmethod
    def create(uri: str, config: Dict[str, Any]) -> str:
        BiolibApiClient.assert_is_signed_in(authenticated_action_description='create an Index')

        response = api.client.post(
            path='/resources/indexes/',
            data={
                'uri': uri,
                'index_config': config,
            },
        )
        result = response.json()
        created_uri: str = result['uri']
        logger.info(f"Successfully created Index '{created_uri}'")
        return created_uri

    @staticmethod
    def create_from_config_file(uri: str, config_path: str) -> str:
        with open(config_path) as config_file:
            index_config = json.load(config_file)

        return Index.create(uri=uri, config=index_config)
