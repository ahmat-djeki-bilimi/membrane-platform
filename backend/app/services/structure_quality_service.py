"""
Qualité structurale d'une entrée PDB.

- Validation officielle wwPDB (clashscore, outliers Ramachandran / rotamères,
  RSRZ) lue dans l'API RCSB.
- Angles φ/ψ calculés à partir des coordonnées, avec une classification
  Ramachandran simplifiée (régions rectangulaires ; les pourcentages officiels
  restent ceux de wwPDB).
- Indicateur de contacts atomiques anormaux par fenêtres de 9 résidus. Inspiré
  d'ERRAT dans sa présentation, ce n'est PAS le programme ERRAT : il compte les
  paires d'atomes lourds non liés dont les sphères de van der Waals se
  chevauchent d'au moins 0,5 Å (calibré pour suivre le clashscore wwPDB).
"""

import math
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

import requests

from app import http
from app.cache import cached

VDW_RADII = {"C": 1.70, "N": 1.55, "O": 1.52, "S": 1.80}
CLASH_OVERLAP = 0.5   # Å de chevauchement des sphères de van der Waals
HBOND_MIN = 2.5       # paires N/O plus éloignées : liaison hydrogène possible
GRID_CELL = 3.6       # ≥ 2 × plus grand rayon − chevauchement
WINDOW_SIZE = 9
BAD_WINDOW = 0.5      # contacts anormaux par résidu dans la fenêtre
WARNING_WINDOW = 0.2


def _fetch_text(url: str) -> str:
    response = http.get(url, timeout=40)
    response.raise_for_status()
    return response.text


def _fetch_json(url: str) -> dict:
    response = http.get(url, timeout=40)
    response.raise_for_status()
    return response.json()


# ---------------------------------------------------------------------------
# Lecture du fichier PDB
# ---------------------------------------------------------------------------

def _parse_atoms(pdb_text: str) -> List[dict]:
    """Atomes lourds ATOM du premier modèle, conformation alternative A seulement."""
    atoms = []
    for line in pdb_text.splitlines():
        if line.startswith("ENDMDL"):
            break  # structures RMN : premier modèle uniquement
        if not line.startswith("ATOM"):
            continue

        alt_loc = line[16]
        if alt_loc not in (" ", "A"):
            continue

        try:
            atom = {
                "atom": line[12:16].strip(),
                "resn": line[17:20].strip(),
                "chain": line[21].strip() or "A",
                "resi": int(line[22:26]),
                "icode": line[26].strip(),
                "coord": (float(line[30:38]), float(line[38:46]), float(line[46:54])),
            }
        except ValueError:
            continue

        element = line[76:78].strip() or atom["atom"][0]
        if element.upper() in ("H", "D"):
            continue
        atom["element"] = element.upper()
        atoms.append(atom)
    return atoms


def _group_residues(atoms: List[dict]) -> Dict[str, List[dict]]:
    """Résidus par chaîne, dans l'ordre du fichier."""
    chains: Dict[str, List[dict]] = defaultdict(list)
    index = {}
    for a in atoms:
        key = (a["chain"], a["resi"], a["icode"])
        if key not in index:
            residue = {
                "chain": a["chain"],
                "resi": a["resi"],
                "icode": a["icode"],
                "resn": a["resn"],
                "atoms": {},
            }
            index[key] = residue
            chains[a["chain"]].append(residue)
        index[key]["atoms"].setdefault(a["atom"], a["coord"])
    return chains


def _distance(a, b) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def _dihedral(p1, p2, p3, p4) -> float:
    b0 = [p1[i] - p2[i] for i in range(3)]
    b1 = [p3[i] - p2[i] for i in range(3)]
    b2 = [p4[i] - p3[i] for i in range(3)]

    n1 = math.sqrt(sum(x * x for x in b1)) or 1.0
    b1 = [x / n1 for x in b1]

    def proj(v):
        d = sum(v[i] * b1[i] for i in range(3))
        return [v[i] - d * b1[i] for i in range(3)]

    v = proj(b0)
    w = proj(b2)
    x = sum(v[i] * w[i] for i in range(3))
    cross = [
        b1[1] * v[2] - b1[2] * v[1],
        b1[2] * v[0] - b1[0] * v[2],
        b1[0] * v[1] - b1[1] * v[0],
    ]
    y = sum(cross[i] * w[i] for i in range(3))
    return math.degrees(math.atan2(y, x))


# ---------------------------------------------------------------------------
# Ramachandran
# ---------------------------------------------------------------------------

def _in_beta(phi, psi):
    return -180 <= phi <= -45 and (psi >= 90 or psi <= -170)


def _in_alpha_r(phi, psi):
    return -160 <= phi <= -20 and -100 <= psi <= 50


def _in_alpha_l(phi, psi):
    return 30 <= phi <= 100 and -20 <= psi <= 100


def _rama_status(resn: str, phi: float, psi: float) -> str:
    if resn == "GLY":
        # Glycine : régions symétriques, rarement réellement aberrante
        if _in_beta(phi, psi) or _in_alpha_r(phi, psi) or _in_alpha_l(phi, psi) \
                or _in_beta(-phi, -psi) or _in_alpha_r(-phi, -psi):
            return "favored"
        return "allowed"

    if resn == "PRO":
        # Proline : φ contraint par le cycle pyrrolidine
        if not -100 <= phi <= -40:
            return "outlier"
        return "favored" if (psi >= 100 or psi <= -170 or -60 <= psi <= 0) else "allowed"

    if _in_beta(phi, psi) or _in_alpha_r(phi, psi):
        return "favored"
    if _in_alpha_l(phi, psi) or phi <= 0:
        return "allowed"
    return "outlier"


def _compute_ramachandran_points(chains: Dict[str, List[dict]]) -> List[dict]:
    points = []
    for chain_id, residues in chains.items():
        for i in range(1, len(residues) - 1):
            prev_r, cur_r, next_r = residues[i - 1], residues[i], residues[i + 1]
            try:
                c_prev = prev_r["atoms"]["C"]
                n_cur = cur_r["atoms"]["N"]
                ca_cur = cur_r["atoms"]["CA"]
                c_cur = cur_r["atoms"]["C"]
                n_next = next_r["atoms"]["N"]
            except KeyError:
                continue

            # Rupture de chaîne : pas de liaison peptidique, angle non défini
            if _distance(c_prev, n_cur) > 2.0 or _distance(c_cur, n_next) > 2.0:
                continue

            phi = _dihedral(c_prev, n_cur, ca_cur, c_cur)
            psi = _dihedral(n_cur, ca_cur, c_cur, n_next)
            points.append(
                {
                    "chain": chain_id,
                    "resi": cur_r["resi"],
                    "resn": cur_r["resn"],
                    "phi": round(phi, 1),
                    "psi": round(psi, 1),
                    "status": _rama_status(cur_r["resn"], phi, psi),
                }
            )
    return points


def _summarize_ramachandran(points: List[dict]) -> Dict:
    total = len(points)
    if total == 0:
        return {
            "favored_percent": None,
            "allowed_percent": None,
            "outliers_percent": None,
            "status": "unknown",
            "interpretation": "Aucun angle φ/ψ calculable dans cette structure.",
        }

    def pct(status):
        return round(100 * sum(1 for p in points if p["status"] == status) / total, 1)

    outliers = pct("outlier")
    if outliers <= 0.5:
        status, text = "excellent", "Très bonne géométrie du squelette : très peu de résidus hors des régions attendues."
    elif outliers <= 2.0:
        status, text = "good", "Géométrie du squelette globalement correcte."
    elif outliers <= 5.0:
        status, text = "medium", "Présence modérée de résidus hors régions : à inspecter en 3D."
    else:
        status, text = "poor", "Nombreux résidus hors régions : vérifier les zones signalées."

    return {
        "favored_percent": pct("favored"),
        "allowed_percent": pct("allowed"),
        "outliers_percent": outliers,
        "status": status,
        "interpretation": text
        + " Classification simplifiée ; la valeur de référence est le pourcentage wwPDB.",
    }


def _merge_residue_ranges(residues: List[int], label: str, color: str):
    if not residues:
        return []
    residues = sorted(set(residues))
    ranges = []
    start = end = residues[0]
    for resi in residues[1:]:
        if resi == end + 1:
            end = resi
        else:
            ranges.append({"start": start, "end": end, "label": label, "color": color})
            start = end = resi
    ranges.append({"start": start, "end": end, "label": label, "color": color})
    return ranges


# ---------------------------------------------------------------------------
# Contacts atomiques anormaux
# ---------------------------------------------------------------------------

def _is_disulfide(a: dict, b: dict) -> bool:
    return a["atom"] == "SG" and b["atom"] == "SG" and a["resn"] == "CYS" and b["resn"] == "CYS"


def _compute_contact_windows(atoms: List[dict], chains: Dict[str, List[dict]]) -> dict:
    method = "Chevauchements de van der Waals ≥ 0,5 Å (indicateur inspiré d'ERRAT)"
    if not atoms:
        return {
            "available": False,
            "score": None,
            "method": method,
            "all_windows": [],
            "bad_windows": [],
            "warning_windows": [],
            "highlight_ranges": [],
            "interpretation": "Aucun atome exploitable.",
        }

    # Grille spatiale : seules les cellules voisines sont comparées
    cell = GRID_CELL
    grid: Dict[Tuple[int, int, int], List[int]] = defaultdict(list)
    for idx, a in enumerate(atoms):
        x, y, z = a["coord"]
        grid[(int(x // cell), int(y // cell), int(z // cell))].append(idx)

    residue_order = {}
    for chain_id, residues in chains.items():
        for pos, r in enumerate(residues):
            residue_order[(chain_id, r["resi"], r["icode"])] = pos

    clash_counts: Dict[Tuple[str, int, str], int] = defaultdict(int)
    for (cx, cy, cz), members in grid.items():
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    neighbours = grid.get((cx + dx, cy + dy, cz + dz))
                    if not neighbours:
                        continue
                    for i in members:
                        ai = atoms[i]
                        key_i = (ai["chain"], ai["resi"], ai["icode"])
                        for j in neighbours:
                            if j <= i:
                                continue
                            aj = atoms[j]
                            key_j = (aj["chain"], aj["resi"], aj["icode"])
                            # Résidus identiques ou voisins dans la chaîne : liés
                            if ai["chain"] == aj["chain"] and abs(
                                residue_order[key_i] - residue_order[key_j]
                            ) <= 1:
                                continue
                            if _is_disulfide(ai, aj):
                                continue
                            d = _distance(ai["coord"], aj["coord"])
                            if d >= GRID_CELL:
                                continue
                            if ai["element"] in "NO" and aj["element"] in "NO" and d >= HBOND_MIN:
                                continue
                            overlap = (
                                VDW_RADII.get(ai["element"], 1.7)
                                + VDW_RADII.get(aj["element"], 1.7)
                                - d
                            )
                            if overlap >= CLASH_OVERLAP:
                                clash_counts[key_i] += 1
                                clash_counts[key_j] += 1

    windows = []
    for chain_id, residues in chains.items():
        for start in range(0, len(residues) - WINDOW_SIZE + 1):
            window = residues[start:start + WINDOW_SIZE]
            count = sum(clash_counts[(chain_id, r["resi"], r["icode"])] for r in window)
            value = count / WINDOW_SIZE
            status = "bad" if value >= BAD_WINDOW else "warning" if value >= WARNING_WINDOW else "good"
            windows.append(
                {
                    "chain": chain_id,
                    "start": window[0]["resi"],
                    "end": window[-1]["resi"],
                    "error_value": round(value, 3),
                    "status": status,
                }
            )

    bad = [w for w in windows if w["status"] == "bad"]
    warning = [w for w in windows if w["status"] == "warning"]
    score = round(100 * (1 - len(bad) / len(windows)), 1) if windows else None

    if score is None:
        text = "Chaînes trop courtes pour des fenêtres de 9 résidus."
    elif score >= 95:
        text = "Très peu de contacts atomiques anormaux."
    elif score >= 80:
        text = "Quelques régions présentent des contacts atomiques anormaux."
    else:
        text = "De nombreuses régions présentent des contacts atomiques anormaux : à inspecter."

    return {
        "available": score is not None,
        "score": score,
        "method": method,
        "is_official_errat": False,
        "all_windows": windows,
        "bad_windows": bad[:200],
        "warning_windows": warning[:200],
        "highlight_ranges": [
            {"start": w["start"], "end": w["end"], "label": "Contacts anormaux", "color": "#dc2626"}
            for w in bad[:30]
        ],
        "interpretation": text
        + " Score = pourcentage de fenêtres de 9 résidus sans contact anormal.",
    }


# ---------------------------------------------------------------------------
# Validation officielle wwPDB
# ---------------------------------------------------------------------------

def _get_rcsb_validation(pdb_id: str) -> dict:
    empty = {
        "available": False,
        "clashscore": None,
        "sidechain_outliers_percent": None,
        "rsrz_outliers_percent": None,
        "rcsb_ramachandran_outliers_percent": None,
        "method": None,
        "resolution": None,
    }
    try:
        entry = _fetch_json(f"https://data.rcsb.org/rest/v1/core/entry/{pdb_id}")
    except Exception as e:
        print("Erreur récupération validation RCSB:", e)
        return empty

    geometry = (entry.get("pdbx_vrpt_summary_geometry") or [{}])[0]
    diffraction = (entry.get("pdbx_vrpt_summary_diffraction") or [{}])[0]
    resolution = (entry.get("rcsb_entry_info") or {}).get("resolution_combined") or [None]

    return {
        "available": bool(geometry),
        "clashscore": geometry.get("clashscore"),
        "sidechain_outliers_percent": geometry.get("percent_rotamer_outliers"),
        "rcsb_ramachandran_outliers_percent": geometry.get("percent_ramachandran_outliers"),
        "rsrz_outliers_percent": diffraction.get("percent_RSRZ_outliers"),
        "method": ((entry.get("exptl") or [{}])[0]).get("method"),
        "resolution": resolution[0],
    }


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------

@cached("quality:pdb")
def _cached_quality(pdb_id: str) -> dict:
    pdb_text = _fetch_text(f"https://files.rcsb.org/download/{pdb_id}.pdb")
    atoms = _parse_atoms(pdb_text)
    chains = _group_residues(atoms)

    points = _compute_ramachandran_points(chains)
    outlier_residues = [p["resi"] for p in points if p["status"] == "outlier"]
    allowed_residues = [p["resi"] for p in points if p["status"] == "allowed"]

    return {
        "pdb_id": pdb_id,
        "ramachandran": {
            **_summarize_ramachandran(points),
            "points": points,
            "highlight_ranges": _merge_residue_ranges(outlier_residues, "Ramachandran outlier", "#ef4444")
            + _merge_residue_ranges(allowed_residues[:50], "Ramachandran allowed", "#f59e0b"),
        },
        "geometry": _get_rcsb_validation(pdb_id),
        "errat": _compute_contact_windows(atoms, chains),
    }


def get_structure_quality(pdb_id: str) -> dict:
    pdb_id = pdb_id.upper().strip()
    try:
        return _cached_quality(pdb_id)
    except requests.HTTPError as e:
        # Fichier .pdb absent (très grandes structures, uniquement en mmCIF)
        return {
            "pdb_id": pdb_id,
            "error": f"Fichier PDB indisponible ({e.response.status_code if e.response is not None else 'erreur'}).",
            "ramachandran": {"points": [], "highlight_ranges": [], "status": "unknown"},
            "geometry": _get_rcsb_validation(pdb_id),
            "errat": {"available": False, "score": None, "all_windows": [], "bad_windows": [], "warning_windows": [], "highlight_ranges": []},
        }
    except Exception as e:
        return {
            "pdb_id": pdb_id,
            "error": str(e),
            "ramachandran": {"points": [], "highlight_ranges": [], "status": "unknown"},
            "geometry": {},
            "errat": {"available": False, "score": None, "all_windows": [], "bad_windows": [], "warning_windows": [], "highlight_ranges": []},
        }
