"""Routes « membrane » : segments transmembranaires, DeepTMHMM, orientation."""

import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app import jobs
from app.config import get_settings
from app.services import uniprot_service as uniprot
from app.services.membrane_orientation_service import get_membrane_orientation
from app.services.membrane_service import deeptmhmm_enabled, deeptmhmm_response

router = APIRouter(prefix="/api", tags=["Membrane"])


def _submit_deeptmhmm(sequence: str, name: str) -> dict:
    # Le nom n'influe pas sur la prédiction : il est exclu de l'empreinte
    return jobs.submit(
        "deeptmhmm",
        {"sequence": sequence, "name": name},
        key_params={"sequence": sequence},
    )


class SequenceRequest(BaseModel):
    sequence: str
    name: str = "query"


@router.post("/membrane/sequence")
def predict_from_sequence(payload: SequenceRequest):
    """DeepTMHMM sur une séquence quelconque (sans accession UniProt)."""
    sequence = re.sub(r"[^A-Za-z]", "", payload.sequence).upper()
    if not sequence:
        raise HTTPException(status_code=400, detail="Séquence vide.")
    max_length = get_settings().deeptmhmm_max_length
    if len(sequence) > max_length:
        raise HTTPException(
            status_code=400,
            detail=f"Séquence trop longue pour DeepTMHMM ({max_length} résidus maximum).",
        )
    if not deeptmhmm_enabled():
        raise HTTPException(status_code=503, detail="DeepTMHMM n'est pas activé sur ce serveur.")

    job = _submit_deeptmhmm(sequence, payload.name)
    if job["status"] == "succeeded":
        return deeptmhmm_response(job["result"], job_id=job["id"])
    if job["status"] == "failed":
        raise HTTPException(status_code=502, detail=job["error"] or "DeepTMHMM a échoué.")
    # Le client réinterroge la même route ou suit /api/jobs/{id}
    return JSONResponse(status_code=202, content={"status": "pending", "job_id": job["id"]})


@router.get("/membrane/{accession}")
def membrane_segments(accession: str):
    """
    Segments transmembranaires d'une entrée UniProt.

    1. DeepTMHMM (file de calculs), si activé et déjà calculé.
    2. Sinon, annotations « Transmembrane » de UniProtKB, avec
       deeptmhmm_status = "pending" tant que la prédiction est en cours.
    Aucun segment n'est inventé : sans source fiable, la liste est vide et
    is_membrane vaut None (inconnu).
    """
    accession = accession.upper().strip()
    try:
        entry = uniprot.fetch_entry(accession)
    except uniprot.UniProtNotFound:
        return {"accession": accession, "tm_segments": [], "count": 0, "error": "UniProt entry not found"}
    except Exception as e:
        return {"accession": accession, "tm_segments": [], "count": 0, "error": str(e)}

    deeptmhmm_status, job_id = None, None
    sequence = entry.get("sequence", {}).get("value", "")
    if deeptmhmm_enabled() and sequence:
        job = _submit_deeptmhmm(sequence, accession)
        job_id = job["id"]
        if job["status"] == "succeeded":
            return deeptmhmm_response(job["result"], accession=accession, job_id=job_id)
        deeptmhmm_status = "failed" if job["status"] == "failed" else "pending"

    segments = uniprot.tm_segments(entry)
    reviewed = uniprot.is_reviewed(entry)
    if segments:
        is_membrane = True
        predicted_type = f"Protéine transmembranaire ({len(segments)} segment(s) annoté(s))"
    elif reviewed:
        # Entrée Swiss-Prot sans région transmembranaire annotée
        is_membrane, predicted_type = False, "Aucun segment transmembranaire annoté (Swiss-Prot)"
    else:
        # Entrée TrEMBL : l'absence d'annotation ne prouve rien
        is_membrane, predicted_type = None, None

    return {
        "accession": accession,
        "method": "UniProt annotation" if segments or reviewed else "none",
        "reviewed": reviewed,
        "is_membrane": is_membrane,
        "predicted_type": predicted_type,
        "tm_segments": segments,
        "count": len(segments),
        "sequence_length": entry.get("sequence", {}).get("length", 0),
        "deeptmhmm_status": deeptmhmm_status,
        "job_id": job_id,
    }


@router.get("/membrane-orientation/{accession}")
def membrane_orientation(accession: str):
    return get_membrane_orientation(accession)
