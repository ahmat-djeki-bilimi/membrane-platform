"""
Superposition d'une structure prédite (ESMFold, placée dans la membrane) et
d'une structure expérimentale (PDB), avec une lecture des écarts.

Méthode :
1. Résidus appariés par leur numéro UniProt (correspondance SIFTS) : aucune
   hypothèse d'alignement de séquences.
2. Superposition de la structure expérimentale sur le modèle, dans le repère
   de la membrane : recherche de la superposition qui maximise le TM-score
   (Zhang & Skolnick, 2004), en partant de fragments et en itérant Kabsch sur
   les résidus proches. Les régions qui diffèrent n'écartent donc pas le cœur
   bien prédit, contrairement à une superposition sur tous les résidus.
3. Écart de chaque résidu (Cα), par région, inclinaison des hélices, accord
   avec le pLDDT, et ligands expérimentaux reportés sur le modèle.
"""

import math
from collections import Counter

import numpy as np

from app import http, jobs
from app.cache import cached, is_successful
from app.services import sifts_service, uniprot_service
from app.services.active_site_service import IMPORTANT_LIGANDS, _is_ligand_candidate
from app.services.alphafold_service import get_alphafold
from app.services.membrane_embedding_service import THREE_TO_ONE, helix_axis
from app.services.mmcif import parse_mmcif
from app.services.structure_prediction_service import place_model

RCSB_DOWNLOAD = "https://files.rcsb.org/download"
MIN_PAIRS = 20
CLOSE = 2.0  # Å : résidu bien superposé
FAR = 4.0  # Å : résidu nettement différent
MIN_DEVIANT_LENGTH = 4
CONTACT = 4.5  # Å : résidu du modèle au contact d'un ligand expérimental
TILT_DIFFERENCE = 10.0  # degrés
CONFIDENT = 70.0  # pLDDT
MIN_IDENTITY = 0.9  # correspondance déduite de la séquence
EXPERIMENTAL_CHAIN = "E"
# Au-delà, le reste du cristal est réduit à sa chaîne principale (gros complexes de cryo-ME)
MAX_OTHER_ATOMS = 40000
BACKBONE = {"N", "CA", "C", "O"}  # chaîne de la structure expérimentale dans le fichier superposé


class ComparisonError(Exception):
    pass


# ---------------------------------------------------------------------------
# Lecture des structures
# ---------------------------------------------------------------------------

@cached("rcsb:pdb", ttl=30 * 24 * 3600)
def fetch_pdb_text(pdb_id: str) -> str | None:
    response = http.get(f"{RCSB_DOWNLOAD}/{pdb_id.upper()}.pdb", timeout=60)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.text


@cached("rcsb:cif", ttl=30 * 24 * 3600)
def fetch_cif_text(pdb_id: str) -> str | None:
    response = http.get(f"{RCSB_DOWNLOAD}/{pdb_id.upper()}.cif", timeout=120)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.text


def read_structure(text: str) -> tuple[list[dict], dict[str, str]]:
    """Atomes et noms des molécules d'un fichier PDB ou mmCIF (format reconnu au contenu)."""
    if text.lstrip().startswith("data_"):
        return parse_mmcif(text)
    return parse_atoms(text), molecule_names(text)


def parse_atoms(pdb: str) -> list[dict]:
    """Atomes du premier modèle (première conformation alternative seulement)."""
    atoms = []
    for line in pdb.splitlines():
        if line.startswith("ENDMDL"):
            break
        if not line.startswith(("ATOM", "HETATM")) or line[16] not in (" ", "A"):
            continue
        atoms.append(
            {
                "record": line[:6].strip(),
                "name": line[12:16].strip(),
                "resn": line[17:20].strip(),
                "chain": line[21],
                "resi": int(line[22:26]),
                "icode": line[26].strip(),
                "coord": np.array([float(line[30:38]), float(line[38:46]), float(line[46:54])]),
                "element": line[76:78].strip() if len(line) >= 78 else line[12:14].strip(),
                "line": line,
            }
        )
    return atoms


def _author_to_uniprot(segments: list[dict], chain: str) -> dict[int, int]:
    table = {}
    for s in segments:
        if s["chain"] != chain:
            continue
        for unp in range(s["unp_start"], s["unp_end"] + 1):
            table[unp + s["offset"]] = unp
    return table


def _protein_ca(atoms: list[dict], chain: str, author_to_unp: dict[int, int]) -> dict[int, dict]:
    residues = {}
    for a in atoms:
        if a["chain"] != chain or a["name"] != "CA" or a["icode"] or a["resn"] not in THREE_TO_ONE:
            continue
        unp = author_to_unp.get(a["resi"])
        if unp is not None and unp not in residues:
            residues[unp] = {"aa": THREE_TO_ONE[a["resn"]], "ca": a["coord"]}
    return residues


def infer_segments(atoms: list[dict], sequence: str) -> list[dict]:
    """
    Correspondance auteur → UniProt déduite de la séquence, chaîne par chaîne :
    décalage constant qui fait coïncider le plus d'acides aminés. Sert quand
    SIFTS ne donne pas de numéro auteur (extrémités non observées).
    """
    positions: dict[str, list[int]] = {}
    for i, aa in enumerate(sequence, start=1):
        positions.setdefault(aa, []).append(i)
    segments = []
    for chain in sorted({a["chain"] for a in atoms}):
        residues = {}
        for a in atoms:
            if a["chain"] == chain and a["name"] == "CA" and not a["icode"] and a["resn"] in THREE_TO_ONE:
                residues.setdefault(a["resi"], THREE_TO_ONE[a["resn"]])
        if len(residues) < MIN_PAIRS:
            continue
        votes = Counter(resi - unp for resi, aa in residues.items() for unp in positions.get(aa, []))
        offset, matches = votes.most_common(1)[0]
        # Identité sur les résidus qui tombent dans la séquence UniProt : une
        # protéine fusionnée (lysozyme T4, BRIL…) numérotée à part n'y compte pas
        numbers = [r - offset for r in residues if 1 <= r - offset <= len(sequence)]
        if matches < MIN_PAIRS or matches / len(numbers) < MIN_IDENTITY:
            continue
        segments.append({"chain": chain, "unp_start": min(numbers), "unp_end": max(numbers), "offset": offset, "linear": True})
    return segments


def choose_chain(atoms: list[dict], segments: list[dict], numbers: set[int]) -> str | None:
    """Chaîne dont le plus de résidus observés correspondent à la région modélisée."""
    best, best_count = None, 0
    for chain in sorted({s["chain"] for s in segments}):
        count = len(set(_protein_ca(atoms, chain, _author_to_uniprot(segments, chain))) & numbers)
        if count > best_count:
            best, best_count = chain, count
    return best


# ---------------------------------------------------------------------------
# Superposition
# ---------------------------------------------------------------------------

def kabsch(mobile: np.ndarray, target: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Rotation R et translation t minimisant |R·mobile + t − target|."""
    mc, tc = mobile.mean(axis=0), target.mean(axis=0)
    h = (mobile - mc).T @ (target - tc)
    u, _, vt = np.linalg.svd(h)
    d = np.sign(np.linalg.det(vt.T @ u.T)) or 1.0
    rotation = vt.T @ np.diag([1.0, 1.0, d]) @ u.T
    return rotation, tc - rotation @ mc


def _apply(rotation: np.ndarray, translation: np.ndarray, points: np.ndarray) -> np.ndarray:
    return points @ rotation.T + translation


def tm_d0(length: int) -> float:
    return max(0.5, 1.24 * (max(length, 19) - 15) ** (1 / 3) - 1.8)


def tm_superpose(mobile: np.ndarray, target: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    """Superposition maximisant le TM-score (fragments de départ puis itérations)."""
    n = len(mobile)
    d0 = tm_d0(n)
    cutoff = max(d0 + 1.0, 4.5)
    best = (-1.0, np.eye(3), np.zeros(3))
    lengths = sorted({n, max(4, n // 2), max(4, n // 4), max(4, n // 8)}, reverse=True)
    for length in lengths:
        step = max(1, length // 2)
        for start in range(0, n - length + 1, step):
            subset = np.arange(start, start + length)
            for _ in range(20):
                rotation, translation = kabsch(mobile[subset], target[subset])
                d = np.linalg.norm(_apply(rotation, translation, mobile) - target, axis=1)
                score = float(np.sum(1.0 / (1.0 + (d / d0) ** 2)) / n)
                if score > best[0]:
                    best = (score, rotation, translation)
                closer = np.flatnonzero(d < cutoff)
                if len(closer) < 3:
                    closer = np.argsort(d)[:3]
                if np.array_equal(closer, subset):
                    break
                subset = closer
    score, rotation, translation = best
    return rotation, translation, score


def _rmsd(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.sum((a - b) ** 2, axis=1))))


def _ranks(values: np.ndarray) -> np.ndarray:
    order = np.argsort(values, kind="stable")
    ranks = np.empty(len(values))
    ranks[order] = np.arange(len(values))
    return ranks


def spearman(a: np.ndarray, b: np.ndarray) -> float | None:
    if len(a) < 3 or np.ptp(a) == 0 or np.ptp(b) == 0:
        return None
    return float(np.corrcoef(_ranks(a), _ranks(b))[0, 1])


# ---------------------------------------------------------------------------
# Comparaison
# ---------------------------------------------------------------------------

def _runs(numbers: list[int], flags: list[bool], min_length: int) -> list[tuple[int, int]]:
    """Plages de positions consécutives où `flags` est vrai."""
    runs, start, previous = [], None, None
    for number, flag in zip(numbers, flags):
        if flag and start is not None and number == previous + 1:
            previous = number
            continue
        if start is not None and previous - start + 1 >= min_length:
            runs.append((start, previous))
        start, previous = (number, number) if flag else (None, None)
    if start is not None and previous - start + 1 >= min_length:
        runs.append((start, previous))
    return runs


def _region_of(number: int, regions: list[dict]) -> dict | None:
    return next((r for r in regions if r["start"] <= number <= r["end"]), None)


def _write_experimental(atoms, chain, author_to_unp, rotation, translation) -> tuple[str, list[dict]]:
    """Chaîne expérimentale superposée, renumérotée en UniProt (chaîne E), et ses ligands."""
    lines, ligand_atoms = [], []
    fmt = lambda v: f"{v:8.3f}"[-8:]  # noqa: E731
    for a in atoms:
        if a["chain"] != chain:
            continue
        x, y, z = rotation @ a["coord"] + translation
        if a["record"] == "ATOM":
            unp = author_to_unp.get(a["resi"])
            if unp is None or a["icode"]:
                continue
            number = unp
        elif _is_ligand_candidate(a["resn"]):
            number = a["resi"]
            ligand_atoms.append({**a, "coord": np.array([x, y, z])})
        else:
            continue
        line = a["line"]
        lines.append(line[:21] + EXPERIMENTAL_CHAIN + f"{number:4d}" + line[26:30] + fmt(x) + fmt(y) + fmt(z) + line[54:])
    return "\n".join(lines + ["END"]) + "\n", ligand_atoms


def molecule_names(pdb: str) -> dict[str, str]:
    """Nom de la molécule de chaque chaîne, d'après les enregistrements COMPND de l'en-tête."""
    text = " ".join(line[10:].strip() for line in pdb.splitlines() if line.startswith("COMPND"))
    names, molecule = {}, None
    for field in text.split(";"):
        key, _, value = field.strip().partition(":")
        key, value = key.strip().upper(), value.strip()
        if key == "MOLECULE":
            molecule = value
        elif key == "CHAIN" and molecule:
            for chain in value.replace(" ", "").split(","):
                names[chain] = molecule
    return names


def _write_other_chains(atoms, chain, author_to_unp, rotation, translation, names) -> tuple[str, list[dict], bool]:
    """
    Reste du cristal, déplacé avec la même superposition : autres chaînes
    (protéines et ligands) et, dans la chaîne comparée, les résidus hors de la
    séquence UniProt (protéine fusionnée : lysozyme T4, BRIL…).
    """
    lines, residues = [], {}
    fused = 0
    fmt = lambda v: f"{v:8.3f}"[-8:]  # noqa: E731
    others = sum(1 for a in atoms if a["chain"] != chain and a["record"] == "ATOM")
    simplified = others > MAX_OTHER_ATOMS
    for a in atoms:
        if a["resn"] == "DUM":
            continue
        if simplified and a["chain"] != chain and (a["record"] != "ATOM" or a["name"] not in BACKBONE):
            continue
        if a["chain"] == chain:
            if a["record"] != "ATOM" or (a["resi"] in author_to_unp and not a["icode"]):
                continue
            x, y, z = rotation @ a["coord"] + translation
            line = a["line"]
            lines.append(line[:30] + fmt(x) + fmt(y) + fmt(z) + line[54:])
            fused += a["name"] == "CA"
            continue
        if a["record"] == "HETATM" and not _is_ligand_candidate(a["resn"]):
            continue
        x, y, z = rotation @ a["coord"] + translation
        line = a["line"]
        lines.append(line[:30] + fmt(x) + fmt(y) + fmt(z) + line[54:])
        if a["record"] == "ATOM" and a["name"] == "CA":
            residues[a["chain"]] = residues.get(a["chain"], 0) + 1
    if not lines:
        return "", [], False
    chains = [{"chain": c, "molecule": names.get(c), "residues": n, "fused": False} for c, n in sorted(residues.items())]
    if fused:
        chains.insert(0, {"chain": chain, "molecule": "Partie hors UniProt (protéine fusionnée)", "residues": fused, "fused": True})
    return "\n".join(lines + ["END"]) + "\n", chains, simplified


def _ligand_sites(ligand_atoms: list[dict], model_atoms: list[dict], plddt: dict[int, float]) -> list[dict]:
    """Résidus du modèle au contact de chaque ligand expérimental (après superposition)."""
    groups: dict[tuple, list[dict]] = {}
    for a in ligand_atoms:
        if a["element"] != "H":
            groups.setdefault((a["resn"], a["resi"]), []).append(a)
    if not groups or not model_atoms:
        return []
    model_xyz = np.array([a["coord"] for a in model_atoms])
    sites = []
    # Ligands biologiques connus d'abord, puis les plus gros
    ordered = sorted(groups.items(), key=lambda kv: (kv[0][0] not in IMPORTANT_LIGANDS, -len(kv[1])))
    for (resn, resi), group in ordered:
        xyz = np.array([a["coord"] for a in group])
        distances = np.linalg.norm(model_xyz[:, None, :] - xyz[None, :, :], axis=2).min(axis=1)
        contact = sorted({(model_atoms[i]["resi"], model_atoms[i]["resn"]) for i in np.flatnonzero(distances <= CONTACT)})
        if not contact:
            continue
        residues = [{"number": n, "aa": THREE_TO_ONE.get(r, "X"), "plddt": plddt.get(n)} for n, r in contact]
        sites.append(
            {
                "ligand": resn,
                "number": resi,
                "atoms": len(group),
                "residues": residues,
                "mean_plddt": round(float(np.mean([r["plddt"] for r in residues if r["plddt"] is not None])), 1)
                if any(r["plddt"] is not None for r in residues)
                else None,
            }
        )
    return sites


def compare_structures(
    prediction: dict,
    experimental: str | tuple[list[dict], dict[str, str]],
    pdb_id: str,
    mapping: dict,
    chain: str | None = None,
) -> dict:
    """Superpose la structure expérimentale sur le modèle (repère de la membrane) et mesure les écarts."""
    model_atoms_all = parse_atoms(prediction["pdb"])
    model_atoms = [a for a in model_atoms_all if a["record"] == "ATOM"]
    model_ca = {a["resi"]: a["coord"] for a in model_atoms if a["name"] == "CA"}
    model_aa = {r["number"]: r["aa"] for r in prediction["residues"]}
    plddt = {r["number"]: r["plddt"] for r in prediction["residues"]}

    # Texte PDB ou mmCIF, ou atomes et noms déjà lus
    atoms, names = read_structure(experimental) if isinstance(experimental, str) else experimental
    segments = mapping.get("segments", [])
    if chain is None:
        chain = choose_chain(atoms, segments, set(model_ca))
    if chain is None:
        raise ComparisonError("Aucune chaîne de cette structure ne correspond à la région modélisée.")
    author_to_unp = _author_to_uniprot(segments, chain)
    experimental = _protein_ca(atoms, chain, author_to_unp)

    numbers = sorted(set(model_ca) & set(experimental))
    if len(numbers) < MIN_PAIRS:
        raise ComparisonError(
            f"Trop peu de résidus communs entre le modèle et la chaîne {chain} de {pdb_id.upper()} ({len(numbers)})."
        )
    target = np.array([model_ca[n] for n in numbers])
    mobile = np.array([experimental[n]["ca"] for n in numbers])

    rotation, translation, tm_score = tm_superpose(mobile, target)
    moved = _apply(rotation, translation, mobile)
    distances = np.linalg.norm(moved - target, axis=1)
    r_all, t_all = kabsch(mobile, target)
    rmsd_all = _rmsd(_apply(r_all, t_all, mobile), target)
    close = distances < CLOSE

    # Résidus par résidu
    regions = prediction.get("regions") or []
    residues = []
    for n, d in zip(numbers, distances):
        residues.append(
            {
                "number": n,
                "aa": model_aa.get(n, "X"),
                "aa_experimental": experimental[n]["aa"],
                "distance": round(float(d), 2),
                "plddt": plddt.get(n),
            }
        )
    mutations = [
        {"number": r["number"], "model": r["aa"], "experimental": r["aa_experimental"]}
        for r in residues
        if r["aa"] != r["aa_experimental"]
    ]

    # Par région (hélices, boucles et extrémités du modèle)
    region_stats = []
    for region in regions:
        idx = [i for i, n in enumerate(numbers) if region["start"] <= n <= region["end"]]
        if not idx:
            continue
        d = distances[idx]
        region_stats.append(
            {
                "kind": region["kind"],
                "label": region["label"],
                "start": region["start"],
                "end": region["end"],
                "observed": len(idx),
                "length": region["end"] - region["start"] + 1,
                "mean_distance": round(float(d.mean()), 2),
                "max_distance": round(float(d.max()), 2),
                "rmsd": round(_rmsd(moved[idx], target[idx]), 2),
                "mean_plddt": region.get("mean_plddt"),
            }
        )

    # Inclinaison des hélices dans les deux structures (repère de la membrane du modèle)
    position = {n: i for i, n in enumerate(numbers)}
    helices = []
    for h in prediction.get("helices") or []:
        span = [n for n in range(h.get("helix_start", h["start"]), h.get("helix_end", h["end"]) + 1) if n in position]
        if len(span) < 7:
            continue
        axis = helix_axis(moved[[position[n] for n in span]])
        tilt = math.degrees(math.acos(min(1.0, abs(float(axis[2])))))
        helices.append(
            {
                "label": h["label"],
                "tilt_model": h["tilt"],
                "tilt_experimental": round(tilt, 1),
                "tilt_difference": round(abs(tilt - h["tilt"]), 1),
                "rmsd": round(_rmsd(moved[[position[n] for n in span]], target[[position[n] for n in span]]), 2),
            }
        )

    # Régions nettement différentes, et accord avec le pLDDT
    deviant = [
        {
            "start": a,
            "end": b,
            "mean_distance": round(float(distances[position[a]:position[b] + 1].mean()), 1),
            "mean_plddt": round(float(np.mean([plddt[n] for n in range(a, b + 1) if n in plddt])), 1),
            "region": (_region_of((a + b) // 2, regions) or {}).get("label"),
        }
        for a, b in _runs(numbers, list(distances > FAR), MIN_DEVIANT_LENGTH)
    ]
    plddt_values = np.array([plddt.get(n, 0.0) for n in numbers])
    correlation = spearman(plddt_values, distances)

    pdb_text, ligand_atoms = _write_experimental(atoms, chain, author_to_unp, rotation, translation)
    others_text, other_chains, simplified = _write_other_chains(atoms, chain, author_to_unp, rotation, translation, names)
    # Identifiant de la chaîne comparée dans le fichier du reste du cristal (un caractère)
    chain_alias = next((a["line"][21] for a in atoms if a["chain"] == chain), chain[:1])
    ligands = _ligand_sites(ligand_atoms, model_atoms, plddt)

    window = prediction.get("window") or {"start": numbers[0], "end": numbers[-1]}
    modelled = window["end"] - window["start"] + 1
    result = {
        "pdb_id": pdb_id.upper(),
        "chain": chain,
        "chains": sorted({s["chain"] for s in segments}),
        "pdb": pdb_text,
        # Reste du cristal (autres chaînes et leurs ligands), dans le même repère
        "pdb_others": others_text,
        "other_chains": other_chains,
        "others_simplified": simplified,
        "chain_alias": chain_alias,
        "molecule": names.get(chain),
        "experimental_chain": EXPERIMENTAL_CHAIN,
        "pairs": len(numbers),
        "modelled": modelled,
        "coverage": round(len(numbers) / modelled, 3),
        "tm_score": round(tm_score, 3),
        "rmsd_all": round(rmsd_all, 2),
        "rmsd_close": round(_rmsd(moved[close], target[close]), 2) if close.any() else None,
        "fraction_close": round(float(close.mean()), 3),
        "fraction_far": round(float((distances > FAR).mean()), 3),
        "plddt_correlation": round(correlation, 2) if correlation is not None else None,
        "residues": residues,
        "regions": region_stats,
        "helices": helices,
        "deviant_regions": deviant,
        "mutations": mutations,
        "ligands": ligands,
        "method": "Correspondance SIFTS, superposition maximisant le TM-score (Kabsch itératif), écarts entre Cα",
    }
    result["interpretation"] = interpret(result)
    return result


# ---------------------------------------------------------------------------
# Lecture en phrases
# ---------------------------------------------------------------------------

def _f(value: float, digits: int = 1) -> str:
    return f"{value:.{digits}f}".replace(".", ",")


def interpret(c: dict) -> list[dict]:
    notes = []
    tm = c["tm_score"]
    if tm >= 0.8:
        level, verdict = "good", "le modèle reproduit très fidèlement la structure expérimentale"
    elif tm >= 0.5:
        level, verdict = "good", "même repliement, avec des différences locales"
    else:
        level, verdict = "warning", "les deux structures n’ont pas le même repliement global"
    notes.append(
        {
            "level": level,
            "topic": "global",
            "title": f"TM-score {_f(tm, 2)} : {verdict}",
            "text": f"{c['pairs']} résidus comparés (chaîne {c['chain']} de {c['pdb_id']}, {round(c['coverage'] * 100)} % de la "
            f"région modélisée). {round(c['fraction_close'] * 100)} % des Cα sont à moins de {_f(CLOSE, 0)} Å "
            f"(RMSD {_f(c['rmsd_close'] or 0, 2)} Å sur ces résidus) ; RMSD sur l’ensemble : {_f(c['rmsd_all'], 2)} Å. "
            "Un TM-score supérieur à 0,5 indique le même repliement.",
        }
    )

    tm_regions = [r for r in c["regions"] if r["kind"] == "tm"]
    loops = [r for r in c["regions"] if r["kind"] != "tm"]
    if tm_regions:
        core = sum(r["mean_distance"] * r["observed"] for r in tm_regions) / sum(r["observed"] for r in tm_regions)
        text = f"Écart moyen de {_f(core)} Å dans les hélices transmembranaires"
        if loops:
            outer = sum(r["mean_distance"] * r["observed"] for r in loops) / sum(r["observed"] for r in loops)
            text += f", {_f(outer)} Å dans les boucles et extrémités"
        text += "."
        if core < CLOSE:
            text += " L’architecture du cœur membranaire est prédite à l’échelle atomique près."
        notes.append({"level": "good" if core < CLOSE else "info", "topic": "membrane", "title": "Cœur membranaire", "text": text})

    if c["deviant_regions"]:
        listing = " ; ".join(
            f"{d['start']}–{d['end']}" + (f" ({d['region']})" if d["region"] else "") + f" : {_f(d['mean_distance'])} Å, pLDDT {_f(d['mean_plddt'], 0)}"
            for d in c["deviant_regions"]
        )
        notes.append(
            {
                "level": "warning",
                "topic": "deviations",
                "title": f"Régions qui diffèrent de plus de {_f(FAR, 0)} Å",
                "text": f"{listing}. Ces écarts viennent d’une erreur du modèle, d’une région flexible, ou d’un autre état "
                "conformationnel dans le cristal (ligand, partenaire, contacts cristallins).",
            }
        )
        confident = [d for d in c["deviant_regions"] if d["mean_plddt"] >= CONFIDENT]
        if confident:
            notes.append(
                {
                    "level": "warning",
                    "topic": "confidence",
                    "title": "Écarts malgré une confiance élevée",
                    "text": ", ".join(f"{d['start']}–{d['end']}" for d in confident)
                    + " : pLDDT ≥ 70 mais structure différente. Signe fréquent d’un changement de conformation "
                    "(autre état fonctionnel) ou d’une interface avec une autre sous-unité, que le modèle d’une chaîne seule ignore.",
                }
            )

    rho = c["plddt_correlation"]
    if rho is not None:
        if rho <= -0.3:
            text = "Les régions de pLDDT faible sont bien celles qui s’écartent le plus : le pLDDT est un bon guide pour cette protéine."
            level = "good"
        else:
            text = "Le pLDDT prédit mal où se trouvent les écarts : ne pas s’y fier seul pour cette protéine."
            level = "info"
        notes.append(
            {
                "level": level,
                "topic": "confidence",
                "title": f"Confiance et écarts (corrélation de Spearman {_f(rho, 2)})",
                "text": text,
            }
        )

    tilted = [h for h in c["helices"] if h["tilt_difference"] >= TILT_DIFFERENCE]
    if c["helices"]:
        if tilted:
            text = "Inclinaison différente de plus de 10° : " + ", ".join(
                f"{h['label']} ({_f(h['tilt_model'], 0)}° prédit, {_f(h['tilt_experimental'], 0)}° observé)" for h in tilted
            ) + "."
        else:
            text = "Toutes les hélices ont la même inclinaison dans les deux structures, à 10° près."
        notes.append({"level": "warning" if tilted else "good", "topic": "helices", "title": "Inclinaison des hélices", "text": text})

    # Une note par type de ligand (le site le plus étendu), au plus quatre
    copies = Counter(site["ligand"] for site in c["ligands"])
    first_sites = list({site["ligand"]: site for site in reversed(c["ligands"])}.values())[::-1]
    for site in first_sites[:4]:
        residues = ", ".join(f"{r['aa']}{r['number']}" for r in site["residues"][:14])
        if len(site["residues"]) > 14:
            residues += "…"
        notes.append(
            {
                "level": "info",
                "topic": "ligands",
                "title": f"Ligand {site['ligand']} : site reporté sur le modèle"
                + (f" ({copies[site['ligand']]} copies)" if copies[site["ligand"]] > 1 else ""),
                "text": f"Après superposition, {len(site['residues'])} résidus du modèle sont à moins de {_f(CONTACT)} Å du "
                f"{site['ligand']} expérimental : {residues}"
                + (f" (pLDDT moyen {_f(site['mean_plddt'], 0)})." if site["mean_plddt"] is not None else ".")
                + " Le modèle ne contient pas le ligand : la poche est-elle bien formée sans lui ?",
            }
        )

    if c["mutations"]:
        listing = ", ".join(f"{m['model']}{m['number']}{m['experimental']}" for m in c["mutations"][:10])
        notes.append(
            {
                "level": "info",
                "topic": "sequence",
                "title": f"{len(c['mutations'])} différence(s) de séquence",
                "text": f"{listing}. La construction cristallisée porte des mutations (stabilisation, étude fonctionnelle) "
                "ou provient d’un variant : écarts locaux possibles autour de ces positions.",
            }
        )

    notes.append(
        {
            "level": "info",
            "topic": "limits",
            "title": "Limites de la comparaison",
            "text": "La structure expérimentale est un état parmi d’autres (cristal, cryo-ME, détergent ou nanodisque). "
            "Les résidus non observés dans l’expérience ne sont pas comparés. Les deux structures sont montrées dans "
            "la membrane placée sur le modèle.",
        }
    )
    return notes


def _compare(prediction: dict, accession: str, pdb_id: str, chain: str | None) -> dict:
    """Comparaison d'un modèle placé dans la membrane avec une structure PDB (erreur dans « error »)."""
    try:
        text, file_format = fetch_pdb_text(pdb_id), "PDB"
        if text is None:
            # Très grandes structures : distribuées seulement en mmCIF
            text, file_format = fetch_cif_text(pdb_id), "mmCIF"
        if text is None:
            return {"error": f"Coordonnées introuvables pour {pdb_id.upper()}."}
        structure = read_structure(text)
        mapping = sifts_service.get_mapping(pdb_id, accession)
        source = "SIFTS"
        if not mapping.get("available"):
            sequence = uniprot_service.fetch_entry(accession).get("sequence", {}).get("value", "")
            mapping = {"segments": infer_segments(structure[0], sequence)}
            source = "séquence"
            if not mapping["segments"]:
                return {"error": f"{pdb_id.upper()} ne contient pas de chaîne correspondant à {accession}."}
        result = compare_structures(prediction, structure, pdb_id, mapping, chain)
        result["mapping_source"] = source
        result["file_format"] = file_format
        if source != "SIFTS":
            result["method"] = result["method"].replace(
                "Correspondance SIFTS", "Numérotation déduite de la séquence (SIFTS incomplet)"
            )
        return result
    except ComparisonError as e:
        return {"error": str(e)}


@cached("comparison:v8", ttl=30 * 24 * 3600, store_if=is_successful)
def compare_prediction_job(job_id: str, accession: str, pdb_id: str, chain: str | None = None) -> dict:
    """Comparaison d'une prédiction ESMFold terminée, mise en cache (un résultat de tâche ne change pas)."""
    job = jobs.get(job_id)
    if not job or job["kind"] != "structure_prediction" or job["status"] != "succeeded":
        return {"error": "Prédiction introuvable ou pas encore terminée."}
    return _compare(job["result"], accession, pdb_id, chain)


@cached("alphafold:pdb", ttl=30 * 24 * 3600)
def fetch_alphafold_pdb(url: str) -> str | None:
    response = http.get(url, timeout=60)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.text


@cached("alphafold:placed:v1", ttl=30 * 24 * 3600, store_if=is_successful)
def alphafold_in_membrane(accession: str, topology: dict) -> dict:
    """Modèle AlphaFold DB de l'entrée, placé dans la membrane comme les prédictions ESMFold."""
    model = get_alphafold(accession)
    if not model.get("available") or not model.get("pdb_url"):
        return {"error": f"Aucun modèle AlphaFold pour {accession}."}
    text = fetch_alphafold_pdb(model["pdb_url"])
    if text is None:
        return {"error": "Fichier du modèle AlphaFold indisponible."}
    placed = place_model(
        text,
        model["sequence"],
        accession,
        topology.get("tm_segments"),
        topology.get("tm_source", "kd"),
        topology.get("n_terminus"),
        "AlphaFold",
    )
    placed["model_id"] = model.get("model_id")
    return placed


@cached("comparison:alphafold:v6", ttl=30 * 24 * 3600, store_if=is_successful)
def compare_alphafold(accession: str, pdb_id: str, topology: dict, chain: str | None = None) -> dict:
    """Modèle AlphaFold placé dans la membrane et sa superposition avec une structure PDB."""
    placed = alphafold_in_membrane(accession, topology)
    if placed.get("error"):
        return placed
    comparison = _compare(placed, accession, pdb_id, chain)
    if comparison.get("error"):
        return comparison
    return {"model": placed, "comparison": comparison}
