import errno
import os
import stat
from datetime import datetime, timezone
from time import time

from biolib._internal.libs.fusepy import FUSE, FuseOSError, Operations
from biolib.biolib_errors import BioLibError
from biolib.jobs import Job
from biolib.typing_utils import Dict, List, Optional, Tuple, TypedDict


class _AttributeDict(TypedDict):
    st_atime: int
    st_ctime: int
    st_gid: int
    st_mode: int
    st_mtime: int
    st_nlink: int
    st_size: int
    st_uid: int


_SUCCESS_CODE = 0


class ExperimentFuseMount(Operations):
    def __init__(self, experiment):
        self._experiment = experiment
        self._job_names_map: Optional[Dict[str, Job]] = None
        self._jobs_last_fetched_at: float = 0.0
        self._mounted_at_epoch_seconds: int = int(time())

    @staticmethod
    def mount_experiment(experiment, mount_path: str) -> None:
        FUSE(
            operations=ExperimentFuseMount(experiment),
            mountpoint=mount_path,
            nothreads=True,
            foreground=True,
            allow_other=False,
        )

    def getattr(self, path: str, fh=None) -> _AttributeDict:
        if path == '/':
            return self._get_directory_attributes(timestamp_epoch_seconds=self._mounted_at_epoch_seconds)

        job, path_in_job = self._parse_path(path)
        job_finished_at_epoch_seconds: int = int(
            datetime.fromisoformat(job.to_dict()['finished_at'].rstrip('Z')).replace(tzinfo=timezone.utc).timestamp()
        )

        if path_in_job == '/':
            return self._get_directory_attributes(timestamp_epoch_seconds=job_finished_at_epoch_seconds)

        try:
            file = job.get_output_file(path_in_job)
            return self._get_file_attributes(
                timestamp_epoch_seconds=job_finished_at_epoch_seconds,
                size_in_bytes=file.length,
            )
        except BioLibError:
            # file not found
            pass

        file_paths_in_job = [file.path for file in job.list_output_files()]

        for file_path_in_job in file_paths_in_job:
            if file_path_in_job.startswith(path_in_job):
                return self._get_directory_attributes(timestamp_epoch_seconds=job_finished_at_epoch_seconds)

        raise FuseOSError(errno.ENOENT) from None  # No such file or directory

    def readdir(self, path: str, fh: int) -> List[str]:
        directory_entries = ['.', '..']

        if path == '/':
            directory_entries.extend(self._get_job_names_map(refresh_jobs=True).keys())
        else:
            job, path_in_job = self._parse_path(path)
            dir_path_in_job = '/' if path_in_job == '/' else path_in_job + '/'
            depth = dir_path_in_job.count('/')
            directory_entries.extend(
                set(
                    [
                        file.path.split('/')[depth]
                        for file in job.list_output_files()
                        if file.path.startswith(dir_path_in_job)
                    ]
                )
            )

        return directory_entries

    def open(self, path: str, flags: int) -> int:
        job, path_in_job = self._parse_path(path)
        try:
            job.get_output_file(path_in_job)
        except BioLibError:
            # file not found
            raise FuseOSError(errno.ENOENT) from None

        return 1234  # dummy file handle

    def read(self, path: str, size: int, offset: int, fh: int) -> bytes:
        job, path_in_job = self._parse_path(path)
        try:
            file = job.get_output_file(path_in_job)
        except BioLibError:
            raise FuseOSError(errno.ENOENT) from None  # No such file or directory

        return file.get_data(start=offset, length=size)

    def release(self, path: str, fh: int) -> int:
        return _SUCCESS_CODE

    def releasedir(self, path: str, fh: int) -> int:
        return _SUCCESS_CODE

    def flush(self, path: str, fh: int) -> int:
        return _SUCCESS_CODE

    @staticmethod
    def _get_directory_attributes(timestamp_epoch_seconds: int) -> _AttributeDict:
        return _AttributeDict(
            st_atime=timestamp_epoch_seconds,
            st_ctime=timestamp_epoch_seconds,
            st_gid=os.getgid(),
            st_mode=stat.S_IFDIR | 0o555,  # Directory that is readable and executable by owner, group, and others.
            st_mtime=timestamp_epoch_seconds,
            st_nlink=1,
            st_size=1,
            st_uid=os.getuid(),
        )

    @staticmethod
    def _get_file_attributes(timestamp_epoch_seconds: int, size_in_bytes: int) -> _AttributeDict:
        return _AttributeDict(
            st_atime=timestamp_epoch_seconds,
            st_ctime=timestamp_epoch_seconds,
            st_gid=os.getgid(),
            st_mode=stat.S_IFREG | 0o444,  # Regular file with read permissions for owner, group, and others.
            st_mtime=timestamp_epoch_seconds,
            st_nlink=1,
            st_size=size_in_bytes,
            st_uid=os.getuid(),
        )

    def _get_job_names_map(self, refresh_jobs=False) -> Dict[str, Job]:
        current_time = time()
        if not self._job_names_map or (current_time - self._jobs_last_fetched_at > 1 and refresh_jobs):
            self._jobs_last_fetched_at = current_time
            self._job_names_map = {job.get_name(): job for job in self._experiment.get_jobs(status='completed')}

        return self._job_names_map

    def _parse_path(self, path: str) -> Tuple[Job, str]:
        path_splitted = path.split('/')
        job_name = path_splitted[1]
        path_in_job = '/' + '/'.join(path_splitted[2:])
        job = self._get_job_names_map().get(job_name)
        if not job:
            raise FuseOSError(errno.ENOENT)  # No such file or directory

        return job, path_in_job

    # ----------------------------------- File system methods not implemented below -----------------------------------

    def chmod(self, path, mode):
        raise FuseOSError(errno.EACCES)

    def chown(self, path, uid, gid):
        raise FuseOSError(errno.EACCES)

    def mknod(self, path, mode, dev):
        raise FuseOSError(errno.EACCES)

    def rmdir(self, path):
        raise FuseOSError(errno.EACCES)

    def mkdir(self, path, mode):
        raise FuseOSError(errno.EACCES)

    def unlink(self, path):
        raise FuseOSError(errno.EACCES)

    def symlink(self, target, source):
        raise FuseOSError(errno.EACCES)

    def rename(self, old, new):
        raise FuseOSError(errno.EACCES)

    def link(self, target, source):
        raise FuseOSError(errno.EACCES)

    def utimens(self, path, times=None):
        raise FuseOSError(errno.EACCES)

    def create(self, path, mode, fi=None):
        raise FuseOSError(errno.EACCES)

    def write(self, path, data, offset, fh):
        raise FuseOSError(errno.EACCES)

    def truncate(self, path, length, fh=None):
        raise FuseOSError(errno.EACCES)

    def fsync(self, path, datasync, fh):
        raise FuseOSError(errno.EACCES)
