import re


def normalize_for_docker_tag(name: str) -> str:
    if not name:
        return ''

    normalized = re.sub(r'[^a-z0-9-]', '-', name.lower())

    normalized = re.sub(r'-+', '-', normalized)
    normalized = normalized.strip('-')

    return normalized
