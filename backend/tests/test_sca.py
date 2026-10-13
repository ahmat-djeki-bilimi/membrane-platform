"""Statistical Coupling Analysis : secteurs de positions qui coévoluent."""

import random

import numpy as np

from app.services import explorer_service as ex
from app.services.sca_service import compute_sca, independent_components

AA = "ACDEFGHIKLMNPQRSTVWY"
SECTOR = [10, 25, 40, 55, 70, 85]  # indices (positions 11, 26, 41, 56, 71, 86)


def family_with_sector(count: int = 400, length: int = 120, seed: int = 4) -> list[str]:
    """Positions variables au hasard ; celles du secteur basculent toutes ensemble (L ou K)."""
    rng = random.Random(seed)
    reference = [rng.choice(AA) for _ in range(length)]
    rows = ["".join(reference)]
    for _ in range(count):
        seq = list(reference)
        for k in range(length):
            if k not in SECTOR and rng.random() < 0.3:
                seq[k] = rng.choice(AA)
        state = "L" if rng.random() < 0.5 else "K"
        for k in SECTOR:
            seq[k] = state
        rows.append("".join(seq))
    return rows


def test_sca_recovers_planted_sector():
    result = compute_sca(family_with_sector())
    assert result["significant_modes"] >= 1
    assert result["eigenvalues"][0] > result["random_threshold"]
    planted = {k + 1 for k in SECTOR}
    best = max(result["sectors"], key=lambda s: len(planted & set(s["positions"])))
    assert planted <= set(best["positions"])
    # Les positions plantées ressortent bien plus que les autres
    top = sorted(best["weights"].items(), key=lambda kv: -kv[1])[:6]
    assert {p for p, _ in top} == planted


def test_ica_returns_orthogonal_components():
    rng = np.random.default_rng(0)
    vectors, _ = np.linalg.qr(rng.standard_normal((50, 3)))
    components = independent_components(vectors)
    assert components.shape == (50, 3)
    gram = components.T @ components
    assert np.allclose(gram, np.eye(3), atol=1e-6)


def test_compare_methods_counts_overlap():
    positions = [{"position": k, "residue": "A", "grade": 5 + (k % 3), "zone": "core" if k < 6 else "out"} for k in range(1, 11)]
    pairs = [{"i": 1, "j": 2}, {"i": 2, "j": 7}]
    sca = {"sectors": [{"id": 1, "positions": [1, 2, 3], "size": 3}, {"id": 2, "positions": [8, 9, 10], "size": 3}]}
    comparison = ex.compare_methods(positions, pairs, sca)
    assert comparison["mip_count"] == 3 and comparison["sca_count"] == 6
    assert [s["position"] for s in comparison["shared"]] == [1, 2]
    assert comparison["mip_only"] == 1 and comparison["sca_only"] == 4
    assert comparison["pairs_within_sector"] == 1
    assert comparison["jaccard"] == round(2 / 7, 2)
    assert comparison["zones"]["core"]["both"] == 2
