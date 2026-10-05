"""
File de calculs (Huey).

Développement : file SQLite et worker démarré dans le processus de l'API.
Production : file Redis (QUEUE_URL=redis://…) et worker séparé :
    huey_consumer app.tasks.huey -k thread -w 4
"""

import logging
from datetime import datetime, timezone
from typing import Callable

from huey import RedisHuey, SqliteHuey
from sqlalchemy import update

from app.config import get_settings
from app.db import session_scope
from app.models import Job

logger = logging.getLogger("memprotscope.tasks")
settings = get_settings()

if settings.queue_url.startswith("redis"):
    huey = RedisHuey("memprotscope", url=settings.queue_url)
else:
    huey = SqliteHuey("memprotscope", filename=settings.queue_url.removeprefix("sqlite:///"))


def _runners() -> dict[str, Callable[[dict], dict]]:
    """Calculs disponibles, par type de tâche."""
    from app.services.conservation_service import compute_conservation, compute_sequence_conservation
    from app.services.membrane_service import predict_topology_isolated
    from app.services.structure_prediction_service import predict_structure

    return {
        "deeptmhmm": lambda p: predict_topology_isolated(p["sequence"], p.get("name", "query")),
        "conservation": lambda p: compute_conservation(p["accession"], p.get("source", "uniref50")),
        "conservation_sequence": lambda p: compute_sequence_conservation(p["sequence"], p.get("name", "query")),
        "structure_prediction": lambda p: predict_structure(
            p["sequence"],
            name=p.get("name", "query"),
            tm_segments=p.get("tm_segments"),
            tm_source=p.get("tm_source", "kd"),
            n_terminus=p.get("n_terminus"),
            start=p.get("start"),
        ),
    }


@huey.task()
def run_job(job_id: str) -> None:
    now = datetime.now(timezone.utc)
    # Passage atomique « queued » → « running » : une tâche ne s'exécute qu'une fois
    with session_scope() as session:
        claimed = session.execute(
            update(Job)
            .where(Job.id == job_id, Job.status == "queued")
            .values(status="running", started_at=now, attempts=Job.attempts + 1)
        ).rowcount
    if not claimed:
        return

    with session_scope() as session:
        job = session.get(Job, job_id)
        kind, params = job.kind, dict(job.params)

    try:
        runner = _runners()[kind]
        result = runner(params)
        status, error = "succeeded", None
    except Exception as exc:  # l'erreur est conservée pour l'utilisateur
        logger.exception("Tâche %s (%s) en échec", job_id, kind)
        result, status, error = None, "failed", str(exc)[:2000]

    with session_scope() as session:
        job = session.get(Job, job_id)
        job.status = status
        job.result = result
        job.error = error
        job.finished_at = datetime.now(timezone.utc)


_consumer = None


def start_embedded_worker() -> None:
    """Worker dans le processus de l'API (développement uniquement)."""
    global _consumer
    if _consumer is not None:
        return
    _consumer = huey.create_consumer(workers=settings.worker_threads, worker_type="thread")
    # Les signaux ne peuvent être interceptés que par le thread principal ;
    # ici, c'est l'API qui arrête le worker.
    _consumer._set_signal_handlers = lambda: None
    _consumer.start()
    logger.info("Worker intégré démarré (%d threads)", settings.worker_threads)


def stop_embedded_worker() -> None:
    global _consumer
    if _consumer is not None:
        from app.services.membrane_service import stop_running_predictions

        # Les tâches interrompues restent « running » et sont relancées au démarrage
        stop_running_predictions()
        _consumer.stop(graceful=False)
        _consumer = None
