import re

from biolib._shared.types import Optional
from biolib._shared.types.resource import ResourceUriDict, SemanticVersionDict
from biolib.biolib_errors import BioLibError

_UUID_REGEX = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.IGNORECASE)

URI_REGEX = re.compile(
    r'^(@(?P<resource_prefix>[\w._-]+)/)?'
    r'(?P<account_handle>[\w-]+)'
    r'(/(?P<resource_name>[\w-]+))?'
    r'(?::(?P<suffix>[^:]+))?$'
)
SEMVER_REGEX = re.compile(r'^(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)$')
TAG_REGEX = re.compile(r'^[a-z0-9-]{1,128}$')


def is_uuid(value: str) -> bool:
    return _UUID_REGEX.match(value) is not None


def normalize_resource_name(string: str) -> str:
    return string.replace('-', '_').lower()


def parse_semantic_version(semantic_version: str) -> SemanticVersionDict:
    if match := SEMVER_REGEX.fullmatch(semantic_version):
        return SemanticVersionDict(
            major=int(match.group('major')),
            minor=int(match.group('minor')),
            patch=int(match.group('patch')),
        )

    raise ValueError('The version must be a valid semantic version in the format of major.minor.patch (1.2.3).')


def parse_resource_uri(uri: str, use_account_as_name_default: bool = True) -> ResourceUriDict:
    matches = URI_REGEX.match(uri)
    if matches is None:
        raise BioLibError(f"Could not parse resource uri '{uri}', uri did not match regex")

    version: Optional[SemanticVersionDict] = None
    tag: Optional[str] = None

    suffix = matches.group('suffix')
    if suffix and suffix != '*':
        try:
            version = parse_semantic_version(suffix)
        except ValueError:
            if TAG_REGEX.fullmatch(suffix):
                tag = suffix
            else:
                raise BioLibError(
                    f'Invalid version or tag "{suffix}". '
                    'Versions must be semantic versions like "1.2.3". '
                    'Tags must be lowercase alphanumeric or dashes and at most 128 characters.'
                ) from None

    resource_prefix_raw: Optional[str] = matches.group('resource_prefix')
    resource_prefix = resource_prefix_raw.lower() if resource_prefix_raw is not None else None
    account_handle: str = matches.group('account_handle')
    account_handle_normalized: str = normalize_resource_name(account_handle)
    resource_name: Optional[str] = matches.group('resource_name')

    if resource_name:
        resource_name_normalized = normalize_resource_name(resource_name)
    elif use_account_as_name_default:
        resource_name_normalized = account_handle_normalized
    else:
        resource_name_normalized = None

    return ResourceUriDict(
        resource_prefix=resource_prefix,
        account_handle=account_handle,
        account_handle_normalized=account_handle_normalized,
        resource_name_normalized=resource_name_normalized,
        resource_name=resource_name if resource_name is not None or not use_account_as_name_default else account_handle,
        version=version,
        tag=tag,
    )
