# TODO: Fix ignore of type
# type: ignore
from biolib import api, utils
from biolib.typing_utils import Optional, List


def search_apps(
        search_query: Optional[str] = None,
        team: Optional[str] = None,
        count: int = 100,
) -> List[str]:
    query_exceeded_page_size = False
    params = {
        'page_size': count,
    }
    if team:
        if not team.startswith('@'):
            team = '@biolib.com/' + team
        params['account_handle'] = team

    if search_query:
        params['search'] = search_query

    apps_json = api.client.get(path='/apps/', params=params).json()
    if apps_json['count'] > count:
        query_exceeded_page_size = True

    apps = [app['resource_uri'] for app in apps_json['results']]

    if not utils.BASE_URL_IS_PUBLIC_BIOLIB and (not team or team.lower().startswith('@biolib.com')):
        # Also get federated apps if running on enterprise deployment
        public_biolib_apps_json = api.client.get(
            authenticate=False,
            path='https://biolib.com/api/apps/',
            params=params,
        ).json()
        if public_biolib_apps_json['count'] > count:
            query_exceeded_page_size = True

        apps.extend([f"@biolib.com/{app['resource_uri']}" for app in public_biolib_apps_json['results']])

    if query_exceeded_page_size:
        print(f'Search results exceeded {count}, use the argument "count" to increase the amount of results returned')

    return apps
