"""Soumission et suivi des tâches de calcul."""

import hashlib
import json

from sqlalchemy import select

from app.db import session_scope
from app.models import Job

ACTIVE = ("queued", "running")


def input_key(kind: str, params: dict) -> str:
    """Empreinte stable des paramètres d'un calcul."""
    payload = json.dumps({"kind": kind, "params": params}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()


def submit(kind: str, params: dict, key_params: dict | None = None) -> dict:
    """
    Renvoie la tâche correspondant à ces paramètres : résultat déjà calculé,
    calcul en cours, ou nouveau calcul mis en file. Une tâche échouée est relancée.
    `key_params` permet d'ignorer des paramètres sans effet sur le résultat
    (ex. le nom de la séquence).
    """
    from app.tasks import run_job

    key = input_key(kind, key_params if key_params is not None else params)
    with session_scope() as session:
        existing = session.scalars(
            select(Job)
            .where(Job.input_key == key, Job.status.in_((*ACTIVE, "succeeded")))
            .order_by(Job.created_at.desc())
        ).first()
        if existing is not None:
            return existing.to_dict()

        job = Job(kind=kind, input_key=key, params=params, status="queued")
        session.add(job)
        session.flush()
        job_dict = job.to_dict()

    run_job(job_dict["id"])
    return job_dict


def get(job_id: str) -> dict | None:
    with session_scope() as session:
        job = session.get(Job, job_id)
        return job.to_dict() if job else None


def recover_interrupted() -> int:
    """Relance les tâches interrompues par un arrêt du serveur."""
    from app.tasks import run_job

    with session_scope() as session:
        jobs = session.scalars(select(Job).where(Job.status.in_(ACTIVE))).all()
        for job in jobs:
            job.status = "queued"
        ids = [job.id for job in jobs]
    for job_id in ids:
        run_job(job_id)
    return len(ids)
