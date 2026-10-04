from biolib.biolib_binary_format.base_bbf_package import BioLibBinaryFormatBasePackage
from biolib.biolib_logging import logger
from biolib.typing_utils import TypedDict, Dict, List


class ModuleInputDict(TypedDict):
    stdin: bytes
    files: Dict[str, bytes]
    arguments: List[str]


class ModuleInput(BioLibBinaryFormatBasePackage):
    def __init__(self, bbf=None):
        super().__init__(bbf)
        self.package_type = 1

    def serialize(self, stdin, arguments, files) -> bytes:
        for path in files.keys():
            if '//' in path:
                raise ValueError(f"File path '{path}' contains double slashes which are not allowed")

        bbf_data = bytearray()
        bbf_data.extend(self.version.to_bytes(1, 'big'))
        bbf_data.extend(self.package_type.to_bytes(1, 'big'))

        bbf_data.extend(len(stdin).to_bytes(8, 'big'))

        argument_len = sum([len(arg.encode()) for arg in arguments]) + (2 * len(arguments))
        bbf_data.extend(argument_len.to_bytes(4, 'big'))

        file_data_len = sum([len(data) + len(path.encode()) for path, data in files.items()]) + (12 * len(files))
        bbf_data.extend(file_data_len.to_bytes(8, 'big'))

        bbf_data.extend(stdin)

        for argument in arguments:
            encoded_argument = argument.encode()
            bbf_data.extend(len(encoded_argument).to_bytes(2, 'big'))
            bbf_data.extend(encoded_argument)

        for path, data in files.items():
            encoded_path = path.encode()
            bbf_data.extend(len(encoded_path).to_bytes(4, 'big'))
            bbf_data.extend(len(data).to_bytes(8, 'big'))

            bbf_data.extend(encoded_path)
            bbf_data.extend(data)

        return bbf_data

    def deserialize(self) -> ModuleInputDict:
        version = self.get_data(1, output_type='int')
        package_type = self.get_data(1, output_type='int')
        self.check_version_and_type(version=version, package_type=package_type, expected_package_type=self.package_type)

        stdin_len = self.get_data(8, output_type='int')
        argument_data_len = self.get_data(4, output_type='int')
        files_data_len = self.get_data(8, output_type='int')
        stdin = self.get_data(stdin_len)

        end_of_arguments = self.pointer + argument_data_len
        arguments = []
        while self.pointer != end_of_arguments:
            argument_len = self.get_data(2, output_type='int')
            argument = self.get_data(argument_len, output_type='str')
            arguments.append(argument)

        end_of_files = self.pointer + files_data_len
        files = {}
        while self.pointer < end_of_files:
            path_len = self.get_data(4, output_type='int')
            data_len = self.get_data(8, output_type='int')
            path = self.get_data(path_len, output_type='str')
            data = self.get_data(data_len)
            if '//' in path:
                # TODO: Raise ValueError here once backwards compatibility period is over
                logger.warning(f"File path '{path}' contains double slashes which are not allowed")
            files[path] = bytes(data)

        return ModuleInputDict(stdin=stdin, arguments=arguments, files=files)
