"""Cache persistant (en base) des réponses de services externes."""

import functools
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from app.config import get_settings
from app.db import session_scope
from app.models import CacheEntry

_MISSING = object()


def cache_get(key: str) -> Any:
    with session_scope() as session:
        entry = session.get(CacheEntry, key)
        if entry is None:
            return _MISSING
        expires = entry.expires_at
        if expires is not None:
            # SQLite renvoie des dates sans fuseau
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if expires < datetime.now(timezone.utc):
                session.delete(entry)
                return _MISSING
        return entry.value


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
            hit = cache_get(key)
            if hit is not _MISSING:
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
