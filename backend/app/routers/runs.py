"""Routes « Analyses » : exécutions, traçabilité, reprise, comparaison, rapports et exports."""

import json

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app import jobs
from app.services import runs
from app.services.report_service import build_report

router = APIRouter(prefix="/api/runs", tags=["Analyses"])

MAX_IDS = 200


def _job(job_id: str) -> dict:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Exécution introuvable.")
    return job


@router.get("")
def list_runs(ids: str = Query(..., description="Identifiants séparés par des virgules")):
    """
    Exécutions demandées (sans leur résultat complet). La liste vient du
    navigateur ou des projets : aucune liste globale n'est exposée.
    """
    wanted = [i.strip() for i in ids.split(",") if i.strip()][:MAX_IDS]
    return [runs.describe(job) for job in jobs.get_many(wanted)]


@router.get("/compare")
def compare_runs(a: str, b: str):
    """Compare deux exécutions : paramètres, versions des sources, étapes et résultats."""
    return runs.compare(_job(a), _job(b))


@router.get("/{job_id}")
def get_run(job_id: str):
    """Exécution, traçabilité complète et tableaux exportables (sans le résultat complet)."""
    job = _job(job_id)
    return {**runs.describe(job), "tables": runs.csv_tables(job), "methods": (job.get("provenance") or {}).get("methods") or runs.methods(job["kind"], job.get("params") or {})}


@router.post("/{job_id}/resume")
def resume_run(job_id: str):
    """Reprend une analyse en échec ou interrompue (les données déjà obtenues sont relues depuis le cache)."""
    try:
        return runs.describe(jobs.resume(job_id))
    except LookupError:
        raise HTTPException(404, "Exécution introuvable.")
    except jobs.RunError as error:
        raise HTTPException(409, str(error))


@router.post("/{job_id}/rerun")
def rerun(job_id: str):
    """Nouvelle exécution avec les mêmes paramètres, à comparer à la première."""
    try:
        return runs.describe(jobs.rerun(job_id))
    except LookupError:
        raise HTTPException(404, "Exécution introuvable.")


def _attachment(content: bytes | str, filename: str, media_type: str) -> Response:
    return Response(content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/{job_id}/export.json")
def export_json(job_id: str):
    """Exécution complète : paramètres, traçabilité, résultat et erreurs."""
    job = _job(job_id)
    payload = {
        "format": "MemProtScope / exécution",
        "label": runs.KIND_LABELS.get(job["kind"], job["kind"]),
        "summary": runs.summarize(job["kind"], job.get("result")),
        "methods": (job.get("provenance") or {}).get("methods") or runs.methods(job["kind"], job.get("params") or {}),
        **job,
    }
    return _attachment(json.dumps(payload, ensure_ascii=False, indent=2), f"memprotscope_{job['kind']}_{job_id[:8]}.json", "application/json")


@router.get("/{job_id}/export.csv")
def export_csv(job_id: str, table: str = "summary"):
    job = _job(job_id)
    try:
        content = runs.csv_table(job, table)
    except KeyError:
        raise HTTPException(400, f"Tableau inconnu ({table}). Disponibles : {', '.join(runs.csv_tables(job))}.")
    # BOM : accents lisibles à l'ouverture dans un tableur
    return _attachment("﻿" + content, f"memprotscope_{job['kind']}_{job_id[:8]}_{table}.csv", "text/csv; charset=utf-8")


@router.get("/{job_id}/report.pdf")
def report_pdf(job_id: str):
    job = _job(job_id)
    return _attachment(build_report(job), f"rapport_memprotscope_{job['kind']}_{job_id[:8]}.pdf", "application/pdf")
