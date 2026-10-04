from biolib import api
from biolib._shared.types import ResourceDetailedDict
from biolib._shared.utils import is_uuid
from biolib.api.client import ApiClient
from biolib.typing_utils import Optional


def fetch_experiment_by_uri(uri: str, api_client: Optional[ApiClient] = None) -> ResourceDetailedDict:
    if api_client is None:
        api_client = api.client

    if is_uuid(uri):
        resource_dict: ResourceDetailedDict = api_client.get(f'/resources/{uri}/').json()
    else:
        query_param_key = 'uri' if '/' in uri else 'name'
        resource_dict = api_client.get('/resource/', params={query_param_key: uri}).json()

    if not resource_dict['experiment']:
        raise ValueError(f'Resource {uri} is not an experiment')

    return resource_dict
