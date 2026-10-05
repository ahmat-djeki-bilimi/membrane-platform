"""
Arbre phylogénétique des homologues à partir de l'alignement multiple.

1. Distances entre séquences : proportion de résidus différents sur les
   positions alignées des deux côtés (gaps exclus), corrigée par la formule de
   Kimura (1983) pour les protéines : d = -ln(1 - p - 0,2 p²).
2. Arbre par Neighbor-Joining (Saitou & Nei, 1987), enraciné au point médian.
3. Robustesse des branches par bootstrap (Felsenstein, 1985) : les colonnes de
   l'alignement sont rééchantillonnées, l'arbre est reconstruit, et chaque
   branche reçoit la fraction des réplicats qui la retrouvent.
4. Groupes taxonomiques (lignées UniProt) pour colorer les espèces.
"""

import re

import numpy as np

from app import http

TAXONOMY_SEARCH = "https://rest.uniprot.org/taxonomy/search"

AMINO_ACIDS = "ACDEFGHIKLMNPQRSTVWY"
_INDEX = {a: i for i, a in enumerate(AMINO_ACIDS)}

MIN_SEQUENCES = 4
MIN_OVERLAP = 20
# Distance attribuée aux paires trop divergentes ou trop peu recouvrantes
MAX_DISTANCE = 3.0
BOOTSTRAP_REPLICATES = 100
MAX_GROUPS = 8

RANKS = [
    ("domain", "Domaine"),
    ("kingdom", "Règne"),
    ("phylum", "Embranchement"),
    ("class", "Classe"),
    ("order", "Ordre"),
    ("family", "Famille"),
]


# ---------------------------------------------------------------------------
# Distances
# ---------------------------------------------------------------------------

def _encode(rows: list[str]) -> tuple[np.ndarray, np.ndarray]:
    """Codage one-hot (n, L, 20) et masque des positions alignées (n, L)."""
    n, length = len(rows), len(rows[0])
    codes = np.full((n, length), -1, dtype=np.int16)
    for i, row in enumerate(rows):
        codes[i] = [_INDEX.get(c, -1) for c in row]
    present = codes >= 0
    onehot = np.zeros((n, length, len(AMINO_ACIDS)), dtype=np.float32)
    rows_idx, cols_idx = np.nonzero(present)
    onehot[rows_idx, cols_idx, codes[rows_idx, cols_idx]] = 1.0
    return onehot, present.astype(np.float32)


def kimura_distances(onehot: np.ndarray, present: np.ndarray, weights: np.ndarray | None = None) -> np.ndarray:
    """Matrice des distances de Kimura, colonnes éventuellement pondérées (bootstrap)."""
    n, length, _ = onehot.shape
    w = np.ones(length, dtype=np.float32) if weights is None else weights.astype(np.float32)
    flat = (onehot * w[None, :, None]).reshape(n, -1)
    identical = flat @ onehot.reshape(n, -1).T
    overlap = (present * w[None, :]) @ present.T

    with np.errstate(divide="ignore", invalid="ignore"):
        p = 1.0 - identical / overlap
        argument = 1.0 - p - 0.2 * p * p
        d = -np.log(argument)
    d = np.where((overlap < MIN_OVERLAP) | ~np.isfinite(d) | (argument <= 0), MAX_DISTANCE, d)
    d = np.minimum(d, MAX_DISTANCE)
    np.fill_diagonal(d, 0.0)
    return d.astype(np.float64)


# ---------------------------------------------------------------------------
# Neighbor-Joining
# ---------------------------------------------------------------------------

def neighbor_joining(distances: np.ndarray) -> list[tuple[int, int, float]]:
    """Arbre non raciné : arêtes (nœud, nœud, longueur). Feuilles 0..n-1."""
    n = len(distances)
    d = distances.copy()
    active = list(range(n))
    edges: list[tuple[int, int, float]] = []
    next_id = n

    while len(active) > 2:
        m = len(active)
        r = d.sum(axis=1)
        q = (m - 2) * d - r[:, None] - r[None, :]
        np.fill_diagonal(q, np.inf)
        i, j = np.unravel_index(np.argmin(q), q.shape)
        if i > j:
            i, j = j, i

        li = 0.5 * d[i, j] + (r[i] - r[j]) / (2 * (m - 2))
        li = min(max(li, 0.0), d[i, j])
        lj = max(d[i, j] - li, 0.0)
        u = next_id
        next_id += 1
        edges.append((u, active[i], li))
        edges.append((u, active[j], lj))

        new_row = np.maximum(0.5 * (d[i] + d[j] - d[i, j]), 0.0)
        d[i, :] = new_row
        d[:, i] = new_row
        d[i, i] = 0.0
        d = np.delete(np.delete(d, j, axis=0), j, axis=1)
        active[i] = u
        del active[j]

    edges.append((active[0], active[1], max(float(d[0, 1]), 0.0)))
    return edges


def _adjacency(edges):
    adjacency: dict[int, list[tuple[int, float]]] = {}
    for a, b, length in edges:
        adjacency.setdefault(a, []).append((b, length))
        adjacency.setdefault(b, []).append((a, length))
    return adjacency


def splits(edges, n_leaves: int) -> set[int]:
    """Bipartitions de l'arbre (masques de feuilles, côté sans la feuille 0)."""
    adjacency = _adjacency(edges)
    result: set[int] = set()

    def visit(node, parent):
        if node < n_leaves and parent is not None:
            return 1 << node
        mask = 1 << node if node < n_leaves else 0
        for child, _ in adjacency[node]:
            if child != parent:
                child_mask = visit(child, node)
                if child >= n_leaves and 1 < bin(child_mask).count("1") < n_leaves - 1:
                    result.add(child_mask)
                mask |= child_mask
        return mask

    visit(0, None)
    return result


# ---------------------------------------------------------------------------
# Enracinement et sortie
# ---------------------------------------------------------------------------

def _farthest(adjacency, start, n_leaves):
    best, best_distance, previous = start, 0.0, {start: None}
    stack = [(start, 0.0)]
    distance = {start: 0.0}
    while stack:
        node, dist = stack.pop()
        if node < n_leaves and dist > best_distance:
            best, best_distance = node, dist
        for neighbor, length in adjacency[node]:
            if neighbor not in distance:
                distance[neighbor] = dist + length
                previous[neighbor] = node
                stack.append((neighbor, dist + length))
    return best, best_distance, previous


def midpoint_root(edges, n_leaves: int) -> dict:
    """Arbre raciné au milieu du plus long chemin entre deux feuilles."""
    adjacency = _adjacency(edges)
    a, _, _ = _farthest(adjacency, 0, n_leaves)
    b, total, previous = _farthest(adjacency, a, n_leaves)

    path = [b]
    while previous[path[-1]] is not None:
        path.append(previous[path[-1]])
    path.reverse()  # a -> b

    half, travelled = total / 2, 0.0
    lengths = {(x, y): l for x, y, l in edges} | {(y, x): l for x, y, l in edges}
    for x, y in zip(path, path[1:]):
        length = lengths[(x, y)]
        if travelled + length >= half:
            offset = half - travelled
            left, right = (x, offset), (y, length - offset)
            break
        travelled += length
    else:  # séquences toutes identiques : racine sur la première arête
        x, length = adjacency[path[0]][0]
        left, right = (path[0], 0.0), (x, length)

    def build(node, parent, length):
        children = [build(c, node, l) for c, l in adjacency[node] if c != parent]
        if node < n_leaves:
            return {"leaf": node, "length": length}
        return {"length": length, "children": children}

    return {
        "length": 0.0,
        "children": [build(left[0], right[0], left[1]), build(right[0], left[0], right[1])],
    }


def _annotate(node: dict, supports: dict[int, float], n_leaves: int) -> int:
    """Masque des feuilles de chaque nœud, support bootstrap et ordre « en échelle »."""
    if "leaf" in node:
        node["size"] = 1
        return 1 << node["leaf"]
    masks = [_annotate(child, supports, n_leaves) for child in node["children"]]
    node["children"].sort(key=lambda c: c["size"])
    node["size"] = sum(c["size"] for c in node["children"])
    mask = 0
    for m in masks:
        mask |= m
    full = (1 << n_leaves) - 1
    split = mask if not mask & 1 else full & ~mask
    if 1 < bin(split).count("1") < n_leaves - 1:
        node["support"] = supports.get(split)
    return mask


def _label(text: str) -> str:
    """Étiquette Newick : nom scientifique sans nom commun ni caractères réservés."""
    text = (text or "").split(" (")[0]
    return re.sub(r"\s+", "_", re.sub(r"[(),:;\[\]'/]", "", text)).strip("_") or "seq"


def to_newick(node: dict, leaves: list[dict]) -> str:
    def render(n):
        if "leaf" in n:
            leaf = leaves[n["leaf"]]
            name = _label(f"{leaf['id']}_{leaf.get('organism') or ''}")
            return f"{name}:{n['length']:.5f}"
        inner = ",".join(render(c) for c in n["children"])
        support = n.get("support")
        label = f"{round(support * 100)}" if support is not None else ""
        return f"({inner}){label}:{n['length']:.5f}"

    inner = ",".join(render(c) for c in node["children"])
    return f"({inner});"


# ---------------------------------------------------------------------------
# Taxonomie
# ---------------------------------------------------------------------------

def fetch_lineages(taxon_ids: list[int]) -> dict[int, dict[str, str]]:
    """Rangs taxonomiques (domaine … famille) de chaque espèce, via UniProt."""
    wanted = {rank for rank, _ in RANKS}
    lineages: dict[int, dict[str, str]] = {}
    ids = sorted({t for t in taxon_ids if t})
    for start in range(0, len(ids), 100):
        batch = ids[start:start + 100]
        try:
            response = http.get(
                TAXONOMY_SEARCH,
                params={
                    "query": " OR ".join(f"tax_id:{t}" for t in batch),
                    "fields": "id,scientific_name,lineage",
                    "size": 500,
                },
            )
            response.raise_for_status()
        except Exception:
            continue
        for item in response.json().get("results", []):
            lineages[item["taxonId"]] = {
                step["rank"]: step["scientificName"]
                for step in item.get("lineage") or []
                if step.get("rank") in wanted
            }
    return lineages


def choose_rank(lineages: list[dict[str, str] | None]) -> tuple[str, str] | None:
    """Rang le plus fin qui sépare les espèces en 2 à 8 groupes."""
    known = [l for l in lineages if l]
    chosen = None
    for rank, label in RANKS:
        groups = {l.get(rank) for l in known if l.get(rank)}
        if 2 <= len(groups) <= MAX_GROUPS:
            chosen = (rank, label)
        elif len(groups) > MAX_GROUPS:
            break
    if chosen is None and known:
        chosen = RANKS[0]
    return chosen


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------

def build_tree(
    query_row: str,
    query_info: dict,
    msa: list[dict],
    homologs: list[dict],
    replicates: int = BOOTSTRAP_REPLICATES,
    seed: int = 1,
) -> dict | None:
    """
    Arbre Neighbor-Joining de la séquence étudiée et des homologues affichés
    dans l'alignement. `msa` : lignes {accession, organism, row}.
    """
    if len(msa) + 1 < MIN_SEQUENCES:
        return None

    by_accession = {h["accession"]: h for h in homologs}
    leaves = [
        {
            "id": query_info.get("id") or "query",
            "organism": query_info.get("organism"),
            "taxon_id": query_info.get("taxon_id"),
            "identity": 1.0,
            "is_query": True,
        }
    ]
    for line in msa:
        h = by_accession.get(line["accession"], {})
        leaves.append(
            {
                "id": line["accession"],
                "organism": h.get("organism") or line.get("organism"),
                "taxon_id": h.get("taxon_id"),
                "identity": h.get("identity"),
                "is_query": False,
            }
        )
    rows = [query_row] + [line["row"] for line in msa]
    n = len(rows)

    onehot, present = _encode(rows)
    distances = kimura_distances(onehot, present)
    edges = neighbor_joining(distances)

    # Bootstrap : colonnes tirées avec remise
    rng = np.random.default_rng(seed)
    length = len(query_row)
    counts: dict[int, int] = {}
    reference = splits(edges, n)
    for _ in range(replicates):
        weights = np.bincount(rng.integers(0, length, length), minlength=length)
        for split in splits(neighbor_joining(kimura_distances(onehot, present, weights)), n) & reference:
            counts[split] = counts.get(split, 0) + 1
    supports = {s: counts.get(s, 0) / replicates for s in reference} if replicates else {}

    root = midpoint_root(edges, n)
    _annotate(root, supports, n)

    # Groupes taxonomiques
    lineages = fetch_lineages([leaf["taxon_id"] for leaf in leaves])
    rank = choose_rank([lineages.get(leaf["taxon_id"]) for leaf in leaves])
    groups: dict[str, int] = {}
    for leaf in leaves:
        lineage = lineages.get(leaf["taxon_id"]) or {}
        leaf["lineage"] = lineage
        leaf["group"] = lineage.get(rank[0]) if rank else None
        if leaf["group"]:
            groups[leaf["group"]] = groups.get(leaf["group"], 0) + 1

    return {
        "method": "Distances de Kimura + Neighbor-Joining, racine au point médian",
        "bootstrap_replicates": replicates,
        "leaf_count": n,
        "max_distance": MAX_DISTANCE,
        "saturated_pairs": int(np.sum(np.triu(distances >= MAX_DISTANCE, 1))),
        "group_rank": rank[0] if rank else None,
        "group_rank_label": rank[1] if rank else None,
        "groups": [{"name": g, "count": c} for g, c in sorted(groups.items(), key=lambda kv: -kv[1])],
        "leaves": leaves,
        "root": root,
        "newick": to_newick(root, leaves),
    }
