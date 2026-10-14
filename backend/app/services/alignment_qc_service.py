"""
Contrôle qualité d'un alignement multiple ancré sur la référence.

L'alignement de l'Explorateur a exactement une colonne par résidu de la
référence (les insertions des homologues sont retirées) : la colonne k est le
résidu k de la référence. Le contrôle qualité ne supprime donc jamais de
colonne. Une colonne peu fiable est « masquée » : elle est exclue des calculs
(conservation, coévolution, SCA) mais garde son numéro, ce qui préserve la
correspondance exacte avec les résidus de la protéine.

1. Colonnes : fraction de gaps et similarité des résidus alignés avec celui de
   la référence (score BLOSUM62 positif).
2. Séquences : couverture de la référence, bornes alignées et plus long trou
   interne (séquences incomplètes ou fragmentées).
3. Diversité : identité moyenne entre homologues, nombre effectif de
   séquences (Neff, identité ≥ 80 %) et Neff rapporté à la longueur.
4. Régions mal alignées : fenêtre glissante où la fiabilité des colonnes
   (présence × similarité) reste basse sur plusieurs positions consécutives.
"""

import numpy as np

from app.services.alignment import BLOSUM62
from app.services.coevolution_service import AMINO_ACIDS, GAP, encode, sequence_weights

WINDOW = 9
POOR_THRESHOLD = 0.35
MIN_POOR_LENGTH = 5
HIGH_GAP = 0.5
MAX_DIVERSITY_ROWS = 400

# Paires d'acides aminés semblables (BLOSUM62 > 0), indexées comme encode()
_POSITIVE = np.zeros((GAP + 1, GAP + 1), dtype=bool)
for _i, _a in enumerate(AMINO_ACIDS):
    for _j, _b in enumerate(AMINO_ACIDS):
        _POSITIVE[_i, _j] = BLOSUM62[_a][_b] > 0


def normalize_params(qc: dict | None) -> dict:
    """Réglages du contrôle qualité ; absents : aucun filtre."""
    qc = qc or {}
    return {
        "min_coverage": qc.get("min_coverage"),
        "max_internal_gap": qc.get("max_internal_gap"),
        "max_column_gaps": qc.get("max_column_gaps"),
        "mask_poor_regions": bool(qc.get("mask_poor_regions")),
    }


# ---------------------------------------------------------------------------
# Séquences
# ---------------------------------------------------------------------------

def sequence_stats(row: str) -> dict:
    """Couverture, bornes alignées (1 = premier résidu de la référence) et trous internes."""
    present = [k for k, c in enumerate(row) if c != "-"]
    if not present:
        return {"coverage": 0.0, "start": None, "end": None, "longest_internal_gap": 0, "internal_gaps": 0}
    first, last = present[0], present[-1]
    longest = runs = current = 0
    for c in row[first:last + 1]:
        if c == "-":
            current += 1
            if current == 1:
                runs += 1
            longest = max(longest, current)
        else:
            current = 0
    return {
        "coverage": round(len(present) / len(row), 3),
        "start": first + 1,
        "end": last + 1,
        "longest_internal_gap": longest,
        "internal_gaps": runs,
    }


def incomplete_reasons(stats: dict, params: dict) -> list[str]:
    reasons = []
    if params["min_coverage"] is not None and stats["coverage"] < params["min_coverage"]:
        reasons.append(f"Couverture de la référence {stats['coverage']:.0%} < {params['min_coverage']:.0%}")
    if params["max_internal_gap"] is not None and stats["longest_internal_gap"] > params["max_internal_gap"]:
        reasons.append(f"Trou interne de {stats['longest_internal_gap']} positions > {params['max_internal_gap']}")
    return reasons


# ---------------------------------------------------------------------------
# Colonnes
# ---------------------------------------------------------------------------

def column_stats(query: str, rows: list[str]) -> dict[str, np.ndarray]:
    """Par colonne : gaps, identité et similarité avec la référence, fiabilité (présence × similarité)."""
    length = len(query)
    if not rows:
        zeros = np.zeros(length)
        return {"gap_fraction": zeros, "identity": zeros, "similarity": zeros, "reliability": zeros}
    codes = encode([query] + rows)
    reference, homologs = codes[0], codes[1:]
    present = homologs != GAP
    count = present.sum(axis=0)
    safe = np.maximum(count, 1)
    identical = (homologs == reference[None, :]) & present
    similar = _POSITIVE[reference[None, :], homologs] & present
    gap_fraction = 1 - count / len(rows)
    similarity = np.where(count > 0, similar.sum(axis=0) / safe, 0.0)
    return {
        "gap_fraction": gap_fraction,
        "identity": np.where(count > 0, identical.sum(axis=0) / safe, 0.0),
        "similarity": similarity,
        "reliability": (1 - gap_fraction) * similarity,
    }


def poor_regions(columns: dict[str, np.ndarray]) -> list[dict]:
    """Segments d'au moins MIN_POOR_LENGTH positions dont la fiabilité moyenne (fenêtre de WINDOW) est basse."""
    reliability = columns["reliability"]
    length = len(reliability)
    if not length:
        return []
    kernel = np.ones(min(WINDOW, length))
    smoothed = np.convolve(reliability, kernel, mode="same") / np.convolve(np.ones(length), kernel, mode="same")
    low = smoothed < POOR_THRESHOLD

    regions, k = [], 0
    while k < length:
        if not low[k]:
            k += 1
            continue
        start = k
        while k < length and low[k]:
            k += 1
        if k - start >= MIN_POOR_LENGTH:
            gap = float(columns["gap_fraction"][start:k].mean())
            similarity = float(columns["similarity"][start:k].mean())
            regions.append(
                {
                    "start": start + 1,
                    "end": k,
                    "length": k - start,
                    "mean_gap": round(gap, 3),
                    "mean_similarity": round(similarity, 3),
                    "reason": "Beaucoup de gaps : peu d’homologues couvrent cette région"
                    if gap > HIGH_GAP
                    else "Résidus alignés peu semblables à la référence : alignement douteux",
                }
            )
    return regions


def column_mask(columns: dict[str, np.ndarray], regions: list[dict], params: dict) -> tuple[list[bool], list[str | None]]:
    """Colonnes masquées et leur raison (les numéros des positions ne changent pas)."""
    length = len(columns["gap_fraction"])
    reasons: list[str | None] = [None] * length
    if params["max_column_gaps"] is not None:
        for k, gap in enumerate(columns["gap_fraction"]):
            if gap > params["max_column_gaps"] + 1e-9:
                reasons[k] = f"{gap:.0%} de gaps (> {params['max_column_gaps']:.0%})"
    if params["mask_poor_regions"]:
        for region in regions:
            for k in range(region["start"] - 1, region["end"]):
                reasons[k] = reasons[k] or f"Région mal alignée {region['start']}–{region['end']}"
    return [r is not None for r in reasons], reasons


# ---------------------------------------------------------------------------
# Diversité
# ---------------------------------------------------------------------------

def diversity(query: str, rows: list[str], identities: list[float]) -> dict:
    """Identité moyenne entre homologues (échantillon), Neff à 80 % et Neff / L."""
    if not rows:
        return {"mean_pairwise_identity": None, "median_identity_to_reference": None, "neff": 1.0, "neff_per_length": round(1 / len(query), 3), "sampled": 0}
    codes = encode([query] + rows)
    neff = float(sequence_weights(codes).sum())

    sample = codes[1:]
    if len(sample) > MAX_DIVERSITY_ROWS:
        sample = sample[np.linspace(0, len(sample) - 1, MAX_DIVERSITY_ROWS).astype(int)]
    present = sample != GAP
    values = []
    for i in range(len(sample) - 1):
        both = present[i][None, :] & present[i + 1:]
        same = (sample[i][None, :] == sample[i + 1:]) & both
        overlap = both.sum(axis=1)
        ok = overlap >= 10
        values.extend((same.sum(axis=1)[ok] / overlap[ok]).tolist())
    return {
        "mean_pairwise_identity": round(float(np.mean(values)), 3) if values else None,
        "median_identity_to_reference": round(float(np.median(identities)), 3) if identities else None,
        "neff": round(neff, 1),
        "neff_per_length": round(neff / len(query), 3),
        "sampled": int(len(sample)),
    }


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------

def quality_control(
    query: str,
    rows: list[str],
    homologs: list[dict],
    qc: dict | None = None,
    source_columns: list[int] | None = None,
) -> tuple[list[str], list[dict], dict]:
    """
    Écarte les séquences incomplètes, masque les colonnes peu fiables et
    renvoie l'alignement retenu avec le rapport de qualité.
    """
    params = normalize_params(qc)
    length = len(query)
    if any(len(row) != length for row in rows):
        raise ValueError("Alignement incohérent : une ligne n'a pas la longueur de la référence.")

    kept_rows, kept, removed, sequences = [], [], [], []
    for row, homolog in zip(rows, homologs):
        stats = sequence_stats(row)
        reasons = incomplete_reasons(stats, params)
        sequences.append({"accession": homolog["accession"], **stats, "removed": bool(reasons)})
        if reasons:
            removed.append({**homolog, "row": row, "reasons": reasons})
        else:
            kept_rows.append(row)
            kept.append(homolog)

    columns = column_stats(query, kept_rows)
    regions = poor_regions(columns)
    masked, reasons = column_mask(columns, regions, params)
    coverages = [s["coverage"] for s in sequences if not s["removed"]]

    report = {
        "params": params,
        "columns": {
            "gap_fraction": [round(float(v), 3) for v in columns["gap_fraction"]],
            "identity": [round(float(v), 3) for v in columns["identity"]],
            "similarity": [round(float(v), 3) for v in columns["similarity"]],
            "masked": masked,
            "reasons": reasons,
        },
        "sequences": sequences,
        "removed": removed,
        "poor_regions": regions,
        "diversity": diversity(query, kept_rows, [h["identity"] for h in kept]),
        # Colonne k de l'alignement = résidu k de la référence ; colonne du fichier importé si alignement fourni
        "mapping": {
            "columns": length,
            "reference_length": length,
            "exact": True,
            "source_columns": source_columns,
        },
        "summary": {
            "sequences": len(rows),
            "kept": len(kept_rows),
            "removed": len(removed),
            "masked_columns": sum(masked),
            "high_gap_columns": int(np.sum(columns["gap_fraction"] > HIGH_GAP)),
            "mean_gap": round(float(columns["gap_fraction"].mean()), 3) if length else None,
            "median_coverage": round(float(np.median(coverages)), 3) if coverages else None,
            "poor_region_positions": sum(r["length"] for r in regions),
        },
    }
    return kept_rows, kept, report
