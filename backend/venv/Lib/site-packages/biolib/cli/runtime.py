from biolib._internal import cli
from biolib.sdk import Runtime


@cli.group(help='Commands available within a BioLib runtime')
def runtime() -> None:
    pass


@runtime.command(help='Set the name prefix of the main result')
@cli.argument('result-prefix', required=True)
def set_main_result_prefix(result_prefix: str) -> None:
    Runtime.set_main_result_prefix(result_prefix)
