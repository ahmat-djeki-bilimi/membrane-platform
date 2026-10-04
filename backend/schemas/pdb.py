from typing import List, Optional

from pydantic import BaseModel


class PDBEntrySummary(BaseModel):
    pdb_id: str
    title: Optional[str]
    experimental_method: Optional[str]
    resolution: Optional[float]
    deposition_date: Optional[str]
    source: str = "PDB"


class PDBByUniProtResponse(BaseModel):
    accession: str
    pdb_entries: List[PDBEntrySummary]