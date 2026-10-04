import re
from io import BufferedIOBase, TextIOBase

from biolib.typing_utils import Dict, Iterator, List, Optional, Union


class SeqUtilRecord:
    def __init__(
        self,
        sequence: str,
        sequence_id: str,
        description: Optional['str'] = None,
        properties: Optional[Dict[str, str]] = None,
    ):
        self.sequence = sequence
        self.id = sequence_id  # pylint: disable=invalid-name
        self.description = description

        if properties:
            disallowed_pattern = re.compile(r'[=\[\]\n]')
            for key, value in properties.items():
                assert not bool(disallowed_pattern.search(key)), 'Key cannot contain characters =[] and newline'
                assert not bool(disallowed_pattern.search(value)), 'Value cannot contain characters =[] and newline'
            self.properties = properties
        else:
            self.properties = {}

    def __repr__(self) -> str:
        return f'{self.__class__.__name__} ({self.id})'


class SeqUtil:
    @staticmethod
    def parse_fasta(
        input_file: Union[str, BufferedIOBase, None] = None,
        default_header: Optional[str] = None,
        allow_any_sequence_characters: bool = False,
        use_strict_alphabet: Optional[bool] = False,
        allow_empty_sequence: bool = True,
        file_name: Optional[str] = None,
) -> Iterator[SeqUtilRecord]:
        def process_and_yield_record(header: str, sequence_lines: List[str]):
            sequence = ''.join(sequence_lines)
            sequence_id = header.split()[0]
            if allow_any_sequence_characters and use_strict_alphabet:
                raise Exception(
                    'Error: Please choose either allow_any_sequence_characters or use_strict_alphabet'
                )
            if not allow_any_sequence_characters:
                if use_strict_alphabet:
                    invalid_sequence_characters = SeqUtil._find_invalid_sequence_characters_strict(sequence)
                else:
                    invalid_sequence_characters = SeqUtil._find_invalid_sequence_characters(sequence)
                if invalid_sequence_characters:
                    raise Exception(
                        f'Error: Invalid character ("{invalid_sequence_characters[0]}") found in sequence {sequence_id}'
                    )
            if not allow_empty_sequence and not sequence:
                raise Exception(f'Error: No sequence found for fasta entry {sequence_id}')
            yield SeqUtilRecord(
                sequence=sequence,
                sequence_id=sequence_id,
                description=header[len(sequence_id):].strip()
            )

        def line_generator_from_buffered_io_base(file_handle: BufferedIOBase) -> Iterator[str]:
            for line in file_handle:
                yield line.decode('utf-8')

        def line_generator_from_text_io_base(file_handle: TextIOBase) -> Iterator[str]:
            for line in file_handle:
                yield line

        if input_file is None:
            if file_name:
                input_file = file_name
            else:
                raise ValueError('input_file must be a file name (str) or a BufferedIOBase object')

        file_handle = None
        if isinstance(input_file, str):
            file_handle = open(input_file, "rb")
            line_iterator = line_generator_from_buffered_io_base(file_handle)
        elif isinstance(input_file, BufferedIOBase):
            line_iterator = line_generator_from_buffered_io_base(input_file)
        elif isinstance(input_file, TextIOBase):
            line_iterator = line_generator_from_text_io_base(input_file)
        else:
            raise ValueError('input_file must be a file name (str) or a BufferedIOBase object')

        header = None
        sequence_lines: List[str] = []

        try:
            for line_number, line in enumerate(line_iterator):
                line = line.strip()
                if not line:
                    continue # skip empty lines
                if line.startswith('>'):
                    if header is not None:
                        yield from process_and_yield_record(header, sequence_lines)

                    header = line[1:].strip()
                    sequence_lines = []
                else:
                    if header is None:
                        if default_header:
                            yield from process_and_yield_record(f"{default_header}{line_number}", [line])
                        else:
                            raise Exception(f'No header line found in FASTA file "{file_name}"')
                    else:
                        sequence_lines.append(line)

            if header is not None:
                yield from process_and_yield_record(header, sequence_lines)
        finally:
            if file_handle:
                file_handle.close()

    @staticmethod
    def write_records_to_fasta(file_name: str, records: List[SeqUtilRecord]) -> None:
        with open(file_name, mode='w') as file_handle:
            for record in records:
                optional_description = f' {record.description}' if record.description else ''
                if record.properties:
                    for key, value in record.properties.items():
                        optional_description += f' [{key}={value}]'
                sequence = '\n'.join(record.sequence[i : i + 80] for i in range(0, len(record.sequence), 80))
                file_handle.write(f'>{record.id}{optional_description}\n{sequence}\n')

    @staticmethod
    def _find_invalid_sequence_characters(sequence: str) -> List[str]:
        allowed_sequence_chars = set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.')
        invalid_chars = [char for char in sequence if char not in allowed_sequence_chars]
        return invalid_chars

    @staticmethod
    def _find_invalid_sequence_characters_strict(sequence: str) -> List[str]:
        # Equivalent to fair-esm alphabet, compatible with ESM-models
        # Excludes digits, '_' and 'J' (ambiguous letter only used in mass-spec NMR)
        # https://github.com/facebookresearch/esm/blob/2b369911bb5b4b0dda914521b9475cad1656b2ac/esm/constants.py#L8
        allowed_sequence_chars = set('lagvsertidpkqnfymhwcxbuzoLAGVSERTIDPKQNFYMHWCXBUZO-.')
        invalid_chars = [char for char in sequence if char not in allowed_sequence_chars]
        return invalid_chars
