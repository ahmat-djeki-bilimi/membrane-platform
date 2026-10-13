"""Routes « Membrane Evolution & Function Explorer » : famille importée en FASTA."""

import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import jobs
from app.cache import cached, is_successful
from app.services import explorer_service, uniprot_service

router = APIRouter(prefix="/api/explorer", tags=["Explorateur"])

MAX_FASTA_SIZE = 3_000_000


class ExplorerRequest(BaseModel):
    fasta: str = Field(max_length=MAX_FASTA_SIZE)
    # Indice (à partir de 0) de la séquence de référence dans le fichier
    reference: int = Field(0, ge=0)
    # Entrée UniProt de la référence, si l'en-tête ne la donne pas
    accession: str | None = Field(None, max_length=12)
    # Ajoute les homologues trouvés par MMseqs2 dans UniRef (alignement plus profond)
    expand: bool = False


@router.post("")
def explore(payload: ExplorerRequest):
    """
    Analyse d'une famille de protéines membranaires homologues (calcul en file) :
    alignement, conservation, topologie, structure placée dans la membrane,
    coévolution et positions candidates. Renvoie la tâche ; le résultat est dans
    `result` une fois `status` à succeeded.
    """
    try:
        records = explorer_service.parse_fasta(payload.fasta)
        explorer_service.validate(records, payload.reference, payload.expand)
    except explorer_service.ExplorerError as error:
        raise HTTPException(400, str(error))

    accession = payload.accession.upper().strip() if payload.accession else None
    if accession and not re.fullmatch(r"[A-Z0-9]{6,10}", accession):
        raise HTTPException(400, "Accession UniProt invalide.")

    params = {
        "fasta": explorer_service.to_fasta(records),
        "reference": payload.reference,
        "accession": accession,
        "expand": payload.expand,
        "version": explorer_service.METHOD_VERSION,
    }
    job = jobs.submit("explorer", params)
    return {**job, "sequence_count": len(records)}


@cached("explorer:homologs", ttl=7 * 24 * 3600, store_if=is_successful)
def _homologs(accession: str) -> dict:
    return explorer_service.homologs_fasta(accession)


@router.get("/homologs/{accession}")
def homologs(accession: str):
    """Référence et orthologues UniRef50 d'une entrée UniProt, au format FASTA (point de départ)."""
    accession = accession.upper().strip()
    if not re.fullmatch(r"[A-Z0-9]{6,10}", accession):
        raise HTTPException(400, "Accession UniProt invalide.")
    try:
        return _homologs(accession)
    except uniprot_service.UniProtNotFound:
        raise HTTPException(404, "Entrée UniProt introuvable.")
    except explorer_service.ExplorerError as error:
        raise HTTPException(422, str(error))
    except Exception:
        raise HTTPException(502, "UniProt est injoignable pour le moment : réessayez dans quelques instants.")
