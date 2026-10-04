from typing import List, Optional

from pydantic import BaseModel


class UniProtResponse(BaseModel):
    accession: Optional[str]
    protein_name: Optional[str]
    organism: Optional[str]
    length: Optional[int]
    sequence: str
    gene_names: List[str]
    function: Optional[str]
    entry_type: Optional[str]
    pdb_ids: List[str]