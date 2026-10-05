"""Routes « évolution » : homologues, alignement et conservation."""

import re
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app import jobs
from app.services.homology_service import find_identical_entry

router = APIRouter(prefix="/api", tags=["Évolution"])

# À incrémenter quand la méthode change : les anciens résultats sont recalculés
CONSERVATION_METHOD_VERSION = 4
MAX_SEQUENCE_LENGTH = 5000


def _accession_job(accession: str, source: str) -> dict:
    return jobs.submit(
        "conservation",
        {"accession": accession, "source": source, "version": CONSERVATION_METHOD_VERSION},
    )


@router.get("/conservation/{accession}")
def conservation(accession: str, source: Literal["uniref50", "mmseqs"] = Query("uniref50")):
    """
    Conservation de chaque résidu d'une entrée UniProt (calcul en file).

    - `uniref50` : orthologues proches (≥ 50 % d'identité), rapide ;
    - `mmseqs` : recherche étendue MMseqs2, homologues plus lointains.

    Renvoie la tâche : `status` vaut queued, running, succeeded ou failed ;
    le résultat est dans `result` une fois la tâche terminée.
    """
    return _accession_job(accession.upper().strip(), source)


class SequenceRequest(BaseModel):
    sequence: str
    name: str = "query"


@router.post("/conservation/sequence")
def sequence_conservation(payload: SequenceRequest):
    """
    Conservation d'une séquence quelconque. Une séquence identique à une
    entrée UniProt est reconnue et analysée comme cette entrée ; sinon les
    homologues sont recherchés avec MMseqs2.
    """
    sequence = re.sub(r"[^A-Za-z]", "", payload.sequence).upper()
    if len(sequence) < 20:
        raise HTTPException(400, "Séquence trop courte pour une analyse évolutive (20 résidus minimum).")
    if len(sequence) > MAX_SEQUENCE_LENGTH:
        raise HTTPException(400, f"Séquence trop longue ({MAX_SEQUENCE_LENGTH} résidus maximum).")

    match = find_identical_entry(sequence)
    if match:
        job = _accession_job(match["accession"], "uniref50")
        return {**job, "matched_entry": match}

    job = jobs.submit(
        "conservation_sequence",
        {"sequence": sequence, "name": payload.name, "version": CONSERVATION_METHOD_VERSION},
        key_params={"sequence": sequence, "version": CONSERVATION_METHOD_VERSION},
    )
    return {**job, "matched_entry": None}
