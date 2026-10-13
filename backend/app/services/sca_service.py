"""
Statistical Coupling Analysis (SCA) : secteurs de résidus qui coévoluent.

Là où l'information mutuelle cherche des paires de positions, la SCA cherche
des groupes (« secteurs ») de positions qui varient ensemble dans la famille :
souvent des réseaux physiquement connectés qui portent une fonction (site
actif, allostérie, changement de conformation). Méthode de Halabi et al.
(2009), dans sa version pySCA (Rivoire et al., 2016), simplifiée :

1. Poids des séquences (identité ≥ 80 %) et fréquences des 20 acides aminés,
   avec une petite pseudo-fréquence.
2. Poids de conservation φ de chaque acide aminé à chaque position (dérivée
   de l'entropie relative par rapport aux fréquences de fond) : les positions
   conservées comptent davantage.
3. Matrice SCA : corrélations pondérées φ_i φ_j (f_ij − f_i f_j), réduites à
   une valeur par paire de positions (norme sur les 20 × 20 acides aminés).
4. Modes significatifs : valeurs propres supérieures à celles d'alignements
   aléatoires de même conservation (colonnes tirées indépendamment).
5. Analyse en composantes indépendantes (ICA) des modes retenus ; chaque
   composante définit un groupe de positions (queue de sa distribution).
"""

import numpy as np

from app.services.coevolution_service import GAP, IDENTITY_THRESHOLD, MAX_GAP_FRACTION, encode, sequence_weights

AMINO = 20
PSEUDOCOUNT = 0.03
TRIALS = 5
MAX_COMPONENTS = 8
SECTOR_Z = 2.5  # écart robuste (médiane, MAD) au-delà duquel une position appartient au groupe
MIN_SECTOR_SIZE = 3
BLOCK = 16
# Fréquences de fond (BLOSUM62), ordre ACDEFGHIKLMNPQRSTVWY
BACKGROUND = np.array(
    [0.073, 0.025, 0.050, 0.061, 0.042, 0.072, 0.023, 0.053, 0.064, 0.089,
     0.023, 0.043, 0.052, 0.040, 0.052, 0.073, 0.056, 0.063, 0.013, 0.033]
)


def _onehot(codes: np.ndarray) -> np.ndarray:
    """Codage (n, L, 20) des acides aminés ; les gaps sont des lignes nulles."""
    n, length = codes.shape
    onehot = np.zeros((n, length, AMINO + 1), dtype=np.float32)
    onehot[np.arange(n)[:, None], np.arange(length)[None, :], codes] = 1.0
    return onehot[:, :, :AMINO]


def sca_matrix(onehot: np.ndarray, weights: np.ndarray, pseudocount: float = PSEUDOCOUNT) -> np.ndarray:
    """Matrice SCA positionnelle (L × L)."""
    n, length, _ = onehot.shape
    w = (weights / weights.sum()).astype(np.float32)
    fi = (1 - pseudocount) * np.einsum("n,nla->la", w, onehot) + pseudocount / (AMINO + 1)
    q = BACKGROUND / BACKGROUND.sum()
    phi = np.abs(np.log(fi * (1 - q) / ((1 - fi) * q))).astype(np.float32)

    flat = onehot.reshape(n, length * AMINO)
    matrix = np.zeros((length, length))
    for start in range(0, length, BLOCK):
        stop = min(start + BLOCK, length)
        size = stop - start
        joint = (flat[:, start * AMINO:stop * AMINO] * w[:, None]).T @ flat
        fij = (1 - pseudocount) * joint.reshape(size, AMINO, length, AMINO) + pseudocount / (AMINO + 1) ** 2
        cov = fij - fi[start:stop, :, None, None] * fi[None, None, :, :]
        weighted = phi[start:stop, :, None, None] * cov * phi[None, None, :, :]
        matrix[start:stop] = np.sqrt(np.einsum("aqlr,aqlr->al", weighted, weighted))
    return matrix


def random_alignment(codes: np.ndarray, weights: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Alignement aléatoire : chaque colonne tirée selon ses fréquences pondérées (corrélations détruites)."""
    n, length = codes.shape
    w = weights / weights.sum()
    random = np.empty_like(codes)
    for k in range(length):
        counts = np.bincount(codes[:, k], weights=w, minlength=AMINO + 1)
        random[:, k] = rng.choice(AMINO + 1, size=n, p=counts / counts.sum())
    return random


def _symmetric_decorrelation(w: np.ndarray) -> np.ndarray:
    values, vectors = np.linalg.eigh(w @ w.T)
    return vectors @ np.diag(1.0 / np.sqrt(np.maximum(values, 1e-12))) @ vectors.T @ w


def independent_components(vectors: np.ndarray, seed: int = 1, iterations: int = 500) -> np.ndarray:
    """
    ICA (FastICA symétrique, non-linéarité tanh) des modes propres retenus.
    `vectors` : L × k (colonnes orthonormées). Renvoie L × k.
    """
    length, k = vectors.shape
    if k == 1:
        return vectors.copy()
    x = vectors.T * np.sqrt(length)  # k × L, de covariance identité
    rng = np.random.default_rng(seed)
    w = _symmetric_decorrelation(rng.standard_normal((k, k)))
    for _ in range(iterations):
        g = np.tanh(w @ x)
        new = (g @ x.T) / length - np.diag((1 - g**2).mean(axis=1)) @ w
        new = _symmetric_decorrelation(new)
        converged = np.max(np.abs(np.abs(np.einsum("ij,ij->i", new, w)) - 1)) < 1e-6
        w = new
        if converged:
            break
    return (w @ x).T / np.sqrt(length)


def _robust_z(values: np.ndarray) -> np.ndarray:
    median = np.median(values)
    mad = np.median(np.abs(values - median)) * 1.4826
    return (values - median) / mad if mad > 0 else np.zeros_like(values)


def compute_sca(rows: list[str], trials: int = TRIALS, seed: int = 1) -> dict:
    """
    Secteurs SCA d'un alignement ancré (la première ligne est la référence,
    positions numérotées à partir de 1).
    """
    codes = encode(rows)
    n, length = codes.shape
    if n < 2 or length < 10:
        raise ValueError("Alignement trop petit pour une analyse SCA.")
    weights = sequence_weights(codes, IDENTITY_THRESHOLD)
    gap_fraction = ((codes == GAP) * weights[:, None]).sum(axis=0) / weights.sum()
    valid = gap_fraction <= MAX_GAP_FRACTION
    idx = np.flatnonzero(valid)
    if len(idx) < 10:
        raise ValueError("Trop de positions avec des gaps pour une analyse SCA.")

    matrix = sca_matrix(_onehot(codes[:, idx]), weights)
    eigenvalues, eigenvectors = np.linalg.eigh(matrix)
    order = np.argsort(eigenvalues)[::-1]
    eigenvalues, eigenvectors = eigenvalues[order], eigenvectors[:, order]

    # Seuil : deuxième valeur propre des alignements aléatoires (la première
    # reflète surtout la conservation), moyenne + 3 écarts-types (pySCA)
    rng = np.random.default_rng(seed)
    random_second = []
    trials = max(1, trials if len(idx) <= 800 else min(trials, 3))
    for _ in range(trials):
        random = random_alignment(codes[:, idx], weights, rng)
        # Mêmes poids que l'alignement réel : même nombre effectif de séquences, donc même bruit
        values = np.linalg.eigvalsh(sca_matrix(_onehot(random), weights))
        random_second.append(np.sort(values)[-2])
    threshold = float(np.mean(random_second) + 3 * np.std(random_second))
    significant = int(np.sum(eigenvalues > threshold))
    k = int(min(MAX_COMPONENTS, max(1, significant)))

    components = independent_components(eigenvectors[:, :k], seed=seed)
    z_scores = []
    for c in range(k):
        values = components[:, c]
        # Composante orientée vers sa queue la plus lourde
        if np.sum(values**3) < 0:
            values = -values
            components[:, c] = values
        z_scores.append(_robust_z(values))
    z_scores = np.array(z_scores)  # k × positions retenues

    # Chaque position rejoint au plus un groupe : celui où elle ressort le plus
    best = np.argmax(z_scores, axis=0)
    members: dict[int, list[int]] = {}
    for column, comp in enumerate(best):
        if z_scores[comp, column] >= SECTOR_Z:
            members.setdefault(int(comp), []).append(column)

    sectors = []
    for comp, columns in sorted(members.items(), key=lambda kv: -len(kv[1])):
        if len(columns) < MIN_SECTOR_SIZE:
            continue
        columns.sort(key=lambda c: -z_scores[comp, c])
        sectors.append(
            {
                "component": comp + 1,
                "positions": sorted(int(idx[c]) + 1 for c in columns),
                "weights": {int(idx[c]) + 1: round(float(z_scores[comp, c]), 2) for c in columns},
            }
        )
    for number, sector in enumerate(sectors, start=1):
        sector["id"] = number

    return {
        "method": "Statistical Coupling Analysis (Halabi et al., 2009 ; pySCA, Rivoire et al., 2016) + ICA",
        "sequence_count": n,
        "neff": round(float(weights.sum()), 1),
        "valid_columns": int(len(idx)),
        "eigenvalues": [round(float(v), 3) for v in eigenvalues[:20]],
        "random_threshold": round(threshold, 3),
        "significant_modes": significant,
        "components": k,
        "sectors": sectors,
    }
