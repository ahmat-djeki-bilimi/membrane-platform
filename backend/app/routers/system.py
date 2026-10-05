"""Routes système : état du service et suivi des tâches de calcul."""

from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select, text

from app import jobs
from app.db import session_scope
from app.models import Job

router = APIRouter(prefix="/api", tags=["Système"])


@router.get("/health")
def health():
    with session_scope() as session:
        session.execute(text("SELECT 1"))
        counts = dict(session.execute(select(Job.status, func.count()).group_by(Job.status)).all())
    return {"status": "ok", "service": "MemProtScope API", "database": "ok", "jobs": counts}


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Tâche introuvable.")
    return job
