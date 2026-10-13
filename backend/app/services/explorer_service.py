"""
Membrane Evolution & Function Explorer.

D'une famille de protéines membranaires homologues (fichier FASTA) à la carte
structurale de ses résidus :

1. Import FASTA : la séquence de référence est alignée avec chaque homologue
   (alignement ancré, voir alignment.py), ou l'alignement fourni est repris tel
   quel sur les colonnes de la référence.
2. Conservation de chaque position (divergence de Jensen-Shannon, grades 1–9).
3. Topologie de la référence : DeepTMHMM (s'il a déjà répondu), sinon
   annotations UniProt, sinon estimation Kyte-Doolittle.
4. Structure : modèle AlphaFold DB (entrée UniProt) ou ESMFold, placé dans la
   membrane ; orientation expérimentale OPM d'une structure PDB si elle existe.
5. Coévolution des positions (information mutuelle + APC), confrontée aux
   contacts de la structure, et réseaux de résidus couplés.
6. Cartographie : profondeur dans la membrane, enfouissement et positions
   candidates (fonction, empilement d'hélices, interface), avec leurs raisons.
"""

import re
from collections import Counter

import numpy as np

from app import jobs
from app.services import uniprot_service
from app.services.alignment import align_to_query, anchored_score, significance
from app.services.coevolution_service import MAX_LENGTH as COEVOLUTION_MAX_LENGTH, compute_coevolution
from app.services.conservation_service import (
    analyze_alignment,
    fetch_cluster_members,
    fetch_sequences,
    find_uniref50_cluster,
    membrane_regions,
    regions_from_segments,
    select_representatives,
    _is_swissprot,
    _mmseqs_alignment,
)
from app.services.homology_service import find_identical_entry
from app.services.membrane_orientation_service import estimate_tm_segments
from app.services.phylogeny_service import build_tree
from app.services.sca_service import compute_sca

# À incrémenter quand la méthode change : les anciens résultats sont recalculés
METHOD_VERSION = 5
MIN_SEQUENCES = 2
MAX_SEQUENCES = 500
MIN_REFERENCE_LENGTH = 20
MAX_REFERENCE_LENGTH = 1500
MIN_COVERAGE = 0.5
MIN_IDENTITY = 0.2
MIN_RELIABLE = 10
# Arbre : les homologues les plus proches (l'arbre de 1 000 feuilles serait illisible et lent)
MAX_TREE_SEQUENCES = 100
# Paires fortes : réseaux et positions couplées
STRONG_PAIR_Z = 3.0
# Poids de la coévolution dans le classement des candidates, selon la profondeur de l'alignement
COUPLING_WEIGHT = {"insuffisante": 0.0, "faible": 0.5, "moyenne": 1.0, "bonne": 1.0}

CONTACT_DISTANCE = 8.0  # Å entre Cβ (Cα pour la glycine)
NEIGHBOUR_RADIUS = 10.0  # Å : enfouissement
BURIED, EXPOSED = 22, 14  # voisins Cβ à 10 Å
INTERFACE_WIDTH = 5.0  # Å de part et d'autre de chaque face de la membrane
MAX_CANDIDATES = 40
MAX_NETWORKS = 12
CONFIDENT_PLDDT = 70.0

POLAR = set("DEKRHNQ")
SMALL = set("GAS")
UNIPROT_ACCESSION = re.compile(r"\b([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})\b")

ZONE_LABELS = {
    "core": "Cœur hydrophobe",
    "interface_out": "Interface externe",
    "interface_in": "Interface cytoplasmique",
    "out": "Côté externe",
    "in": "Côté cytoplasmique",
    "membrane": "Segment transmembranaire",
    "loop": "Hors membrane",
}


class ExplorerError(ValueError):
    pass


# ---------------------------------------------------------------------------
# 1. Import FASTA
# ---------------------------------------------------------------------------

def _accession_from_header(header: str) -> str | None:
    """Accession UniProt d'un en-tête (sp|P02945|…, UniRef100_P02945, P02945 …)."""
    match = re.match(r"(?:sp|tr)\|([A-Z0-9]+)\|", header)
    if match:
        return match.group(1)
    match = re.match(r"UniRef\d+_([A-Z0-9]+)", header)
    if match and UNIPROT_ACCESSION.fullmatch(match.group(1)):
        return match.group(1)
    first = header.split()[0] if header.split() else ""
    match = UNIPROT_ACCESSION.search(first)
    return match.group(1) if match else None


def parse_fasta(text: str) -> list[dict]:
    """Séquences d'un texte FASTA ; les gaps (- et .) sont conservés."""
    records, header, lines = [], None, []

    def flush():
        if header is not None:
            raw = re.sub(r"[^A-Za-z\-.]", "", "".join(lines)).replace(".", "-")
            records.append({"header": header, "raw": raw})

    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(";"):
            continue
        if line.startswith(">"):
            flush()
            header, lines = line[1:].strip() or f"sequence_{len(records) + 1}", []
        elif header is None:
            raise ExplorerError("Le texte doit être au format FASTA : chaque séquence commence par une ligne « > nom ».")
        else:
            lines.append(line)
    flush()

    seen: dict[str, int] = {}
    for record in records:
        header = record["header"]
        identifier = re.sub(r"[^\w.|:-]", "_", header.split()[0])[:60]
        count = seen.get(identifier, 0)
        seen[identifier] = count + 1
        record["id"] = identifier if not count else f"{identifier}_{count + 1}"
        record["sequence"] = record["raw"].replace("-", "").upper()
        record["accession"] = _accession_from_header(header)
        organism = re.search(r"\bOS=(.+?)(?=\s+[A-Z]{2}=|$)", header)
        taxon = re.search(r"\bOX=(\d+)", header)
        record["organism"] = organism.group(1).strip() if organism else None
        record["taxon_id"] = int(taxon.group(1)) if taxon else None
        description = re.sub(r"\s+[A-Z]{2}=.*$", "", header.split(None, 1)[1]) if len(header.split()) > 1 else None
        record["description"] = description or None
    return [r for r in records if r["sequence"]]


def is_prealigned(records: list[dict]) -> bool:
    """Alignement fourni : gaps présents et toutes les lignes de même longueur."""
    return len({len(r["raw"]) for r in records}) == 1 and any("-" in r["raw"] for r in records)


def validate(records: list[dict], reference: int, expand: bool = False) -> None:
    if not records:
        raise ExplorerError("Aucune séquence lue dans le fichier.")
    if len(records) < MIN_SEQUENCES and not expand:
        raise ExplorerError(
            "Il faut au moins deux séquences : la référence et un homologue (ou activez la recherche étendue MMseqs2)."
        )
    if len(records) > MAX_SEQUENCES:
        raise ExplorerError(f"Trop de séquences ({len(records)}) : {MAX_SEQUENCES} au maximum.")
    if not 0 <= reference < len(records):
        raise ExplorerError("Séquence de référence introuvable dans le fichier.")
    length = len(records[reference]["sequence"])
    if length < MIN_REFERENCE_LENGTH:
        raise ExplorerError(f"Séquence de référence trop courte ({MIN_REFERENCE_LENGTH} résidus minimum).")
    if length > MAX_REFERENCE_LENGTH:
        raise ExplorerError(f"Séquence de référence trop longue ({MAX_REFERENCE_LENGTH} résidus maximum).")


def to_fasta(records: list[dict]) -> str:
    """Texte FASTA normalisé (en-têtes et lignes d'origine, gaps compris)."""
    return "".join(f">{r['header']}\n{r['raw']}\n" for r in records)


def build_alignment(records: list[dict], reference: int, allow_empty: bool = False) -> dict:
    """
    Alignement ancré sur la référence : une ligne par homologue, de la longueur
    de la référence. Les homologues trop partiels ou trop éloignés sont écartés.
    """
    ref = records[reference]
    query = ref["sequence"]
    prealigned = is_prealigned(records)
    columns = [k for k, c in enumerate(ref["raw"]) if c != "-"] if prealigned else []

    rows, homologs, excluded, seen = [], [], [], {query}
    for index, record in enumerate(records):
        if index == reference:
            continue
        if record["sequence"] in seen:
            excluded.append({"id": record["id"], "reason": "Séquence identique à une autre séquence du fichier"})
            continue
        seen.add(record["sequence"])
        if prealigned:
            row = "".join(record["raw"][k].upper() if record["raw"][k] != "-" else "-" for k in columns)
            aligned = [(q, s) for q, s in zip(query, row) if s != "-"]
            identity = sum(q == s for q, s in aligned) / len(aligned) if aligned else 0.0
            coverage = len(aligned) / len(query)
            score = anchored_score(query, row)
        else:
            pair = align_to_query(query, record["sequence"])
            row, identity, coverage, score = pair.anchored, pair.identity, pair.coverage, pair.score
        if coverage < MIN_COVERAGE:
            excluded.append({"id": record["id"], "reason": f"Couverture de la référence trop faible ({coverage:.0%})"})
            continue
        if identity < MIN_IDENTITY:
            excluded.append({"id": record["id"], "reason": f"Identité trop faible ({identity:.0%})"})
            continue
        rows.append(row)
        bits, evalue = significance(score, len(query), len(record["sequence"]))
        accession = record["accession"]
        homologs.append(
            {
                "accession": record["id"],
                "entry_name": record["id"],
                "protein_name": record["description"],
                "organism": record["organism"],
                "taxon_id": record["taxon_id"],
                "reviewed": record["header"].startswith("sp|"),
                "length": len(record["sequence"]),
                "identity": round(identity, 3),
                "coverage": round(coverage, 3),
                "bits": round(bits, 1),
                "evalue": float(f"{evalue:.3g}"),
                "uniprot_accession": accession,
                "link": f"https://www.uniprot.org/uniprotkb/{accession}/entry" if accession else None,
            }
        )
    if not rows and not allow_empty:
        raise ExplorerError("Aucun homologue ne s'aligne suffisamment sur la référence (couverture ≥ 50 %, identité ≥ 20 %).")

    order = sorted(range(len(rows)), key=lambda k: -homologs[k]["identity"])
    return {
        "query": query,
        "rows": [rows[k] for k in order],
        "homologs": [homologs[k] for k in order],
        "excluded": excluded,
        "prealigned": prealigned,
    }


# ---------------------------------------------------------------------------
# 2. Référence UniProt et topologie
# ---------------------------------------------------------------------------

def identify_reference(record: dict, accession: str | None) -> dict:
    """Entrée UniProt de la référence : accession fournie, en-tête, ou séquence identique (UniParc)."""
    candidates = []
    if accession:
        candidates.append((accession.upper().strip(), "user"))
    if record["accession"]:
        candidates.append((record["accession"], "header"))

    for candidate, origin in candidates:
        try:
            entry = uniprot_service.fetch_entry(candidate)
        except Exception:
            continue
        if entry.get("sequence", {}).get("value", "") == record["sequence"]:
            return {"accession": candidate, "origin": origin, "entry": entry, "mismatch": False}
        if origin == "user":
            # Séquence différente : annotations et modèle non transposables
            return {"accession": candidate, "origin": origin, "entry": None, "mismatch": True}

    match = find_identical_entry(record["sequence"])
    if match:
        try:
            return {"accession": match["accession"], "origin": "uniparc", "entry": uniprot_service.fetch_entry(match["accession"]), "mismatch": False}
        except Exception:
            pass
    return {"accession": None, "origin": None, "entry": None, "mismatch": False}


def regions_with_sides(segments: list[dict], length: int, n_terminus: str | None, estimated: bool) -> list[dict]:
    """Régions à partir des segments TM ; côtés des boucles déduits de l'alternance."""
    regions = regions_from_segments(segments, length, estimated)
    if n_terminus not in ("in", "out"):
        return regions
    side, counters = n_terminus, {"in": 0, "out": 0}
    names = {"out": "Boucle extérieure", "in": "Boucle cytoplasmique"}
    for region in regions:
        if region["kind"] == "tm":
            side = "out" if side == "in" else "in"
            continue
        region["side"] = side
        region["kind"] = f"loop_{side}"
        if region["start"] != 1 and region["end"] != length:
            counters[side] += 1
            region["label"] = f"{names[side]} {counters[side]}"
    return regions


def reference_topology(sequence: str, entry: dict | None, name: str) -> dict:
    """Segments TM et régions de la référence, avec leur source."""
    from app.services.membrane_service import deeptmhmm_enabled

    deeptmhmm_status = None
    if deeptmhmm_enabled():
        job = jobs.submit("deeptmhmm", {"sequence": sequence, "name": name}, key_params={"sequence": sequence})
        deeptmhmm_status = job["status"]
        result = job.get("result") or {}
        if job["status"] == "succeeded" and result.get("tm_segments"):
            segments = [{"start": s["start"], "end": s["end"], "label": s["label"]} for s in result["tm_segments"]]
            return {
                "source": "deeptmhmm",
                "segments": segments,
                "n_terminus": result.get("n_terminus"),
                "regions": regions_with_sides(segments, len(sequence), result.get("n_terminus"), False),
                "predicted_type": result.get("predicted_type"),
                "signal_peptide": result.get("signal_peptide"),
                "deeptmhmm_status": deeptmhmm_status,
            }

    if entry is not None:
        segments = uniprot_service.tm_segments(entry)
        if segments:
            regions = membrane_regions(entry, len(sequence))
            return {
                "source": "uniprot",
                "segments": segments,
                "n_terminus": uniprot_service.n_terminus_side(entry),
                "regions": regions,
                "predicted_type": None,
                "signal_peptide": None,
                "deeptmhmm_status": deeptmhmm_status,
            }

    segments = [{"start": s["start"], "end": s["end"], "label": s["label"]} for s in estimate_tm_segments(sequence)]
    return {
        "source": "kd",
        "segments": segments,
        "n_terminus": None,
        "regions": regions_from_segments(segments, len(sequence), estimated=True),
        "predicted_type": None,
        "signal_peptide": None,
        "deeptmhmm_status": deeptmhmm_status,
    }


# ---------------------------------------------------------------------------
# 3. Structure placée dans la membrane et OPM
# ---------------------------------------------------------------------------

def residue_geometry(pdb: str) -> dict[int, dict]:
    """Cα, Cβ (Cα pour la glycine) et pLDDT de chaque résidu d'un PDB orienté."""
    residues: dict[int, dict] = {}
    for line in pdb.splitlines():
        if not line.startswith("ATOM"):
            continue
        name = line[12:16].strip()
        if name not in ("CA", "CB"):
            continue
        number = int(line[22:26])
        xyz = np.array([float(line[30:38]), float(line[38:46]), float(line[46:54])])
        r = residues.setdefault(number, {"plddt": float(line[60:66])})
        r[name] = xyz
    for r in residues.values():
        r.setdefault("CB", r.get("CA"))
    return {k: v for k, v in residues.items() if v.get("CA") is not None}


def structure_features(pdb: str, half_thickness: float | None) -> dict:
    """
    Par résidu : profondeur z (normale à la membrane, z > 0 côté externe),
    zone, enfouissement (voisins Cβ à 10 Å). Contacts Cβ–Cβ < 8 Å.
    """
    geometry = residue_geometry(pdb)
    numbers = sorted(geometry)
    cb = np.array([geometry[k]["CB"] for k in numbers])
    distances = np.linalg.norm(cb[:, None, :] - cb[None, :, :], axis=-1)
    neighbours = (distances < NEIGHBOUR_RADIUS).sum(axis=1) - 1

    residues = {}
    for k, number in enumerate(numbers):
        z = float(geometry[number]["CA"][2])
        if half_thickness:
            depth = abs(z)
            if depth <= half_thickness - INTERFACE_WIDTH:
                zone = "core"
            elif depth <= half_thickness + INTERFACE_WIDTH:
                zone = "interface_out" if z > 0 else "interface_in"
            else:
                zone = "out" if z > 0 else "in"
        else:
            zone = None
        count = int(neighbours[k])
        residues[number] = {
            "z": round(z, 1) if half_thickness else None,
            "zone": zone,
            "neighbours": count,
            "burial": "enfoui" if count >= BURIED else "exposé" if count <= EXPOSED else "intermédiaire",
            "plddt": round(geometry[number]["plddt"], 1),
        }

    contacts = []
    i_idx, j_idx = np.nonzero(np.triu(distances < CONTACT_DISTANCE, k=1))
    for a, b in zip(i_idx, j_idx):
        if numbers[b] - numbers[a] >= 5:
            contacts.append([numbers[a], numbers[b]])
    return {"residues": residues, "contacts": contacts, "distance": (numbers, distances)}


def find_opm(accession: str, length: int) -> dict | None:
    """Orientation OPM de la première structure PDB de la protéine référencée dans OPM."""
    from app.services.opm_service import get_opm_data
    from app.services.pdb_service import get_pdb_structures

    structures = get_pdb_structures(accession, length).get("structures") or []
    for structure in structures[:6]:
        opm = get_opm_data(structure["pdb_id"])
        if opm.get("available"):
            return {
                "pdb_id": opm["pdb_id"],
                "opm_pdb_id": opm.get("opm_pdb_id"),
                "url": opm.get("url"),
                "name": opm.get("name"),
                "type": opm.get("type"),
                "family": opm.get("family"),
                "superfamily": opm.get("superfamily"),
                "membrane": opm.get("membrane"),
                "hydrophobic_thickness": opm.get("hydrophobic_thickness"),
                "tilt_angle": opm.get("tilt_angle"),
                "n_terminus": opm.get("n_terminus"),
                "topology_in": opm.get("topology_in"),
                "topology_out": opm.get("topology_out"),
                "structure_count": len(structures),
            }
    return {"pdb_id": None, "structure_count": len(structures)} if structures else None


def reference_structure(accession: str | None, sequence: str, topology: dict, name: str) -> dict:
    """Modèle AlphaFold DB (entrée UniProt) ou ESMFold, placé dans la membrane."""
    params = {"tm_segments": topology["segments"] or None, "tm_source": topology["source"], "n_terminus": topology["n_terminus"]}
    if accession:
        from app.services.structure_comparison_service import alphafold_in_membrane

        placed = alphafold_in_membrane(accession, params)
        # Le modèle doit porter exactement la séquence de référence (même version UniProt)
        modelled = "".join(r["aa"] for r in placed.get("residues", []))
        if not placed.get("error") and modelled == sequence:
            return {"source": "AlphaFold", **placed}

    from app.services.structure_prediction_service import predict_structure

    placed = predict_structure(sequence, name=name, **params)
    return {"source": "ESMFold", **placed}


# ---------------------------------------------------------------------------
# 4. Coévolution annotée
# ---------------------------------------------------------------------------

def _region_at(regions: list[dict], position: int) -> dict | None:
    return next((r for r in regions if r["start"] <= position <= r["end"]), None)


def _pair_kind(a: dict | None, b: dict | None) -> str:
    membrane = ("tm", "intramembrane")
    a_tm, b_tm = bool(a and a["kind"] in membrane), bool(b and b["kind"] in membrane)
    if a_tm and b_tm:
        return "intra_helix" if a["label"] == b["label"] else "inter_helix"
    if a_tm or b_tm:
        return "tm_loop"
    return "loops"


def annotate_pairs(coevolution: dict, regions: list[dict], structure: dict | None) -> None:
    """Région de chaque position, distance dans la structure et précision des premières paires."""
    length = coevolution["length"]
    distance_of = None
    if structure:
        numbers, distances = structure["distance"]
        index = {n: k for k, n in enumerate(numbers)}
        plddt = {n: r["plddt"] for n, r in structure["residues"].items()}

        def distance_of(i, j):
            if i in index and j in index:
                return float(distances[index[i], index[j]]), min(plddt[i], plddt[j])
            return None, None

    for pair in coevolution["pairs"]:
        a, b = _region_at(regions, pair["i"]), _region_at(regions, pair["j"])
        pair["region_i"] = a["label"] if a else None
        pair["region_j"] = b["label"] if b else None
        pair["kind"] = _pair_kind(a, b)
        if distance_of:
            d, confidence = distance_of(pair["i"], pair["j"])
            pair["distance"] = round(d, 1) if d is not None else None
            pair["contact"] = d is not None and d < CONTACT_DISTANCE
            pair["confident"] = confidence is not None and confidence >= CONFIDENT_PLDDT

    precision = []
    if distance_of:
        for label, count in (("L/10", length // 10), ("L/5", length // 5), ("L/2", length // 2)):
            top = [p for p in coevolution["pairs"][:max(count, 1)] if p.get("distance") is not None]
            if top:
                precision.append({"label": label, "count": len(top), "precision": round(sum(p["contact"] for p in top) / len(top), 3)})
    coevolution["precision"] = precision
    # Contacts aléatoires attendus : référence pour juger la précision
    if structure:
        n = len(structure["residues"])
        possible = max(1, (n - 5) * (n - 4) // 2)
        coevolution["random_precision"] = round(len(structure["contacts"]) / possible, 3)


def coupling_networks(pairs: list[dict], positions: list[dict], regions: list[dict]) -> list[dict]:
    """Réseaux de résidus couplés (composantes connexes des meilleures paires)."""
    parent: dict[int, int] = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for p in pairs:
        parent[find(p["i"])] = find(p["j"])
    groups: dict[int, set[int]] = {}
    for p in pairs:
        for x in (p["i"], p["j"]):
            groups.setdefault(find(x), set()).add(x)

    networks = []
    for members in groups.values():
        if len(members) < 3:
            continue
        residues = sorted(members)
        labels = sorted({r["label"] for r in (_region_at(regions, x) for x in residues) if r and r["kind"] in ("tm", "intramembrane")})
        links = [p for p in pairs if p["i"] in members]
        networks.append(
            {
                "residues": [{"position": x, "residue": positions[x - 1]["residue"], "grade": positions[x - 1]["grade"]} for x in residues],
                "size": len(residues),
                "links": [[p["i"], p["j"]] for p in links],
                "helices": labels,
                "mean_grade": round(sum(positions[x - 1]["grade"] for x in residues) / len(residues), 1),
                "contacts": sum(1 for p in links if p.get("contact")),
                "with_distance": sum(1 for p in links if p.get("distance") is not None),
            }
        )
    networks.sort(key=lambda n: (-n["size"], -n["mean_grade"]))
    for k, network in enumerate(networks[:MAX_NETWORKS], start=1):
        network["id"] = k
    return networks[:MAX_NETWORKS]


def _compactness(members: list[int], structure: dict | None) -> float | None:
    """Distance Cβ moyenne entre membres, rapportée à celle de tous les résidus (< 1 : groupe compact en 3D)."""
    if not structure or len(members) < 2:
        return None
    numbers, distances = structure["distance"]
    index = {n: k for k, n in enumerate(numbers)}
    rows = [index[m] for m in members if m in index]
    if len(rows) < 2:
        return None
    inside = distances[np.ix_(rows, rows)][np.triu_indices(len(rows), 1)].mean()
    overall = distances[np.triu_indices(len(numbers), 1)].mean()
    return round(float(inside / overall), 2) if overall else None


def annotate_sectors(sca: dict, positions: list[dict], regions: list[dict], structure: dict | None) -> None:
    """Résidus, hélices, zones membranaires et compacité 3D de chaque secteur SCA."""
    for sector in sca["sectors"]:
        members = sector["positions"]
        sector["residues"] = [
            {
                "position": m,
                "residue": positions[m - 1]["residue"],
                "grade": positions[m - 1]["grade"],
                "weight": sector["weights"][m],
                "zone": positions[m - 1].get("zone"),
            }
            for m in members
        ]
        del sector["weights"]
        sector["size"] = len(members)
        sector["helices"] = sorted(
            {r["label"] for r in (_region_at(regions, m) for m in members) if r and r["kind"] in ("tm", "intramembrane")},
            key=lambda label: (len(label), label),
        )
        sector["mean_grade"] = round(sum(positions[m - 1]["grade"] for m in members) / len(members), 1)
        sector["zones"] = dict(Counter(positions[m - 1].get("zone") for m in members))
        sector["compactness"] = _compactness(members, structure)
        for m in members:
            positions[m - 1]["sector"] = sector["id"]


def compare_methods(positions: list[dict], strong_pairs: list[dict], sca: dict) -> dict:
    """Recouvrement des résidus couplés par la MIp et des secteurs SCA."""
    mip = {x for p in strong_pairs for x in (p["i"], p["j"])}
    sector_of = {m: sector["id"] for sector in sca["sectors"] for m in sector["positions"]}
    sca_set = set(sector_of)
    shared = sorted(mip & sca_set)
    union = mip | sca_set
    within = sum(1 for p in strong_pairs if p["i"] in sector_of and sector_of[p["i"]] == sector_of.get(p["j"]))

    zones: dict[str, dict[str, int]] = {}
    for number in union:
        zone = positions[number - 1].get("zone") or "loop"
        counts = zones.setdefault(zone, {"mip": 0, "sca": 0, "both": 0})
        key = "both" if number in mip and number in sca_set else "mip" if number in mip else "sca"
        counts[key] += 1

    def mean_grade(numbers):
        return round(sum(positions[n - 1]["grade"] for n in numbers) / len(numbers), 1) if numbers else None

    return {
        "mip_count": len(mip),
        "sca_count": len(sca_set),
        "shared": [{"position": n, "residue": positions[n - 1]["residue"], "sector": sector_of[n]} for n in shared],
        "mip_only": len(mip - sca_set),
        "sca_only": len(sca_set - mip),
        "jaccard": round(len(shared) / len(union), 2) if union else None,
        "pairs_within_sector": within,
        "strong_pairs": len(strong_pairs),
        "zones": zones,
        "mip_mean_grade": mean_grade(mip),
        "sca_mean_grade": mean_grade(sca_set),
        "per_sector": [
            {"id": sector["id"], "size": sector["size"], "shared": sum(1 for m in sector["positions"] if m in mip)}
            for sector in sca["sectors"]
        ],
    }


# ---------------------------------------------------------------------------
# 5. Positions candidates
# ---------------------------------------------------------------------------

def gxxxg_positions(sequence: str, positions: list[dict], regions: list[dict]) -> set[int]:
    """Petits résidus conservés espacés de 4 dans une hélice TM (motifs GxxxG / small-xxx-small)."""
    found = set()
    for region in regions:
        if region["kind"] != "tm":
            continue
        for p in range(region["start"], region["end"] - 3):
            q = p + 4
            if sequence[p - 1] in SMALL and sequence[q - 1] in SMALL and "G" in (sequence[p - 1], sequence[q - 1]):
                if positions[p - 1]["grade"] >= 7 and positions[q - 1]["grade"] >= 7:
                    found.update((p, q))
    return found


def score_candidates(
    sequence: str,
    positions: list[dict],
    regions: list[dict],
    degree: Counter,
    has_structure: bool,
    coupling_weight: float = 1.0,
) -> list[dict]:
    """Positions candidates classées, avec les raisons de leur sélection."""
    gxxxg = gxxxg_positions(sequence, positions, regions)
    candidates = []
    for p in positions:
        number, aa, grade = p["position"], p["residue"], p["grade"]
        couplings = degree.get(number, 0) if coupling_weight > 0 else 0
        in_sector = bool(p.get("sector")) and coupling_weight > 0
        if p["gap_fraction"] > 0.3 or (grade < 7 and not ((couplings >= 2 or in_sector) and grade >= 5)):
            continue
        zone = p.get("zone")
        in_membrane = zone in ("core", "membrane")
        at_interface = zone in ("interface_out", "interface_in")
        reasons, bonus, category = [f"Conservation : grade {grade}/9"], 0.0, "Conservé"

        if in_membrane and aa in POLAR:
            bonus += 0.35
            category = "Fonctionnel"
            reasons.append("Résidu polaire ou chargé conservé au cœur de la membrane : site actif, transport d’ions ou de protons, liaison d’un ligand probables")
        if in_membrane and aa == "P":
            bonus += 0.25
            category = "Structural"
            reasons.append("Proline conservée dans une hélice transmembranaire : coude ou charnière de l’hélice")
        if number in gxxxg:
            bonus += 0.2
            category = "Structural"
            reasons.append("Motif GxxxG (petits résidus espacés de 4) : contact étroit entre hélices")
        elif in_membrane and aa == "G":
            bonus += 0.15
            category = "Structural"
            reasons.append("Glycine conservée dans la membrane : flexibilité ou empilement serré des hélices")
        if at_interface and aa in "WY":
            bonus += 0.15
            category = "Interface" if category == "Conservé" else category
            reasons.append("Aromatique à l’interface : ceinture aromatique qui ancre la protéine dans la bicouche")
        if zone in ("interface_in", "in") and aa in "KR" and grade >= 8:
            bonus += 0.1
            reasons.append("Charge positive conservée côté cytoplasmique (règle « positive-inside »)")
        if aa == "C" and grade >= 8:
            bonus += 0.05
            reasons.append("Cystéine conservée : pont disulfure ou site de modification possibles")
        if has_structure and in_membrane:
            if p.get("burial") == "enfoui":
                bonus += 0.1
                reasons.append("Enfoui entre les hélices : rôle probable dans la stabilité")
            elif p.get("burial") == "exposé" and grade >= 8:
                bonus += 0.15
                category = "Interface" if category == "Conservé" else category
                reasons.append("Tourné vers les lipides mais conservé : interface possible avec un partenaire, un lipide ou une autre sous-unité")
        if couplings:
            bonus += coupling_weight * min(0.3, 0.1 * couplings)
            if category == "Conservé":
                category = "Réseau coévolutif"
            reasons.append(f"Coévolue avec {couplings} autre(s) position(s) (MIp)")
        if in_sector:
            bonus += coupling_weight * 0.1
            if category == "Conservé":
                category = "Réseau coévolutif"
            reasons.append(f"Membre du secteur SCA {p['sector']}")

        score = 0.5 * (grade - 1) / 8 + bonus
        candidates.append(
            {
                "position": number,
                "residue": aa,
                "grade": grade,
                "zone": zone,
                "region": p.get("region"),
                "score": round(score, 3),
                "category": category,
                "couplings": couplings,
                "reasons": reasons,
            }
        )
    candidates.sort(key=lambda c: (-c["score"], c["position"]))
    return candidates[:MAX_CANDIDATES]


# ---------------------------------------------------------------------------
# 6. Lecture des résultats
# ---------------------------------------------------------------------------

def _pct(value: float | None) -> str:
    return "—" if value is None else f"{round(100 * value)} %"


def interpret(result: dict) -> list[dict]:
    notes = []
    homologs = result["homologs"]
    identities = [h["identity"] for h in homologs]
    if identities:
        notes.append(
            {
                "topic": "family",
                "title": "Famille analysée",
                "text": f"{len(homologs)} homologue(s) alignés sur la référence, identité de {_pct(min(identities))} "
                f"à {_pct(max(identities))} (médiane {_pct(float(np.median(identities)))}). "
                + ("Une famille variée rend la conservation plus discriminante." if np.median(identities) < 0.6 else
                   "Les séquences sont proches : beaucoup de positions paraîtront conservées faute de temps évolutif ; ajoutez des homologues plus lointains."),
            }
        )

    s = result["summary"]
    if s["tm_mean_score"] is not None and s["loop_mean_score"] is not None:
        diff = s["tm_mean_score"] - s["loop_mean_score"]
        notes.append(
            {
                "topic": "conservation",
                "title": "Membrane et boucles",
                "text": (
                    "Les segments transmembranaires sont plus conservés que les boucles : la contrainte évolutive porte surtout sur le cœur membranaire."
                    if diff > 0.02 else
                    "Les boucles sont aussi conservées que les segments transmembranaires : elles portent probablement des sites fonctionnels (liaison, régulation)."
                    if diff > -0.02 else
                    "Les boucles sont plus conservées que les segments transmembranaires : sites de liaison ou d’interaction extramembranaires probables."
                ),
            }
        )

    candidates = result["candidates"]
    if candidates:
        by_category = Counter(c["category"] for c in candidates)
        top = ", ".join(f"{c['residue']}{c['position']}" for c in candidates[:6])
        notes.append(
            {
                "topic": "candidates",
                "title": "Positions candidates",
                "text": f"{len(candidates)} position(s) retenue(s) ({', '.join(f'{v} {k.lower()}' for k, v in by_category.most_common())}). "
                f"En tête : {top}. Ce sont des hypothèses à tester (mutagenèse dirigée), pas des preuves.",
            }
        )

    coevolution = result.get("coevolution")
    if coevolution:
        reliability = coevolution["reliability"]
        text = f"Neff = {coevolution['neff']} séquences effectives pour {coevolution['length']} positions (fiabilité {reliability['level']}). "
        precision = {p["label"]: p for p in coevolution.get("precision", [])}
        if "L/5" in precision:
            random = coevolution.get("random_precision")
            text += (
                f"{_pct(precision['L/5']['precision'])} des {precision['L/5']['count']} premières paires sont en contact dans la structure"
                + (f" (contre {_pct(random)} au hasard)." if random is not None else ".")
            )
        if reliability["level"] in ("insuffisante", "faible"):
            text += " " + reliability["text"]
        inter = sum(1 for p in coevolution["pairs"][: coevolution["length"] // 5] if p["kind"] == "inter_helix")
        if inter:
            text += f" {inter} des premières paires relient deux hélices différentes : candidates pour l’empilement des hélices."
        notes.append({"topic": "coevolution", "title": "Coévolution", "text": text})

    if result.get("networks"):
        n = result["networks"][0]
        notes.append(
            {
                "topic": "networks",
                "title": "Réseaux de résidus",
                "text": f"Le plus grand réseau couple {n['size']} positions"
                + (f" réparties sur {', '.join(n['helices'])}" if n["helices"] else "")
                + f" (grade moyen {n['mean_grade']}/9) : un ensemble qui pourrait agir de concert (changement de conformation, stabilité).",
            }
        )

    sca, comparison = result.get("sca"), result.get("comparison")
    if sca and sca["sectors"]:
        first = sca["sectors"][0]
        text = (
            f"{len(sca['sectors'])} secteur(s) SCA ({sca['significant_modes']} mode(s) au-dessus du hasard). Le premier réunit "
            f"{first['size']} positions"
            + (f" sur {', '.join(first['helices'])}" if first["helices"] else "")
            + f", grade moyen {first['mean_grade']}/9"
            + (f", regroupées en 3D (compacité {first['compactness']})" if first.get("compactness") is not None and first["compactness"] < 0.8 else "")
            + "."
        )
        if comparison:
            text += f" {len(comparison['shared'])} résidu(s) sont désignés à la fois par la MIp et par la SCA : les candidats les plus solides."
        notes.append({"topic": "sca", "title": "Secteurs SCA", "text": text})

    structure, opm = result.get("structure"), result.get("opm")
    if structure and structure.get("membrane") and opm and opm.get("hydrophobic_thickness"):
        notes.append(
            {
                "topic": "orientation",
                "title": "Orientation membranaire",
                "text": f"Épaisseur hydrophobe estimée sur le modèle {structure['source']} : {structure['membrane']['thickness']} Å ; "
                f"OPM ({opm['pdb_id']}) : {opm['hydrophobic_thickness']} Å.",
            }
        )
    return notes


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------

def add_mmseqs_homologs(alignment: dict, reference_accession: str | None = None) -> int:
    """
    Ajoute les homologues MMseqs2 (UniRef) absents de l'alignement importé :
    même séquence alignée ou même entrée UniProt (UniRef100_P12345 = P12345)
    déjà présente. Score et E-value recalculés comme pour les séquences
    importées, pour que toutes les lignes soient comparables.
    """
    query = alignment["query"]
    rows, homologs, _ = _mmseqs_alignment(query)
    known = set(alignment["rows"])
    known_entries = {h.get("uniprot_accession") for h in alignment["homologs"]} | {reference_accession}
    added = 0
    for row, homolog in zip(rows, homologs):
        entry = homolog["accession"].split("_", 1)[-1]
        if row in known or entry in known_entries:
            continue
        known.add(row)
        known_entries.add(entry)
        aligned = sum(c != "-" for c in row)
        bits, evalue = significance(anchored_score(query, row), len(query), homolog.get("length") or aligned)
        homolog.update({"source": "mmseqs", "bits": round(bits, 1), "evalue": float(f"{evalue:.3g}")})
        alignment["rows"].append(row)
        alignment["homologs"].append(homolog)
        added += 1
    order = sorted(range(len(alignment["rows"])), key=lambda k: -alignment["homologs"][k]["identity"])
    alignment["rows"] = [alignment["rows"][k] for k in order]
    alignment["homologs"] = [alignment["homologs"][k] for k in order]
    return added


def run_explorer(fasta: str, reference: int = 0, accession: str | None = None, expand: bool = False) -> dict:
    records = parse_fasta(fasta)
    validate(records, reference, expand)
    ref = records[reference]
    alignment = build_alignment(records, reference, allow_empty=expand)
    query = alignment["query"]
    warnings = []
    imported = len(alignment["rows"])
    added = add_mmseqs_homologs(alignment, accession or ref["accession"]) if expand else 0
    if not alignment["rows"]:
        raise ExplorerError("Aucun homologue retenu : importez des séquences ou réessayez la recherche étendue.")

    identity = identify_reference(ref, accession)
    entry = identity["entry"]
    if identity["mismatch"]:
        warnings.append(f"La séquence de référence diffère de celle de l'entrée {identity['accession']} : ses annotations et son modèle AlphaFold ne sont pas utilisés.")
    uniprot_accession = identity["accession"] if entry is not None else None

    topology = reference_topology(query, entry, uniprot_accession or ref["id"])
    if topology["source"] == "kd":
        warnings.append("Segments transmembranaires estimés par hydropathie (Kyte-Doolittle) : à confirmer par DeepTMHMM.")
    if topology["deeptmhmm_status"] in ("queued", "running"):
        warnings.append("DeepTMHMM est en cours sur la référence : relancez l'analyse plus tard pour utiliser sa topologie.")

    result = analyze_alignment(query, alignment["rows"], alignment["homologs"], topology["regions"], topology["segments"])
    result["warnings"] = result["warnings"] + warnings
    # Alignement et homologues complets (et pas seulement les premiers)
    result["homologs"] = alignment["homologs"]
    result["msa"] = [
        {"accession": h["accession"], "organism": h.get("organism") or h["accession"], "row": row}
        for h, row in zip(alignment["homologs"], alignment["rows"])
    ]
    positions = result["positions"]

    # Arbre phylogénétique de la référence et des homologues les plus proches
    try:
        result["tree"] = build_tree(
            query,
            {"id": uniprot_accession or ref["id"], "organism": ref["organism"], "taxon_id": ref["taxon_id"]},
            result["msa"][:MAX_TREE_SEQUENCES],
            alignment["homologs"],
        )
    except Exception as error:  # l'arbre ne doit pas faire échouer l'analyse
        result["tree"] = None
        result["warnings"].append(f"Arbre phylogénétique indisponible : {error}"[:300])

    # Structure placée dans la membrane
    structure, features = None, None
    try:
        placed = reference_structure(uniprot_accession, query, topology, uniprot_accession or ref["id"])
        membrane = placed.get("membrane") if placed.get("embedded") else None
        features = structure_features(placed["pdb"], membrane["thickness"] / 2 if membrane else None)
        structure = {
            "source": placed["source"],
            "model_id": placed.get("model_id"),
            "method": placed.get("method"),
            "pdb": placed["pdb"],
            "embedded": bool(placed.get("embedded")),
            "membrane": membrane,
            "helices": placed.get("helices", []),
            "window": placed.get("window"),
            "mean_plddt": placed.get("mean_plddt"),
            "tm_mean_plddt": placed.get("tm_mean_plddt"),
            "aromatic_belt": placed.get("aromatic_belt", []),
            "buried_charged": placed.get("buried_charged", []),
            "contacts": features["contacts"],
        }
    except Exception as error:  # la structure ne doit pas faire échouer l'analyse
        result["warnings"].append(f"Structure 3D indisponible : {error}"[:300])

    opm = None
    if uniprot_accession:
        try:
            opm = find_opm(uniprot_accession, len(query))
        except Exception:
            opm = None

    # Cartographie de chaque position
    tm_positions = {k for s in topology["segments"] for k in range(s["start"], s["end"] + 1)}
    for p in positions:
        region = _region_at(topology["regions"], p["position"])
        p["region"] = region["label"] if region else None
        p["region_kind"] = region["kind"] if region else None
        info = features["residues"].get(p["position"]) if features else None
        if info and info["zone"]:
            p.update(info)
        else:
            p["zone"] = "membrane" if p["position"] in tm_positions else (
                region["side"] if region and region.get("side") in ("in", "out") else "loop"
            )
            if info:
                p.update({k: info[k] for k in ("neighbours", "burial", "plddt")})

    # Coévolution
    coevolution = None
    if len(query) <= COEVOLUTION_MAX_LENGTH:
        try:
            coevolution = compute_coevolution([query] + alignment["rows"])
            annotate_pairs(coevolution, topology["regions"], features)
        except ValueError as error:
            result["warnings"].append(f"Coévolution non calculée : {error}")
    degree: Counter = Counter()
    networks, top = [], []
    if coevolution:
        # Paires fortes : parmi les L/5 premières, nettement au-dessus du bruit
        top = [p for p in coevolution["pairs"][: max(len(query) // 5, 1)] if p["z"] >= STRONG_PAIR_Z]
        coevolution["strong_pairs"] = len(top)
        for pair in top:
            degree[pair["i"]] += 1
            degree[pair["j"]] += 1
        networks = coupling_networks(top, positions, topology["regions"])
        for network in networks:
            for r in network["residues"]:
                positions[r["position"] - 1]["network"] = network["id"]
    for p in positions:
        p["couplings"] = degree.get(p["position"], 0)

    # Secteurs SCA, cartographiés sur la structure et comparés aux réseaux MIp
    sca, comparison = None, None
    if len(query) <= COEVOLUTION_MAX_LENGTH:
        try:
            sca = compute_sca([query] + alignment["rows"])
            annotate_sectors(sca, positions, topology["regions"], features)
            if coevolution:
                sca["reliability"] = coevolution["reliability"]
                comparison = compare_methods(positions, top, sca)
        except ValueError as error:
            result["warnings"].append(f"SCA non calculée : {error}")

    result.update(
        {
            "version": METHOD_VERSION,
            "reference": {
                "id": ref["id"],
                "header": ref["header"],
                "index": reference,
                "accession": uniprot_accession,
                "accession_origin": identity["origin"] if uniprot_accession else None,
                "protein_name": (entry or {}).get("proteinDescription", {}).get("recommendedName", {}).get("fullName", {}).get("value")
                if entry else ref["description"],
                "organism": ((entry or {}).get("organism") or {}).get("scientificName") or ref["organism"],
                "length": len(query),
            },
            "input": {
                "sequence_count": len(records),
                "kept": len(alignment["rows"]),
                "imported_kept": imported,
                "mmseqs_added": added,
                "expanded": expand,
                "excluded": alignment["excluded"],
                "prealigned": alignment["prealigned"],
            },
            "topology": {k: v for k, v in topology.items() if k != "regions"},
            "structure": structure,
            "opm": opm,
            "coevolution": coevolution,
            "networks": networks,
            "sca": sca,
            "comparison": comparison,
            "candidates": score_candidates(
                query,
                positions,
                topology["regions"],
                degree,
                features is not None,
                COUPLING_WEIGHT[coevolution["reliability"]["level"]] if coevolution else 0.0,
            ),
        }
    )
    result["most_variable"] = [
        {"position": p["position"], "residue": p["residue"], "score": p["score"]}
        for p in sorted((p for p in positions if p["gap_fraction"] < 0.3), key=lambda p: p["score"])[:20]
    ]
    if len(alignment["rows"]) < MIN_RELIABLE:
        result["warnings"].append("Moins de 10 homologues : ajoutez des séquences pour des résultats fiables.")
    result["interpretation"] = interpret(result)
    return result


# ---------------------------------------------------------------------------
# Homologues proposés pour une entrée UniProt
# ---------------------------------------------------------------------------

def homologs_fasta(accession: str) -> dict:
    """Référence et orthologues UniRef50 (une séquence par espèce), au format FASTA."""
    accession = accession.upper().strip()
    entry = uniprot_service.fetch_entry(accession)
    sequence = entry.get("sequence", {}).get("value", "")
    if not sequence:
        raise ExplorerError("Séquence UniProt indisponible.")
    organism = entry.get("organism") or {}
    name = entry.get("proteinDescription", {}).get("recommendedName", {}).get("fullName", {}).get("value") or accession
    prefix = "sp" if uniprot_service.is_reviewed(entry) else "tr"
    lines = [f">{prefix}|{accession}|{entry.get('uniProtkbId', accession)} {name} OS={organism.get('scientificName', '')} OX={organism.get('taxonId', '')}", sequence]

    cluster = find_uniref50_cluster(accession)
    count = 0
    if cluster:
        representatives = select_representatives(fetch_cluster_members(cluster["id"]), accession)
        sequences = fetch_sequences([m["accessions"][0] for m in representatives])
        for member in representatives:
            acc = member["accessions"][0]
            if acc not in sequences:
                continue
            tag = "sp" if _is_swissprot(member) else "tr"
            lines.append(
                f">{tag}|{acc}|{member.get('memberId', acc)} {member.get('proteinName') or ''} "
                f"OS={member.get('organismName') or ''} OX={member.get('organismTaxId') or ''}"
            )
            lines.append(sequences[acc])
            count += 1
    return {
        "accession": accession,
        "protein_name": name,
        "organism": organism.get("scientificName"),
        "cluster_id": cluster["id"] if cluster else None,
        "homolog_count": count,
        "fasta": "\n".join(lines) + "\n",
    }
