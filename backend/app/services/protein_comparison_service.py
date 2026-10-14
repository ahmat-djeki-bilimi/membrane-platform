"""
Comparaison de deux à six protéines (entrées UniProt).

Correspondance des résidus
--------------------------
Chaque paire de protéines est alignée (semi-global, BLOSUM62, gaps affines) :
on obtient les paires de résidus correspondants, quelles que soient les
longueurs. Un alignement multiple « en étoile » est construit autour de la
protéine de référence : une colonne par résidu de la référence, plus des
colonnes d'insertion pour les résidus des autres protéines qui n'ont pas
d'équivalent. Les résidus d'insertion ne sont jamais comparés entre eux.

La fiabilité de la correspondance est évaluée deux fois :
- par la séquence : E-value de l'alignement, identité, et fenêtres où les
  résidus alignés se ressemblent peu (correspondance douteuse) ;
- par la structure, quand les deux modèles AlphaFold existent : après
  superposition, une paire de résidus à moins de 4 Å est confirmée.

Le reste (domaines, topologies, propriétés, conservation) est comparé dans le
repère commun de cet alignement.
"""

import re

import numpy as np

from app import jobs, provenance
from app.services import uniprot_service
from app.services.alignment import BLOSUM62, align_to_query, significance
from app.services.alphafold_service import get_alphafold
from app.services.membrane_orientation_service import estimate_tm_segments
from app.services.physicochemical_service import properties
from app.services.structure_comparison_service import fetch_alphafold_pdb, tm_d0, tm_superpose
from app.services.topology_comparison_service import group_segments

MIN_PROTEINS, MAX_PROTEINS = 2, 6
MAX_LENGTH = 2000
CONFIDENT_PLDDT = 70.0
MATCH_DISTANCE = 4.0
RELIABILITY_WINDOW = 11
LOW_SIMILARITY = 0.3
DOMAIN_TYPES = {"Domain": "Domaine", "Repeat": "Répétition", "Zinc finger": "Doigt de zinc", "Motif": "Motif", "Signal": "Peptide signal"}


class ComparisonError(ValueError):
    pass


# ---------------------------------------------------------------------------
# Protéines
# ---------------------------------------------------------------------------

def _range(feature: dict) -> tuple[int | None, int | None]:
    location = feature.get("location") or {}
    return (location.get("start") or {}).get("value"), (location.get("end") or {}).get("value")


def protein_topology(entry: dict, sequence: str, accession: str) -> dict:
    """Segments TM : UniProt s'il en annote, sinon DeepTMHMM s'il a déjà répondu, sinon hydropathie."""
    segments = uniprot_service.tm_segments(entry)
    if segments:
        return {"source": "uniprot", "segments": segments, "n_terminus": uniprot_service.n_terminus_side(entry)}
    from app.services.membrane_service import deeptmhmm_enabled

    if deeptmhmm_enabled():
        job = jobs.submit("deeptmhmm", {"sequence": sequence, "name": accession}, key_params={"sequence": sequence})
        result = job.get("result") or {}
        if job["status"] == "succeeded":
            return {
                "source": "deeptmhmm",
                "segments": [{"start": s["start"], "end": s["end"], "label": s["label"]} for s in result.get("tm_segments") or []],
                "n_terminus": result.get("n_terminus"),
            }
    return {"source": "kd", "segments": [{"start": s["start"], "end": s["end"], "label": s["label"]} for s in estimate_tm_segments(sequence)], "n_terminus": None}


def load_protein(accession: str) -> dict:
    try:
        entry = uniprot_service.fetch_entry(accession)
    except Exception:
        raise ComparisonError(f"Entrée UniProt {accession} introuvable.")
    sequence = (entry.get("sequence") or {}).get("value") or ""
    if not sequence:
        raise ComparisonError(f"Séquence indisponible pour {accession}.")
    if len(sequence) > MAX_LENGTH:
        raise ComparisonError(f"{accession} est trop longue ({len(sequence)} résidus ; {MAX_LENGTH} au maximum).")
    description = entry.get("proteinDescription") or {}
    name = ((description.get("recommendedName") or {}).get("fullName") or {}).get("value") or (
        ((description.get("submissionNames") or [{}])[0].get("fullName") or {}).get("value")
    )
    domains = []
    for feature in entry.get("features", []):
        kind = DOMAIN_TYPES.get(feature.get("type"))
        start, end = _range(feature)
        if kind and start and end:
            domains.append({"type": kind, "name": feature.get("description") or kind, "start": start, "end": end})
    genes = entry.get("genes") or []
    return {
        "accession": accession,
        "name": name or accession,
        "gene": ((genes[0] if genes else {}).get("geneName") or {}).get("value"),
        "organism": (entry.get("organism") or {}).get("scientificName"),
        "reviewed": uniprot_service.is_reviewed(entry),
        "sequence": sequence,
        "length": len(sequence),
        "domains": domains,
        "topology": protein_topology(entry, sequence, accession),
        "properties": properties(sequence),
    }


# ---------------------------------------------------------------------------
# Alignements
# ---------------------------------------------------------------------------

def _similar(a: str, b: str) -> bool:
    return BLOSUM62.get(a, {}).get(b, -1) > 0


def pairwise(a: dict, b: dict) -> dict:
    """Alignement de b sur a : paires de résidus, identité, similarité, significativité, régions douteuses."""
    alignment = align_to_query(a["sequence"], b["sequence"], band=max(100, abs(a["length"] - b["length"]) + 50))
    pairs = list(alignment.pairs)
    sa, sb = a["sequence"], b["sequence"]
    same = [sa[i] == sb[j] for i, j in pairs]
    similar = [_similar(sa[i], sb[j]) for i, j in pairs]
    bits, evalue = significance(alignment.score, a["length"], b["length"])

    # Fenêtres de paires consécutives où les résidus se ressemblent peu
    doubtful, start = [], None
    for k in range(len(pairs)):
        window = similar[max(0, k - RELIABILITY_WINDOW // 2):k + RELIABILITY_WINDOW // 2 + 1]
        low = sum(window) / len(window) < LOW_SIMILARITY
        if low and start is None:
            start = k
        if (not low or k == len(pairs) - 1) and start is not None:
            end = k if low else k - 1
            if end - start + 1 >= 5:
                doubtful.append({"a": [pairs[start][0] + 1, pairs[end][0] + 1], "b": [pairs[start][1] + 1, pairs[end][1] + 1]})
            start = None

    identity = sum(same) / len(pairs) if pairs else 0.0
    if evalue < 1e-10 and identity >= 0.3:
        level, text = "fiable", "Homologie nette : la correspondance des résidus est fiable, hors régions signalées."
    elif evalue < 1e-3:
        level, text = "a_verifier", "Homologie probable mais éloignée (zone crépusculaire) : vérifiez les régions douteuses, idéalement avec les structures."
    else:
        level, text = "non_significative", "Alignement non significatif : les séquences ne sont peut-être pas homologues, la correspondance des résidus n’est pas fiable."
    return {
        "pairs": pairs,
        "aligned": len(pairs),
        "identity": round(identity, 3),
        "similarity": round(sum(similar) / len(pairs), 3) if pairs else 0.0,
        "coverage_a": round(len(pairs) / a["length"], 3),
        "coverage_b": round(len(pairs) / b["length"], 3),
        "bits": round(bits, 1),
        "evalue": float(f"{evalue:.3g}"),
        "doubtful": doubtful,
        "reliability": level,
        "reliability_text": text,
    }


def star_alignment(proteins: list[dict], maps: list[dict[int, int]], reference: int = 0) -> dict:
    """
    Alignement multiple autour de la référence. `maps[p]` : résidu de la
    référence (0…) → résidu de la protéine p (0…). Renvoie les colonnes
    (numéro de résidu de chaque protéine, 1…, ou None) et les lignes alignées.
    """
    n = proteins[reference]["length"]
    inserts: list[dict[int, list[int]]] = []
    for p, protein in enumerate(proteins):
        slots: dict[int, list[int]] = {}
        if p != reference:
            mapped = sorted((j, i) for i, j in maps[p].items())
            following = {}
            for j, i in mapped:
                following[j] = i
            last_slot = 0
            mapped_set = set(following)
            for j in range(protein["length"]):
                if j in mapped_set:
                    last_slot = following[j] + 1
                else:
                    slots.setdefault(last_slot, []).append(j)
        inserts.append(slots)

    columns: list[list[int | None]] = []
    kinds: list[str] = []
    for slot in range(n + 1):
        width = max((len(s.get(slot, [])) for s in inserts), default=0)
        for k in range(width):
            column = []
            for p in range(len(proteins)):
                residues = inserts[p].get(slot, [])
                # Extrémité N-terminale : résidus collés au bloc aligné (alignés à droite)
                index = k - (width - len(residues)) if slot == 0 else k
                column.append(residues[index] + 1 if 0 <= index < len(residues) else None)
            columns.append(column)
            kinds.append("insertion")
        if slot < n:
            columns.append([slot + 1 if p == reference else (maps[p].get(slot) + 1 if slot in maps[p] else None) for p in range(len(proteins))])
            kinds.append("reference")
    rows = ["".join(proteins[p]["sequence"][c[p] - 1] if c[p] else "-" for c in columns) for p in range(len(proteins))]
    return {"columns": columns, "kinds": kinds, "rows": rows, "reference": reference}


# ---------------------------------------------------------------------------
# Structures
# ---------------------------------------------------------------------------

def load_model(protein: dict) -> dict | None:
    """Cα, pLDDT et texte PDB du modèle AlphaFold (si sa séquence est celle d'UniProt)."""
    try:
        model = get_alphafold(protein["accession"])
        if not model.get("available") or not model.get("pdb_url"):
            return None
        text = fetch_alphafold_pdb(model["pdb_url"])
    except Exception:
        return None
    if not text:
        return None
    ca: dict[int, tuple[np.ndarray, float]] = {}
    for line in text.splitlines():
        if line.startswith("ATOM") and line[12:16].strip() == "CA":
            ca[int(line[22:26])] = (np.array([float(line[30:38]), float(line[38:46]), float(line[46:54])]), float(line[60:66]))
    plddt = [v for _, v in ca.values()]
    return {
        "model_id": model.get("model_id"),
        "text": text,
        "ca": ca,
        "mean_plddt": round(sum(plddt) / len(plddt), 1) if plddt else None,
        # Numérotation du modèle = numérotation UniProt seulement si la séquence est la même
        "same_sequence": (model.get("sequence") or "") == protein["sequence"],
    }


def transform_pdb(text: str, rotation: np.ndarray, translation: np.ndarray) -> str:
    out = []
    for line in text.splitlines():
        if line.startswith(("ATOM", "HETATM")):
            xyz = np.array([float(line[30:38]), float(line[38:46]), float(line[46:54])]) @ rotation.T + translation
            line = f"{line[:30]}{xyz[0]:8.3f}{xyz[1]:8.3f}{xyz[2]:8.3f}{line[54:]}"
        out.append(line)
    return "\n".join(out)


def superpose(model_a: dict, model_b: dict, pairs: list[tuple[int, int]], length_a: int, length_b: int) -> dict | None:
    """Superposition de b sur a à partir des résidus alignés (fiables en priorité)."""
    common = [(i + 1, j + 1) for i, j in pairs if i + 1 in model_a["ca"] and j + 1 in model_b["ca"]]
    if len(common) < 10:
        return None
    confident = [(i, j) for i, j in common if model_a["ca"][i][1] >= CONFIDENT_PLDDT and model_b["ca"][j][1] >= CONFIDENT_PLDDT]
    used = confident if len(confident) >= 20 else common
    target = np.array([model_a["ca"][i][0] for i, _ in used])
    mobile = np.array([model_b["ca"][j][0] for _, j in used])
    rotation, translation, _ = tm_superpose(mobile, target)
    all_target = np.array([model_a["ca"][i][0] for i, _ in common])
    all_mobile = np.array([model_b["ca"][j][0] for _, j in common]) @ rotation.T + translation
    distances = np.linalg.norm(all_mobile - all_target, axis=1)
    used_set = set(used)
    used_d = np.array([d for (pair, d) in zip(common, distances) if pair in used_set])

    def tm(length):
        d0 = tm_d0(length)
        return round(float(np.sum(1 / (1 + (distances / d0) ** 2)) / length), 3)

    return {
        "rotation": rotation,
        "translation": translation,
        "aligned_pairs": len(common),
        "superposed_on": len(used),
        "confident_only": used is confident,
        "rmsd": round(float(np.sqrt(np.mean(used_d ** 2))), 2),
        "tm_score_a": tm(length_a),
        "tm_score_b": tm(length_b),
        # Correspondance de séquence confirmée par la structure (paires fiables)
        "confirmed": round(float(np.mean(used_d < MATCH_DISTANCE)), 3),
        "distances": [[i, j, round(float(d), 1)] for (i, j), d in zip(common, distances)],
    }


# ---------------------------------------------------------------------------
# Domaines et topologies dans le repère de l'alignement
# ---------------------------------------------------------------------------

def _column_index(alignment: dict, p: int) -> dict[int, int]:
    return {column[p]: k for k, column in enumerate(alignment["columns"]) if column[p]}


def _to_columns(segment: dict, index: dict[int, int]) -> dict | None:
    cols = [index[r] for r in range(segment["start"], segment["end"] + 1) if r in index]
    return {"start": min(cols) + 1, "end": max(cols) + 1, "residues": [segment["start"], segment["end"]]} if cols else None


def compare_topologies(proteins: list[dict], alignment: dict) -> dict:
    sources = {}
    for p, protein in enumerate(proteins):
        index = _column_index(alignment, p)
        sources[str(p)] = [s for s in (_to_columns(seg, index) for seg in protein["topology"]["segments"]) if s]
    loci = group_segments(sources)
    rows = []
    for k, locus in enumerate(loci, start=1):
        members = {int(p): [m["residues"] for m in segments] for p, segments in locus["members"].items()}
        rows.append({"id": k, "columns": [locus["start"], locus["end"]], "proteins": {str(p): members.get(p, []) for p in range(len(proteins))}, "shared": len(members)})
    counts = [len(p["topology"]["segments"]) for p in proteins]
    differences = []
    if len(set(counts)) > 1:
        differences.append("Nombre de segments transmembranaires : " + ", ".join(f"{p['accession']} {c}" for p, c in zip(proteins, counts)) + ".")
    sides = {p["accession"]: p["topology"]["n_terminus"] for p in proteins if p["topology"]["n_terminus"]}
    if len(set(sides.values())) > 1:
        differences.append("Extrémité N-terminale : " + ", ".join(f"{a} {'cytoplasmique' if s == 'in' else 'externe'}" for a, s in sides.items()) + ".")
    for row in rows:
        missing = [proteins[p]["accession"] for p in range(len(proteins)) if not row["proteins"][str(p)]]
        if missing and row["shared"] >= 1:
            present = [proteins[p]["accession"] for p in range(len(proteins)) if row["proteins"][str(p)]]
            differences.append(f"Segment {row['id']} (colonnes {row['columns'][0]}–{row['columns'][1]}) : présent chez {', '.join(present)}, absent chez {', '.join(missing)}.")
    if any(p["topology"]["source"] == "kd" for p in proteins):
        differences.append("Certaines topologies sont estimées par hydropathie (aucune annotation ni prédiction DeepTMHMM) : comparaison indicative.")
    return {"segments": rows, "differences": differences}


def _domain_key(name: str) -> str:
    return re.sub(r"[\s\d;,.]+$", "", name.lower()).strip()


def compare_domains(proteins: list[dict], alignment: dict) -> list[dict]:
    groups: dict[str, dict] = {}
    indexes = [_column_index(alignment, p) for p in range(len(proteins))]
    for p, protein in enumerate(proteins):
        for d in protein["domains"]:
            key = f"{d['type']}|{_domain_key(d['name'])}"
            group = groups.setdefault(key, {"type": d["type"], "name": re.sub(r"\s+\d+$", "", d["name"]), "proteins": {str(q): [] for q in range(len(proteins))}})
            group["proteins"][str(p)].append({"start": d["start"], "end": d["end"], "columns": _to_columns(d, indexes[p])})
    rows = []
    for group in groups.values():
        present = [q for q, items in group["proteins"].items() if items]
        # Même domaine aligné aux mêmes colonnes ? Recouvrement avec la première protéine qui le porte
        overlap = None
        if len(present) >= 2:
            spans = [items[0]["columns"] for items in (group["proteins"][q] for q in present) if items[0]["columns"]]
            if len(spans) >= 2:
                first = spans[0]
                shared = [max(0, min(first["end"], s["end"]) - max(first["start"], s["start"]) + 1) / (s["end"] - s["start"] + 1) for s in spans[1:]]
                overlap = round(min(shared), 2)
        rows.append({**group, "shared": len(present), "aligned_overlap": overlap})
    rows.sort(key=lambda r: (-r["shared"], r["name"]))
    return rows


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------

def compare_proteins(accessions: list[str], reference: int = 0) -> dict:
    if not MIN_PROTEINS <= len(accessions) <= MAX_PROTEINS:
        raise ComparisonError(f"Choisissez de {MIN_PROTEINS} à {MAX_PROTEINS} protéines.")
    provenance.mark("Fiches UniProt, topologies et propriétés")
    proteins = [load_protein(a) for a in accessions]
    count = len(proteins)
    provenance.mark("Alignements deux à deux et alignement commun")

    pairs: dict[str, dict] = {}
    for a in range(count):
        for b in range(a + 1, count):
            pairs[f"{a}-{b}"] = pairwise(proteins[a], proteins[b])

    def mapping(p: int) -> dict[int, int]:
        if p == reference:
            return {}
        key = f"{min(p, reference)}-{max(p, reference)}"
        result = pairs[key]["pairs"]
        return {i: j for i, j in result} if reference < p else {j: i for i, j in result}

    alignment = star_alignment(proteins, [mapping(p) for p in range(count)], reference)

    provenance.mark("Modèles AlphaFold et superpositions")
    # Structures : superposition de chaque modèle sur celui de la référence, et matrice de toutes les paires
    models = [load_model(p) for p in proteins]
    structures = {"models": [], "pairs": {}, "superposed": []}
    for p, (protein, model) in enumerate(zip(proteins, models)):
        structures["models"].append(
            {"available": bool(model), "model_id": model and model["model_id"], "mean_plddt": model and model["mean_plddt"], "same_sequence": bool(model and model["same_sequence"])}
        )
    usable = [m if m and m["same_sequence"] else None for m in models]
    for key, pair in pairs.items():
        a, b = map(int, key.split("-"))
        if usable[a] and usable[b]:
            result = superpose(usable[a], usable[b], pair["pairs"], proteins[a]["length"], proteins[b]["length"])
            if result:
                if reference in (a, b):
                    other = b if a == reference else a
                    if a == reference:
                        rotation, translation = result["rotation"], result["translation"]
                    else:  # b est la référence : inverser la transformation de b sur a
                        rotation = result["rotation"].T
                        translation = -rotation @ result["translation"]
                    structures["superposed"].append({"protein": other, "pdb": transform_pdb(usable[other]["text"], rotation, translation)})
                structures["pairs"][key] = {k: v for k, v in result.items() if k not in ("rotation", "translation")}
    if usable[reference]:
        structures["superposed"].append({"protein": reference, "pdb": usable[reference]["text"]})

    # Fiabilité structurale de la correspondance (paires de résidus à moins de 4 Å)
    for key, pair in pairs.items():
        structure = structures["pairs"].get(key)
        pair["structure_confirmed"] = structure["confirmed"] if structure else None
        pair["pairs"] = [[i + 1, j + 1] for i, j in pair["pairs"]]

    provenance.mark("Domaines et topologies dans le repère commun")
    for protein, model in zip(proteins, models):
        provenance.record_input("Entrée UniProt", protein["accession"], longueur=protein["length"])
        if model:
            provenance.record_input("Modèle 3D", model["model_id"], source="AlphaFold DB")
    return {
        "proteins": proteins,
        "reference": reference,
        "pairwise": pairs,
        "alignment": alignment,
        "structures": structures,
        "topology": compare_topologies(proteins, alignment),
        "domains": compare_domains(proteins, alignment),
        "method": {
            "alignment": "Alignements deux à deux semi-globaux (BLOSUM62, gaps 11/1, Gotoh) ; alignement multiple en étoile autour de la référence",
            "structure": "Modèles AlphaFold DB superposés sur les résidus alignés de pLDDT ≥ 70 (maximisation du TM-score, puis Kabsch)",
            "reliability": f"Correspondance douteuse : fenêtre de {RELIABILITY_WINDOW} paires à moins de {LOW_SIMILARITY:.0%} de similarité ; confirmée par la structure : Cα à moins de {MATCH_DISTANCE} Å après superposition",
        },
    }
