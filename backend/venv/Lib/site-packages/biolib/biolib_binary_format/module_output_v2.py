from biolib.biolib_binary_format import BioLibBinaryFormatBasePackage
from biolib.biolib_binary_format.utils import IndexableBuffer, InMemoryIndexableBuffer, LazyLoadedFile
from biolib.biolib_binary_format.file_in_container import FileInContainer
from biolib.typing_utils import TypedDict, List, Optional


class Metadata(TypedDict):
    version: int
    type: int
    stdout_length: int
    stderr_length: int
    files_info_length: int
    files_data_length: int
    exit_code: int


class ModuleOutputV2(BioLibBinaryFormatBasePackage):
    _version = 1
    _type = 11
    _metadata_byte_lengths = dict(
        # Note: order is important
        version=1,
        type=1,
        stdout_length=8,
        stderr_length=8,
        files_info_length=8,
        files_data_length=8,
        exit_code=2,
    )
    _metadata_length = sum(_metadata_byte_lengths.values())
    _file_path_length_bytes = 4
    _file_data_length_bytes = 8

    def __init__(self, buffer: IndexableBuffer):
        super().__init__()
        self._buffer = buffer

        self._metadata: Optional[Metadata] = None
        self._stdout: Optional[bytes] = None
        self._stderr: Optional[bytes] = None
        self._files: Optional[List[LazyLoadedFile]] = None

    @property
    def buffer(self) -> IndexableBuffer:
        return self._buffer

    def get_exit_code(self) -> int:
        metadata = self._get_metadata()
        return metadata['exit_code']

    def get_stdout(self) -> bytes:
        if self._stdout is None:
            metadata = self._get_metadata()
            self._stdout = self._buffer.get_data(start=self._metadata_length, length=metadata['stdout_length'])

        return self._stdout

    def get_stderr(self) -> bytes:
        if self._stderr is None:
            metadata = self._get_metadata()
            self._stderr = self._buffer.get_data(
                start=self._metadata_length + metadata['stdout_length'],
                length=metadata['stderr_length'],
            )

        return self._stderr

    def get_files(self) -> List[LazyLoadedFile]:
        metadata = self._get_metadata()
        if self._files is None:
            self._files = []
            if metadata['files_info_length'] == 0:
                return self._files

            files_info_start = self._metadata_length + metadata['stdout_length'] + metadata['stderr_length']
            files_info_buffer = InMemoryIndexableBuffer(
                data=self._buffer.get_data(start=files_info_start, length=metadata['files_info_length'])
            )

            files_data_pointer = files_info_start + metadata['files_info_length']
            while files_info_buffer.pointer < len(files_info_buffer):
                path_length = files_info_buffer.get_data_with_pointer_as_int(self._file_path_length_bytes)
                path = files_info_buffer.get_data_with_pointer_as_string(path_length)
                data_length = files_info_buffer.get_data_with_pointer_as_int(self._file_data_length_bytes)

                data_start = files_data_pointer
                files_data_pointer += data_length

                self._files.append(LazyLoadedFile(path=path, buffer=self._buffer, start=data_start, length=data_length))

        return self._files

    def _get_metadata(self) -> Metadata:
        if self._metadata is None:
            metadata_buffer = InMemoryIndexableBuffer(self._buffer.get_data(start=0, length=self._metadata_length))

            partial_metadata = {}
            for field_name, field_length in self._metadata_byte_lengths.items():
                value = metadata_buffer.get_data_with_pointer_as_int(length=field_length)  # type: ignore
                if field_name == 'version' and value != ModuleOutputV2._version:
                    raise Exception('Version does not match')

                if field_name == 'type' and value != ModuleOutputV2._type:
                    raise Exception('Type does not match')

                partial_metadata[field_name] = value

            self._metadata = partial_metadata  # type: ignore

        return self._metadata  # type: ignore

    @staticmethod
    def write_to_file(
            output_file_path: str,
            exit_code: int,
            files: List[FileInContainer],
            stderr: bytes,
            stdout: bytes,
    ) -> None:
        with open(output_file_path, mode='wb') as output_file:
            meta_lengths = ModuleOutputV2._metadata_byte_lengths

            output_file.write(ModuleOutputV2._version.to_bytes(meta_lengths['version'], byteorder='big'))
            output_file.write(ModuleOutputV2._type.to_bytes(meta_lengths['type'], byteorder='big'))
            output_file.write(len(stdout).to_bytes(meta_lengths['stdout_length'], byteorder='big'))
            output_file.write(len(stderr).to_bytes(meta_lengths['stdout_length'], byteorder='big'))

            files_info = bytearray()
            files_data_size = 0

            for file in files:
                file_size = file.get_data_size_in_bytes()
                path_as_bytes = file.path.encode()
                path_length_as_bytes = len(path_as_bytes).to_bytes(length=4, byteorder='big')
                data_byte_length_as_bytes = file_size.to_bytes(length=8, byteorder='big')

                files_info.extend(path_length_as_bytes + path_as_bytes + data_byte_length_as_bytes)
                files_data_size += file_size

            output_file.write(len(files_info).to_bytes(length=8, byteorder='big'))
            output_file.write(files_data_size.to_bytes(length=8, byteorder='big'))
            output_file.write(exit_code.to_bytes(length=meta_lengths['exit_code'], byteorder='big'))
            output_file.write(stdout)
            output_file.write(stderr)
            output_file.write(files_info)

            for file in files:
                for chunk in file.get_data_stream():
                    output_file.write(chunk)
