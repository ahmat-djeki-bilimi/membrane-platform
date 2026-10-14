"""
Coévolution des positions d'un alignement multiple.

Deux positions qui changent ensemble au cours de l'évolution sont souvent en
contact dans la structure (empilement d'hélices, pont salin, poche) ou
participent au même changement fonctionnel.

Méthode :
1. Poids des séquences : chaque séquence compte 1 / (nombre de séquences à
   ≥ 80 % d'identité avec elle), pour que les familles sur-représentées ne
   dominent pas. Le nombre effectif de séquences (Neff) est la somme des poids.
2. Fréquences pondérées des 20 acides aminés et du gap (21 états), avec une
   pseudo-fréquence uniforme qui limite le bruit des petits alignements.
3. Information mutuelle de chaque paire de positions, puis correction APC
   (Average Product Correction, Dunn et al., 2008) qui retire le signal
   commun dû à la phylogénie et à l'entropie propre de chaque colonne.
4. Paires séparées d'au moins 5 positions dans la séquence (les voisines
   d'une même hélice sont trivialement corrélées), classées par score.
"""

import numpy as np

AMINO_ACIDS = "ACDEFGHIKLMNPQRSTVWY"
_INDEX = {a: i for i, a in enumerate(AMINO_ACIDS)}
STATES = 21  # 20 acides aminés + gap
GAP = 20

IDENTITY_THRESHOLD = 0.8
PSEUDOCOUNT = 0.2
MAX_GAP_FRACTION = 0.5
MIN_SEPARATION = 5
MAX_LENGTH = 1500
MAX_PAIRS_RETURNED = 600
BLOCK = 16


def encode(rows: list[str]) -> np.ndarray:
    """Alignement codé en entiers (0–19 acides aminés, 20 gap ou inconnu)."""
    codes = np.full((len(rows), len(rows[0])), GAP, dtype=np.int8)
    for i, row in enumerate(rows):
        codes[i] = [_INDEX.get(c, GAP) for c in row.upper()]
    return codes


def sequence_weights(codes: np.ndarray, threshold: float = IDENTITY_THRESHOLD) -> np.ndarray:
    """Poids 1 / (nombre de voisines à ≥ `threshold` d'identité, elle comprise)."""
    n = codes.shape[0]
    neighbours = np.zeros(n)
    for i in range(n):
        identity = (codes == codes[i]).mean(axis=1)
        neighbours[i] = np.sum(identity >= threshold)
    return 1.0 / neighbours


def reliability(neff: float, length: int) -> dict:
    """Lecture qualitative de la profondeur de l'alignement pour la coévolution."""
    ratio = neff / max(length, 1)
    if neff < 50:
        level, text = "insuffisante", (
            "Trop peu de séquences indépendantes : les paires proposées sont surtout du bruit. "
            "Importez une famille plus large (plusieurs centaines de séquences variées)."
        )
    elif ratio < 1:
        level, text = "faible", (
            "Alignement peu profond : seules les toutes premières paires sont à considérer, "
            "et de préférence si elles sont confirmées par la structure."
        )
    elif ratio < 5:
        level, text = "moyenne", "Profondeur correcte : les premières paires sont généralement informatives."
    else:
        level, text = "bonne", "Alignement profond : le signal de coévolution est robuste."
    return {"level": level, "neff_per_length": round(ratio, 2), "text": text}


def mutual_information(codes: np.ndarray, weights: np.ndarray, pseudocount: float = PSEUDOCOUNT) -> tuple[np.ndarray, np.ndarray]:
    """Matrice d'information mutuelle (L × L) et fraction pondérée de gaps par colonne."""
    n, length = codes.shape
    w = weights / weights.sum()
    onehot = np.zeros((n, length, STATES), dtype=np.float32)
    onehot[np.arange(n)[:, None], np.arange(length)[None, :], codes] = 1.0

    single = np.einsum("n,nlq->lq", w, onehot)
    gap_fraction = single[:, GAP].copy()
    fi = (1 - pseudocount) * single + pseudocount / STATES
    log_fi = np.log(fi)

    flat = onehot.reshape(n, length * STATES)
    w32 = w.astype(np.float32)[:, None]
    mi = np.zeros((length, length))
    for start in range(0, length, BLOCK):
        stop = min(start + BLOCK, length)
        size = stop - start
        joint = (flat[:, start * STATES:stop * STATES] * w32).T @ flat  # (size·21, L·21)
        fij = (1 - pseudocount) * joint.reshape(size, STATES, length, STATES) + pseudocount / STATES**2
        log_ratio = np.log(fij) - log_fi[start:stop, :, None, None] - log_fi[None, None, :, :]
        mi[start:stop] = np.einsum("aqlr,aqlr->al", fij, log_ratio)
    np.fill_diagonal(mi, 0.0)
    return mi, gap_fraction


def apc(mi: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Correction APC sur les colonnes retenues (les autres valent 0)."""
    corrected = np.zeros_like(mi)
    idx = np.flatnonzero(valid)
    if len(idx) < 3:
        return corrected
    sub = mi[np.ix_(idx, idx)]
    k = len(idx)
    column_mean = sub.sum(axis=1) / (k - 1)
    overall = sub.sum() / (k * (k - 1))
    if overall <= 0:
        return corrected
    sub = sub - np.outer(column_mean, column_mean) / overall
    np.fill_diagonal(sub, 0.0)
    corrected[np.ix_(idx, idx)] = sub
    return corrected


def compute_coevolution(
    rows: list[str],
    min_separation: int = MIN_SEPARATION,
    max_pairs: int = MAX_PAIRS_RETURNED,
    mask: list[bool] | None = None,
) -> dict:
    """
    Paires de positions qui coévoluent. `rows` : alignement ancré, la première
    ligne est la séquence de référence (positions numérotées à partir de 1).
    `mask` : colonnes peu fiables exclues (sans décaler la numérotation).
    """
    length = len(rows[0]) if rows else 0
    if len(rows) < 2 or length < min_separation + 1:
        raise ValueError("Alignement trop petit pour une analyse de coévolution.")
    if length > MAX_LENGTH:
        raise ValueError(f"Séquence trop longue pour la coévolution ({MAX_LENGTH} positions maximum).")

    codes = encode(rows)
    weights = sequence_weights(codes)
    neff = float(weights.sum())
    mi, gap_fraction = mutual_information(codes, weights)
    valid = gap_fraction <= MAX_GAP_FRACTION
    if mask is not None:
        valid &= ~np.asarray(mask, dtype=bool)
    scores = apc(mi, valid)

    i_idx, j_idx = np.triu_indices(length, k=min_separation)
    keep = valid[i_idx] & valid[j_idx]
    i_idx, j_idx = i_idx[keep], j_idx[keep]
    values = scores[i_idx, j_idx]
    mean, std = (float(values.mean()), float(values.std())) if len(values) else (0.0, 0.0)
    order = np.argsort(-values)[:max_pairs]

    pairs = [
        {
            "i": int(i_idx[k]) + 1,
            "j": int(j_idx[k]) + 1,
            "score": round(float(values[k]), 4),
            "z": round((float(values[k]) - mean) / std, 2) if std > 0 else 0.0,
        }
        for k in order
    ]
    return {
        "method": "Information mutuelle pondérée + correction APC (Dunn et al., 2008)",
        "sequence_count": len(rows),
        "neff": round(neff, 1),
        "length": length,
        "valid_columns": int(valid.sum()),
        "min_separation": min_separation,
        "reliability": reliability(neff, length),
        "parameters": {
            "identity_threshold": IDENTITY_THRESHOLD,
            "pseudocount": PSEUDOCOUNT,
            "max_gap_fraction": MAX_GAP_FRACTION,
            "min_separation": min_separation,
            "masked_columns": int(np.sum(mask)) if mask is not None else 0,
            "states": STATES,
        },
        "distribution": score_distribution(values, mean, std),
        "pairs": pairs,
    }


def score_distribution(values: np.ndarray, mean: float, std: float, bins: int = 40) -> dict:
    """Histogramme des scores z de toutes les paires évaluées (sélection : seuil et rang)."""
    if not len(values) or std <= 0:
        return {"pairs": int(len(values)), "mean": mean, "std": std, "edges": [], "counts": []}
    z = (values - mean) / std
    upper = max(float(z.max()), 4.0)
    counts, edges = np.histogram(z, bins=bins, range=(float(z.min()), upper))
    return {
        "pairs": int(len(values)),
        "mean": round(mean, 5),
        "std": round(std, 5),
        "edges": [round(float(e), 2) for e in edges],
        "counts": counts.tolist(),
        "above_z3": int(np.sum(z >= 3)),
        "above_z5": int(np.sum(z >= 5)),
    }
