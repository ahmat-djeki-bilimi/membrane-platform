# pylint: skip-file
"""
Code from:
https://github.com/gtsystem/python-remotezip
&
https://github.com/uktrade/stream-unzip
"""

import io
import zipfile

from functools import partial
from struct import Struct
import zlib

__all__ = ['RemoteIOError', 'RemoteZip']

from biolib._internal.http_client import HttpClient


class RemoteZipError(Exception):
    pass

class OutOfBound(RemoteZipError):
    pass


class RemoteIOError(RemoteZipError):
    pass


class RangeNotSupported(RemoteZipError):
    pass


class PartialBuffer:
    def __init__(self, buffer, offset, size, stream):
        self.buffer = buffer if stream else io.BytesIO(buffer.read())
        self.offset = offset
        self.size = size
        self.position = offset
        self.stream = stream

    def __repr__(self):
        return "<PartialBuffer off=%s size=%s stream=%s>" % (self.offset, self.size, self.stream)

    def read(self, size=0):
        if size == 0:
            size = self.offset + self.size - self.position

        content = self.buffer.read(size)
        self.position = self.offset + self.buffer.tell()
        return content

    def close(self):
        if not self.buffer.closed:
            self.buffer.close()
            if hasattr(self.buffer, 'release_conn'):
                self.buffer.release_conn()

    def seek(self, offset, whence):
        if whence == 2:
            self.position = self.size + self.offset + offset
        elif whence == 0:
            self.position = offset
        else:
            self.position += offset

        relative_position = self.position - self.offset

        if relative_position < 0 or relative_position >= self.size:
            raise OutOfBound("Position out of buffer bound")

        if self.stream:
            buff_pos = self.buffer.tell()
            if relative_position < buff_pos:
                raise OutOfBound("Negative seek not supported")

            skip_bytes = relative_position - buff_pos
            if skip_bytes == 0:
                return self.position
            self.buffer.read(skip_bytes)
        else:
            self.buffer.seek(relative_position)

        return self.position


class RemoteIO(io.IOBase):
    def __init__(self, fetch_fun, initial_buffer_size=64*1024):
        self.fetch_fun = fetch_fun
        self.initial_buffer_size = initial_buffer_size
        self.buffer = None
        self.file_size = None
        self.position = None
        self._seek_succeeded = False
        self.member_pos2size = None
        self._last_member_pos = None

    def set_pos2size(self, pos2size):
        self.member_pos2size = pos2size

    def read(self, size=0):
        if size == 0:
            size = self.file_size - self.buffer.position

        if not self._seek_succeeded:
            if self.member_pos2size is None:
                fetch_size = size
                stream = False
            else:
                try:
                    fetch_size = self.member_pos2size[self.buffer.position]
                    self._last_member_pos = self.buffer.position
                except KeyError:
                    if self._last_member_pos and self._last_member_pos < self.buffer.position:
                        fetch_size = self.member_pos2size[self._last_member_pos]
                        fetch_size -= (self.buffer.position - self._last_member_pos)
                    else:
                        raise OutOfBound("Attempt to seek outside boundary of current zip member")
                stream = True

            self._seek_succeeded = True
            self.buffer.close()
            self.buffer = self.fetch_fun((self.buffer.position, self.buffer.position + fetch_size -1), stream=stream)

        return self.buffer.read(size)

    def seekable(self):
        return True

    def seek(self, offset, whence=0):
        if whence == 2 and self.file_size is None:
            size = self.initial_buffer_size
            self.buffer = self.fetch_fun((-size, None), stream=False)
            self.file_size = self.buffer.size + self.buffer.position

        try:
            pos = self.buffer.seek(offset, whence)
            self._seek_succeeded = True
            return pos
        except OutOfBound:
            self._seek_succeeded = False
            return self.buffer.position   # we ignore the issue here, we will check if buffer is fine during read

    def tell(self):
        return self.buffer.position

    def close(self):
        if self.buffer:
            self.buffer.close()
            self.buffer = None


class RemoteZip(zipfile.ZipFile):
    def __init__(self, url, initial_buffer_size=64*1024):
        self.url = url

        rio = RemoteIO(self.fetch_fun, initial_buffer_size)
        super(RemoteZip, self).__init__(rio)
        rio.set_pos2size(self.get_position2size())

    def get_central_directory(self):
        return {
            file.filename: {
                attribute: getattr(file, attribute) for attribute in zipfile.ZipInfo.__slots__
            } for file in self.infolist()
        }

    def get_position2size(self):
        ilist = self.infolist()
        if len(ilist) == 0:
            return {}

        position2size = {ilist[-1].header_offset: self.start_dir - ilist[-1].header_offset}
        for i in range(len(ilist) - 1):
            m1, m2 = ilist[i: i+2]
            position2size[m1.header_offset] = m2.header_offset - m1.header_offset

        return position2size

    @staticmethod
    def make_buffer(io_buffer, content_range_header, stream):
        range_min, range_max = content_range_header.split("/")[0][6:].split("-")
        range_min, range_max = int(range_min), int(range_max)
        return PartialBuffer(io_buffer, range_min, range_max - range_min + 1, stream)

    @staticmethod
    def make_header(range_min, range_max):
        if range_max is None:
            return "bytes=%s%s" % (range_min, '' if range_min < 0 else '-')
        return "bytes=%s-%s" % (range_min, range_max)

    def fetch_fun(self, data_range, stream=False):
        range_header = self.make_header(*data_range)
        try:
            response = HttpClient.request(url=self.url, headers={'Range': range_header})
            if 'Content-Range' not in response.headers:
                raise RangeNotSupported("The server doesn't support range requests")

            return self.make_buffer(io.BytesIO(response.content), response.headers['Content-Range'], stream=False)
        except IOError as e:
            raise RemoteIOError(str(e))

    def stream_unzip(self, zipfile_chunks, password=None, chunk_size=65536):
        local_file_header_signature = b'\x50\x4b\x03\x04'
        local_file_header_struct = Struct('<H2sHHHIIIHH')
        zip64_version = 45
        zip64_compressed_size = 4294967295
        zip64_size_signature = b'\x01\x00'
        aes_extra_signature = b'\x01\x99'
        central_directory_signature = b'\x50\x4b\x01\x02'
        central_directory_info = self.get_central_directory()

        def next_or_truncated_error(it):
            try:
                return next(it)
            except StopIteration:
                raise TruncatedDataError from None

        def get_byte_readers(iterable):
            # Return functions to return/"replace" bytes from/to the iterable
            # - _yield_all: yields chunks as they come up (often for a "body")
            # - _get_num: returns a single `bytes` of a given length
            # - _return_unused: puts "unused" bytes "back", to be retrieved by a yield/get call

            chunk = b''
            offset = 0
            it = iter(iterable)

            def _yield_all():
                nonlocal chunk, offset

                while True:
                    if offset == len(chunk):
                        try:
                            chunk = next(it)
                        except StopIteration:
                            break
                        else:
                            offset = 0
                    to_yield = min(len(chunk) - offset, chunk_size)
                    offset = offset + to_yield
                    yield chunk[offset - to_yield:offset]

            def _yield_num(num):
                nonlocal chunk, offset

                while num:
                    if offset == len(chunk):
                        chunk = next_or_truncated_error(it)
                        offset = 0
                    to_yield = min(num, len(chunk) - offset, chunk_size)
                    offset = offset + to_yield
                    num -= to_yield
                    yield chunk[offset - to_yield:offset]

            def _get_num(num):
                return b''.join(_yield_num(num))

            def _return_unused(num_unused):
                nonlocal offset
                offset -= num_unused

            return _yield_all, _get_num, _return_unused

        def get_decompressor_none(num_bytes):
            num_decompressed = 0
            num_unused = 0

            def _decompress(compressed_chunk):
                nonlocal num_decompressed, num_unused
                to_yield = min(len(compressed_chunk), num_bytes - num_decompressed)
                num_decompressed += to_yield
                num_unused = len(compressed_chunk) - to_yield
                yield compressed_chunk[:to_yield]

            def _is_done():
                return num_decompressed == num_bytes

            def _num_unused():
                return num_unused

            return _decompress, _is_done, _num_unused

        def get_decompressor_deflate():
            dobj = zlib.decompressobj(wbits=-zlib.MAX_WBITS)

            def _decompress_single(compressed_chunk):
                try:
                    return dobj.decompress(compressed_chunk, chunk_size)
                except zlib.error as e:
                    raise DeflateError() from e

            def _decompress(compressed_chunk):
                uncompressed_chunk = _decompress_single(compressed_chunk)
                if uncompressed_chunk:
                    yield uncompressed_chunk

                while dobj.unconsumed_tail and not dobj.eof:
                    uncompressed_chunk = _decompress_single(dobj.unconsumed_tail)
                    if uncompressed_chunk:
                        yield uncompressed_chunk

            def _is_done():
                return dobj.eof

            def _num_unused():
                return len(dobj.unused_data)

            return _decompress, _is_done, _num_unused

        def get_decompressor_deflate64():
            uncompressed_chunks, is_done, num_bytes_unconsumed = stream_inflate64()

            def _decompress(compressed_chunk):
                yield from uncompressed_chunks((compressed_chunk,))

            return _decompress, is_done, num_bytes_unconsumed

        def yield_file(yield_all, get_num, return_unused):

            def get_flag_bits(flags):
                for b in flags:
                    for i in range(8):
                        yield (b >> i) & 1

            def parse_extra(extra):
                extra_offset = 0
                while extra_offset <= len(extra) - 4:
                    extra_signature = extra[extra_offset:extra_offset + 2]
                    extra_offset += 2
                    extra_data_size, = Struct('<H').unpack(extra[extra_offset:extra_offset + 2])
                    extra_offset += 2
                    extra_data = extra[extra_offset:extra_offset + extra_data_size]
                    extra_offset += extra_data_size
                    yield (extra_signature, extra_data)

            def get_extra_value(extra, if_true, signature, exception_if_missing, min_length, exception_if_too_short):
                if if_true:
                    try:
                        value = extra[signature]
                    except KeyError:
                        raise exception_if_missing()

                    if len(value) < min_length:
                        raise exception_if_too_short()
                else:
                    value = None

                return value

            def decrypt_weak_decompress(chunks, decompress, is_done, num_unused):
                key_0 = 305419896
                key_1 = 591751049
                key_2 = 878082192
                crc32 = zlib.crc32
                bytes_c = bytes

                def update_keys(byte):
                    nonlocal key_0, key_1, key_2
                    key_0 = ~crc32(bytes_c((byte,)), ~key_0) & 0xFFFFFFFF
                    key_1 = (key_1 + (key_0 & 0xFF)) & 0xFFFFFFFF
                    key_1 = ((key_1 * 134775813) + 1) & 0xFFFFFFFF
                    key_2 = ~crc32(bytes_c((key_1 >> 24,)), ~key_2) & 0xFFFFFFFF

                def decrypt(chunk):
                    chunk = bytearray(chunk)
                    for i, byte in enumerate(chunk):
                        temp = key_2 | 2
                        byte ^= ((temp * (temp ^ 1)) >> 8) & 0xFF
                        update_keys(byte)
                        chunk[i] = byte
                    return bytes(chunk)

                for byte in password:
                    update_keys(byte)

                if decrypt(get_num(12))[11] != mod_time >> 8:
                    raise IncorrectZipCryptoPasswordError()

                while not is_done():
                    yield from decompress(decrypt(next_or_truncated_error(chunks)))

                return_unused(num_unused())

            def decrypt_aes_decompress(chunks, decompress, is_done, num_unused, key_length_raw):
                try:
                    key_length, salt_length = {1: (16, 8), 2: (24, 12), 3: (32, 16)}[key_length_raw]
                except KeyError:
                    raise InvalidAESKeyLengthError(key_length_raw)

                salt = get_num(salt_length)
                password_verification_length = 2

                keys = PBKDF2(password, salt, 2 * key_length + password_verification_length, 1000)
                if keys[-password_verification_length:] != get_num(password_verification_length):
                    raise IncorrectAESPasswordError()

                decrypter = AES.new(
                    keys[:key_length], AES.MODE_CTR,
                    counter=Counter.new(nbits=128, little_endian=True)
                )
                hmac = HMAC.new(keys[key_length:key_length * 2], digestmod=SHA1)

                while not is_done():
                    chunk = next_or_truncated_error(chunks)
                    yield from decompress(decrypter.decrypt(chunk))
                    hmac.update(chunk[:len(chunk) - num_unused()])

                return_unused(num_unused())

                if get_num(10) != hmac.digest()[:10]:
                    raise HMACIntegrityError()

            def decrypt_none_decompress(chunks, decompress, is_done, num_unused):
                while not is_done():
                    yield from decompress(next_or_truncated_error(chunks))

                return_unused(num_unused())

            def get_crc_32_expected_from_data_descriptor(is_zip64, file_size_stored_as_long_long):
                dd_optional_signature = get_num(4)
                dd_so_far_num = \
                    0 if dd_optional_signature == b'PK\x07\x08' else \
                        4
                dd_so_far = dd_optional_signature[:dd_so_far_num]
                # Have to check both if zip64 and if we store as long long (8), since some zip64 store only as long (4)
                dd_remaining = \
                    (20 - dd_so_far_num) if is_zip64 and file_size_stored_as_long_long else \
                        (12 - dd_so_far_num)
                dd = dd_so_far + get_num(dd_remaining)
                crc_32_expected, = Struct('<I').unpack(dd[:4])
                return crc_32_expected

            def get_crc_32_expected_from_file_header():
                return crc_32_expected

            def read_data_and_crc_32_ignore(get_crc_32_expected, chunks):
                yield from chunks
                get_crc_32_expected()

            def read_data_and_crc_32_verify(get_crc_32_expected, chunks):
                crc_32_actual = zlib.crc32(b'')
                for chunk in chunks:
                    crc_32_actual = zlib.crc32(chunk, crc_32_actual)
                    yield chunk

                if crc_32_actual != get_crc_32_expected():
                    raise CRC32IntegrityError()

            version, flags, compression_raw, mod_time, mod_date, crc_32_expected, compressed_size_raw, uncompressed_size_raw, file_name_len, extra_field_len = \
                local_file_header_struct.unpack(get_num(local_file_header_struct.size))

            flag_bits = tuple(get_flag_bits(flags))
            if (
                    flag_bits[4]  # Enhanced deflating
                    or flag_bits[5]  # Compressed patched
                    or flag_bits[6]  # Strong encrypted
                    or flag_bits[13]  # Masked header values
            ):
                raise UnsupportedFlagsError(flag_bits)

            file_name = get_num(file_name_len)
            file_name_str = file_name.decode()

            # Get these attributes from central directory as they are incorrect in the File Header
            uncompressed_size_raw = central_directory_info[file_name_str]['file_size']
            extract_version = central_directory_info[file_name_str]['extract_version']
            central_directory_extra = central_directory_info[file_name_str]['extra']

            # Zip64 Extra field requires 20 bytes to store Header (2) + Field Length (2) + File size (8) + Compressed size (8)
            # The length of the filesize field determines if the length of the data descriptor is 12 or 20 bytes.
            if zip64_size_signature in central_directory_extra and len(central_directory_extra) >= 20:
                file_size_stored_as_long_long = True
            else:
                file_size_stored_as_long_long = False

            extra = dict(parse_extra(get_num(extra_field_len)))

            is_weak_encrypted = flag_bits[0] and compression_raw != 99
            is_aes_encrypted = flag_bits[0] and compression_raw == 99
            aes_extra = get_extra_value(extra, is_aes_encrypted, aes_extra_signature, MissingAESExtraError, 7,
                                        TruncatedAESExtraError)
            is_aes_2_encrypted = is_aes_encrypted and aes_extra[0:2] == b'\x02\x00'

            if is_weak_encrypted and password is None:
                raise MissingZipCryptoPasswordError()

            if is_aes_encrypted and password is None:
                raise MissingAESPasswordError()

            compression = \
                Struct('<H').unpack(aes_extra[5:7])[0] if is_aes_encrypted else \
                    compression_raw

            if compression not in (0, 8, 9):
                raise UnsupportedCompressionTypeError(compression)

            has_data_descriptor = flag_bits[3]
            is_zip64 = compressed_size_raw == zip64_compressed_size and uncompressed_size_raw == zip64_compressed_size \
                       or extract_version == zip64_version
            zip64_extra = get_extra_value(extra, not has_data_descriptor and is_zip64, zip64_size_signature,
                                          MissingZip64ExtraError, 16, TruncatedZip64ExtraError)

            # zip64_extra can be None in some cases where is_zip64 is True so it is necessary to check.
            uncompressed_size = \
                None if has_data_descriptor and compression in (8, 9) else \
                    Struct('<Q').unpack(zip64_extra[:8])[0] if is_zip64 and zip64_extra else \
                        uncompressed_size_raw

            decompressor = \
                get_decompressor_none(uncompressed_size) if compression == 0 else \
                    get_decompressor_deflate() if compression == 8 else \
                        get_decompressor_deflate64()

            decompressed_bytes = \
                decrypt_weak_decompress(yield_all(), *decompressor) if is_weak_encrypted else \
                    decrypt_aes_decompress(yield_all(), *decompressor,
                                           key_length_raw=aes_extra[4]) if is_aes_encrypted else \
                        decrypt_none_decompress(yield_all(), *decompressor)

            get_crc_32_expected = \
                partial(get_crc_32_expected_from_data_descriptor, is_zip64, file_size_stored_as_long_long) \
                    if has_data_descriptor else get_crc_32_expected_from_file_header

            crc_checked_bytes = \
                read_data_and_crc_32_ignore(get_crc_32_expected, decompressed_bytes) if is_aes_2_encrypted else \
                    read_data_and_crc_32_verify(get_crc_32_expected, decompressed_bytes)

            return file_name, uncompressed_size, crc_checked_bytes

        def all():
            yield_all, get_num, return_unused = get_byte_readers(zipfile_chunks)

            while True:
                signature = get_num(len(local_file_header_signature))
                if signature == local_file_header_signature:
                    yield yield_file(yield_all, get_num, return_unused)
                elif signature == central_directory_signature:
                    for _ in yield_all():
                        pass
                    break
                else:
                    raise UnexpectedSignatureError(signature)

        for file_name, file_size, unzipped_chunks in all():
            yield file_name, file_size, unzipped_chunks
            for _ in unzipped_chunks:
                raise UnfinishedIterationError()

class UnzipError(Exception):
    pass

class InvalidOperationError(UnzipError):
    pass

class UnfinishedIterationError(InvalidOperationError):
    pass

class UnzipValueError(UnzipError, ValueError):
    pass

class DataError(UnzipValueError):
    pass

class UncompressError(UnzipValueError):
    pass

class DeflateError(UncompressError):
    pass

class UnsupportedFeatureError(DataError):
    pass

class UnsupportedFlagsError(UnsupportedFeatureError):
    pass

class UnsupportedCompressionTypeError(UnsupportedFeatureError):
    pass

class TruncatedDataError(DataError):
    pass

class UnexpectedSignatureError(DataError):
    pass

class MissingExtraError(DataError):
    pass

class MissingZip64ExtraError(MissingExtraError):
    pass

class MissingAESExtraError(MissingExtraError):
    pass

class TruncatedExtraError(DataError):
    pass

class TruncatedZip64ExtraError(TruncatedExtraError):
    pass

class TruncatedAESExtraError(TruncatedExtraError):
    pass

class InvalidExtraError(TruncatedExtraError):
    pass

class InvalidAESKeyLengthError(TruncatedExtraError):
    pass

class IntegrityError(DataError):
    pass

class HMACIntegrityError(IntegrityError):
    pass

class CRC32IntegrityError(IntegrityError):
    pass

class PasswordError(UnzipValueError):
    pass

class MissingPasswordError(UnzipValueError):
    pass

class MissingZipCryptoPasswordError(MissingPasswordError):
    pass

class MissingAESPasswordError(MissingPasswordError):
    pass

class IncorrectPasswordError(PasswordError):
    pass

class IncorrectZipCryptoPasswordError(IncorrectPasswordError):
    pass

class IncorrectAESPasswordError(IncorrectPasswordError):
    pass
