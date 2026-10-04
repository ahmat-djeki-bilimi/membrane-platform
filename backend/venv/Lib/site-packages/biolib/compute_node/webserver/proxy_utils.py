from docker.errors import ImageNotFound
from docker.models.images import Image

from biolib import utils
from biolib.biolib_docker_client import BiolibDockerClient
from biolib.biolib_logging import logger_no_user_data
from biolib.typing_utils import cast


def get_biolib_nginx_proxy_image() -> Image:
    docker = BiolibDockerClient().get_docker_client()

    if utils.IS_RUNNING_IN_CLOUD:
        try:
            logger_no_user_data.debug('Getting local Docker image for nginx proxy')
            return cast(Image, docker.images.get('biolib-remote-host-proxy:latest'))
        except ImageNotFound:
            logger_no_user_data.debug(
                'Local Docker image for nginx proxy not available. Falling back to public image...'
            )

    public_image_uri = 'public.ecr.aws/h5y4b3l1/biolib-remote-host-proxy:latest'
    try:
        logger_no_user_data.debug('Getting public Docker image for nginx proxy')
        return cast(Image, docker.images.get(public_image_uri))
    except ImageNotFound:
        logger_no_user_data.debug('Pulling public Docker image for nginx proxy')
        return cast(Image, docker.images.pull(public_image_uri))
