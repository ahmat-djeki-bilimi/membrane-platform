"""Cache persistant (en base) des réponses de services externes."""

import functools
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from app import provenance
from app.config import get_settings
from app.db import session_scope
from app.models import CacheEntry

_MISSING = object()


def cache_get(key: str) -> Any:
    return cache_lookup(key)[0]


def cache_lookup(key: str) -> tuple[Any, datetime | None]:
    """Valeur en cache et date de mise en cache (_MISSING si absente ou expirée)."""
    with session_scope() as session:
        entry = session.get(CacheEntry, key)
        if entry is None:
            return _MISSING, None
        expires = entry.expires_at
        if expires is not None:
            # SQLite renvoie des dates sans fuseau
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if expires < datetime.now(timezone.utc):
                session.delete(entry)
                return _MISSING, None
        return entry.value, entry.created_at


def cache_set(key: str, value: Any, ttl: int | None = None) -> None:
    expires = datetime.now(timezone.utc) + timedelta(seconds=ttl) if ttl else None
    with session_scope() as session:
        session.merge(CacheEntry(key=key, value=value, expires_at=expires))


def cached(namespace: str, ttl: int | None = None, store_if: Callable[[Any], bool] | None = None):
    """
    Met en cache le résultat (JSON) d'une fonction selon ses arguments.
    `store_if` permet de ne pas conserver les réponses d'erreur.
    """

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            key = f"{namespace}:" + json.dumps([args, kwargs], sort_keys=True, default=str)
            hit, created_at = cache_lookup(key)
            if hit is not _MISSING:
                # Traçabilité : réponse réutilisée et date à laquelle elle a été obtenue
                provenance.record_cache_hit(namespace, created_at)
                return hit
            value = func(*args, **kwargs)
            if store_if is None or store_if(value):
                cache_set(key, value, ttl if ttl is not None else get_settings().cache_ttl_seconds)
            return value

        return wrapper

    return decorator


def is_successful(value: Any) -> bool:
    """Ne met pas en cache les réponses signalant une erreur."""
    return not (isinstance(value, dict) and value.get("error"))
