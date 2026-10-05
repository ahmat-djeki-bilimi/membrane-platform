"""UniProtKB : fiche, segments transmembranaires et domaines annotés."""

from app import http
from app.cache import cached

UNIPROT_URL = "https://rest.uniprot.org/uniprotkb"

# Types de régions UniProt utiles pour naviguer dans la structure 3D
DOMAIN_FEATURE_TYPES = {
    "Domain": "domain",
    "Repeat": "repeat",
    "Zinc finger": "domain",
    "Topological domain": "topological",
    "Transmembrane": "transmembrane",
    "Intramembrane": "intramembrane",
    "Signal": "signal",
    "Region": "region",
    "Motif": "motif",
}


class UniProtNotFound(Exception):
    pass


@cached("uniprot:entry", store_if=lambda v: v is not None)
def _fetch_entry_cached(accession: str) -> dict | None:
    response = http.get(f"{UNIPROT_URL}/{accession}.json")
    if response.status_code in (400, 404):
        return None
    response.raise_for_status()
    return response.json()


def fetch_entry(accession: str) -> dict:
    """Fiche UniProtKB complète (JSON), mise en cache."""
    entry = _fetch_entry_cached(accession.upper().strip())
    if entry is None:
        raise UniProtNotFound(accession)
    return entry


def _location(feature: dict) -> tuple[int | None, int | None]:
    location = feature.get("location", {})
    start = location.get("start", {}).get("value")
    end = location.get("end", {}).get("value")
    return (int(start) if start else None, int(end) if end else None)


def is_reviewed(entry: dict) -> bool:
    entry_type = entry.get("entryType", "").lower()
    return "reviewed" in entry_type and "unreviewed" not in entry_type


def summarize_entry(entry: dict) -> dict:
    sequence = entry.get("sequence", {}).get("value", "")
    function_text = ""
    for comment in entry.get("comments", []):
        if comment.get("commentType") == "FUNCTION" and comment.get("texts"):
            function_text = comment["texts"][0].get("value", "")
            break

    return {
        "accession": entry.get("primaryAccession"),
        "available": True,
        "protein_name": entry.get("proteinDescription", {})
        .get("recommendedName", {})
        .get("fullName", {})
        .get("value", ""),
        "organism": entry.get("organism", {}).get("scientificName", ""),
        "gene_names": [
            g["geneName"]["value"] for g in entry.get("genes", []) if g.get("geneName", {}).get("value")
        ],
        "function": function_text,
        "sequence": sequence,
        "length": entry.get("sequence", {}).get("length", len(sequence)),
        "pdb_ids": [
            ref["id"]
            for ref in entry.get("uniProtKBCrossReferences", [])
            if ref.get("database") == "PDB" and ref.get("id")
        ],
        "entry_type": entry.get("entryType", ""),
    }


def tm_segments(entry: dict) -> list[dict]:
    """Segments « Transmembrane » annotés."""
    segments = []
    for feature in entry.get("features", []):
        if feature.get("type") != "Transmembrane":
            continue
        start, end = _location(feature)
        if start and end:
            segments.append({"start": start, "end": end, "label": f"TM{len(segments) + 1}"})
    return segments


def n_terminus_side(entry: dict) -> str | None:
    """Côté de l'extrémité N-terminale (« in » / « out ») d'après les domaines topologiques annotés."""
    segments = tm_segments(entry)
    if not segments:
        return None
    first_tm = segments[0]["start"]
    for feature in entry.get("features", []):
        if feature.get("type") != "Topological domain":
            continue
        start, end = _location(feature)
        if not end or end >= first_tm:
            continue
        description = feature.get("description", "").lower()
        if "cytoplasmic" in description:
            return "in"
        if any(word in description for word in ("extracellular", "lumenal", "periplasmic")):
            return "out"
    return None


def domain_features(entry: dict) -> list[dict]:
    """Domaines, régions et éléments topologiques annotés."""
    domains = []
    for feature in entry.get("features", []):
        kind = DOMAIN_FEATURE_TYPES.get(feature.get("type"))
        if not kind:
            continue
        start, end = _location(feature)
        if not start or not end:
            continue
        domains.append(
            {
                "start": start,
                "end": end,
                "label": feature.get("description") or feature.get("type"),
                "type": kind,
                "feature_type": feature.get("type"),
            }
        )
    domains.sort(key=lambda d: (d["start"], d["end"]))
    return domains
