"""
Contrôles de fiabilité de la coévolution (MIp et SCA).

1. Alignement : profondeur effective (Neff à 80 %), redondance, gaps,
   structure phylogénétique (part de la variance des séquences portée par la
   première composante principale) et domination d'un groupe taxonomique.
2. MIp :
   - sous-échantillonnage : la MIp est recalculée sur 70 % des séquences ;
     on mesure combien des L/5 premières paires sont retrouvées ;
   - hypothèse nulle : chaque colonne est mélangée indépendamment (la
     conservation est gardée, la covariation détruite) ; le meilleur score
     obtenu sert de seuil empirique.
3. SCA : secteurs recalculés sur des sous-échantillons (même nombre de
   composantes) ; stabilité = meilleur recouvrement (indice de Jaccard).

Les calculs répétés sont limités pour les très gros alignements, et le
nombre de répétitions effectuées est toujours indiqué.
"""

from collections import Counter

import numpy as np

from app.services.coevolution_service import GAP, MAX_GAP_FRACTION, compute_coevolution, encode, sequence_weights
from app.services.sca_service import compute_sca

SUBSAMPLE_FRACTION = 0.7
# Taille n × L² au-delà de laquelle on réduit puis supprime les répétitions
FULL_BUDGET = 2e8
REDUCED_BUDGET = 8e8
MAX_PCA_SEQUENCES = 1500


def replicate_budget(n: int, length: int) -> tuple[int, int]:
    """(sous-échantillons, mélanges) selon la taille de l'alignement."""
    size = n * length * length
    if size <= FULL_BUDGET:
        return 4, 2
    if size <= REDUCED_BUDGET:
        return 2, 1
    return 0, 0


# ---------------------------------------------------------------------------
# 1. Alignement
# ---------------------------------------------------------------------------

def _check(identifier: str, label: str, value: str, status: str, text: str) -> dict:
    return {"id": identifier, "label": label, "value": value, "status": status, "text": text}


def alignment_diagnostics(rows: list[str], mask: list[bool] | None = None, homologs: list[dict] | None = None) -> dict:
    codes = encode(rows)
    n, length = codes.shape
    weights = sequence_weights(codes)
    neff = float(weights.sum())
    cluster_sizes = 1.0 / weights
    gap = ((codes == GAP) * weights[:, None]).sum(axis=0) / weights.sum()
    masked = np.asarray(mask, dtype=bool) if mask is not None else np.zeros(length, dtype=bool)
    excluded = (gap > MAX_GAP_FRACTION) | masked

    # Structure phylogénétique : variance des séquences (one-hot centré) portée par les premières composantes
    sample = codes if n <= MAX_PCA_SEQUENCES else codes[np.linspace(0, n - 1, MAX_PCA_SEQUENCES).astype(int)]
    onehot = np.zeros((len(sample), length * 21), dtype=np.float32)
    onehot[np.repeat(np.arange(len(sample)), length), (np.arange(length)[None, :] * 21 + sample).ravel()] = 1.0
    onehot -= onehot.mean(axis=0)
    eigen = np.clip(np.linalg.eigvalsh(onehot @ onehot.T)[::-1], 0, None)
    total = eigen.sum() or 1.0
    pc1, pc3 = float(eigen[0] / total), float(eigen[:3].sum() / total)

    dominant = None
    if homologs:
        phyla = Counter((h.get("lineage") or {}).get("phylum") for h in homologs)
        phyla.pop(None, None)
        if phyla:
            name, count = phyla.most_common(1)[0]
            dominant = {"rank": "Embranchement", "name": name, "share": round(count / len(homologs), 2), "groups": len(phyla)}

    ratio = neff / max(length, 1)
    checks = [
        _check(
            "depth", "Profondeur effective", f"Neff = {neff:.0f} ({ratio:.2f} par position)",
            "ok" if neff >= 50 and ratio >= 1 else "attention" if neff >= 50 and ratio >= 0.3 else "probleme",
            "Il faut idéalement plus d’une séquence effective par position (Neff/L ≥ 1) et au moins 50 au total ; "
            "en dessous, les premières paires sont dominées par le bruit d’échantillonnage.",
        ),
        _check(
            "redundancy", "Redondance", f"{n} séquences pour {neff:.0f} effectives ({n / max(neff, 1):.1f} par groupe)",
            "ok" if n / max(neff, 1) <= 3 else "attention" if n / max(neff, 1) <= 10 else "probleme",
            f"Les séquences à ≥ 80 % d’identité sont regroupées et pondérées (le plus grand groupe compte {int(cluster_sizes.max())} séquences). "
            "Une forte redondance gonfle le nombre apparent de séquences sans apporter d’information.",
        ),
        _check(
            "gaps", "Gaps", f"{excluded.mean():.0%} des colonnes exclues, {gap.mean():.0%} de gaps en moyenne",
            "ok" if excluded.mean() <= 0.15 else "attention" if excluded.mean() <= 0.35 else "probleme",
            f"Colonnes à plus de {MAX_GAP_FRACTION:.0%} de gaps (pondérés) ou masquées par le contrôle qualité : exclues de la MIp et de la SCA, "
            "leurs positions ne peuvent pas ressortir.",
        ),
        _check(
            "phylogeny", "Structure phylogénétique", f"1re composante : {pc1:.0%} de la variance des séquences (3 premières : {pc3:.0%})",
            "ok" if pc1 <= 0.15 else "attention" if pc1 <= 0.3 else "probleme",
            "Quand une composante domine, la famille se divise en sous-familles : des positions qui distinguent ces sous-familles "
            "covarient par descendance commune, sans contrainte structurale. L’APC (MIp) et la pondération corrigent en partie ce biais.",
        ),
    ]
    if dominant:
        checks.append(
            _check(
                "taxonomy", "Diversité taxonomique", f"{dominant['share']:.0%} des homologues dans « {dominant['name']} » ({dominant['groups']} embranchements)",
                "ok" if dominant["share"] <= 0.6 else "attention" if dominant["share"] <= 0.85 else "probleme",
                "Une famille dominée par un seul groupe d’organismes reflète surtout son histoire : ajoutez des homologues d’autres groupes.",
            )
        )
    return {
        "sequences": n,
        "neff": round(neff, 1),
        "neff_per_length": round(ratio, 3),
        "largest_cluster": int(round(cluster_sizes.max())),
        "excluded_columns": int(excluded.sum()),
        "mean_gap": round(float(gap.mean()), 3),
        "pc1_share": round(pc1, 3),
        "pc3_share": round(pc3, 3),
        "dominant_group": dominant,
        "checks": checks,
        "status": "probleme" if any(c["status"] == "probleme" for c in checks) else "attention" if any(c["status"] == "attention" for c in checks) else "ok",
    }


# ---------------------------------------------------------------------------
# 2. MIp
# ---------------------------------------------------------------------------

def _subsample(rows: list[str], rng: np.random.Generator) -> list[str]:
    """Référence gardée, 70 % des homologues tirés sans remise."""
    others = rows[1:]
    keep = rng.choice(len(others), size=max(2, int(round(SUBSAMPLE_FRACTION * len(others)))), replace=False)
    return [rows[0]] + [others[k] for k in sorted(keep)]


def _shuffled(rows: list[str], rng: np.random.Generator) -> list[str]:
    """Chaque colonne mélangée entre les homologues : conservation gardée, covariation détruite."""
    matrix = np.array([list(r) for r in rows[1:]])
    for column in range(matrix.shape[1]):
        rng.shuffle(matrix[:, column])
    return [rows[0]] + ["".join(r) for r in matrix]


def mip_robustness(rows: list[str], coevolution: dict, mask: list[bool] | None = None, seed: int = 1) -> dict:
    length = len(rows[0])
    top_count = max(1, length // 5)
    top = [(p["i"], p["j"]) for p in coevolution["pairs"][:top_count]]
    subsamples, shuffles = replicate_budget(len(rows), length)
    rng = np.random.default_rng(seed)

    found: Counter = Counter()
    overlaps = []
    for _ in range(subsamples):
        replicate = compute_coevolution(_subsample(rows, rng), max_pairs=top_count, mask=mask)
        pairs = {(p["i"], p["j"]) for p in replicate["pairs"]}
        found.update(pair for pair in top if pair in pairs)
        overlaps.append(round(len(pairs & set(top)) / len(top), 3))

    null_scores = []
    for _ in range(shuffles):
        replicate = compute_coevolution(_shuffled(rows, rng), max_pairs=1, mask=mask)
        if replicate["pairs"]:
            null_scores.append(replicate["pairs"][0]["score"])
    null_max = max(null_scores) if null_scores else None

    for pair in coevolution["pairs"][:top_count]:
        if subsamples:
            pair["stability"] = round(found[(pair["i"], pair["j"])] / subsamples, 2)
        if null_max is not None:
            pair["above_null"] = pair["score"] > null_max
    stable = sum(1 for p in coevolution["pairs"][:top_count] if p.get("stability", 0) >= 0.75)
    return {
        "subsamples": subsamples,
        "fraction": SUBSAMPLE_FRACTION,
        "top_count": top_count,
        "overlaps": overlaps,
        "mean_overlap": round(float(np.mean(overlaps)), 3) if overlaps else None,
        "stable_pairs": stable if subsamples else None,
        "shuffles": shuffles,
        "null_max_score": null_max,
        "above_null": sum(1 for p in coevolution["pairs"][:top_count] if p.get("above_null")) if null_max is not None else None,
        "skipped": not subsamples,
        "note": None if subsamples else "Alignement trop grand : tests de robustesse non calculés (temps de calcul).",
    }


def contact_benchmark(coevolution: dict, structure: dict | None) -> dict | None:
    """Précision des paires selon leur rang, leur séparation dans la séquence et la confiance du modèle."""
    pairs = [p for p in coevolution["pairs"] if p.get("distance") is not None]
    if not pairs or not structure:
        return None
    length = coevolution["length"]
    curve = []
    hits = 0
    for rank, pair in enumerate(pairs[: max(length, 10)], start=1):
        hits += bool(pair.get("contact"))
        if rank in (1, 2, 5) or rank % max(1, length // 50) == 0:
            curve.append([rank, round(hits / rank, 3)])
    top = pairs[: max(1, length // 5)]
    classes = []
    for label, low, high in (("Courte (6–11)", 0, 11), ("Moyenne (12–23)", 12, 23), ("Longue (≥ 24)", 24, 10**6)):
        members = [p for p in top if low <= p["j"] - p["i"] <= high]
        if members:
            classes.append({"label": label, "count": len(members), "precision": round(sum(bool(p["contact"]) for p in members) / len(members), 3)})
    confident = [p for p in top if p.get("confident")]
    random = coevolution.get("random_precision")
    precision = sum(bool(p["contact"]) for p in top) / len(top)
    return {
        "curve": curve,
        "by_separation": classes,
        "confident_count": len(confident),
        "confident_precision": round(sum(bool(p["contact"]) for p in confident) / len(confident), 3) if confident else None,
        "top_precision": round(precision, 3),
        "enrichment": round(precision / random, 1) if random else None,
        "structure_note": f"Contacts du modèle {structure.get('source', '3D')} (structure prédite, non expérimentale) : Cβ–Cβ < 8 Å.",
    }


# ---------------------------------------------------------------------------
# 3. SCA
# ---------------------------------------------------------------------------

def _jaccard(a: set[int], b: set[int]) -> float:
    return len(a & b) / len(a | b) if a | b else 0.0


def sca_stability(rows: list[str], sca: dict, mask: list[bool] | None = None, seed: int = 1) -> dict:
    subsamples, _ = replicate_budget(len(rows), len(rows[0]))
    rng = np.random.default_rng(seed + 1)
    scores: dict[int, list[float]] = {s["id"]: [] for s in sca["sectors"]}
    counts = []
    for _ in range(subsamples):
        try:
            replicate = compute_sca(_subsample(rows, rng), trials=0, mask=mask, components=sca["components"])
        except ValueError:
            continue
        counts.append(len(replicate["sectors"]))
        others = [set(s["positions"]) for s in replicate["sectors"]]
        for sector in sca["sectors"]:
            scores[sector["id"]].append(max((_jaccard(set(sector["positions"]), o) for o in others), default=0.0))
    for sector in sca["sectors"]:
        values = scores[sector["id"]]
        sector["stability"] = round(float(np.mean(values)), 2) if values else None
        sector["stability_label"] = (
            None if not values else "stable" if np.mean(values) >= 0.6 else "partiellement stable" if np.mean(values) >= 0.35 else "instable"
        )
        z = sector.get("covariance_z")
        sector["signal"] = (
            "covariance collective" if z is not None and z >= 2
            else "dominé par la conservation" if (sector.get("loading_conservation_r") or 0) >= 0.6 or (z is not None and z < 1)
            else "indéterminé"
        )
    return {
        "subsamples": len(counts),
        "fraction": SUBSAMPLE_FRACTION,
        "sector_counts": counts,
        "skipped": not subsamples,
        "note": None if subsamples else "Alignement trop grand : stabilité des secteurs non calculée (temps de calcul).",
    }
