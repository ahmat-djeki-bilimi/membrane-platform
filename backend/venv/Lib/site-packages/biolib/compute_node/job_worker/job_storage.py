import os

from biolib import utils
from biolib._internal.http_client import HttpClient
from biolib.biolib_api_client import CreatedJobDict
from biolib.biolib_api_client.biolib_job_api import BiolibJobApi
from biolib.compute_node.cloud_utils import CloudUtils
from biolib.biolib_logging import logger_no_user_data
from biolib.utils.multipart_uploader import get_chunk_iterator_from_file_object


class JobStorage:
    module_input_file_name = 'input-output.bbf'
    module_output_file_name = 'module-output.bbf'

    @staticmethod
    def upload_module_input(job: CreatedJobDict, module_input_serialized: bytes) -> None:
        job_uuid = job['public_id']
        headers = {'Job-Auth-Token': job['auth_token']}

        multipart_uploader = utils.MultiPartUploader(
            start_multipart_upload_request=dict(
                requires_biolib_auth=False,
                path=f'/jobs/{job_uuid}/storage/input/start_upload/',
                headers=headers
            ),
            get_presigned_upload_url_request=dict(
                requires_biolib_auth=False,
                path=f'/jobs/{job_uuid}/storage/input/presigned_upload_url/',
                headers=headers
            ),
            complete_upload_request=dict(
                requires_biolib_auth=False,
                path=f'/jobs/{job_uuid}/storage/input/complete_upload/',
                headers=headers
            ),
        )

        multipart_uploader.upload(
            payload_iterator=utils.get_chunk_iterator_from_bytes(module_input_serialized),
            payload_size_in_bytes=len(module_input_serialized),
        )

    @staticmethod
    def upload_module_output(job_uuid: str, job_temporary_dir: str) -> None:
        logger_no_user_data.debug(f'Job "{job_uuid}" uploading result...')
        module_output_path = os.path.join(job_temporary_dir, JobStorage.module_output_file_name)
        module_output_size = os.path.getsize(module_output_path)

        # Calculate chunk size based on max chunk count of 10_000, using 9_000 to be on the safe side
        max_chunk_count = 9_000
        min_chunk_size_bytes = 50_000_000
        chunk_size_in_bytes = max(min_chunk_size_bytes, module_output_size // max_chunk_count)

        logger_no_user_data.debug(
            f'Job "{job_uuid}" uploading result of size {module_output_size} bytes '
            f'with chunk size of {chunk_size_in_bytes} bytes...'
        )

        with open(module_output_path, mode='rb') as module_output_file:
            module_output_iterator = get_chunk_iterator_from_file_object(
                file_object=module_output_file,
                chunk_size_in_bytes=chunk_size_in_bytes,
            )
            multipart_uploader = JobStorage._get_module_output_uploader(job_uuid)
            multipart_uploader.upload(
                payload_iterator=module_output_iterator,
                payload_size_in_bytes=module_output_size,
            )

        logger_no_user_data.debug(f'Job "{job_uuid}" result uploaded successfully')

    @staticmethod
    def _get_module_output_uploader(job_uuid: str) -> utils.MultiPartUploader:
        config = CloudUtils.get_webserver_config()
        compute_node_auth_token = config['compute_node_info']['auth_token']  # pylint: disable=unsubscriptable-object
        headers = {'Compute-Node-Auth-Token': compute_node_auth_token}

        return utils.MultiPartUploader(
            start_multipart_upload_request=dict(
                requires_biolib_auth=False,
                path=f'/jobs/{job_uuid}/storage/results/start_upload/',
                headers=headers,
            ),
            get_presigned_upload_url_request=dict(
                requires_biolib_auth=False,
                path=f'/jobs/{job_uuid}/storage/results/presigned_upload_url/',
                headers=headers,
            ),
            complete_upload_request=dict(
                requires_biolib_auth=False,
                path=f'/jobs/{job_uuid}/storage/results/complete_upload/',
                headers=headers,
            ),
        )

    @staticmethod
    def download_module_input(job: CreatedJobDict, path: str):
        job_uuid = job['public_id']
        logger_no_user_data.debug(f'Job "{job_uuid}" getting module input url...')
        presigned_download_url = BiolibJobApi.get_job_storage_download_url(
            job_uuid=job_uuid,
            job_auth_token=job['auth_token'],
            storage_type='input',
        )
        logger_no_user_data.debug(f'Job "{job_uuid}" downloading module input...')
        HttpClient.request(url=presigned_download_url, response_path=path)
        logger_no_user_data.debug(f'Job "{job_uuid}" module input downloaded')
