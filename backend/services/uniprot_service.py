from typing import Any, Dict, List, Optional

import requests
from fastapi import HTTPException

UNIPROT_BASE_URL = "https://rest.uniprot.org/uniprotkb"


def _safe_get_protein_name(data: Dict[str, Any]) -> Optional[str]:
    protein_desc = data.get("proteinDescription", {})
    recommended = protein_desc.get("recommendedName", {})
    full_name = recommended.get("fullName", {})
    return full_name.get("value")


def _safe_get_organism(data: Dict[str, Any]) -> Optional[str]:
    organism = data.get("organism", {})
    return organism.get("scientificName")


def _safe_get_sequence(data: Dict[str, Any]) -> str:
    sequence = data.get("sequence", {})
    return sequence.get("value", "")


def _safe_get_length(data: Dict[str, Any]) -> Optional[int]:
    sequence = data.get("sequence", {})
    return sequence.get("length")


def _safe_get_gene_names(data: Dict[str, Any]) -> List[str]:
    genes = data.get("genes", [])
    names: List[str] = []

    for gene in genes:
        gene_name = gene.get("geneName", {})
        value = gene_name.get("value")
        if value:
            names.append(value)

    return names


def _safe_get_function_comment(data: Dict[str, Any]) -> Optional[str]:
    comments = data.get("comments", [])

    for comment in comments:
        if comment.get("commentType") == "FUNCTION":
            texts = comment.get("texts", [])
            if texts:
                return texts[0].get("value")

    return None


def _safe_get_pdb_ids(data: Dict[str, Any]) -> List[str]:
    xrefs = data.get("uniProtKBCrossReferences", [])
    pdb_ids: List[str] = []

    for xref in xrefs:
        if xref.get("database") == "PDB":
            pdb_id = xref.get("id")
            if pdb_id and pdb_id not in pdb_ids:
                pdb_ids.append(pdb_id)

    return pdb_ids


def fetch_uniprot_entry(accession: str) -> Dict[str, Any]:
    accession = accession.strip().upper()

    if not accession:
        raise HTTPException(status_code=400, detail="Empty UniProt accession.")

    url = f"{UNIPROT_BASE_URL}/{accession}.json"

    try:
        response = requests.get(url, timeout=20)
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"UniProt network error: {exc}") from exc

    if response.status_code == 404:
        raise HTTPException(
            status_code=404,
            detail=f"No UniProt entry found for accession: {accession}",
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Unexpected UniProt response: {response.status_code}",
        )

    raw = response.json()

    return {
        "accession": raw.get("primaryAccession"),
        "protein_name": _safe_get_protein_name(raw),
        "organism": _safe_get_organism(raw),
        "length": _safe_get_length(raw),
        "sequence": _safe_get_sequence(raw),
        "gene_names": _safe_get_gene_names(raw),
        "function": _safe_get_function_comment(raw),
        "entry_type": raw.get("entryType"),
        "pdb_ids": _safe_get_pdb_ids(raw),
    }