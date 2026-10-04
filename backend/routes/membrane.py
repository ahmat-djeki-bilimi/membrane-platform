from fastapi import APIRouter, HTTPException

from schemas.membrane import MembranePredictionResponse
from services.membrane_service import run_deeptmhmm_for_accession

router = APIRouter()


@router.get("/membrane/{accession}", response_model=MembranePredictionResponse)
def predict_membrane_status(accession: str):
    try:
        return run_deeptmhmm_for_accession(accession)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Internal server error: {exc}")