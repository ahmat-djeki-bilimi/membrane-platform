"""Routes « structure » : PDB, AlphaFold, qualité, OPM, site actif, SIFTS."""

from fastapi import APIRouter, Query

from app.services import sifts_service, uniprot_service
from app.services.active_site_service import detect_active_site
from app.services.alphafold_service import get_alphafold
from app.services.opm_service import get_opm_data
from app.services.pdb_service import get_pdb_structures
from app.services.structure_quality_service import get_structure_quality

router = APIRouter(prefix="/api", tags=["Structures"])


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
