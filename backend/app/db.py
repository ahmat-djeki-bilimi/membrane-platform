"""Connexion à la base de données (SQLAlchemy)."""

from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import get_settings

settings = get_settings()

engine = create_engine(
    settings.database_url,
    # SQLite partagé entre l'API et les threads du worker
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

if settings.database_url.startswith("sqlite"):
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, _):
        # SQLite n'applique les clés étrangères (et ON DELETE CASCADE) que sur demande
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


class Base(DeclarativeBase):
    pass


@contextmanager
def session_scope():
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def run_migrations() -> None:
    """Met la base au niveau de la dernière migration Alembic."""
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import inspect

    from app.config import BACKEND_DIR

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.attributes["configure_logger"] = False

    tables = inspect(engine).get_table_names()
    if "alembic_version" not in tables and "jobs" in tables:
        # Base créée avant l'introduction des migrations : déjà au niveau 0001
        command.stamp(config, "0001")
    command.upgrade(config, "head")


def init_db() -> None:
    if settings.auto_migrate:
        run_migrations()
