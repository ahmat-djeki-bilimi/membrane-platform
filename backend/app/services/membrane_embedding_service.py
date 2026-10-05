"""
Placement d'une structure (prédite) dans la membrane, et lecture biologique.

Méthode (simplifiée, dans l'esprit de TMDET et PPM) :
1. Direction initiale de la normale : moyenne des axes des hélices
   transmembranaires (orientées dans le même sens).
2. Ajustement d'une bicouche : on cherche la direction (à moins de 35° de la
   direction initiale), le centre et l'épaisseur qui placent dans la tranche
   le plus de résidus exposés plus hydrophobes que la moyenne de la protéine
   (échelle de Kyte-Doolittle), et le moins de résidus chargés exposés. Les
   résidus enfouis au cœur de la protéine ne voient pas les lipides : ils
   sont ignorés (exposition estimée par le nombre de voisins à 10 Å).
3. Côté cytoplasmique : prédiction de topologie (DeepTMHMM) si disponible,
   sinon règle « positive-inside » (von Heijne, 1989).
4. Coordonnées réorientées comme OPM : normale = axe z, centre en z = 0, face
   externe vers z > 0, faces matérialisées par des atomes DUM (O externe,
   N interne).
"""

import math

import numpy as np

from app.services.membrane_orientation_service import KYTE_DOOLITTLE

THREE_TO_ONE = {
    "ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C", "GLN": "Q", "GLU": "E",
    "GLY": "G", "HIS": "H", "ILE": "I", "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F",
    "PRO": "P", "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V",
}

MAX_TILT_SEARCH = 35.0  # degrés autour de la direction initiale
HALF_THICKNESSES = np.arange(11.0, 19.5, 1.0)  # bicouches de 22 à 38 Å
# Centre cherché à ±4 Å du milieu des hélices TM : une chaîne isolée
# d'oligomère expose des surfaces d'interface qui décaleraient la bicouche
CENTER_OFFSETS = np.arange(-4.0, 4.5, 1.0)
SOFTNESS = 1.5  # Å, transition douce aux bords de la tranche
DUM_SPACING = 3.0
INTERFACE_WIDTH = 5.0  # Å de part et d'autre de chaque face
# Les segments TM prédits ou annotés sont souvent plus courts que l'hélice
# réelle : on la prolonge dans la structure tant que la géométrie reste
# celle d'une hélice α (Cα i → i+3 : 5,0 Å ; i → i+4 : 6,2 Å)
HELIX_D3 = (4.4, 5.8)
HELIX_D4 = (5.4, 7.0)
MAX_HELIX_EXTENSION = 8  # résidus de chaque côté
CROSSING_TOLERANCE = 6.0  # Å : extrémités à moins de 6 Å des faces
FLANK = 6  # résidus de boucle examinés au-delà d'une hélice courte


# ---------------------------------------------------------------------------
# Lecture et écriture PDB
# ---------------------------------------------------------------------------

def parse_pdb(pdb: str) -> tuple[list[str], list[dict], float]:
    """Lignes ATOM, résidus (numéro, acide aminé, Cα, pLDDT sur 0–100) et échelle du pLDDT."""
    atoms, residues, seen = [], [], {}
    for line in pdb.splitlines():
        if not line.startswith("ATOM"):
            continue
        atoms.append(line)
        number = int(line[22:26])
        if number not in seen:
            seen[number] = len(residues)
            residues.append({"number": number, "aa": THREE_TO_ONE.get(line[17:20], "X"), "ca": None, "plddt": None})
        if line[12:16].strip() == "CA":
            r = residues[seen[number]]
            r["ca"] = (float(line[30:38]), float(line[38:46]), float(line[46:54]))
            r["plddt"] = float(line[60:66])
    residues = [r for r in residues if r["ca"] is not None]
    # ESMFold : pLDDT entre 0 et 1 ; AlphaFold : entre 0 et 100
    scale = 100.0 if residues and max(r["plddt"] for r in residues) <= 1.0 else 1.0
    for r in residues:
        r["plddt"] = r["plddt"] * scale
    return atoms, residues, scale


def _fmt(value: float) -> str:
    return f"{value:8.3f}"[-8:]


def write_oriented_pdb(atoms, origin, frame, half_thickness, plddt_scale, renumber_offset=0) -> str:
    """Coordonnées dans le repère de la membrane, pLDDT sur 0–100, atomes DUM."""
    lines, xs, ys = [], [], []
    for line in atoms:
        r = np.array([float(line[30:38]), float(line[38:46]), float(line[46:54])])
        x, y, z = frame @ (r - origin)
        xs.append(x)
        ys.append(y)
        b = float(line[60:66]) * plddt_scale
        number = int(line[22:26]) + renumber_offset
        lines.append(
            line[:22] + f"{number:4d}" + line[26:30] + _fmt(x) + _fmt(y) + _fmt(z) + line[54:60] + f"{b:6.2f}" + line[66:]
        )

    serial = len(lines) + 1
    if half_thickness <= 0:
        return "\n".join(lines + ["END"]) + "\n"
    x_range = np.arange(min(xs) - 6, max(xs) + 6.1, DUM_SPACING)
    y_range = np.arange(min(ys) - 6, max(ys) + 6.1, DUM_SPACING)
    for name, z in (("O", half_thickness), ("N", -half_thickness)):
        for x in x_range:
            for y in y_range:
                lines.append(
                    f"HETATM{serial % 100000:5d}  {name:<3} DUM D   1    {_fmt(x)}{_fmt(y)}{_fmt(z)}  1.00  0.00           {name}"
                )
                serial += 1
    lines.append("END")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Géométrie
# ---------------------------------------------------------------------------

def helix_axis(points: np.ndarray) -> np.ndarray:
    """Axe principal d'un segment (Cα), orienté du début vers la fin."""
    centered = points - points.mean(axis=0)
    _, _, vt = np.linalg.svd(centered, full_matrices=False)
    axis = vt[0]
    if np.dot(points[-1] - points[0], axis) < 0:
        axis = -axis
    return axis / np.linalg.norm(axis)


def _helical_turn(ca: np.ndarray, i: int) -> bool:
    """Le tour i → i+3 (et i+4 s'il existe) a la géométrie d'une hélice α."""
    if i < 0 or i + 3 >= len(ca):
        return False
    d3 = np.linalg.norm(ca[i + 3] - ca[i])
    if not HELIX_D3[0] <= d3 <= HELIX_D3[1]:
        return False
    if i + 4 < len(ca):
        d4 = np.linalg.norm(ca[i + 4] - ca[i])
        return HELIX_D4[0] <= d4 <= HELIX_D4[1]
    return True


def extend_helix(ca: np.ndarray, a: int, b: int, max_extension: int = MAX_HELIX_EXTENSION) -> tuple[int, int]:
    """Indices de début et de fin de l'hélice réelle contenant le segment [a, b]."""
    start = a
    while a - start < max_extension and _helical_turn(ca, start - 1):
        start -= 1
    end = b
    while end - b < max_extension and _helical_turn(ca, end + 1 - 3):
        end += 1
    return start, end


def initial_normal(ca: np.ndarray, segments: list[tuple[int, int]]) -> np.ndarray:
    """Moyenne des axes des segments TM, tous ramenés dans le même sens."""
    axes, weights = [], []
    for start, end in segments:
        if end - start + 1 >= 7:
            axes.append(helix_axis(ca[start:end + 1]))
            weights.append(end - start + 1)
    if not axes:
        centered = ca - ca.mean(axis=0)
        return np.linalg.svd(centered, full_matrices=False)[2][0]
    reference = axes[0]
    total = sum(w * (a if np.dot(a, reference) >= 0 else -a) for a, w in zip(axes, weights))
    return total / np.linalg.norm(total)


def _directions_around(n0: np.ndarray, max_angle: float, count: int = 4000) -> np.ndarray:
    """Directions (sphère de Fibonacci) à moins de `max_angle` degrés de n0."""
    i = np.arange(count) + 0.5
    phi = np.arccos(1 - 2 * i / count)
    theta = math.pi * (1 + 5 ** 0.5) * i
    points = np.stack([np.cos(theta) * np.sin(phi), np.sin(theta) * np.sin(phi), np.cos(phi)], axis=1)
    keep = points @ n0 >= math.cos(math.radians(max_angle))
    return np.vstack([n0[None, :], points[keep]])


def exposure(ca: np.ndarray) -> np.ndarray:
    """Exposition approchée de chaque résidu (0 = enfoui, 1 = en surface) : peu de Cα voisins à 10 Å."""
    distances = np.linalg.norm(ca[:, None, :] - ca[None, :, :], axis=2)
    neighbors = (distances < 10.0).sum(axis=1) - 1
    low, high = np.percentile(neighbors, 10), np.percentile(neighbors, 90)
    if high <= low:
        return np.ones(len(ca))
    return np.clip((high - neighbors) / (high - low), 0.0, 1.0)


def fit_bilayer(
    ca: np.ndarray,
    sequence: str,
    n0: np.ndarray,
    tm_mask: np.ndarray,
    segments: list[tuple[int, int]] | None = None,
) -> dict:
    """Normale, centre et demi-épaisseur maximisant l'hydrophobie exposée dans la tranche."""
    hydro = np.array([KYTE_DOOLITTLE.get(a, 0.0) for a in sequence])
    hydro = (hydro - hydro.mean()) * exposure(ca)
    directions = _directions_around(n0, MAX_TILT_SEARCH)
    proj = ca @ directions.T  # (résidus, directions)
    # Centre de départ : milieu géométrique des hélices TM, pour chaque direction
    if segments:
        base = np.mean([(proj[a] + proj[b]) / 2 for a, b in segments], axis=0)
    else:
        base = proj[tm_mask].mean(axis=0) if tm_mask.any() else proj.mean(axis=0)

    best = (-np.inf, 0, 0.0, HALF_THICKNESSES[0])
    for offset in CENTER_OFFSETS:
        depth = np.abs(proj - (base + offset)[None, :])
        for half in HALF_THICKNESSES:
            inside = 1.0 / (1.0 + np.exp((depth - half) / SOFTNESS))
            scores = hydro @ inside
            k = int(np.argmax(scores))
            if scores[k] > best[0]:
                best = (float(scores[k]), k, float(base[k] + offset), float(half))
    score, k, center, half = best
    return {"normal": directions[k], "center": center, "half_thickness": half, "score": score}


# ---------------------------------------------------------------------------
# Analyse
# ---------------------------------------------------------------------------

def _mean(values):
    values = [v for v in values if v is not None]
    return round(sum(values) / len(values), 1) if values else None


def confidence_label(plddt: float | None) -> str:
    if plddt is None:
        return "inconnue"
    if plddt >= 90:
        return "très élevée"
    if plddt >= 70:
        return "élevée"
    if plddt >= 50:
        return "faible"
    return "très faible"


def embed_structure(
    pdb: str,
    sequence: str,
    tm_segments: list[dict],
    n_terminus: str | None = None,
    offset: int = 0,
) -> dict:
    """
    Place la structure dans la membrane. `sequence` est la séquence modélisée,
    `tm_segments` en numérotation de la séquence complète, `offset` le décalage
    de numérotation (fenêtre commençant au résidu offset + 1).
    """
    atoms, residues, scale = parse_pdb(pdb)
    ca = np.array([r["ca"] for r in residues])
    n = len(residues)
    plddt = [r["plddt"] for r in residues]
    numbers = [r["number"] + offset for r in residues]
    index_of = {num: i for i, num in enumerate(numbers)}

    segments = []
    for s in tm_segments:
        start, end = max(s["start"], numbers[0]), min(s["end"], numbers[-1])
        if end - start + 1 >= 7:
            segments.append({**s, "start": start, "end": end})
    seg_idx = [(index_of[s["start"]], index_of[s["end"]]) for s in segments]

    base = {
        "residues": [{"number": num, "aa": r["aa"], "plddt": round(r["plddt"], 1)} for num, r in zip(numbers, residues)],
        "mean_plddt": _mean(plddt),
    }
    if not segments:
        return {**base, "embedded": False, "pdb": write_oriented_pdb(atoms, ca.mean(axis=0), np.eye(3), 0.0, scale, offset)}

    tm_mask = np.zeros(n, dtype=bool)
    for a, b in seg_idx:
        tm_mask[a:b + 1] = True

    n0 = initial_normal(ca, seg_idx)
    fit = fit_bilayer(ca, "".join(r["aa"] for r in residues), n0, tm_mask, seg_idx)
    normal, center, half = fit["normal"], fit["center"], fit["half_thickness"]
    depth = ca @ normal - center  # signe provisoire

    # Côté cytoplasmique (interne)
    loops = ~tm_mask
    positive = np.array([r["aa"] in "KR" for r in residues])
    near = loops & (np.abs(depth) > half - 3) & (np.abs(depth) < half + 15)
    kr_plus = int(np.sum(positive & near & (depth > 0)))
    kr_minus = int(np.sum(positive & near & (depth < 0)))
    first_start = seg_idx[0][0]
    if n_terminus in ("in", "out"):
        n_side = 1 if depth[first_start] >= 0 else -1  # côté où entre la première hélice
        inside_sign = n_side if n_terminus == "in" else -n_side
        side_method = "topology"
    else:
        inside_sign = 1 if kr_plus > kr_minus else -1
        side_method = "positive_inside"
    z_axis = normal * (-inside_sign)  # z > 0 : face externe
    kr_inside = kr_plus if inside_sign > 0 else kr_minus
    kr_outside = kr_minus if inside_sign > 0 else kr_plus

    # Repère : z = normale vers l'extérieur, origine au centre de la bicouche
    helper = np.array([1.0, 0.0, 0.0]) if abs(z_axis[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    x_axis = np.cross(helper, z_axis)
    x_axis /= np.linalg.norm(x_axis)
    y_axis = np.cross(z_axis, x_axis)
    frame = np.vstack([x_axis, y_axis, z_axis])
    centroid = ca.mean(axis=0)
    origin = centroid - (centroid @ normal - center) * normal
    z = (ca - origin) @ z_axis

    # Hélices ; la traversée est jugée sur l'hélice réelle, sans déborder
    # sur l'hélice transmembranaire voisine
    helices = []
    for k, ((a, b), seg) in enumerate(zip(seg_idx, segments), start=1):
        axis = helix_axis(ca[a:b + 1])
        cos = float(np.clip(axis @ z_axis, -1, 1))
        z_start, z_end = float(z[a]), float(z[b])
        low = seg_idx[k - 2][1] + 1 if k > 1 else 0
        high = seg_idx[k][0] - 1 if k < len(seg_idx) else n - 1
        ha, hb = extend_helix(ca, a, b)
        ha, hb = max(ha, low), min(hb, high)
        # Point de l'hélice le plus avancé de chaque côté, dans le sens de la traversée
        sign = 1.0 if z_end >= z_start else -1.0
        reach_start = float(min(sign * z[ha:a + 1])) * sign
        reach_end = float(max(sign * z[b:hb + 1])) * sign
        limit = half - CROSSING_TOLERANCE
        if reach_start * reach_end < 0 and min(abs(reach_start), abs(reach_end)) >= limit:
            crossing = "full"
        elif reach_start * reach_end < 0:
            # Hélice courte : la boucle voisine termine-t-elle la traversée ?
            before = sign * z[max(low, ha - FLANK):ha + 1]
            after = sign * z[hb:min(high, hb + FLANK) + 1]
            crossing = "short" if -before.min() >= limit and after.max() >= limit else "partial"
        else:
            crossing = "partial"
        helices.append(
            {
                "label": seg.get("label") or f"TM{k}",
                "start": seg["start"],
                "end": seg["end"],
                "length": seg["end"] - seg["start"] + 1,
                "tilt": round(math.degrees(math.acos(abs(cos))), 1),
                "direction": "in_to_out" if z_end > z_start else "out_to_in",
                "z_start": round(z_start, 1),
                "z_end": round(z_end, 1),
                "span": round(abs(z_end - z_start), 1),
                "crosses": crossing != "partial",
                "crossing": crossing,
                "reach_start": round(reach_start, 1),
                "reach_end": round(reach_end, 1),
                "helix_start": numbers[ha],
                "helix_end": numbers[hb],
                "mean_plddt": _mean(plddt[a:b + 1]),
            }
        )

    # Résidus remarquables
    aromatic_belt, buried_charged = [], []
    for i, r in enumerate(residues):
        position = {"number": numbers[i], "aa": r["aa"], "z": round(float(z[i]), 1), "plddt": round(plddt[i], 1)}
        if r["aa"] in "WY" and abs(abs(z[i]) - half) <= INTERFACE_WIDTH:
            aromatic_belt.append({**position, "face": "externe" if z[i] > 0 else "interne"})
        if r["aa"] in "DEKRH" and abs(z[i]) <= half - 5:
            buried_charged.append(position)

    # Régions (hélices, boucles et extrémités) : côté et confiance
    regions, cursor = [], 0
    for (a, b), helix in zip(seg_idx, helices):
        if a > cursor:
            regions.append(_loop_region(cursor, a - 1, numbers, z, plddt, n))
        regions.append({"kind": "tm", "label": helix["label"], "start": helix["start"], "end": helix["end"], "mean_plddt": helix["mean_plddt"], "side": None})
        cursor = b + 1
    if cursor < n:
        regions.append(_loop_region(cursor, n - 1, numbers, z, plddt, n))

    return {
        **base,
        "embedded": True,
        "pdb": write_oriented_pdb(atoms, origin, frame, half, scale, offset),
        "membrane": {
            "thickness": round(2 * half, 1),
            "at_search_limit": bool(half in (HALF_THICKNESSES[0], HALF_THICKNESSES[-1])),
            "initial_to_final_angle": round(math.degrees(math.acos(float(np.clip(abs(n0 @ normal), -1, 1)))), 1),
            "side_method": side_method,
            "kr_inside": kr_inside,
            "kr_outside": kr_outside,
            "n_terminus": "in" if (z[0] < 0) else "out",
        },
        "helices": helices,
        "aromatic_belt": aromatic_belt,
        "buried_charged": buried_charged,
        "regions": regions,
        "tm_mean_plddt": _mean([plddt[i] for i in range(n) if tm_mask[i]]),
        "loop_mean_plddt": _mean([plddt[i] for i in range(n) if not tm_mask[i]]),
    }


def _loop_region(a, b, numbers, z, plddt, n):
    side = "out" if float(np.mean(z[a:b + 1])) > 0 else "in"
    if a == 0:
        label = "Extrémité N-terminale"
    elif b == n - 1:
        label = "Extrémité C-terminale"
    else:
        label = "Boucle externe" if side == "out" else "Boucle interne (cytoplasmique)"
    return {
        "kind": "loop_out" if side == "out" else "loop_in",
        "label": label,
        "start": numbers[a],
        "end": numbers[b],
        "mean_plddt": _mean(plddt[a:b + 1]),
        "side": side,
    }
