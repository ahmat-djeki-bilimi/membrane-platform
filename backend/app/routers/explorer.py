"""Routes « Membrane Evolution & Function Explorer » : famille importée en FASTA."""

import re
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app import jobs
from app.cache import cached, is_successful
from app.services import explorer_service, iqtree_service, tree_selection_service, uniprot_service

router = APIRouter(prefix="/api/explorer", tags=["Explorateur"])

MAX_FASTA_SIZE = 3_000_000


class QualityControl(BaseModel):
    """Contrôle qualité de l'alignement : filtres appliqués avant la conservation et la coévolution."""

    # Séquences incomplètes : couverture minimale de la référence, plus long trou interne toléré
    min_coverage: float | None = Field(None, ge=0, le=1)
    max_internal_gap: int | None = Field(None, ge=1, le=5000)
    # Colonnes peu fiables (masquées, sans décaler la numérotation)
    max_column_gaps: float | None = Field(None, ge=0, le=1)
    mask_poor_regions: bool = False


class ExplorerRequest(BaseModel):
    fasta: str = Field(max_length=MAX_FASTA_SIZE)
    # Indice (à partir de 0) de la séquence de référence dans le fichier
    reference: int = Field(0, ge=0)
    # Entrée UniProt de la référence, si l'en-tête ne la donne pas
    accession: str | None = Field(None, max_length=12)
    # Ajoute les homologues trouvés par MMseqs2 dans UniRef (alignement plus profond)
    expand: bool = False
    # Homologues à conserver (identifiants de l'onglet Homologues) ; absent : tous
    keep: list[str] | None = Field(None, max_length=explorer_service.MAX_KEEP)
    qc: QualityControl | None = None


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
    if payload.keep is not None:
        keep = sorted({k.strip() for k in payload.keep if k.strip()})
        if not keep or any(len(k) > 100 for k in keep):
            raise HTTPException(400, "Sélection d'homologues invalide : choisissez-en au moins un.")
        params["keep"] = keep
    # Réglages actifs seulement : sans filtre, même tâche qu'avant le contrôle qualité
    qc = payload.qc.model_dump(exclude_none=True, exclude_defaults=True) if payload.qc else {}
    if qc:
        params["qc"] = qc
    job = jobs.submit("explorer", params)
    return {**job, "sequence_count": len(records)}


class TreeRequest(BaseModel):
    # Stratégie de choix des séquences (la référence est toujours incluse)
    strategy: Literal["closest", "taxonomic", "diversity", "custom"] = "custom"
    # Nombre d'homologues voulu (stratégies automatiques)
    count: int = Field(50, ge=3, le=explorer_service.MAX_TREE_SELECTION)
    # Homologues choisis un à un (stratégie « custom »)
    ids: list[str] | None = Field(None, max_length=explorer_service.MAX_TREE_SELECTION)
    # nj : Neighbor-Joining (rapide) ; ml : maximum de vraisemblance avec IQ-TREE
    method: Literal["nj", "ml"] = "nj"
    model: Literal["kimura", "poisson", "p"] = "kimura"
    ml_model: Literal["LG+G4", "MFP"] = "LG+G4"
    # Réplicats de bootstrap pour Neighbor-Joining (IQ-TREE : 1 000 UFBoot et SH-aLRT)
    replicates: Literal[100, 200, 500] = 100


def _explorer_result(job_id: str) -> dict:
    parent = jobs.get(job_id)
    if not parent or parent["kind"] != "explorer":
        raise HTTPException(404, "Analyse introuvable.")
    if parent["status"] != "succeeded":
        raise HTTPException(409, "L'analyse n'est pas terminée.")
    return parent["result"]


@router.get("/phylogeny-tools")
def phylogeny_tools():
    """Méthodes de reconstruction disponibles : Neighbor-Joining toujours, IQ-TREE s'il est installé."""
    return {"nj": {"available": True, "replicates": [100, 200, 500]}, "ml": iqtree_service.availability(), "strategies": tree_selection_service.STRATEGIES}


@router.get("/{job_id}/tree/selection")
def tree_selection(
    job_id: str,
    strategy: Literal["closest", "taxonomic", "diversity"] = "closest",
    count: int = Query(50, ge=3, le=explorer_service.MAX_TREE_SELECTION),
):
    """Aperçu des homologues que retiendrait une stratégie, avant de construire l'arbre."""
    return tree_selection_service.select_sequences(_explorer_result(job_id), strategy, count)


@router.post("/{job_id}/tree")
def tree(job_id: str, payload: TreeRequest):
    """
    Arbre phylogénétique de la référence et des homologues retenus par une
    stratégie (ou choisis un à un), à partir de l'alignement d'une analyse
    terminée : Neighbor-Joining (secondes) ou IQ-TREE (minutes).
    """
    result = _explorer_result(job_id)
    if payload.strategy == "custom" and not payload.ids:
        raise HTTPException(400, "Choisissez les homologues de l'arbre.")
    if payload.method == "ml" and not iqtree_service.availability()["available"]:
        raise HTTPException(400, iqtree_service.availability()["help"])
    selection = tree_selection_service.select_sequences(result, payload.strategy, payload.count, payload.ids)
    ids = sorted(selection.pop("ids"))
    if len(ids) < 3:
        raise HTTPException(400, "Choisissez au moins 3 homologues de l'alignement.")
    params = {
        "job": job_id,
        "ids": ids,
        "method": payload.method,
        "model": payload.model,
        "replicates": payload.replicates if payload.method == "nj" else iqtree_service.UFBOOT_REPLICATES,
        "selection": selection,
        "version": explorer_service.METHOD_VERSION,
    }
    if payload.method == "ml":
        params["ml_model"] = payload.ml_model
    # La description de la sélection n'influe pas sur l'arbre : hors de l'empreinte
    key = {k: v for k, v in params.items() if k != "selection"}
    return jobs.submit("explorer_tree", params, key_params=key)


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
