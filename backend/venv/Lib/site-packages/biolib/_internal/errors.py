from biolib.biolib_errors import BioLibError


class AuthenticationError(BioLibError):
    """Raised when authentication is required but user is not signed in."""
