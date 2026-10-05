"""
Authentification : mots de passe (scrypt) et jetons de session.

Le client envoie `Authorization: Bearer <jeton>`. Seule l'empreinte SHA-256
du jeton est enregistrée : une fuite de la base ne permet pas d'usurper une
session, et la déconnexion révoque immédiatement le jeton.
"""

import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import delete, select

from app.config import get_settings
from app.db import session_scope
from app.models import AuthSession, User

# Paramètres scrypt recommandés (RFC 7914 / OWASP)
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 64}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD_LENGTH = 8

_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), **_SCRYPT)
    return hmac.compare_digest(digest.hex(), digest_hex)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=get_settings().session_days)
    with session_scope() as session:
        session.add(AuthSession(token_hash=_token_hash(token), user_id=user_id, expires_at=expires))
    return token


def revoke_session(token: str) -> None:
    with session_scope() as session:
        session.execute(delete(AuthSession).where(AuthSession.token_hash == _token_hash(token)))


def _user_for_token(token: str) -> dict | None:
    with session_scope() as session:
        auth = session.get(AuthSession, _token_hash(token))
        if auth is None:
            return None
        expires = auth.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            session.delete(auth)
            return None
        user = session.get(User, auth.user_id)
        return user.to_dict() if user else None


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    """Dépendance FastAPI : utilisateur connecté, sinon erreur 401."""
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Connexion requise.")
    user = _user_for_token(credentials.credentials)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expirée ou invalide.")
    return user


def bearer_token(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> str | None:
    return credentials.credentials if credentials else None


def find_user_by_email(email: str) -> User | None:
    with session_scope() as session:
        return session.scalars(select(User).where(User.email == email.lower().strip())).first()
