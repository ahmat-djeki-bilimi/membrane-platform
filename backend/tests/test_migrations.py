"""Les migrations Alembic produisent exactement le schéma des modèles."""

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect

from app.config import BACKEND_DIR
from app.db import Base


def test_migrations_match_models(tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'migrations.db').as_posix()}")
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.attributes["configure_logger"] = False

    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")

    with engine.connect() as connection:
        differences = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    assert differences == []
    assert "users" in inspect(engine).get_table_names()

    # Retour en arrière complet possible
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "base")
    assert set(inspect(engine).get_table_names()) <= {"alembic_version"}
