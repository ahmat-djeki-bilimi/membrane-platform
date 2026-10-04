import os
import subprocess
from datetime import datetime, timedelta, timezone

from biolib.biolib_logging import logger_no_user_data
from biolib.compute_node.job_worker.cache_state import LfsCacheState


def prune_lfs_cache(dry_run: bool) -> None:
    logger_no_user_data.info(f'Pruning LFS cache (dry run = {dry_run})...')

    current_time = datetime.now(timezone.utc)
    paths_to_delete = set()

    with LfsCacheState() as state:
        lfs_storage_path = f'{LfsCacheState().main_lfs_storage_path}/lfs'
        if os.path.exists(lfs_storage_path):
            for lfs_uuid in os.listdir(lfs_storage_path):
                if lfs_uuid not in state['large_file_systems']:
                    path_to_delete = f'{lfs_storage_path}/{lfs_uuid}'
                    logger_no_user_data.info(f'Will delete path "{path_to_delete}" as it is not in cache state')
                    paths_to_delete.add(path_to_delete)

        lfs_uuids_to_keep_in_state = set()
        for lfs_uuid, lfs in state['large_file_systems'].items():
            last_used_at = datetime.fromisoformat(lfs['last_used_at'])
            if last_used_at.tzinfo is None:
                last_used_at = last_used_at.replace(tzinfo=timezone.utc)
            lfs_time_to_live_in_days = 60 if lfs['state'] == 'ready' else 7

            if last_used_at < current_time - timedelta(days=lfs_time_to_live_in_days):
                logger_no_user_data.info(f"Will delete LFS {lfs_uuid} as it was last used at {lfs['last_used_at']}")
                partition = state['storage_partitions'][lfs['storage_partition_uuid']]
                paths_to_delete.add(f"{partition['path']}/lfs/{lfs_uuid}")
                if not dry_run:
                    partition['allocated_size_bytes'] -= lfs['size_bytes']
            else:
                logger_no_user_data.info(f'Keeping LFS "{lfs_uuid}"')
                lfs_uuids_to_keep_in_state.add(lfs_uuid)

        if not dry_run:
            state['large_file_systems'] = {
                key: value for key, value in state['large_file_systems'].items() if key in lfs_uuids_to_keep_in_state
            }

    for path in paths_to_delete:
        logger_no_user_data.info(f'Deleting {path}...')
        if not dry_run:
            subprocess.run(['rm', '-rf', path], check=True)

    logger_no_user_data.info(f'Successfully deleted {len(paths_to_delete)}')
