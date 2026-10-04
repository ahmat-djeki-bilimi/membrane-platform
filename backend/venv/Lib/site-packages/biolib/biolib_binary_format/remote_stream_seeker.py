from biolib.biolib_binary_format.utils import IndexableBuffer
from biolib.biolib_logging import logger
from biolib.typing_utils import Iterable


class StreamSeeker:
    def __init__(
        self,
        upstream_buffer: IndexableBuffer,
        files_data_start: int,
        files_data_end: int,
        max_chunk_size: int,
    ):
        self._upstream_buffer = upstream_buffer
        self._files_data_end = files_data_end
        self._max_chunk_size = max_chunk_size

        self._buffer_start = files_data_start
        self._buffer = bytearray()

    def seek_and_read(self, file_start: int, file_length: int, read_ahead_bytes: int = 0) -> Iterable[bytes]:
        assert file_start >= self._buffer_start
        self._buffer = self._buffer[file_start - self._buffer_start :]
        self._buffer_start = file_start

        while True:
            file_byte_count_remaining = file_length - (self._buffer_start - file_start)
            if file_byte_count_remaining <= 0:
                return

            if len(self._buffer) > 0:
                take = min(file_byte_count_remaining, len(self._buffer))
                chunk = self._buffer[:take]
                if chunk:
                    yield chunk
                self._buffer = self._buffer[take:]
                self._buffer_start += take
            else:
                start_of_fetch = self._buffer_start + len(self._buffer)
                bytes_left_in_stream = self._files_data_end - start_of_fetch
                if bytes_left_in_stream <= 0:
                    logger.error(
                        'StreamSeeker: no bytes left upstream (start_of_fetch=%d, files_data_end=%d)',
                        start_of_fetch,
                        self._files_data_end,
                    )
                    return

                fetch_size = min(self._max_chunk_size, file_byte_count_remaining + read_ahead_bytes)
                if fetch_size > bytes_left_in_stream:
                    logger.error(
                        'StreamSeeker: fetch_size (%d) > bytes_left_in_stream (%d); clamping',
                        fetch_size,
                        bytes_left_in_stream,
                    )
                    fetch_size = bytes_left_in_stream

                fetched_data = self._upstream_buffer.get_data(start=start_of_fetch, length=fetch_size)
                self._buffer.extend(fetched_data)
