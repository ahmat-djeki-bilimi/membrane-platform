import math
from typing import Dict, List, Tuple

import requests


def _fetch_text(url: str) -> str:
    response = requests.get(url, timeout=40)
    response.raise_for_status()
    return response.text


def _fetch_json(url: str) -> dict:
    response = requests.get(url, timeout=40)
    response.raise_for_status()
    return response.json()


def _parse_atom_line(line: str):
    atom = line[12:16].strip()
    resn = line[17:20].strip()
    chain = line[21].strip() or "A"

    try:
        resi = int(line[22:26].strip())
        x = float(line[30:38])
        y = float(line[38:46])
        z = float(line[46:54])
    except Exception:
        return None

    element = line[76:78].strip()
    if not element:
        element = atom[0]

    return {
        "atom": atom,
        "resn": resn,
        "chain": chain,
        "resi": resi,
        "coord": (x, y, z),
        "element": element.upper(),
    }


def _load_atoms(pdb_text: str) -> List[dict]:
    atoms = []

    for line in pdb_text.splitlines():
        if not line.startswith("ATOM"):
            continue

        parsed = _parse_atom_line(line)
        if not parsed:
            continue

        # On ignore hydrogènes pour un score plus stable.
        if parsed["element"] == "H":
            continue

        atoms.append(parsed)

    return atoms


def _load_residues_from_pdb(pdb_text: str):
    residues = {}

    for line in pdb_text.splitlines():
        if not line.startswith("ATOM"):
            continue

        parsed = _parse_atom_line(line)
        if not parsed:
            continue

        key = (parsed["chain"], parsed["resi"])
        if key not in residues:
            residues[key] = {
                "chain": parsed["chain"],
                "resi": parsed["resi"],
                "resn": parsed["resn"],
                "atoms": {},
            }

        residues[key]["atoms"][parsed["atom"]] = parsed["coord"]

    ordered = sorted(residues.values(), key=lambda r: (r["chain"], r["resi"]))
    return ordered


def _vec_sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _norm(v):
    return math.sqrt(_dot(v, v))


def _normalize(v):
    n = _norm(v)
    if n == 0:
        return (0.0, 0.0, 0.0)
    return (v[0] / n, v[1] / n, v[2] / n)


def _dihedral(p1, p2, p3, p4) -> float:
    b0 = _vec_sub(p1, p2)
    b1 = _vec_sub(p3, p2)
    b2 = _vec_sub(p4, p3)

    b1n = _normalize(b1)

    v = _vec_sub(b0, tuple(_dot(b0, b1n) * x for x in b1n))
    w = _vec_sub(b2, tuple(_dot(b2, b1n) * x for x in b1n))

    x = _dot(v, w)
    y = _dot(_cross(b1n, v), w)

    return math.degrees(math.atan2(y, x))


def _rama_status(phi: float, psi: float) -> str:
    if -180 <= phi <= -40 and 60 <= psi <= 180:
        return "favored"

    if -100 <= phi <= -20 and -80 <= psi <= 40:
        return "favored"

    if 20 <= phi <= 100 and -20 <= psi <= 90:
        return "allowed"

    if -180 <= phi <= 0 and -180 <= psi <= 180:
        return "allowed"

    return "outlier"


def _compute_ramachandran_points(pdb_text: str) -> List[dict]:
    residues = _load_residues_from_pdb(pdb_text)
    points = []

    chains = {}
    for residue in residues:
        chains.setdefault(residue["chain"], []).append(residue)

    for chain_id, chain_residues in chains.items():
        for i in range(1, len(chain_residues) - 1):
            prev_r = chain_residues[i - 1]
            cur_r = chain_residues[i]
            next_r = chain_residues[i + 1]

            try:
                c_prev = prev_r["atoms"]["C"]
                n_cur = cur_r["atoms"]["N"]
                ca_cur = cur_r["atoms"]["CA"]
                c_cur = cur_r["atoms"]["C"]
                n_next = next_r["atoms"]["N"]

                phi = _dihedral(c_prev, n_cur, ca_cur, c_cur)
                psi = _dihedral(n_cur, ca_cur, c_cur, n_next)
                status = _rama_status(phi, psi)

                points.append(
                    {
                        "chain": chain_id,
                        "resi": cur_r["resi"],
                        "resn": cur_r["resn"],
                        "phi": round(phi, 2),
                        "psi": round(psi, 2),
                        "status": status,
                    }
                )
            except KeyError:
                continue

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

    favored = sum(1 for p in points if p["status"] == "favored")
    allowed = sum(1 for p in points if p["status"] == "allowed")
    outliers = sum(1 for p in points if p["status"] == "outlier")

    outliers_percent = round((outliers / total) * 100, 2)
    favored_percent = round((favored / total) * 100, 2)
    allowed_percent = round((allowed / total) * 100, 2)

    if outliers_percent <= 0.5:
        status = "excellent"
        interpretation = "Très bonne géométrie backbone : très peu d’outliers Ramachandran calculés."
    elif outliers_percent <= 2.0:
        status = "good"
        interpretation = "Géométrie backbone globalement correcte avec peu d’outliers."
    elif outliers_percent <= 5.0:
        status = "medium"
        interpretation = "Présence modérée d’outliers : inspecter les résidus signalés en 3D."
    else:
        status = "poor"
        interpretation = "Nombre élevé d’outliers : vérifier les régions locales et la qualité du modèle."

    return {
        "favored_percent": favored_percent,
        "allowed_percent": allowed_percent,
        "outliers_percent": outliers_percent,
        "status": status,
        "interpretation": interpretation,
    }


def _merge_residue_ranges(residues: List[int], label: str, color: str):
    if not residues:
        return []

    residues = sorted(set(residues))
    ranges = []
    start = residues[0]
    end = residues[0]

    for resi in residues[1:]:
        if resi == end + 1:
            end = resi
        else:
            ranges.append({"start": start, "end": end, "label": label, "color": color})
            start = end = resi

    ranges.append({"start": start, "end": end, "label": label, "color": color})
    return ranges


def _distance(a, b):
    return math.sqrt(
        (a[0] - b[0]) ** 2 +
        (a[1] - b[1]) ** 2 +
        (a[2] - b[2]) ** 2
    )


def _compute_local_errat_like_score(pdb_text: str) -> dict:
    """
    Score automatique local inspiré d'ERRAT.
    Important : ce n'est pas l'ERRAT officiel.
    Il évalue les contacts atomiques non liés anormaux dans des fenêtres de 9 résidus,
    puis retourne un quality factor 0-100.
    """
    atoms = _load_atoms(pdb_text)

    if not atoms:
        return {
            "available": True,
            "score": None,
            "method": "ERRAT-like local nonbonded contact score",
            "bad_windows": [],
            "interpretation": "Aucun atome exploitable pour le score automatique.",
        }

    residue_keys = sorted(set((a["chain"], a["resi"]) for a in atoms), key=lambda x: (x[0], x[1]))
    residue_index = {key: idx for idx, key in enumerate(residue_keys)}

    # Compter les contacts anormalement proches par résidu.
    bad_counts = {key: 0 for key in residue_keys}
    total_checked = 0

    # O(n²), mais OK pour des structures moyennes. Limite pour éviter lenteur.
    max_atoms = 4500
    if len(atoms) > max_atoms:
      atoms = atoms[:max_atoms]

    for i in range(len(atoms)):
        ai = atoms[i]
        key_i = (ai["chain"], ai["resi"])

        for j in range(i + 1, len(atoms)):
            aj = atoms[j]
            key_j = (aj["chain"], aj["resi"])

            if ai["chain"] == aj["chain"] and abs(ai["resi"] - aj["resi"]) <= 1:
                continue

            d = _distance(ai["coord"], aj["coord"])

            # Seuil simple pour clash non lié.
            if d < 2.2:
                bad_counts[key_i] += 1
                bad_counts[key_j] += 1

            if d < 4.0:
                total_checked += 1

    # Fenêtres de 9 résidus façon ERRAT.
    window_size = 9
    window_scores = []

    for start in range(0, max(1, len(residue_keys) - window_size + 1)):
        window = residue_keys[start:start + window_size]
        bad = sum(bad_counts[k] for k in window)
        error_value = bad / max(1, len(window))

        status = "good"
        if error_value >= 2.5:
            status = "bad"
        elif error_value >= 1.2:
            status = "warning"

        window_scores.append(
            {
                "start": window[0][1],
                "end": window[-1][1],
                "error_value": round(error_value, 3),
                "status": status,
            }
        )

    bad_windows = [w for w in window_scores if w["status"] == "bad"]
    warning_windows = [w for w in window_scores if w["status"] == "warning"]

    # Quality factor : % fenêtres qui ne sont pas mauvaises.
    if window_scores:
        score = round(100 * (1 - (len(bad_windows) / len(window_scores))), 2)
    else:
        score = None

    if score is None:
        interpretation = "Score ERRAT automatique non calculable."
    elif score >= 80:
        interpretation = "Score automatique élevé : peu de fenêtres présentent des contacts non liés anormaux."
    elif score >= 50:
        interpretation = "Score automatique moyen : certaines fenêtres structurales doivent être inspectées."
    else:
        interpretation = "Score automatique faible : plusieurs régions présentent des contacts atomiques non liés défavorables."

    highlight_ranges = [
        {
            "start": w["start"],
            "end": w["end"],
            "label": "ERRAT-like bad window",
            "color": "#dc2626",
        }
        for w in bad_windows[:20]
    ]

    return {
        "available": True,
        "score": score,
        "method": "Automatic ERRAT-like nonbonded contact score",
        "bad_windows": bad_windows[:50],
        "warning_windows": warning_windows[:50],
        "highlight_ranges": highlight_ranges,
        "interpretation": interpretation,
    }


def _get_rcsb_validation(pdb_id: str) -> dict:
    try:
        entry = _fetch_json(f"https://data.rcsb.org/rest/v1/core/entry/{pdb_id}")

        summary = entry.get("pdbx_vrpt_summary") or {}

        clashscore = summary.get("clashscore")
        rama_outliers = summary.get("pct_ramachandran_outliers")
        rotamer_outliers = summary.get("pct_rotamer_outliers")
        rsrz_outliers = summary.get("pct_RSRZ_outliers")

        # 🔥 fallback si null
        if clashscore is None:
            validation = entry.get("rcsb_entry_info", {})
            clashscore = validation.get("clashscore")

        return {
            "clashscore": clashscore,
            "sidechain_outliers_percent": rotamer_outliers,
            "rsrz_outliers_percent": rsrz_outliers,
            "rcsb_ramachandran_outliers_percent": rama_outliers,
        }

    except Exception as e:
        print("Erreur récupération validation RCSB:", e)
        return {
            "clashscore": None,
            "sidechain_outliers_percent": None,
            "rsrz_outliers_percent": None,
            "rcsb_ramachandran_outliers_percent": None,
        }


def get_structure_quality(pdb_id: str) -> dict:
    pdb_id = pdb_id.upper().strip()
    pdb_url = f"https://files.rcsb.org/download/{pdb_id}.pdb"

    result = {
        "pdb_id": pdb_id,
        "ramachandran": {
            "favored_percent": None,
            "allowed_percent": None,
            "outliers_percent": None,
            "status": "unknown",
            "interpretation": "Données Ramachandran non disponibles.",
            "points": [],
            "highlight_ranges": [],
        },
        "geometry": {
            "clashscore": None,
            "sidechain_outliers_percent": None,
            "rsrz_outliers_percent": None,
            "rcsb_ramachandran_outliers_percent": None,
        },
        "opm": {
            "available": True,
            "url": f"https://opm.phar.umich.edu/proteins/{pdb_id}",
            "interpretation": "Orientation membranaire à consulter dans OPM. La plateforme affiche une visualisation intégrée de la bicouche.",
            "highlight_ranges": [],
        },
        "errat": {
            "available": True,
            "score": None,
            "method": "Automatic ERRAT-like nonbonded contact score",
            "bad_windows": [],
            "warning_windows": [],
            "highlight_ranges": [],
            "interpretation": "Score automatique en attente.",
        },
    }

    try:
        pdb_text = _fetch_text(pdb_url)

        points = _compute_ramachandran_points(pdb_text)
        summary = _summarize_ramachandran(points)
        geometry = _get_rcsb_validation(pdb_id)
        errat = _compute_local_errat_like_score(pdb_text)

        outlier_residues = [p["resi"] for p in points if p["status"] == "outlier"]
        allowed_residues = [p["resi"] for p in points if p["status"] == "allowed"]

        highlight_ranges = []
        highlight_ranges += _merge_residue_ranges(outlier_residues, "Ramachandran outliers", "#ef4444")
        highlight_ranges += _merge_residue_ranges(allowed_residues[:50], "Ramachandran allowed", "#f59e0b")

        result["ramachandran"] = {
            **summary,
            "points": points,
            "highlight_ranges": highlight_ranges,
        }

        result["geometry"] = geometry
        result["errat"] = errat

        return result

    except Exception as e:
        result["error"] = str(e)
        return result
