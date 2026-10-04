import base64
import binascii
import json
from typing import Any, Dict


class JwtDecodeError(Exception):
    pass


def decode_jwt_without_checking_signature(jwt: str) -> Dict[str, Any]:
    jwt_bytes = jwt.encode('utf-8')

    try:
        signing_input, _ = jwt_bytes.rsplit(b'.', 1)
        header_segment, payload_segment = signing_input.split(b'.', 1)
    except ValueError as error:
        raise JwtDecodeError('Not enough segments') from error

    try:
        header_data = base64.urlsafe_b64decode(header_segment)
    except (TypeError, binascii.Error) as error:
        raise JwtDecodeError('Invalid header padding') from error

    try:
        header = json.loads(header_data)
    except ValueError as error:
        raise JwtDecodeError(f'Invalid header string: {error}') from error

    if not isinstance(header, dict):
        raise JwtDecodeError('Invalid header string: must be a json object')

    try:
        payload_data = base64.urlsafe_b64decode(payload_segment)
    except (TypeError, binascii.Error) as error:
        raise JwtDecodeError('Invalid payload padding') from error

    try:
        payload = json.loads(payload_data)
    except ValueError as error:
        raise JwtDecodeError(f'Invalid payload string: {error}') from error

    if not isinstance(payload, dict):
        raise JwtDecodeError('Invalid payload string: must be a json object')

    return dict(header=header, payload=payload)
