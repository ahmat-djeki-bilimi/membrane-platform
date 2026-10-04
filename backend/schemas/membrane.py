from typing import List, Optional

from pydantic import BaseModel


class MembraneSegment(BaseModel):
    start: int
    end: int
    label: str


class MembranePredictionResponse(BaseModel):
    accession: str
    is_membrane: bool
    predicted_type: Optional[str]
    tm_segments: List[MembraneSegment]
    raw_output: str