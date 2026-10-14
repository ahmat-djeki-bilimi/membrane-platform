"""
Analyse structurale d'un modèle AlphaFold (protéines sans structure PDB).

1. Correspondance séquence : chaque résidu du modèle est comparé à la
   séquence UniProt actuelle (numérotation identique attendue) et à la
   séquence sur laquelle le modèle a été calculé.
2. Confiance : pLDDT par résidu (colonne B-factor), régions peu fiables.
3. Géométrie : angles φ/ψ (Ramachandran), structures secondaires déduites de
   ces angles, rayon de giration.
4. Contacts : paires de résidus dont les Cβ (Cα pour la glycine) sont à moins
   de 8 Å, séparées d'au moins 6 positions dans la séquence.
5. Poches potentielles : méthode de grille dans l'esprit de LIGSITE
   (Hendlich et al., 1997) : points de grille vides entourés de protéine
   dans la plupart des 14 directions, regroupés en poches.
6. Sites UniProt (site actif, liaison, site) classés selon leur preuve :
   seuls ceux qui ont une preuve expérimentale sont dits « confirmés ».
   Une poche détectée n'est jamais présentée comme un site actif.
"""

import math
from collections import deque

import numpy as np

from app.cache import cached, is_successful
from app.services import uniprot_service
from app.services.alphafold_service import get_alphafold
from app.services.membrane_embedding_service import THREE_TO_ONE
from app.services.structure_comparison_service import fetch_alphafold_pdb
from app.services.structure_quality_service import (
    _compute_ramachandran_points,
    _group_residues,
    _parse_atoms,
    _summarize_ramachandran,
)
from app.services.topology_comparison_service import EVIDENCE_LABELS, evidence_of

CONFIDENT = 70.0
VERY_LOW = 50.0
CONTACT_DISTANCE = 8.0
MIN_SEPARATION = 6
LONG_RANGE = 24

# Poches
GRID_SPACING = 1.0
MAX_GRID_POINTS = 6_000_000
EMPTY_RADIUS = 3.0  # Å : aucun atome lourd plus près (sonde ≈ 1,4 Å + rayon atomique)
SOLID_RADIUS = 1.8  # Å : point considéré comme dans la protéine pour les rayons
RAY_LENGTH = 8.0  # Å
MIN_BURIED = 11  # rayons (sur 14) qui rencontrent la protéine
MIN_POCKET_POINTS = 15
LINING_RADIUS = 4.5
MAX_POCKETS = 10
# 7 axes de LIGSITE : 3 axes du repère et 4 diagonales du cube, dans les deux sens
RAY_AXES = [(1, 0, 0), (0, 1, 0), (0, 0, 1), (1, 1, 1), (1, 1, -1), (1, -1, 1), (-1, 1, 1)]

HYDROPHOBIC = set("AVILMFWC")
CHARGED = set("DEKR")
SITE_TYPES = {"Active site": "Site actif", "Binding site": "Site de liaison", "Site": "Site"}
# Résidus modifiés retenus comme sites : attache covalente d'un cofacteur (pas les phosphorylations…)
COFACTOR_ATTACHMENT = ("retinylidene", "pyridoxal", "heme", "flavin", "fad", "fmn", "biotin", "lipoyl", "phosphopantetheine", "chlorophyll", "bilin")
CONFIRMED_EVIDENCE = {"experimental", "structure"}


# ---------------------------------------------------------------------------
# Lecture du modèle
# ---------------------------------------------------------------------------

def model_residues(pdb_text: str) -> tuple[list[dict], list[dict]]:
    """Atomes lourds et résidus de la première chaîne (avec pLDDT du Cα)."""
    atoms = _parse_atoms(pdb_text)
    plddt: dict[tuple[str, int], float] = {}
    for line in pdb_text.splitlines():
        if line.startswith("ATOM") and line[12:16].strip() == "CA":
            try:
                plddt[(line[21].strip() or "A", int(line[22:26]))] = float(line[60:66])
            except ValueError:
                continue
    chains = _group_residues(atoms)
    if not chains:
        return [], []
    chain_id = next(iter(chains))
    residues = chains[chain_id]
    for r in residues:
        r["aa"] = THREE_TO_ONE.get(r["resn"], "X")
        r["plddt"] = plddt.get((chain_id, r["resi"]))
    return [a for a in atoms if a["chain"] == chain_id], residues


# ---------------------------------------------------------------------------
# 1. Correspondance avec UniProt
# ---------------------------------------------------------------------------

def check_mapping(residues: list[dict], uniprot_sequence: str | None, model_sequence: str | None) -> dict:
    """Le résidu n du modèle est-il le résidu n de la séquence UniProt ?"""
    mismatches, outside = [], []
    reference = uniprot_sequence or model_sequence or ""
    for r in residues:
        n = r["resi"]
        if n < 1 or n > len(reference):
            outside.append(n)
        elif reference[n - 1] != r["aa"]:
            mismatches.append({"position": n, "model": r["aa"], "uniprot": reference[n - 1]})
    numbers = [r["resi"] for r in residues]
    gaps = sum(1 for a, b in zip(numbers, numbers[1:]) if b != a + 1)
    version_changed = bool(uniprot_sequence and model_sequence and uniprot_sequence != model_sequence)
    exact = not mismatches and not outside and not version_changed and len(residues) == len(reference)
    if exact:
        status, text = "exacte", "Chaque résidu du modèle porte le numéro et l’acide aminé de la séquence UniProt."
    elif version_changed:
        status, text = "version", "Le modèle a été calculé sur une autre version de la séquence UniProt : vérifiez les positions avant de les reporter."
    elif mismatches or outside:
        status, text = "differences", f"{len(mismatches) + len(outside)} résidu(s) du modèle ne correspondent pas à la séquence UniProt."
    else:
        status, text = "partielle", f"Le modèle couvre {len(residues)} des {len(reference)} résidus de la séquence."
    return {
        "status": status,
        "text": text,
        "model_residues": len(residues),
        "uniprot_length": len(uniprot_sequence) if uniprot_sequence else None,
        "model_sequence_length": len(model_sequence) if model_sequence else None,
        "first": numbers[0] if numbers else None,
        "last": numbers[-1] if numbers else None,
        "numbering_gaps": gaps,
        "identical": len(residues) - len(mismatches) - len(outside),
        "mismatches": mismatches[:50],
        "outside": outside[:50],
        "version_changed": version_changed,
        "checked_against": "UniProt (version actuelle)" if uniprot_sequence else "séquence du modèle AlphaFold",
    }


# ---------------------------------------------------------------------------
# 2. Confiance
# ---------------------------------------------------------------------------

def _runs(numbers: list[int], min_length: int) -> list[dict]:
    runs: list[list[int]] = []
    for n in numbers:
        if runs and n == runs[-1][-1] + 1:
            runs[-1].append(n)
        else:
            runs.append([n])
    return [{"start": r[0], "end": r[-1], "length": len(r)} for r in runs if len(r) >= min_length]


def confidence_summary(residues: list[dict]) -> dict:
    values = [r["plddt"] for r in residues if r["plddt"] is not None]
    if not values:
        return {"mean_plddt": None, "bands": {}, "low_regions": [], "per_residue": []}
    n = len(values)
    bands = {
        "very_high": round(sum(v > 90 for v in values) / n, 3),
        "confident": round(sum(CONFIDENT <= v <= 90 for v in values) / n, 3),
        "low": round(sum(VERY_LOW <= v < CONFIDENT for v in values) / n, 3),
        "very_low": round(sum(v < VERY_LOW for v in values) / n, 3),
    }
    low = [r["resi"] for r in residues if r["plddt"] is not None and r["plddt"] < CONFIDENT]
    return {
        "mean_plddt": round(sum(values) / n, 1),
        "bands": bands,
        # Régions peu fiables : souvent désordonnées ou mobiles, à ne pas interpréter géométriquement
        "low_regions": _runs(low, 5),
        "per_residue": [[r["resi"], round(r["plddt"], 1)] for r in residues if r["plddt"] is not None],
    }


# ---------------------------------------------------------------------------
# 3. Géométrie
# ---------------------------------------------------------------------------

def _secondary(phi: float, psi: float) -> str:
    if -100 <= phi <= -30 and -80 <= psi <= -10:
        return "H"
    if phi <= -60 and (psi >= 90 or psi <= -150):
        return "E"
    return "C"


def geometry_summary(residues: list[dict], chain: str) -> dict:
    points = _compute_ramachandran_points({chain: residues})
    plddt = {r["resi"]: r["plddt"] for r in residues}
    confident_points = [p for p in points if (plddt.get(p["resi"]) or 0) >= CONFIDENT]
    states = {p["resi"]: _secondary(p["phi"], p["psi"]) for p in points}

    # Hélices (≥ 4 résidus consécutifs) et brins (≥ 3)
    assigned: dict[int, str] = {}
    for kind, minimum in (("H", 4), ("E", 3)):
        for run in _runs(sorted(n for n, s in states.items() if s == kind), minimum):
            for n in range(run["start"], run["end"] + 1):
                assigned[n] = kind
    total = max(len(residues), 1)
    ca = np.array([r["atoms"]["CA"] for r in residues if "CA" in r["atoms"]])
    rg = float(np.sqrt(((ca - ca.mean(axis=0)) ** 2).sum(axis=1).mean())) if len(ca) else None
    outliers = [p for p in confident_points if p["status"] == "outlier"]
    return {
        "ramachandran": _summarize_ramachandran(points),
        "ramachandran_confident": _summarize_ramachandran(confident_points),
        "outliers_confident": [{"resi": p["resi"], "resn": p["resn"], "phi": p["phi"], "psi": p["psi"]} for p in outliers[:50]],
        "helix_fraction": round(sum(1 for s in assigned.values() if s == "H") / total, 3),
        "strand_fraction": round(sum(1 for s in assigned.values() if s == "E") / total, 3),
        "secondary": "".join(assigned.get(r["resi"], "C") for r in residues),
        "radius_of_gyration": round(rg, 1) if rg is not None else None,
        # Rg attendu pour une protéine globulaire compacte : 2,2 N^0,38 Å
        "expected_globular_rg": round(2.2 * len(residues) ** 0.38, 1) if residues else None,
    }


# ---------------------------------------------------------------------------
# 4. Contacts
# ---------------------------------------------------------------------------

def _beta_carbons(residues: list[dict]) -> tuple[list[int], np.ndarray]:
    numbers, coords = [], []
    for r in residues:
        point = r["atoms"].get("CB") or r["atoms"].get("CA")
        if point is not None:
            numbers.append(r["resi"])
            coords.append(point)
    return numbers, np.array(coords, dtype=np.float32)


def contact_summary(residues: list[dict]) -> dict:
    numbers, cb = _beta_carbons(residues)
    plddt = {r["resi"]: r["plddt"] or 0.0 for r in residues}
    if len(numbers) < 2:
        return {"pairs": [], "total": 0}
    # |a − b|² = |a|² + |b|² − 2 a·b : pas de tableau n × n × 3 pour les longues protéines
    squared = (cb ** 2).sum(axis=1)
    distances = np.sqrt(np.maximum(squared[:, None] + squared[None, :] - 2 * cb @ cb.T, 0))
    index = np.array(numbers)
    i_idx, j_idx = np.nonzero(np.triu(distances < CONTACT_DISTANCE, k=1))
    keep = (index[j_idx] - index[i_idx]) >= MIN_SEPARATION
    i_idx, j_idx = i_idx[keep], j_idx[keep]
    pairs = []
    for a, b in zip(i_idx.tolist(), j_idx.tolist()):
        i, j = numbers[a], numbers[b]
        pairs.append([i, j, round(min(plddt[i], plddt[j]))])
    degree: dict[int, int] = {}
    for i, j, _ in pairs:
        degree[i] = degree.get(i, 0) + 1
        degree[j] = degree.get(j, 0) + 1
    separations = [j - i for i, j, _ in pairs]
    confident = [p for p in pairs if p[2] >= CONFIDENT]
    return {
        "cutoff": CONTACT_DISTANCE,
        "min_separation": MIN_SEPARATION,
        "total": len(pairs),
        "long_range": sum(1 for s in separations if s >= LONG_RANGE),
        "confident": len(confident),
        "per_residue": round(len(pairs) * 2 / len(numbers), 2),
        # Ordre de contact relatif (Plaxco et al., 1998)
        "relative_contact_order": round(sum(separations) / (len(pairs) * len(numbers)), 3) if pairs else None,
        "most_connected": [{"resi": n, "contacts": c} for n, c in sorted(degree.items(), key=lambda kv: -kv[1])[:10]],
        "pairs": pairs,
    }


# ---------------------------------------------------------------------------
# 5. Poches potentielles
# ---------------------------------------------------------------------------

def _offsets(radius: float, spacing: float) -> np.ndarray:
    r = int(math.ceil(radius / spacing))
    grid = np.mgrid[-r:r + 1, -r:r + 1, -r:r + 1].reshape(3, -1).T
    return grid[(grid ** 2).sum(axis=1) * spacing ** 2 <= radius ** 2]


def _stamp(shape, cells: np.ndarray, radius: float, spacing: float) -> np.ndarray:
    grid = np.zeros(shape, dtype=bool)
    offsets = _offsets(radius, spacing)
    limit = np.array(shape) - 1
    for start in range(0, len(cells), 1500):
        points = (cells[start:start + 1500, None, :] + offsets[None, :, :]).reshape(-1, 3)
        points = np.clip(points, 0, limit)
        grid[points[:, 0], points[:, 1], points[:, 2]] = True
    return grid


def _shift(array: np.ndarray, step: tuple[int, int, int]) -> np.ndarray:
    """out[x] = array[x + step], faux au-delà des bords."""
    out = np.zeros_like(array)
    src, dst = [], []
    for s, n in zip(step, array.shape):
        if s >= 0:
            src.append(slice(s, n))
            dst.append(slice(0, n - s))
        else:
            src.append(slice(0, n + s))
            dst.append(slice(-s, n))
    out[tuple(dst)] = array[tuple(src)]
    return out


def _components(mask: np.ndarray) -> list[np.ndarray]:
    """Groupes de points voisins (6-connexité)."""
    remaining = set(map(tuple, np.argwhere(mask).tolist()))
    groups = []
    while remaining:
        seed = remaining.pop()
        queue, group = deque([seed]), [seed]
        while queue:
            x, y, z = queue.popleft()
            for dx, dy, dz in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
                neighbour = (x + dx, y + dy, z + dz)
                if neighbour in remaining:
                    remaining.discard(neighbour)
                    queue.append(neighbour)
                    group.append(neighbour)
        groups.append(np.array(group))
    return groups


def detect_pockets(atoms: list[dict], residues: list[dict], tm_segments: list[dict] | None = None) -> dict:
    """Poches potentielles du modèle (géométrie seule)."""
    coords = np.array([a["coord"] for a in atoms], dtype=np.float32)
    if len(coords) < 50:
        return {"method": "", "pockets": []}
    spacing = GRID_SPACING
    low, high = coords.min(axis=0) - RAY_LENGTH, coords.max(axis=0) + RAY_LENGTH
    while np.prod(np.ceil((high - low) / spacing) + 1) > MAX_GRID_POINTS:
        spacing += 0.25
    shape = tuple(int(v) for v in np.ceil((high - low) / spacing) + 1)
    cells = np.round((coords - low) / spacing).astype(np.int32)

    empty = ~_stamp(shape, cells, EMPTY_RADIUS, spacing)
    solid = _stamp(shape, cells, SOLID_RADIUS, spacing)
    buried = np.zeros(shape, dtype=np.int8)
    for axis in RAY_AXES:
        length = math.sqrt(sum(a * a for a in axis)) * spacing
        steps = max(1, int(RAY_LENGTH / length))
        for sign in (1, -1):
            hit = np.zeros(shape, dtype=bool)
            for k in range(1, steps + 1):
                hit |= _shift(solid, tuple(sign * k * a for a in axis))
            buried += hit
    candidate = empty & (buried >= MIN_BURIED)

    groups = [g for g in _components(candidate) if len(g) >= MIN_POCKET_POINTS]
    labels = np.zeros(shape, dtype=np.int32)
    for k, group in enumerate(groups, start=1):
        labels[group[:, 0], group[:, 1], group[:, 2]] = k

    # Résidus qui bordent chaque poche (atome à moins de LINING_RADIUS d'un point)
    lining: dict[int, set[int]] = {k: set() for k in range(1, len(groups) + 1)}
    offsets = _offsets(LINING_RADIUS, spacing)
    limit = np.array(shape) - 1
    resi = np.array([a["resi"] for a in atoms])
    for start in range(0, len(cells), 1000):
        points = np.clip(cells[start:start + 1000, None, :] + offsets[None, :, :], 0, limit)
        found = labels[points[..., 0], points[..., 1], points[..., 2]]
        atom_idx, _ = np.nonzero(found)
        for a, label in zip(atom_idx.tolist(), found[found > 0].tolist()):
            lining[label].add(int(resi[start + a]))

    by_number = {r["resi"]: r for r in residues}
    tm = {n for s in tm_segments or [] for n in range(s["start"], s["end"] + 1)}
    pockets = []
    for k, group in enumerate(groups, start=1):
        members = sorted(lining[k])
        if len(members) < 4:
            continue
        values = [by_number[n]["plddt"] for n in members if n in by_number and by_number[n]["plddt"] is not None]
        aa = [by_number[n]["aa"] for n in members if n in by_number]
        burial = float(buried[group[:, 0], group[:, 1], group[:, 2]].mean()) / 14
        volume = len(group) * spacing ** 3
        mean_plddt = round(sum(values) / len(values), 1) if values else None
        center = (group.mean(axis=0) * spacing + low).round(1).tolist()
        pockets.append(
            {
                "volume": round(volume, 1),
                "burial": round(burial, 2),
                "center": center,
                "residues": members,
                "residue_labels": [f"{by_number[n]['aa']}{n}" for n in members if n in by_number],
                "mean_plddt": mean_plddt,
                "reliable": mean_plddt is not None and mean_plddt >= CONFIDENT,
                "hydrophobic_fraction": round(sum(a in HYDROPHOBIC for a in aa) / len(aa), 2) if aa else None,
                "charged_fraction": round(sum(a in CHARGED for a in aa) / len(aa), 2) if aa else None,
                "in_membrane": bool(tm) and sum(n in tm for n in members) / len(members) >= 0.5,
                "score": round(volume ** 0.5 * burial * ((mean_plddt or 0) / 100), 2),
            }
        )
    pockets.sort(key=lambda p: -p["score"])
    for k, pocket in enumerate(pockets[:MAX_POCKETS], start=1):
        pocket["id"] = k
    return {
        "method": "Grille de points vides enfouis (dans l’esprit de LIGSITE, Hendlich et al., 1997)",
        "parameters": {"spacing": spacing, "probe_clearance": EMPTY_RADIUS, "ray_length": RAY_LENGTH, "min_buried_rays": f"{MIN_BURIED}/14"},
        "pockets": pockets[:MAX_POCKETS],
        "detected": len(pockets),
    }


# ---------------------------------------------------------------------------
# 6. Sites annotés
# ---------------------------------------------------------------------------

def annotated_sites(entry: dict | None) -> list[dict]:
    """Sites UniProt avec leur preuve ; « confirmé » seulement si la preuve est expérimentale."""
    sites = []
    for feature in (entry or {}).get("features", []):
        kind = SITE_TYPES.get(feature.get("type"))
        description = (feature.get("description") or "").lower()
        if feature.get("type") == "Modified residue" and any(word in description for word in COFACTOR_ATTACHMENT):
            kind = "Cofacteur lié"
        if not kind:
            continue
        location = feature.get("location") or {}
        start = (location.get("start") or {}).get("value")
        end = (location.get("end") or {}).get("value")
        if not start or not end:
            continue
        evidence = evidence_of(feature)
        ligand = (feature.get("ligand") or {}).get("name")
        sites.append(
            {
                "type": kind,
                "start": start,
                "end": end,
                "description": ligand or feature.get("description") or kind,
                "evidence": evidence,
                "evidence_label": EVIDENCE_LABELS[evidence],
                "confirmed": evidence in CONFIRMED_EVIDENCE,
                "status": "Confirmé expérimentalement" if evidence in CONFIRMED_EVIDENCE else "Annoté sans preuve expérimentale",
            }
        )
    return sites


def link_sites(pockets: list[dict], sites: list[dict], residues_plddt: dict[int, float]) -> None:
    """Sites annotés présents dans chaque poche, et poche de chaque site."""
    for site in sites:
        positions = set(range(site["start"], site["end"] + 1))
        site["pockets"] = [p["id"] for p in pockets if positions & set(p["residues"])]
        values = [residues_plddt[n] for n in positions if n in residues_plddt]
        site["mean_plddt"] = round(sum(values) / len(values), 1) if values else None
    for pocket in pockets:
        inside = [s for s in sites if pocket["id"] in s["pockets"]]
        pocket["sites"] = [{"type": s["type"], "position": s["start"], "description": s["description"], "confirmed": s["confirmed"]} for s in inside]
        if any(s["confirmed"] for s in inside):
            pocket["status"] = "Poche prédite contenant un site confirmé expérimentalement"
        elif inside:
            pocket["status"] = "Poche prédite contenant un site annoté (sans preuve expérimentale)"
        else:
            pocket["status"] = "Poche prédite (géométrie seule, aucune fonction connue)"


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------

LIMITS = [
    "Modèle prédit par AlphaFold, pas une structure expérimentale : géométrie, poches et contacts sont des hypothèses.",
    "Les poches sont détectées par la seule géométrie (points vides enfouis) : ni la fixation d’un ligand ni une fonction ne sont démontrées.",
    "Les chaînes latérales et les boucles mobiles sont positionnées par le modèle : une poche peut s’ouvrir ou se fermer dans la réalité (formes libre et liée).",
    "Chaîne isolée, sans ligand, cofacteur, ion, partenaire ni membrane : les sites d’interface ou dépendant d’un cofacteur peuvent manquer.",
    "Les régions de pLDDT inférieur à 70 (et surtout à 50) sont souvent désordonnées : n’en tirez ni contact ni poche.",
]


@cached("alphafold:analysis:v2", ttl=30 * 24 * 3600, store_if=is_successful)
def analyze_alphafold_model(accession: str) -> dict:
    accession = accession.upper().strip()
    model = get_alphafold(accession)
    if not model.get("available") or not model.get("pdb_url"):
        return {"accession": accession, "available": False, "error": f"Aucun modèle AlphaFold pour {accession}."}
    text = fetch_alphafold_pdb(model["pdb_url"])
    if text is None:
        return {"accession": accession, "available": False, "error": "Fichier du modèle AlphaFold indisponible."}
    try:
        entry = uniprot_service.fetch_entry(accession)
    except Exception:
        entry = None
    return analyze_model_text(text, accession, model, entry)


def analyze_model_text(text: str, accession: str, model: dict, entry: dict | None) -> dict:
    atoms, residues = model_residues(text)
    if not residues:
        return {"accession": accession, "available": False, "error": "Modèle AlphaFold illisible."}
    chain = residues[0]["chain"]
    uniprot_sequence = ((entry or {}).get("sequence") or {}).get("value")
    tm_segments = uniprot_service.tm_segments(entry) if entry else []

    pockets = detect_pockets(atoms, residues, tm_segments)
    sites = annotated_sites(entry)
    link_sites(pockets["pockets"], sites, {r["resi"]: r["plddt"] for r in residues if r["plddt"] is not None})
    limits = list(LIMITS)
    if tm_segments:
        limits.append(
            "Protéine membranaire modélisée sans bicouche : des sillons tournés vers les lipides peuvent apparaître comme des poches "
            "(signalées « dans la membrane »)."
        )

    return {
        "accession": accession,
        "available": True,
        "model_id": model.get("model_id"),
        "model_version": model.get("latest_version"),
        "kind": "Modèle prédit (AlphaFold DB)",
        "experimental": False,
        "mapping": check_mapping(residues, uniprot_sequence, model.get("sequence")),
        "confidence": confidence_summary(residues),
        "geometry": geometry_summary(residues, chain),
        "contacts": contact_summary(residues),
        "pockets": pockets,
        "sites": sites,
        "limits": limits,
    }
