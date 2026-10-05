"""
Topologie membranaire d'une entrée UniProt.

Les segments et l'orientation proviennent des annotations UniProtKB
(« Transmembrane » et « Topological domain »). Sans annotation, les segments
sont estimés par hydropathie (Kyte-Doolittle) et l'orientation reste inconnue :
aucune valeur n'est inventée.
"""

from app.services.uniprot_service import fetch_entry

KYTE_DOOLITTLE = {
    "I": 4.5, "V": 4.2, "L": 3.8, "F": 2.8, "C": 2.5, "M": 1.9, "A": 1.8,
    "G": -0.4, "T": -0.7, "S": -0.8, "W": -0.9, "Y": -1.3, "P": -1.6,
    "H": -3.2, "E": -3.5, "Q": -3.5, "D": -3.5, "N": -3.5, "K": -3.9, "R": -4.5,
}
TM_WINDOW = 19
TM_THRESHOLD = 1.6

# Libellés UniProt des domaines topologiques → côté de la membrane
INSIDE_TERMS = ("cytoplasmic", "intravirion", "mitochondrial matrix", "stromal")
OUTSIDE_TERMS = (
    "extracellular", "lumenal", "periplasmic", "mitochondrial intermembrane",
    "vacuolar", "exoplasmic", "virion surface", "thylakoid lumen",
)


def fetch_uniprot_sequence(accession: str):
    entry = fetch_entry(accession)
    return entry.get("sequence", {}).get("value", ""), entry.get("features", [])

def _location(feature):
    location = feature.get("location", {})
    return location.get("start", {}).get("value"), location.get("end", {}).get("value")


def extract_uniprot_tm_segments(features):
    segments = []
    for feature in features:
        if feature.get("type") != "Transmembrane":
            continue
        start, end = _location(feature)
        if start and end:
            segments.append(
                {
                    "start": int(start),
                    "end": int(end),
                    "label": f"TM{len(segments) + 1}",
                    "source": "Annotation UniProt",
                }
            )
    return segments


def _side(description: str):
    text = (description or "").lower()
    if any(term in text for term in INSIDE_TERMS):
        return "in"
    if any(term in text for term in OUTSIDE_TERMS):
        return "out"
    return None


def extract_topology(features):
    """Côtés des extrémités N et C d'après les domaines topologiques annotés."""
    domains = []
    for feature in features:
        if feature.get("type") != "Topological domain":
            continue
        start, end = _location(feature)
        if start and end:
            domains.append((int(start), int(end), feature.get("description", "")))
    if not domains:
        return None, None, []

    domains.sort()
    return (
        _side(domains[0][2]),
        _side(domains[-1][2]),
        [{"start": s, "end": e, "label": d, "side": _side(d)} for s, e, d in domains],
    )


def estimate_tm_segments(sequence: str):
    """Régions hydrophobes (Kyte & Doolittle, fenêtre 19, seuil 1,6)."""
    n = len(sequence)
    if n < TM_WINDOW:
        return []

    half = TM_WINDOW // 2
    centers = []
    for start in range(0, n - TM_WINDOW + 1):
        window = [KYTE_DOOLITTLE[a] for a in sequence[start:start + TM_WINDOW] if a in KYTE_DOOLITTLE]
        if window and sum(window) / len(window) >= TM_THRESHOLD:
            centers.append(start + half + 1)

    segments = []
    run = []
    for c in centers + [None]:
        if run and (c is None or c != run[-1] + 1):
            missing = max(0, TM_WINDOW - len(run))
            start = max(1, run[0] - missing // 2)
            end = min(n, run[-1] + (missing - missing // 2))
            if segments and start <= segments[-1]["end"]:
                segments[-1]["end"] = max(segments[-1]["end"], end)
            else:
                segments.append({"start": start, "end": end})
            run = []
        if c is not None:
            run.append(c)

    return [
        {**s, "label": f"TM{i + 1}", "source": "Estimation Kyte-Doolittle"}
        for i, s in enumerate(segments)
    ]


SIDE_LABEL = {"in": "cytoplasmique", "out": "extracellulaire / luminale", None: "inconnue"}


def get_membrane_orientation(accession: str):
    accession = accession.upper().strip()

    try:
        sequence, features = fetch_uniprot_sequence(accession)
    except Exception as e:
        return {
            "accession": accession,
            "available": False,
            "sequence_length": 0,
            "method": "error",
            "tm_segments": [],
            "orientation": {"tm_count": 0, "n_terminus": None, "c_terminus": None, "topology": "-"},
            "error": str(e),
        }

    segments = extract_uniprot_tm_segments(features)
    method = "Annotation UniProt"
    if not segments:
        segments = estimate_tm_segments(sequence)
        method = "Estimation Kyte-Doolittle" if segments else "Aucun segment"

    n_side, c_side, topological_domains = extract_topology(features)
    count = len(segments)

    if n_side or c_side:
        topology = f"N-{n_side or '?'} / C-{c_side or '?'}"
    else:
        topology = "Non annotée"

    if count == 0:
        interpretation = (
            "Aucun segment transmembranaire annoté ni région suffisamment hydrophobe : "
            "protéine probablement soluble ou associée à la membrane sans la traverser."
        )
    else:
        interpretation = (
            f"{count} segment(s) transmembranaire(s) ({method.lower()}). "
            f"Extrémité N-terminale {SIDE_LABEL[n_side]}, extrémité C-terminale {SIDE_LABEL[c_side]}"
            + (" (domaines topologiques UniProt)." if n_side or c_side else ".")
        )

    return {
        "accession": accession,
        "available": True,
        "sequence_length": len(sequence),
        "method": method,
        "tm_segments": segments,
        "topological_domains": topological_domains,
        "orientation": {
            "tm_count": count,
            "n_terminus": n_side,
            "c_terminus": c_side,
            "topology": topology,
            "topology_source": "UniProt (domaines topologiques)" if (n_side or c_side) else None,
            "interpretation": interpretation,
        },
    }
