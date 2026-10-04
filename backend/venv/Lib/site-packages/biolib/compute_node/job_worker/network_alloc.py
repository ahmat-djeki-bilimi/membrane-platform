import hashlib
import ipaddress
import uuid
from typing import Dict, Optional, cast

from docker.errors import APIError
from docker.models.networks import Network
from docker.types import IPAMConfig, IPAMPool

from biolib.biolib_errors import BioLibError
from biolib.biolib_logging import logger_no_user_data
from biolib.compute_node.remote_host_proxy import get_static_ip_from_network


def _iter_network_subnets(existing_network):
    ipam_config = existing_network.attrs.get('IPAM', {}).get('Config', [])
    for cfg in ipam_config:
        subnet_str = cfg.get('Subnet')
        if not subnet_str:
            continue
        try:
            yield ipaddress.ip_network(subnet_str, strict=False)
        except ValueError:
            continue


def _find_overlap(candidate_network, existing_networks):
    for existing in existing_networks:
        for subnet in _iter_network_subnets(existing):
            if candidate_network.overlaps(subnet):
                return existing, str(subnet)
    return None


def _allocate_network_with_retries(
    name_prefix: str,
    docker_client,
    internal: bool = True,
    driver: str = 'bridge',
    max_attempts: int = 10,
    labels: Optional[Dict[str, str]] = None,
) -> Network:
    base_network = ipaddress.ip_network('172.28.0.0/16', strict=False)

    suffix = uuid.uuid4().hex
    full_name = f'{name_prefix}{suffix}'
    name_hash = int(hashlib.sha256(full_name.encode()).hexdigest(), 16)
    starting_offset = name_hash % 256

    for attempt in range(max_attempts):
        offset = (starting_offset + attempt) % 256

        if base_network.prefixlen == 16:
            third_octet = offset
            candidate_subnet = f'{base_network.network_address.exploded.rsplit(".", 2)[0]}.{third_octet}.0/24'
        else:
            candidate_subnet = f'{base_network.network_address.exploded.rsplit(".", 1)[0]}.{offset}.0/24'

        candidate_network = ipaddress.ip_network(candidate_subnet, strict=False)

        existing_networks = docker_client.networks.list()
        overlap = _find_overlap(candidate_network, existing_networks)
        if overlap:
            existing_network, existing_subnet = overlap
            logger_no_user_data.debug(
                f'Subnet {candidate_subnet} conflicts with existing network '
                f'{existing_network.name} ({existing_subnet}), trying next candidate'
            )
            continue

        ipam_pool = IPAMPool(subnet=candidate_subnet)
        computed_ipam_config = IPAMConfig(pool_configs=[ipam_pool])

        try:
            network = cast(
                Network,
                docker_client.networks.create(
                    name=full_name,
                    internal=internal,
                    driver=driver,
                    ipam=computed_ipam_config,
                    labels=labels or {},
                ),
            )
            static_ip = get_static_ip_from_network(network, offset=2)
            logger_no_user_data.debug(
                f'Created network {full_name} with subnet {candidate_subnet} and static IP {static_ip}'
            )
            return network
        except APIError as api_error:
            logger_no_user_data.debug(
                f'Network creation failed with Docker API error for subnet {candidate_subnet}: {api_error}, '
                f'trying next candidate (attempt {attempt + 1}/{max_attempts})'
            )
            continue

    raise BioLibError(
        f'Failed to allocate and create network {full_name} after {max_attempts} attempts. ' f'Base CIDR: 172.28.0.0/16'
    )
