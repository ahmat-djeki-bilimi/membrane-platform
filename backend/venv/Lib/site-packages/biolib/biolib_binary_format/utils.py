import io
import math
import multiprocessing
from abc import ABC, abstractmethod
from multiprocessing.pool import ThreadPool
from typing import Callable, Optional

from biolib._internal.http_client import HttpClient
from biolib.typing_utils import Iterator


class RemoteEndpoint(ABC):
    @abstractmethod
    def get_remote_url(self):
        pass


class IndexableBuffer(ABC):
    def __init__(self):
        self.pointer = 0

    @abstractmethod
    def get_data(self, start: int, length: int) -> bytes:
        pass

    def get_data_as_string(self, start: int, length: int) -> str:
        return self.get_data(start=start, length=length).decode()

    def get_data_as_int(self, start: int, length: int) -> int:
        return int.from_bytes(bytes=self.get_data(start=start, length=length), byteorder='big')

    def get_data_with_pointer(self, length: int) -> bytes:
        data = self.get_data(start=self.pointer, length=length)
        self.pointer += length
        return data

    def get_data_with_pointer_as_int(self, length: int) -> int:
        data = self.get_data_as_int(start=self.pointer, length=length)
        self.pointer += length
        return data

    def get_data_with_pointer_as_string(self, length: int) -> str:
        data = self.get_data_as_string(start=self.pointer, length=length)
        self.pointer += length
        return data


class LocalFileIndexableBuffer(IndexableBuffer):
    def __init__(self, filename: str):
        super().__init__()
        self._filehandle = open(filename, 'rb')

    def get_data(self, start: int, length: int) -> bytes:
        if length < 0:
            raise Exception('get_data length must be positive')

        if length == 0:
            return bytes(0)

        self._filehandle.seek(start)
        data: bytes = self._filehandle.read(length)

        if len(data) != length:
            raise Exception(f'get_data got response of unexpected length. Got {len(data)} expected {length}.')

        return data


class RemoteIndexableBuffer(IndexableBuffer):
    def __init__(self, endpoint: RemoteEndpoint):
        super().__init__()
        self._endpoint = endpoint

    def get_data(self, start: int, length: int) -> bytes:
        if length < 0:
            raise Exception('get_data length must be positive')

        if length == 0:
            return bytes(0)

        end = start + length - 1
        response = HttpClient.request(
            url=self._endpoint.get_remote_url(),
            headers={'range': f'bytes={start}-{end}'},
        )

        data: bytes = response.content
        if len(data) != length:
            raise Exception(f'get_data got response of unexpected length. Got {len(data)} expected {length}.')

        return data


class InMemoryIndexableBuffer(IndexableBuffer):
    def __init__(self, data: bytes):
        super().__init__()
        self._buffer = data
        self._length_bytes = len(data)

    def get_data(self, start: int, length: int) -> bytes:
        end = start + length
        return self._buffer[start:end]

    def __len__(self):
        return self._length_bytes


class LazyLoadedFile:
    def __init__(
        self,
        path: str,
        buffer: IndexableBuffer,
        start: Optional[int],
        length: int,
        start_func: Optional[Callable[[], int]] = None,
    ):
        self._path = path
        self._buffer = buffer
        self._start = start
        self._start_func = start_func
        self._length = length

    def __repr__(self) -> str:
        return f'File "{self._path}" with size of {self._length} bytes'

    @property
    def path(self) -> str:
        return self._path

    @property
    def name(self) -> str:
        return self._path.split('/')[-1]

    @property
    def start(self) -> int:
        if self._start is None:
            assert self._start_func is not None, 'No start function or start value'
            self._start = self._start_func()

        return self._start

    @property
    def length(self) -> int:
        return self._length

    def get_file_handle(self) -> io.BufferedIOBase:
        return io.BytesIO(self.get_data())

    def get_data(self, start=0, length=None) -> bytes:
        start_offset = start + self.start
        # make sure length doesn't go outside file boundaries
        length_to_end_of_file = max(self._length - start, 0)
        length_to_request = length_to_end_of_file if length is None else min(length, length_to_end_of_file)
        return self._buffer.get_data(start=start_offset, length=length_to_request)

    def get_data_iterator(self) -> Iterator[bytes]:
        if self._length == 0:
            yield b''
        else:
            chunk_size = 50_000_000
            chunk_count = math.ceil(self._length / chunk_size)
            chunk_indices_iterator = range(chunk_count - 1)

            def get_chunk(chunk_index: int) -> bytes:
                return self._buffer.get_data(start=self.start + chunk_index * chunk_size, length=chunk_size)

            if chunk_count > 1:
                with ThreadPool(processes=min(16, chunk_count, multiprocessing.cpu_count() - 1)) as pool:
                    yield from pool.imap(func=get_chunk, iterable=chunk_indices_iterator)

            data_already_yielded = (chunk_count - 1) * chunk_size
            yield self._buffer.get_data(
                start=self.start + data_already_yielded,
                length=self._length - data_already_yielded,
            )
