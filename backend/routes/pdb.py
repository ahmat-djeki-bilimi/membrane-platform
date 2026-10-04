from fastapi import APIRouter, HTTPException

from schemas.pdb import PDBByUniProtResponse
from services.pdb_service import fetch_pdb_entries_by_uniprot

router = APIRouter()


@router.get("/pdb/by-uniprot/{accession}", response_model=PDBByUniProtResponse)
def get_pdb_entries_by_uniprot(accession: str):
    try:
        return fetch_pdb_entries_by_uniprot(accession)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Internal server error: {exc}")