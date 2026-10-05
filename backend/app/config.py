"""Configuration lue dans les variables d'environnement (ou le fichier .env)."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # Base de données : SQLite en développement, PostgreSQL en production
    # (ex. postgresql+psycopg://user:mot_de_passe@db:5432/memprotscope)
    database_url: str = f"sqlite:///{(DATA_DIR / 'memprotscope.db').as_posix()}"

    # File de calculs : SQLite en développement, Redis en production
    # (ex. redis://redis:6379/0)
    queue_url: str = f"sqlite:///{(DATA_DIR / 'queue.db').as_posix()}"
    # Démarre un worker dans le processus de l'API (pratique en développement)
    embedded_worker: bool = True
    worker_threads: int = 2

    # Origines autorisées à appeler l'API, séparées par des virgules
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # DeepTMHMM via BioLib (si pybiolib est installé)
    deeptmhmm_enabled: bool = True
    deeptmhmm_max_length: int = 10_000

    # Applique les migrations au démarrage de l'API (désactivé en production,
    # où `alembic upgrade head` est lancé une seule fois avant les serveurs)
    auto_migrate: bool = True

    # Durée de validité d'une session de connexion (jours)
    session_days: int = 30

    # Durée de conservation des réponses des services externes (secondes)
    cache_ttl_seconds: int = 7 * 24 * 3600

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return Settings()
