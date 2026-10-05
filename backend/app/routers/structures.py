"""Routes « structure » : PDB, AlphaFold, ESMFold, qualité, OPM, site actif, SIFTS."""

import re
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app import jobs
from app.services import sifts_service, uniprot_service
from app.services.active_site_service import detect_active_site
from app.services.alphafold_service import get_alphafold
from app.services.opm_service import get_opm_data
from app.services.pdb_service import get_pdb_structures
from app.services.esmfold_service import MAX_LENGTH as ESMFOLD_MAX_LENGTH
from app.services.structure_comparison_service import compare_alphafold, compare_prediction_job
from app.services.membrane_service import deeptmhmm_enabled
from app.services.structure_quality_service import get_structure_quality

router = APIRouter(prefix="/api", tags=["Structures"])

# À incrémenter quand la méthode change : les anciens résultats sont recalculés
PREDICTION_METHOD_VERSION = 2
MIN_PREDICTION_LENGTH = 20
MAX_SEQUENCE_LENGTH = 5000


@router.get("/pdb/{accession}")
def pdb_structures(accession: str):
    """Structures PDB contenant la protéine, triées par couverture et résolution."""
    accession = accession.upper().strip()
    try:
        length = uniprot_service.fetch_entry(accession).get("sequence", {}).get("length", 0)
    except Exception:
        length = 0
    return get_pdb_structures(accession, length)


@router.get("/alphafold/{accession}")
def alphafold_model(accession: str):
    return get_alphafold(accession.upper().strip())


@router.get("/quality/{pdb_id}")
def structure_quality(pdb_id: str):
    return get_structure_quality(pdb_id)


@router.get("/opm/{pdb_id}")
def opm_entry(pdb_id: str):
    return get_opm_data(pdb_id)


@router.get("/active-site/{pdb_id}")
def active_site(pdb_id: str, cutoff: float = Query(5.0, ge=2.0, le=10.0)):
    return detect_active_site(pdb_id.upper().strip(), cutoff)


@router.get("/mapping/{pdb_id}/{accession}")
def residue_mapping(pdb_id: str, accession: str):
    """Correspondance de numérotation UniProt → structure (SIFTS)."""
    return sifts_service.get_mapping(pdb_id, accession)


# ---------------------------------------------------------------------------
# Structure prédite (ESMFold) placée dans la membrane
# ---------------------------------------------------------------------------

def _clean_sequence(sequence: str) -> str:
    sequence = re.sub(r"[^A-Za-z]", "", sequence).upper()
    if len(sequence) < MIN_PREDICTION_LENGTH:
        raise HTTPException(400, f"Séquence trop courte ({MIN_PREDICTION_LENGTH} résidus minimum).")
    if len(sequence) > MAX_SEQUENCE_LENGTH:
        raise HTTPException(400, f"Séquence trop longue ({MAX_SEQUENCE_LENGTH} résidus maximum).")
    return sequence


def _submit_prediction(sequence: str, name: str, topology: dict, start: int | None) -> dict:
    params = {
        "sequence": sequence,
        "tm_segments": topology.get("tm_segments"),
        "tm_source": topology.get("tm_source", "kd"),
        "n_terminus": topology.get("n_terminus"),
        "start": start,
        "version": PREDICTION_METHOD_VERSION,
    }
    # Le nom n'influe pas sur la prédiction : il est exclu de l'empreinte
    job = jobs.submit("structure_prediction", {**params, "name": name}, key_params=params)
    return {**job, "max_length": ESMFOLD_MAX_LENGTH, "tm_source": params["tm_source"]}


def _accession_topology(entry: dict, sequence: str, accession: str) -> dict:
    """Segments TM : DeepTMHMM s'il a déjà répondu, sinon UniProt, sinon Kyte-Doolittle."""
    if deeptmhmm_enabled():
        job = jobs.submit("deeptmhmm", {"sequence": sequence, "name": accession}, key_params={"sequence": sequence})
        if job["status"] == "succeeded" and job["result"].get("tm_segments"):
            result = job["result"]
            return {"tm_segments": result["tm_segments"], "n_terminus": result.get("n_terminus"), "tm_source": "deeptmhmm"}
    segments = uniprot_service.tm_segments(entry)
    if segments:
        return {"tm_segments": segments, "n_terminus": uniprot_service.n_terminus_side(entry), "tm_source": "uniprot"}
    return {"tm_source": "kd"}


@router.get("/predicted-structure/{accession}")
def predicted_structure(accession: str, start: int | None = Query(None, ge=1)):
    """
    Structure prédite par ESMFold pour une entrée UniProt, placée dans la
    membrane (calcul en file). Au-delà de 400 résidus, seule une fenêtre est
    modélisée : celle qui couvre le plus de segments transmembranaires, ou
    celle qui commence à `start`.
    """
    accession = accession.upper().strip()
    try:
        entry = uniprot_service.fetch_entry(accession)
    except uniprot_service.UniProtNotFound:
        raise HTTPException(404, "Entrée UniProt introuvable.")
    sequence = _clean_sequence(entry.get("sequence", {}).get("value", ""))
    return _submit_prediction(sequence, accession, _accession_topology(entry, sequence, accession), start)


class SegmentModel(BaseModel):
    start: int = Field(ge=1)
    end: int = Field(ge=1)
    label: str | None = None


class PredictionRequest(BaseModel):
    sequence: str
    name: str = "query"
    start: int | None = Field(None, ge=1)
    # Topologie connue (ex. réponse de /api/membrane/sequence) ; sinon Kyte-Doolittle
    tm_segments: list[SegmentModel] | None = None
    n_terminus: Literal["in", "out"] | None = None
    tm_source: Literal["deeptmhmm", "uniprot", "user"] = "user"


@router.post("/predicted-structure/sequence")
def predicted_structure_from_sequence(payload: PredictionRequest):
    """Structure prédite par ESMFold pour une séquence quelconque (calcul en file)."""
    sequence = _clean_sequence(payload.sequence)
    if payload.tm_segments:
        if any(s.end < s.start or s.end > len(sequence) for s in payload.tm_segments):
            raise HTTPException(400, "Segment transmembranaire hors de la séquence.")
        topology = {
            "tm_segments": [s.model_dump(exclude_none=True) for s in payload.tm_segments],
            "n_terminus": payload.n_terminus,
            "tm_source": payload.tm_source,
        }
    else:
        topology = {"tm_source": "kd"}
    return _submit_prediction(sequence, payload.name, topology, payload.start)


@router.get("/predicted-structure/jobs/{job_id}/compare/{pdb_id}")
def compare_with_experimental(
    job_id: str,
    pdb_id: str,
    accession: str | None = Query(None, max_length=10),
    chain: str | None = Query(None, max_length=4),
):
    """
    Superpose une structure expérimentale (PDB) sur la structure prédite d'une
    entrée UniProt, dans la membrane du modèle, et mesure les écarts.
    """
    job = jobs.get(job_id)
    if not job or job["kind"] != "structure_prediction":
        raise HTTPException(404, "Prédiction introuvable.")
    if job["status"] != "succeeded":
        raise HTTPException(409, "La prédiction n’est pas encore terminée.")
    if not re.fullmatch(r"[0-9][A-Za-z0-9]{3}", pdb_id):
        raise HTTPException(400, "Identifiant PDB invalide.")
    accession = (accession or job["params"].get("name") or "").upper().strip()
    if not re.fullmatch(r"[A-Z0-9]{6,10}", accession):
        raise HTTPException(400, "Comparaison possible seulement pour une entrée UniProt.")
    result = compare_prediction_job(job_id, accession, pdb_id.lower(), chain)
    if result.get("error"):
        raise HTTPException(422, result["error"])
    return result


@router.get("/alphafold/{accession}/compare/{pdb_id}")
def compare_alphafold_with_experimental(accession: str, pdb_id: str, chain: str | None = Query(None, max_length=4)):
    """
    Modèle AlphaFold DB placé dans la membrane (même méthode que pour ESMFold)
    et superposé à une structure expérimentale. Renvoie `model` et `comparison`.
    """
    accession = accession.upper().strip()
    if not re.fullmatch(r"[0-9][A-Za-z0-9]{3}", pdb_id):
        raise HTTPException(400, "Identifiant PDB invalide.")
    try:
        entry = uniprot_service.fetch_entry(accession)
    except uniprot_service.UniProtNotFound:
        raise HTTPException(404, "Entrée UniProt introuvable.")
    sequence = entry.get("sequence", {}).get("value", "")
    topology = _accession_topology(entry, sequence, accession)
    result = compare_alphafold(accession, pdb_id.lower(), topology, chain)
    if result.get("error"):
        raise HTTPException(422, result["error"])
    return result
