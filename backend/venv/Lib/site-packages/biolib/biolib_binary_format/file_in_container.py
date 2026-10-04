import os.path
import tarfile
import tempfile

from biolib.typing_utils import TYPE_CHECKING, Iterable, Optional

if TYPE_CHECKING:
    from docker.models.containers import Container  # type: ignore


class FileInContainer:
    def __init__(self, container: 'Container', path_in_container: str, overlay_upper_dir_path: Optional[str]):
        self._container: 'Container' = container
        self._path_on_disk: Optional[str] = overlay_upper_dir_path + path_in_container if overlay_upper_dir_path \
            else None

        self._path_in_container: str = path_in_container
        self._path: str = path_in_container
        self._buffered_file_data: Optional[bytes] = None

    def __repr__(self) -> str:
        return f'FileInContainer({self.path})'

    @property
    def path(self) -> str:
        return self._path

    @path.setter
    def path(self, value: str) -> None:
        self._path = value

    def is_file(self) -> bool:
        if self._path_on_disk:
            return os.path.isfile(self._path_on_disk)
        else:
            tmp_file = self._get_temp_file_from_container_via_tar()
            if tmp_file:
                os.remove(tmp_file)
                return True
            else:
                return False

    def get_data_size_in_bytes(self) -> int:
        if self._path_on_disk:
            return os.path.getsize(self._path_on_disk)
        else:
            tmp_file = self._get_temp_file_from_container_via_tar()
            if tmp_file:
                file_length = os.path.getsize(tmp_file)
                os.remove(tmp_file)
                return file_length
            else:
                return 0

    def get_data_stream(self) -> Iterable[bytes]:
        if self._path_on_disk:
            with open(self._path_on_disk, mode='rb') as file:
                while True:
                    chunk = file.read(1_000_000)
                    if not chunk:
                        return

                    yield chunk
        else:
            tmp_file = self._get_temp_file_from_container_via_tar()
            if not tmp_file:
                yield bytes()
                return
            else:
                file = open(tmp_file, mode='rb')
                while True:
                    chunk = file.read(1_000_000)
                    if not chunk:
                        file.close()
                        os.remove(tmp_file)
                        return

                    yield chunk

    def _get_temp_file_from_container_via_tar(self) -> Optional[str]:
        with tempfile.NamedTemporaryFile(mode='wb', delete=True) as tmp_io:
            stream, _ = self._container.get_archive(path=self._path_in_container)
            for chunk in stream:
                tmp_io.write(chunk)

            tmp_io.seek(0)
            with tarfile.open(tmp_io.name) as tar:
                members = tar.getmembers()
                file_members = [member for member in members if member.isfile()]
                if not file_members:
                    # Path was not a file
                    return None

                assert len(file_members) == 1
                file_obj = tar.extractfile(member=file_members[0])
                if not file_obj:
                    # Path was not a file
                    return None
                tmp_io_2 = tempfile.NamedTemporaryFile(mode='wb', delete=False)
                while True:
                    chunk = file_obj.read(1_000_000)
                    if not chunk:
                        break
                    tmp_io_2.write(chunk)
                tmp_io_2.close()
                return tmp_io_2.name
