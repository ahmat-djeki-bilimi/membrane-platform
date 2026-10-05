"""Configuration des tests : base et file temporaires, aucun appel réseau réel."""

import os
import sys
import tempfile
from pathlib import Path

import pytest

_tmp = Path(tempfile.mkdtemp(prefix="memprotscope-tests-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_tmp / 'test.db').as_posix()}"
os.environ["QUEUE_URL"] = f"sqlite:///{(_tmp / 'queue.db').as_posix()}"
os.environ["EMBEDDED_WORKER"] = "false"
os.environ["DEEPTMHMM_ENABLED"] = "false"
# Tables créées directement ; les migrations ont leur propre test
os.environ["AUTO_MIGRATE"] = "false"

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import models  # noqa: E402,F401
from app.db import Base, engine  # noqa: E402
from app.tasks import huey  # noqa: E402

# Les tâches s'exécutent immédiatement, dans le processus des tests
huey.immediate = True

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def clean_database():
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Tout appel HTTP non simulé fait échouer le test."""
    from app import http

    def refuse(*args, **kwargs):
        raise RuntimeError(f"Appel réseau interdit pendant les tests : {args[:1]}")

    monkeypatch.setattr(http, "get", refuse)
    monkeypatch.setattr(http, "post", refuse)
