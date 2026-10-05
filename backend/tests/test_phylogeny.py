"""Arbre phylogénétique : distances, Neighbor-Joining, racine, bootstrap."""

import random

import numpy as np

from app.services import phylogeny_service as ps

# Exemple classique (Saitou & Nei ; arbre additif a,b | c | d,e)
NAMES = "abcde"
MATRIX = np.array(
    [
        [0, 5, 9, 9, 8],
        [5, 0, 10, 10, 9],
        [9, 10, 0, 8, 7],
        [9, 10, 8, 0, 3],
        [8, 9, 7, 3, 0],
    ],
    dtype=float,
)


def _mask(*names):
    return sum(1 << NAMES.index(n) for n in names)


def test_nj_recovers_additive_tree():
    edges = ps.neighbor_joining(MATRIX)
    # Bipartitions attendues (côté sans la feuille a) : {c,d,e} et {d,e}
    assert ps.splits(edges, 5) == {_mask("c", "d", "e"), _mask("d", "e")}
    leaf_lengths = {b: round(l, 6) for a, b, l in edges if b < 5}
    leaf_lengths |= {a: round(l, 6) for a, b, l in edges if a < 5 and b >= 5}
    assert leaf_lengths == {0: 2, 1: 3, 2: 4, 3: 2, 4: 1}
    assert all(l >= 0 for _, _, l in edges)


def test_midpoint_root_is_balanced():
    root = ps.midpoint_root(ps.neighbor_joining(MATRIX), 5)

    def depths(node, acc=0.0):
        acc += node["length"]
        if "leaf" in node:
            return {node["leaf"]: acc}
        out = {}
        for child in node["children"]:
            out |= depths(child, acc)
        return out

    d = depths(root)
    assert len(d) == 5
    # Le plus long chemin entre feuilles (b–c = 10) est coupé en son milieu
    assert abs(max(d.values()) - MATRIX[1, 2] / 2) < 1e-6
    left, right = root["children"]
    assert len(root["children"]) == 2 and left["length"] >= 0 and right["length"] >= 0


def test_kimura_distances():
    onehot, present = ps._encode(["ACDEFGHIKLMNPQRSTVWY" * 2, "ACDEFGHIKLMNPQRSTVWY" * 2, "A" * 40])
    d = ps.kimura_distances(onehot, present)
    assert d[0, 1] == 0 and np.allclose(d, d.T)
    assert d[0, 2] == ps.MAX_DISTANCE  # p = 0,95 : au-delà de la correction


def test_kimura_ignores_gaps_and_short_overlaps():
    a = "ACDEFGHIKLMNPQRSTVWY" * 2
    b = a[:30] + "-" * 10
    c = "-" * 30 + a[30:]
    onehot, present = ps._encode([a, b, c])
    d = ps.kimura_distances(onehot, present)
    assert d[0, 1] == 0  # gaps ignorés
    assert d[0, 2] == ps.MAX_DISTANCE  # 10 positions communes seulement


def _family(n=12, length=200, seed=0):
    rng = random.Random(seed)
    aa = "ACDEFGHIKLMNPQRSTVWY"
    query = "".join(rng.choice(aa) for _ in range(length))
    # Deux clades nets : mutations communes à chaque clade
    clade_a = "".join(c if rng.random() > 0.25 else rng.choice(aa) for c in query)
    clade_b = "".join(c if rng.random() > 0.25 else rng.choice(aa) for c in query)
    msa = []
    for i in range(n):
        base = clade_a if i < n // 2 else clade_b
        row = "".join(c if rng.random() > 0.05 else rng.choice(aa) for c in base)
        msa.append({"accession": f"S{i}", "organism": f"Species {i} (common)", "row": row})
    return query, msa


def test_build_tree(monkeypatch):
    monkeypatch.setattr(ps, "fetch_lineages", lambda ids: {})
    query, msa = _family()
    tree = ps.build_tree(query, {"id": "Q1"}, msa, [], replicates=30)
    assert tree["leaf_count"] == 13
    assert tree["leaves"][0]["is_query"]
    newick = tree["newick"]
    assert newick.endswith(";") and newick.count("(") == newick.count(")")
    assert "Species_3:" in newick or "S3_Species_3:" in newick

    supports = []

    def walk(node):
        if node.get("support") is not None:
            supports.append(node["support"])
        for child in node.get("children", []):
            walk(child)

    walk(tree["root"])
    assert supports and all(0 <= s <= 1 for s in supports)
    # Les deux clades simulés sont retrouvés avec un fort soutien
    assert max(supports) >= 0.9


def test_build_tree_needs_four_sequences(monkeypatch):
    monkeypatch.setattr(ps, "fetch_lineages", lambda ids: {})
    query, msa = _family(n=2)
    assert ps.build_tree(query, {"id": "Q1"}, msa, []) is None


def test_identical_sequences_do_not_crash(monkeypatch):
    monkeypatch.setattr(ps, "fetch_lineages", lambda ids: {})
    query = "ACDEFGHIKLMNPQRSTVWY" * 3
    msa = [{"accession": f"S{i}", "organism": None, "row": query} for i in range(4)]
    tree = ps.build_tree(query, {"id": "Q1"}, msa, [], replicates=5)
    assert tree["leaf_count"] == 5


def test_choose_rank():
    lineages = [
        {"domain": "Eukaryota", "class": "Mammalia", "order": "Primates"},
        {"domain": "Eukaryota", "class": "Mammalia", "order": "Rodentia"},
        {"domain": "Eukaryota", "class": "Aves", "order": "Passeriformes"},
        None,
    ]
    assert ps.choose_rank(lineages) == ("order", "Ordre")
    assert ps.choose_rank([{"domain": "Bacteria"}]) == ("domain", "Domaine")
    assert ps.choose_rank([None]) is None
