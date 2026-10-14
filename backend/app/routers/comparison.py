"""Route « Comparaison » : deux à six protéines comparées (calcul en file)."""

import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import jobs
from app.services.protein_comparison_service import MAX_PROTEINS, MIN_PROTEINS

router = APIRouter(prefix="/api", tags=["Comparaison"])

# À incrémenter quand la méthode change : les anciens résultats sont recalculés
COMPARISON_METHOD_VERSION = 1


class ComparisonRequest(BaseModel):
    accessions: list[str] = Field(min_length=MIN_PROTEINS, max_length=MAX_PROTEINS)
    # Indice de la protéine de référence (repère de l'alignement et de la superposition)
    reference: int = Field(0, ge=0)


@router.post("/comparison")
def compare(payload: ComparisonRequest):
    """
    Compare des protéines UniProt : séquences, structures AlphaFold superposées,
    domaines, topologies et propriétés physico-chimiques. Renvoie la tâche.
    """
    accessions: list[str] = []
    for accession in payload.accessions:
        accession = accession.upper().strip()
        if not re.fullmatch(r"[A-Z0-9]{6,10}", accession):
            raise HTTPException(400, f"Accession UniProt invalide : {accession or '(vide)'}.")
        if accession not in accessions:
            accessions.append(accession)
    if len(accessions) < MIN_PROTEINS:
        raise HTTPException(400, "Choisissez au moins deux protéines différentes.")
    if payload.reference >= len(accessions):
        raise HTTPException(400, "Protéine de référence introuvable.")
    params = {"accessions": accessions, "reference": payload.reference, "version": COMPARISON_METHOD_VERSION}
    return jobs.submit("protein_comparison", params)
