"""
Stratégies de choix des séquences d'un arbre phylogénétique.

- closest : les homologues les plus proches de la référence (identité) ;
  arbre détaillé autour de la référence, mais peu représentatif de la famille.
- taxonomic : échantillonnage taxonomique représentatif ; les groupes
  d'organismes (au rang le plus fin qui en donne au plus autant que de
  séquences demandées) sont parcourus à tour de rôle, une espèce nouvelle
  à chaque passage.
- diversity : échantillonnage par diversité de séquence ; on ajoute à chaque
  fois la séquence la plus éloignée de toutes celles déjà retenues (« point
  le plus éloigné »), parmi les séquences qui couvrent assez la référence.
- custom : sélection de l'utilisateur.

Le choix est déterministe : mêmes données et mêmes réglages, mêmes séquences.
"""

import numpy as np

STRATEGIES = {
    "closest": {
        "label": "Homologues les plus proches",
        "text": "Les séquences les plus identiques à la référence : détail fin autour de la référence, mais la famille est mal représentée.",
    },
    "taxonomic": {
        "label": "Échantillonnage taxonomique représentatif",
        "text": "Les groupes d’organismes sont parcourus à tour de rôle (une espèce nouvelle à chaque passage) : la diversité des lignées est couverte.",
    },
    "diversity": {
        "label": "Échantillonnage par diversité de séquence",
        "text": "Chaque séquence ajoutée est la plus éloignée de celles déjà retenues : la diversité des séquences est couverte, les quasi-doublons évités.",
    },
    "custom": {
        "label": "Sélection personnalisée",
        "text": "Séquences choisies une à une par l’utilisateur.",
    },
}
RANKS = [("family", "Famille"), ("order", "Ordre"), ("class", "Classe"), ("phylum", "Embranchement"), ("kingdom", "Règne"), ("domain", "Domaine")]
MIN_DIVERSITY_COVERAGE = 0.6
MIN_OVERLAP = 30
_INDEX = {a: i for i, a in enumerate("ACDEFGHIKLMNPQRSTVWY")}


class SelectionError(ValueError):
    pass


def _species(h: dict) -> str:
    return str(h.get("taxon_id") or h.get("organism") or h["accession"])


def _closest(candidates: list[dict], count: int) -> tuple[list[str], dict]:
    chosen = sorted(candidates, key=lambda h: (-h.get("identity", 0), -h.get("coverage", 0), h["accession"]))[:count]
    return [h["accession"] for h in chosen], {}


def _taxonomic(candidates: list[dict], count: int) -> tuple[list[str], dict]:
    # Rang le plus fin qui donne au plus `count` groupes
    rank, label = "genus", "Genre"
    for name, title in RANKS:
        groups = {(h.get("lineage") or {}).get(name) for h in candidates}
        groups.discard(None)
        if 1 < len(groups) <= count:
            rank, label = name, title
            break

    def group_of(h: dict) -> str:
        value = (h.get("lineage") or {}).get(rank) if rank != "genus" else None
        if value:
            return value
        organism = (h.get("organism") or "").split()
        return f"{organism[0]} (non classé)" if organism else "Non classé"

    groups: dict[str, list[dict]] = {}
    # Représentant d’un groupe : une séquence qui couvre bien la référence (≥ 80 %), la plus proche d’abord
    for h in sorted(candidates, key=lambda h: (h.get("coverage", 0) < 0.8, -h.get("identity", 0), h["accession"])):
        groups.setdefault(group_of(h), []).append(h)
    order = sorted(groups, key=lambda g: (-len(groups[g]), g))
    chosen: list[str] = []
    seen_species: set[str] = set()
    taken: set[str] = set()
    # Passages successifs : une espèce nouvelle par groupe, puis toute séquence restante
    for allow_repeat_species in (False, True):
        progress = True
        while len(chosen) < count and progress:
            progress = False
            for g in order:
                if len(chosen) >= count:
                    break
                pick = next(
                    (h for h in groups[g] if h["accession"] not in taken and (allow_repeat_species or _species(h) not in seen_species)),
                    None,
                )
                if pick:
                    chosen.append(pick["accession"])
                    taken.add(pick["accession"])
                    seen_species.add(_species(pick))
                    progress = True
    covered = {group_of(h) for h in candidates if h["accession"] in taken}
    return chosen, {"rank": rank, "rank_label": label, "groups_available": len(groups), "groups_covered": len(covered)}


def _encode(rows: list[str]) -> np.ndarray:
    codes = np.full((len(rows), len(rows[0])), -1, dtype=np.int8)
    for k, row in enumerate(rows):
        codes[k] = [_INDEX.get(c, -1) for c in row]
    return codes


def _diversity(candidates: list[dict], rows: dict[str, str], query: str, count: int, mask: list[bool] | None) -> tuple[list[str], dict]:
    pool = [h for h in candidates if h.get("coverage", 0) >= MIN_DIVERSITY_COVERAGE]
    excluded = len(candidates) - len(pool)
    if len(pool) < count:
        pool, excluded = candidates, 0
    keep = [k for k in range(len(query)) if not (mask and mask[k])]
    sequences = [query] + [rows[h["accession"]] for h in pool]
    codes = _encode(["".join(s[k] for k in keep) for s in sequences])
    present = codes >= 0

    def distances_to(index: int) -> np.ndarray:
        both = present & present[index]
        overlap = both.sum(axis=1)
        same = ((codes == codes[index]) & both).sum(axis=1)
        distance = 1 - same / np.maximum(overlap, 1)
        # Trop peu de positions communes : distance inconnue, la séquence n'est pas favorisée
        return np.where(overlap >= MIN_OVERLAP, distance, 0.0)

    nearest = distances_to(0)  # la référence fait partie de l'arbre
    nearest[0] = -1
    chosen: list[int] = []
    # Distance de chaque séquence ajoutée à la plus proche des séquences déjà retenues
    gains: list[float] = []
    for _ in range(min(count, len(pool))):
        best = int(np.argmax(nearest))
        if nearest[best] < 0:
            break
        chosen.append(best)
        gains.append(float(nearest[best]))
        nearest = np.minimum(nearest, distances_to(best))
        nearest[[0, *chosen]] = -1
    return [pool[k - 1]["accession"] for k in chosen], {
        "min_coverage": MIN_DIVERSITY_COVERAGE if excluded else None,
        "excluded_low_coverage": excluded,
        "mean_nearest_distance": round(float(np.mean(gains)), 3) if gains else None,
        "last_nearest_distance": round(gains[-1], 3) if gains else None,
    }


def select_sequences(result: dict, strategy: str, count: int, ids: list[str] | None = None) -> dict:
    """Identifiants des homologues retenus pour l'arbre, avec la description de la stratégie."""
    if strategy not in STRATEGIES:
        raise SelectionError(f"Stratégie inconnue : {strategy}.")
    rows = {m["accession"]: m["row"] for m in result.get("msa", [])}
    homologs = {h["accession"]: h for h in result.get("homologs", [])}
    candidates = [homologs.get(a, {"accession": a}) | {"accession": a} for a in rows]
    if strategy == "custom":
        wanted = set(ids or [])
        chosen, details = [a for a in rows if a in wanted], {"requested": len(wanted)}
    elif strategy == "closest":
        chosen, details = _closest(candidates, count)
    elif strategy == "taxonomic":
        chosen, details = _taxonomic(candidates, count)
    else:
        mask = ((result.get("qc") or {}).get("columns") or {}).get("masked")
        chosen, details = _diversity(candidates, rows, result["query_sequence"], count, mask)

    identities = [homologs[a].get("identity") for a in chosen if a in homologs and homologs[a].get("identity") is not None]
    species = {_species(homologs.get(a, {"accession": a})) for a in chosen}
    return {
        "strategy": strategy,
        **STRATEGIES[strategy],
        "requested": count if strategy != "custom" else len(ids or []),
        "ids": chosen,
        "available": len(rows),
        "species": len(species),
        "identity_range": [round(min(identities), 3), round(max(identities), 3)] if identities else None,
        "details": details,
    }
