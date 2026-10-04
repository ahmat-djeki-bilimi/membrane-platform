import sys

from biolib import biolib_errors, utils
from biolib._internal import cli
from biolib.app import BioLibApp
from biolib.experiments.experiment import Experiment
from biolib.typing_utils import Optional, Tuple


@cli.command(
    context_settings=dict(ignore_unknown_options=True, allow_interspersed_args=False),
    help='Run an application on BioLib.',
)
@cli.option('--experiment', type=str, required=False, help='Experiment name or URI to add the run to.')
@cli.option('--local', is_flag=True, required=False, hidden=True)
@cli.option('--non-blocking', is_flag=True, required=False, help='Run the application non blocking.')
@cli.argument('uri', required=True)
@cli.argument('args', nargs=-1, type=cli.UNPROCESSED)
def run(experiment: Optional[str], local: bool, non_blocking: bool, uri: str, args: Tuple[str]) -> None:
    if local:
        print('Error: Running applications locally with --local is no longer supported.', file=sys.stderr)
        sys.exit(1)

    if experiment:
        with Experiment(uri=experiment):
            _run(non_blocking=non_blocking, uri=uri, args=args)
    else:
        _run(non_blocking=non_blocking, uri=uri, args=args)


def _run(non_blocking: bool, uri: str, args: Tuple[str]) -> None:
    try:
        app = BioLibApp(uri=uri)
    except biolib_errors.BioLibError as error:
        print(f'An error occurred:\n {error.message}', file=sys.stderr)
        exit(1)

    def _get_stdin():
        stdin = None
        if not sys.stdin.isatty() and not utils.IS_DEV:
            stdin = sys.stdin.read()
        return stdin

    blocking = not non_blocking
    job = app.cli(
        args=list(args),
        stdin=_get_stdin(),
        files=None,
        blocking=blocking,
    )

    if blocking:
        job.save_files('biolib_results', overwrite=True)

        # Write stdout and stderr if it has not been streamed (Markdown is not streamed)
        if app.version.get('stdout_render_type') == 'markdown' or not sys.stdout.isatty():
            sys.stdout.buffer.write(job.get_stdout())
            sys.stderr.buffer.write(job.get_stderr())

        exit(job.get_exit_code())
    else:
        print('{"job_id": "' + str(job.id) + '"}')
