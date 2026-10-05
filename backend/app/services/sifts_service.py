"""
Correspondance de numérotation UniProt ↔ structure PDB (SIFTS, via PDBe).

Les annotations (segments TM, domaines…) sont en numérotation UniProt, alors
que les visionneuses 3D sélectionnent les résidus par leur numéro « auteur »
dans le fichier PDB. Chaque segment SIFTS est converti en décalage linéaire.
"""

from app import http
from app.cache import cached, is_successful

PDBE_MAPPING = "https://www.ebi.ac.uk/pdbe/api/mappings/uniprot"


def _segment(mapping: dict) -> dict | None:
    unp_start, unp_end = mapping.get("unp_start"), mapping.get("unp_end")
    start, end = mapping.get("start") or {}, mapping.get("end") or {}
    if unp_start is None or unp_end is None:
        return None

    # Décalage auteur − UniProt, mesuré à une extrémité observée du segment
    offsets = []
    if start.get("author_residue_number") is not None:
        offsets.append(start["author_residue_number"] - unp_start)
    if end.get("author_residue_number") is not None:
        offsets.append(end["author_residue_number"] - unp_end)
    if not offsets:
        return None

    return {
        "chain": mapping.get("chain_id"),
        "unp_start": unp_start,
        "unp_end": unp_end,
        "offset": offsets[0],
        # Décalages différents aux deux extrémités : numérotation non linéaire
        "linear": len(set(offsets)) == 1,
    }


@cached("sifts:mapping", store_if=is_successful)
def get_mapping(pdb_id: str, accession: str) -> dict:
    pdb_id, accession = pdb_id.lower().strip(), accession.upper().strip()
    try:
        response = http.get(f"{PDBE_MAPPING}/{pdb_id}")
        if response.status_code == 404:
            return {"pdb_id": pdb_id.upper(), "accession": accession, "available": False, "segments": []}
        response.raise_for_status()
        uniprot = response.json().get(pdb_id, {}).get("UniProt", {})
    except Exception as e:
        return {"pdb_id": pdb_id.upper(), "accession": accession, "available": False, "segments": [], "error": str(e)}

    entry = uniprot.get(accession)
    if not entry:
        return {"pdb_id": pdb_id.upper(), "accession": accession, "available": False, "segments": []}

    segments = [s for s in (_segment(m) for m in entry.get("mappings", [])) if s]
    return {
        "pdb_id": pdb_id.upper(),
        "accession": accession,
        "available": bool(segments),
        "segments": segments,
        # Vrai si la numérotation de la structure est identique à celle d'UniProt
        "identity": all(s["offset"] == 0 and s["linear"] for s in segments),
    }


def map_range(mapping: dict, start: int, end: int) -> list[dict]:
    """Convertit une plage UniProt en plages de la structure, chaîne par chaîne."""
    ranges = []
    for seg in mapping.get("segments", []):
        lo, hi = max(start, seg["unp_start"]), min(end, seg["unp_end"])
        if lo <= hi:
            ranges.append({"chain": seg["chain"], "start": lo + seg["offset"], "end": hi + seg["offset"]})
    return ranges
