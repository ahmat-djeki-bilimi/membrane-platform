"""
Orientation dans la membrane d'après OPM (Orientations of Proteins in Membranes,
Lomize et al.), via l'API publique utilisée par le site OPM.
"""

import re
from typing import List, Optional

from app import http
from app.cache import cached

OPM_API = "https://opm-back.cc.lehigh.edu/opm-backend"
OPM_SITE = "https://opm.phar.umich.edu"


def _get(path: str, **params) -> dict:
    response = http.get(f"{OPM_API}/{path}", params=params)
    response.raise_for_status()
    return response.json()


def _find_primary_id(pdb_id: str) -> tuple:
    """Identifiant OPM de la structure principale (et PDB représentatif)."""
    primary = _get("primary_structures", search=pdb_id, pageSize=20)
    for obj in primary.get("objects", []):
        if (obj.get("pdbid") or "").lower() == pdb_id:
            return obj["id"], None

    # Entrée PDB rattachée à une structure représentative dans OPM
    secondary = _get("secondary_representations", search=pdb_id, pageSize=20)
    table = secondary.get("table", secondary)
    for obj in table.get("objects", []):
        if (obj.get("pdbid") or "").lower() == pdb_id and obj.get("primary_structure_id"):
            return obj["primary_structure_id"], pdb_id
    return None, None


def _parse_segments(text: str) -> List[dict]:
    """« 1(31-56),2(70-92) » → [{start: 31, end: 56}, …] (numérotation PDB)."""
    segments = []
    for start, end in re.findall(r"\(\s*(-?\d+)\s*-\s*(-?\d+)\s*\)", text or ""):
        segments.append({"start": int(start), "end": int(end)})
    return segments


def _to_float(value) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


@cached("opm:entry")
def _cached_opm(pdb_id: str) -> dict:
    primary_id, _ = _find_primary_id(pdb_id)
    if primary_id is None:
        return {
            "pdb_id": pdb_id.upper(),
            "available": False,
            "url": f"{OPM_SITE}/proteins?search={pdb_id}",
            "message": "Aucune entrée OPM pour cette structure.",
        }

    o = _get(f"primary_structures/{primary_id}")
    membrane = o.get("membrane") or {}
    family = o.get("family") or {}
    superfamily = family.get("superfamily") or {}
    classtype = superfamily.get("classtype") or {}
    protein_type = classtype.get("type") or {}
    species = o.get("species") or {}

    subunits = [
        {
            "chain": s.get("protein_letter"),
            "name": s.get("name"),
            "tilt": _to_float(s.get("tilt")),
            "segments": _parse_segments(s.get("segment")),
        }
        for s in o.get("subunits") or []
    ]

    reference_chain = o.get("topology_subunit")
    n_terminus = None
    if reference_chain:
        # topology_show_in : N-terminal de la sous-unité de référence côté interne
        n_terminus = "in" if o.get("topology_show_in") else "out"

    # La fiche détaillée fait foi : OPM peut avoir changé de structure représentative
    opm_pdb_id = (o.get("pdbid") or "").upper()
    is_representative = opm_pdb_id == pdb_id.upper()

    thickness = _to_float(o.get("thickness"))
    tilt = _to_float(o.get("tilt"))
    gibbs = _to_float(o.get("gibbs"))

    parts = []
    if thickness is not None:
        parts.append(f"épaisseur hydrophobe {thickness} ± {o.get('thicknesserror')} Å")
    if tilt is not None:
        parts.append(f"inclinaison {tilt:g} ± {o.get('tilterror')}°")
    if gibbs is not None:
        parts.append(f"ΔG de transfert {gibbs} kcal/mol")

    return {
        "pdb_id": pdb_id.upper(),
        "available": True,
        "opm_id": primary_id,
        "opm_pdb_id": opm_pdb_id,
        "is_representative": is_representative,
        "url": f"{OPM_SITE}/proteins/{primary_id}",
        "oriented_pdb_url": f"https://opm-assets.storage.googleapis.com/pdb/{opm_pdb_id.lower()}.pdb",
        "name": o.get("name"),
        "resolution": o.get("resolution"),
        "type": protein_type.get("name"),
        "class": classtype.get("name"),
        "superfamily": superfamily.get("name"),
        "superfamily_pfam": superfamily.get("pfam") or None,
        "family": family.get("name"),
        "family_pfam": family.get("pfam") or None,
        "family_interpro": family.get("interpro") or None,
        "family_tcdb": family.get("tcdb") or None,
        "species": species.get("name") or o.get("species_name_cache"),
        "species_lineage": species.get("description"),
        "membrane": membrane.get("name") or o.get("membrane_name_cache"),
        "topology_in": membrane.get("topology_in"),
        "topology_out": membrane.get("topology_out"),
        "reference_chain": reference_chain,
        "n_terminus": n_terminus,
        "hydrophobic_thickness": thickness,
        "thickness_error": _to_float(o.get("thicknesserror")),
        "tilt_angle": tilt,
        "tilt_error": _to_float(o.get("tilterror")),
        "delta_g_transfer": gibbs,
        "subunits": subunits,
        "uniprot_codes": o.get("uniprotcodes") or [],
        "comments": o.get("comments") or None,
        "verification": o.get("verification") or None,
        "citations": [
            {"text": c.get("maintext"), "pmid": c.get("pmid") or None}
            for c in o.get("citations") or []
            if c.get("maintext")
        ],
        "secondary_representations": [
            {"pdb_id": (r.get("pdbid") or "").upper(), "resolution": r.get("resolution")}
            for r in o.get("secondary_representations") or []
        ],
        "message": "Entrée OPM trouvée."
        if is_representative
        else f"Orientation calculée par OPM sur la structure représentative {opm_pdb_id}.",
        "interpretation": ("OPM : " + ", ".join(parts) + ".") if parts else "",
    }


def get_opm_data(pdb_id: str) -> dict:
    pdb_id = pdb_id.lower().strip()
    try:
        return _cached_opm(pdb_id)
    except Exception as e:
        return {
            "pdb_id": pdb_id.upper(),
            "available": False,
            "url": f"{OPM_SITE}/proteins?search={pdb_id}",
            "message": "Service OPM injoignable.",
            "error": str(e),
        }
