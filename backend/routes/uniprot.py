from fastapi import APIRouter, HTTPException

from schemas.uniprot import UniProtResponse
from services.uniprot_service import fetch_uniprot_entry

router = APIRouter()


@router.get("/uniprot/{accession}", response_model=UniProtResponse)
def get_uniprot_entry(accession: str):
    try:
        return fetch_uniprot_entry(accession)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Internal server error: {exc}")