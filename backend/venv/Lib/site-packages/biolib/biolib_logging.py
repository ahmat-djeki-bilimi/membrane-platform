import logging
import os
import sys

_DEFAULT_LOGGER_FORMAT = '%(asctime)s | %(levelname)s : %(message)s'

# define global logging format
logging.basicConfig(format=_DEFAULT_LOGGER_FORMAT, level=logging.INFO, stream=sys.stdout)

# define extra log levels
TRACE = 5
logging.addLevelName(TRACE, 'TRACE')


# note: Logger classes should never be instantiated directly
class _BioLibLogger(logging.Logger):
    def __init__(self, name: str, level=logging.INFO):
        super(_BioLibLogger, self).__init__(name=name, level=level)

    def configure(self, default_log_level):
        env_log_level = os.getenv('BIOLIB_LOG')
        if env_log_level is None or env_log_level == '':
            self.setLevel(default_log_level)
        else:
            self.setLevel(env_log_level.upper())

    def setLevel(self, level) -> None:
        try:
            normalized_level = level.upper() if isinstance(level, str) else level
            super(_BioLibLogger, self).setLevel(normalized_level)
        except ValueError:
            raise Exception(f'Unknown log level "{level}"') from None

        global_root_logger = logging.getLogger()
        # only activate debug logging globally if user selected trace logging
        if self.level == TRACE:
            global_root_logger.setLevel(logging.DEBUG)
        elif self.level == logging.DEBUG:
            global_root_logger.setLevel(logging.INFO)
        else:
            global_root_logger.setLevel(self.level)


def _get_biolib_logger_instance(name: str) -> _BioLibLogger:
    # for thread safety use the global lock of logging
    logging._lock.acquire()  # type: ignore # pylint: disable=protected-access

    original_logger_class = logging.getLoggerClass()
    try:
        # change logger class temporarily to get instance of _BioLibLogger
        logging.setLoggerClass(_BioLibLogger)
        biolib_logger = logging.getLogger(name=name)
        # change the logger class back to original so we do not interfere with other libraries
        logging.setLoggerClass(original_logger_class)
        return biolib_logger  # type: ignore
    finally:
        logging._lock.release()  # type: ignore # pylint: disable=protected-access


def _get_no_user_data_logger() -> _BioLibLogger:
    _logger_no_user_data = _get_biolib_logger_instance(name='biolib_no_user_data')

    # TODO: Simplify by refactoring to env BIOLIB_ENVIRONMENT_IS_CLOUD: boolean
    if os.getenv('BIOLIB_CLOUD_ENVIRONMENT', '').lower() == 'non-enclave':
        handler = logging.FileHandler(filename='/biolib/logs/biolib_no_user_data.log')
        formatter = logging.Formatter(_DEFAULT_LOGGER_FORMAT)
        handler.setFormatter(formatter)
        _logger_no_user_data.addHandler(handler)

    return _logger_no_user_data


# expose loggers
logger = _get_biolib_logger_instance(name='biolib')
logger_no_user_data = _get_no_user_data_logger()
