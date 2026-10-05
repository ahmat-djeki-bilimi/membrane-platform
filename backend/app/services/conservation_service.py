"""
Conservation évolutive de chaque résidu d'une protéine.

1. Homologues : membres du cluster UniRef50 de la protéine (séquences ≥ 50 %
   d'identité, souvent des orthologues d'autres espèces), une séquence par
   espèce, en privilégiant les entrées Swiss-Prot ; ou, en recherche étendue
   et pour les séquences sans accession, homologues MMseqs2 dans UniRef.
2. Alignement de chaque homologue sur la protéine étudiée (alignement multiple
   ancré, voir alignment.py).
3. Poids des séquences de Henikoff & Henikoff (1994), pour que des séquences
   très proches ne comptent pas plusieurs fois.
4. Score de divergence de Jensen-Shannon (Capra & Singh, 2007) par position,
   pénalisé par la fraction de gaps, puis grades de 1 (variable) à 9
   (conservé) relatifs à la protéine.
"""

import math
import re
from collections import Counter, defaultdict

from app import http
from app.services.alignment import align_to_query
from app.services.homology_service import fetch_uniref_organisms, run_mmseqs
from app.services.uniprot_service import domain_features, fetch_entry, tm_segments

UNIREF = "https://rest.uniprot.org/uniref"
UNIPROT_ACCESSIONS = "https://rest.uniprot.org/uniprotkb/accessions"

AMINO_ACIDS = "ACDEFGHIKLMNPQRSTVWY"
# Fréquences de fond BLOSUM62 (Capra & Singh, 2007)
BACKGROUND = {
    "A": 0.078, "R": 0.051, "N": 0.041, "D": 0.052, "C": 0.024, "Q": 0.034,
    "E": 0.059, "G": 0.083, "H": 0.025, "I": 0.062, "L": 0.092, "K": 0.056,
    "M": 0.024, "F": 0.044, "P": 0.043, "S": 0.059, "T": 0.055, "W": 0.014,
    "Y": 0.034, "V": 0.072,
}
_bg_total = sum(BACKGROUND.values())
BACKGROUND = {a: f / _bg_total for a, f in BACKGROUND.items()}

MAX_HOMOLOGS = 150
MAX_MEMBERS_SCANNED = 2000
MIN_IDENTITY = 0.30
MIN_COVERAGE = 0.50
MIN_SEQUENCES_RELIABLE = 10
MSA_ROWS_RETURNED = 100
MAX_HOMOLOGS_RETURNED = 300
# Recherche étendue (MMseqs2) : homologues plus lointains acceptés
MIN_IDENTITY_EXTENDED = 0.20
MAX_EXTENDED_SEQUENCES = 1000


class ConservationError(Exception):
    pass


# ---------------------------------------------------------------------------
# Homologues
# ---------------------------------------------------------------------------

def find_uniref50_cluster(accession: str) -> dict | None:
    response = http.get(
        f"{UNIREF}/search",
        params={"query": f"uniprot_id:{accession} AND identity:0.5", "fields": "id,count,name"},
    )
    response.raise_for_status()
    results = response.json().get("results", [])
    return results[0] if results else None


def _is_swissprot(member: dict) -> bool:
    # Swiss-Prot : identifiant mnémonique (ADRB2_HUMAN) ; TrEMBL : accession_ESPÈCE
    accessions = member.get("accessions") or []
    member_id = member.get("memberId", "")
    return bool(accessions) and not member_id.startswith(accessions[0] + "_")


def fetch_cluster_members(cluster_id: str) -> list[dict]:
    members, url, params = [], f"{UNIREF}/{cluster_id}/members", {"size": 500}
    while url and len(members) < MAX_MEMBERS_SCANNED:
        response = http.get(url, params=params)
        response.raise_for_status()
        members.extend(response.json().get("results", []))
        match = re.search(r'<([^>]+)>;\s*rel="next"', response.headers.get("Link", ""))
        url, params = (match.group(1), None) if match else (None, None)
    return members


def select_representatives(members: list[dict], query_accession: str) -> list[dict]:
    """Une séquence par espèce et par séquence identique ; Swiss-Prot d'abord."""
    candidates = [
        m for m in members
        if m.get("memberIdType") == "UniProtKB ID"
        and m.get("accessions")
        and query_accession not in m["accessions"]
        and "(Fragment)" not in (m.get("proteinName") or "")
    ]
    candidates.sort(key=lambda m: (not _is_swissprot(m), -(m.get("sequenceLength") or 0)))

    chosen, seen_species, seen_sequences = [], set(), set()
    for m in candidates:
        species, identical = m.get("organismTaxId"), m.get("uniref100Id")
        if species in seen_species or (identical and identical in seen_sequences):
            continue
        seen_species.add(species)
        if identical:
            seen_sequences.add(identical)
        chosen.append(m)
        if len(chosen) >= MAX_HOMOLOGS:
            break
    return chosen


def fetch_sequences(accessions: list[str]) -> dict[str, str]:
    sequences: dict[str, str] = {}
    for start in range(0, len(accessions), 100):
        batch = accessions[start:start + 100]
        response = http.get(UNIPROT_ACCESSIONS, params={"accessions": ",".join(batch), "format": "fasta"}, timeout=60)
        response.raise_for_status()
        for block in response.text.split(">")[1:]:
            header, *lines = block.splitlines()
            parts = header.split("|")
            if len(parts) >= 2:
                sequences[parts[1]] = "".join(lines)
    return sequences


# ---------------------------------------------------------------------------
# Scores
# ---------------------------------------------------------------------------

def henikoff_weights(rows: list[str]) -> list[float]:
    """Poids de séquence position par position (gaps ignorés), normalisés à 1."""
    if not rows:
        return []
    weights = [0.0] * len(rows)
    for column in zip(*rows):
        counts = Counter(c for c in column if c != "-")
        distinct = len(counts)
        if not distinct:
            continue
        for index, residue in enumerate(column):
            if residue != "-":
                weights[index] += 1.0 / (distinct * counts[residue])
    total = sum(weights)
    return [w / total for w in weights] if total else [1.0 / len(rows)] * len(rows)


def jensen_shannon(column: str, weights: list[float]) -> tuple[float, float, dict[str, float]]:
    """Divergence de Jensen-Shannon (bits) pénalisée par les gaps ; renvoie aussi
    la fraction de gaps et la distribution pondérée des résidus."""
    gap_weight = sum(w for c, w in zip(column, weights) if c not in AMINO_ACIDS)
    residue_weight = 1.0 - gap_weight
    if residue_weight <= 1e-9:
        return 0.0, 1.0, {}

    pseudo = 1e-6
    freq = {a: pseudo for a in AMINO_ACIDS}
    for c, w in zip(column, weights):
        if c in AMINO_ACIDS:
            freq[c] += w
    total = sum(freq.values())
    p = {a: f / total for a, f in freq.items()}

    divergence = 0.0
    for a in AMINO_ACIDS:
        r = 0.5 * (p[a] + BACKGROUND[a])
        if p[a] > 0:
            divergence += 0.5 * p[a] * math.log2(p[a] / r)
        divergence += 0.5 * BACKGROUND[a] * math.log2(BACKGROUND[a] / r)
    return divergence * residue_weight, gap_weight, p


def grade_scores(scores: list[float]) -> list[int]:
    """Grades 1 (le plus variable) à 9 (le plus conservé), par rang dans la protéine."""
    order = sorted(range(len(scores)), key=lambda i: scores[i])
    grades = [0] * len(scores)
    for rank, index in enumerate(order):
        grades[index] = min(9, 1 + rank * 9 // max(len(scores), 1))
    return grades


# ---------------------------------------------------------------------------
# Régions membranaires
# ---------------------------------------------------------------------------

_INSIDE = ("cytoplasmic", "mitochondrial matrix", "stromal", "intravirion", "nuclear")


def _side(description: str | None) -> str | None:
    text = (description or "").lower()
    if any(term in text for term in _INSIDE):
        return "in"
    if text and any(term in text for term in ("extracellular", "lumenal", "periplasmic", "intermembrane", "vacuolar", "exoplasmic", "virion surface")):
        return "out"
    return None


def membrane_regions(entry: dict, length: int) -> list[dict]:
    """
    Découpe la séquence en régions : hélices TM, régions intramembranaires et
    boucles (côté extérieur ou cytoplasmique d'après UniProt). Vide si la
    protéine n'a aucune région membranaire annotée.
    """
    features = domain_features(entry)
    membrane = [f for f in features if f["type"] in ("transmembrane", "intramembrane")]
    if not membrane:
        return []
    topological = [f for f in features if f["type"] == "topological"]

    regions, tm_index, im_index = [], 0, 0
    for f in sorted(membrane, key=lambda f: f["start"]):
        if f["type"] == "transmembrane":
            tm_index += 1
            regions.append({"kind": "tm", "label": f"TM{tm_index}", "start": f["start"], "end": f["end"]})
        else:
            im_index += 1
            regions.append({"kind": "intramembrane", "label": f"Intramembranaire {im_index}", "start": f["start"], "end": f["end"]})

    # Boucles : intervalles entre les régions membranaires
    loops, cursor = [], 1
    for r in regions:
        if r["start"] > cursor:
            loops.append((cursor, r["start"] - 1))
        cursor = max(cursor, r["end"] + 1)
    if cursor <= length:
        loops.append((cursor, length))

    counters = {"out": 0, "in": 0, None: 0}
    names = {"out": "Boucle extérieure", "in": "Boucle cytoplasmique", None: "Boucle"}
    for start, end in loops:
        mid = (start + end) // 2
        domain = next((t for t in topological if t["start"] <= mid <= t["end"]), None)
        side = _side(domain["label"]) if domain else None
        if start == 1:
            label = "Extrémité N-terminale"
        elif end == length:
            label = "Extrémité C-terminale"
        else:
            counters[side] += 1
            label = f"{names[side]} {counters[side]}"
        regions.append({"kind": f"loop_{side}" if side else "loop", "label": label, "start": start, "end": end, "side": side})

    return sorted(regions, key=lambda r: r["start"])


# ---------------------------------------------------------------------------
# Analyse complète
# ---------------------------------------------------------------------------

def regions_from_segments(segments: list[dict], length: int, estimated: bool) -> list[dict]:
    """Régions (hélices et boucles sans côté connu) à partir de segments TM seuls."""
    if not segments:
        return []
    suffix = " (estimé)" if estimated else ""
    regions, cursor = [], 1
    for index, s in enumerate(sorted(segments, key=lambda s: s["start"]), start=1):
        if s["start"] > cursor:
            regions.append({"kind": "loop", "label": "", "start": cursor, "end": s["start"] - 1, "side": None})
        regions.append({"kind": "tm", "label": f"TM{index}{suffix}", "start": s["start"], "end": s["end"]})
        cursor = s["end"] + 1
    if cursor <= length:
        regions.append({"kind": "loop", "label": "", "start": cursor, "end": length, "side": None})

    loop_number = 0
    for region in regions:
        if region["kind"] != "loop":
            continue
        if region["start"] == 1:
            region["label"] = "Extrémité N-terminale"
        elif region["end"] == length:
            region["label"] = "Extrémité C-terminale"
        else:
            loop_number += 1
            region["label"] = f"Boucle {loop_number}"
    return regions


def _mean(values):
    return round(sum(values) / len(values), 4) if values else None


def analyze_alignment(
    query: str,
    rows: list[str],
    homologs: list[dict],
    regions: list[dict],
    segments: list[dict],
) -> dict:
    """Scores de conservation, régions et résumé à partir d'un alignement ancré."""
    all_rows = [query] + rows
    weights = henikoff_weights(all_rows)

    positions, scores = [], []
    for index, column in enumerate(zip(*all_rows)):
        column = "".join(column)
        score, gap_fraction, distribution = jensen_shannon(column, weights)
        query_residue = query[index]
        top = sorted(distribution.items(), key=lambda kv: -kv[1])[:3] if distribution else []
        positions.append(
            {
                "position": index + 1,
                "residue": query_residue,
                "score": round(score, 4),
                "gap_fraction": round(gap_fraction, 3),
                "query_residue_frequency": round(distribution.get(query_residue, 0.0), 3),
                "top_residues": [{"residue": a, "frequency": round(f, 3)} for a, f in top if f >= 0.05],
            }
        )
        scores.append(score)

    for position, grade in zip(positions, grade_scores(scores)):
        position["grade"] = grade

    for region in regions:
        region["mean_score"] = _mean([p["score"] for p in positions[region["start"] - 1:region["end"]]])
        region["length"] = region["end"] - region["start"] + 1

    in_tm = {p for s in segments for p in range(s["start"], s["end"] + 1)}
    warnings = []
    if len(homologs) < MIN_SEQUENCES_RELIABLE:
        warnings.append(f"Seulement {len(homologs)} homologue(s) retenu(s) : la conservation est peu informative.")

    msa = [
        {"accession": h["accession"], "organism": h.get("organism") or h["accession"], "row": row}
        for h, row in list(zip(homologs, rows))[:MSA_ROWS_RETURNED]
    ]
    species = {h["taxon_id"] for h in homologs if h.get("taxon_id")}

    return {
        "sequence_count": len(homologs) + 1,
        "species_count": len(species) + 1 if species else None,
        "length": len(query),
        "query_sequence": query,
        "positions": positions,
        "summary": {
            "mean_score": _mean(scores),
            "tm_mean_score": _mean([p["score"] for p in positions if p["position"] in in_tm]),
            "loop_mean_score": _mean([p["score"] for p in positions if p["position"] not in in_tm]),
            "tm_segments": segments,
            "regions": regions,
            "most_conserved": [
                {"position": p["position"], "residue": p["residue"], "score": p["score"]}
                for p in sorted(positions, key=lambda p: -p["score"])[:20]
            ],
        },
        "homologs": homologs[:MAX_HOMOLOGS_RETURNED],
        "msa": msa,
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Sources d'homologues
# ---------------------------------------------------------------------------

def _uniref50_alignment(accession: str, query: str) -> tuple[list[str], list[dict], dict]:
    cluster = find_uniref50_cluster(accession)
    if cluster is None:
        raise ConservationError("Aucun cluster UniRef50 pour cette entrée.")

    representatives = select_representatives(fetch_cluster_members(cluster["id"]), accession)
    sequences = fetch_sequences([m["accessions"][0] for m in representatives])

    pairs, excluded = [], 0
    for member in representatives:
        acc = member["accessions"][0]
        sequence = sequences.get(acc)
        if not sequence:
            continue
        pair = align_to_query(query, sequence)
        if pair.identity < MIN_IDENTITY or pair.coverage < MIN_COVERAGE:
            excluded += 1
            continue
        pairs.append(
            (
                pair.anchored,
                {
                    "accession": acc,
                    "entry_name": member.get("memberId"),
                    "protein_name": member.get("proteinName"),
                    "organism": member.get("organismName"),
                    "taxon_id": member.get("organismTaxId"),
                    "reviewed": _is_swissprot(member),
                    "length": len(sequence),
                    "identity": round(pair.identity, 3),
                    "coverage": round(pair.coverage, 3),
                    "link": f"https://www.uniprot.org/uniprotkb/{acc}/entry",
                },
            )
        )

    pairs.sort(key=lambda p: -p[1]["identity"])
    meta = {
        "source": "uniref50",
        "method": "UniRef50 + alignement ancré (BLOSUM62) + divergence de Jensen-Shannon",
        "cluster_id": cluster["id"],
        "cluster_size": cluster.get("memberCount"),
        "excluded_count": excluded,
    }
    return [p[0] for p in pairs], [p[1] for p in pairs], meta


def _mmseqs_alignment(query: str) -> tuple[list[str], list[dict], dict]:
    hits = run_mmseqs(query)
    kept, excluded = [], 0
    for hit in hits:
        row = hit["row"]
        aligned = [(q, s) for q, s in zip(query, row) if s != "-"]
        coverage = len(aligned) / len(query)
        identity = hit["identity"]
        if identity is None:
            identity = sum(q == s for q, s in aligned) / len(aligned) if aligned else 0.0
        if coverage < MIN_COVERAGE or identity < MIN_IDENTITY_EXTENDED:
            excluded += 1
            continue
        kept.append((row, hit["id"], identity, coverage))
        if len(kept) >= MAX_EXTENDED_SEQUENCES:
            break

    # Organismes des séquences affichées (alignement et tableau)
    organisms = fetch_uniref_organisms([k[1] for k in kept[:MAX_HOMOLOGS_RETURNED]])
    homologs = []
    for row, identifier, identity, coverage in kept:
        info = organisms.get(identifier, {})
        homologs.append(
            {
                "accession": identifier,
                "entry_name": identifier,
                "protein_name": info.get("name"),
                "organism": info.get("organism"),
                "taxon_id": info.get("taxon_id"),
                "reviewed": False,
                "length": None,
                "identity": round(identity, 3),
                "coverage": round(coverage, 3),
                "link": f"https://www.uniprot.org/uniref/{identifier}",
            }
        )
    meta = {
        "source": "mmseqs",
        "method": "MMseqs2 (UniRef, serveur ColabFold) + divergence de Jensen-Shannon",
        "cluster_id": None,
        "cluster_size": len(hits),
        "excluded_count": excluded,
    }
    return [k[0] for k in kept], homologs, meta


# ---------------------------------------------------------------------------
# Points d'entrée
# ---------------------------------------------------------------------------

def compute_conservation(accession: str, source: str = "uniref50") -> dict:
    """Conservation d'une entrée UniProt (homologues UniRef50 ou MMseqs2)."""
    accession = accession.upper().strip()
    entry = fetch_entry(accession)
    query = entry.get("sequence", {}).get("value", "")
    if not query:
        raise ConservationError("Séquence UniProt indisponible.")

    if source == "mmseqs":
        rows, homologs, meta = _mmseqs_alignment(query)
    else:
        rows, homologs, meta = _uniref50_alignment(accession, query)

    result = analyze_alignment(query, rows, homologs, membrane_regions(entry, len(query)), tm_segments(entry))
    return {"accession": accession, **meta, **result}


def compute_sequence_conservation(sequence: str, name: str = "query") -> dict:
    """Conservation d'une séquence quelconque (homologues MMseqs2)."""
    from app.services.membrane_orientation_service import estimate_tm_segments

    query = re.sub(r"[^A-Za-z]", "", sequence).upper()
    if not query:
        raise ConservationError("Séquence vide.")

    rows, homologs, meta = _mmseqs_alignment(query)
    # Sans annotation, segments TM estimés par hydropathie (Kyte-Doolittle)
    segments = [{"start": s["start"], "end": s["end"], "label": s["label"]} for s in estimate_tm_segments(query)]
    regions = regions_from_segments(segments, len(query), estimated=True)
    result = analyze_alignment(query, rows, homologs, regions, segments)
    if segments:
        result["warnings"].append(
            "Segments transmembranaires estimés par hydropathie (Kyte-Doolittle) : à confirmer par DeepTMHMM."
        )
    return {"accession": None, "name": name, **meta, **result}
