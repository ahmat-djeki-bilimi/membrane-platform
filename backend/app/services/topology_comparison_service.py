"""
Comparaison des topologies membranaires d'une même protéine.

Sources confrontées :
- DeepTMHMM : prédiction par apprentissage profond (segments seulement : les
  fichiers exploités ne donnent pas de probabilité par résidu) ;
- UniProt : annotations, avec la nature de leur preuve (expérimentale,
  structure 3D, similarité, simple analyse de séquence) ;
- structure 3D : résidus situés dans la tranche hydrophobe du modèle placé
  dans la membrane, et géométrie de ses hélices ;
- hydropathie (Kyte-Doolittle) : estimation de dernier recours.

Les segments des sources sont regroupés en « segments communs » (ils se
recouvrent), dont on mesure l'accord et la confiance. Aucune de ces sources,
pas même OPM, n'est une mesure directe de l'orientation : l'orientation
affichée est toujours présentée comme calculée.
"""

MIN_OVERLAP = 5
SHIFT_MINOR = 5
SHIFT_MAJOR = 10
STRUCTURE_MIN_LENGTH = 12
STRUCTURE_MAX_GAP = 2
CONFIDENT_PLDDT = 70.0

SOURCE_LABELS = {
    "deeptmhmm": "DeepTMHMM",
    "uniprot": "UniProt",
    "structure": "Structure 3D",
    "kd": "Hydropathie",
}
SOURCE_KINDS = {
    "deeptmhmm": "Prédiction (apprentissage profond)",
    "uniprot": "Annotation",
    "structure": "Modèle 3D placé dans la membrane",
    "kd": "Estimation (Kyte-Doolittle)",
}

# Codes ECO des preuves UniProt
_EXPERIMENTAL = {"ECO:0000269", "ECO:0000314", "ECO:0000315", "ECO:0000316", "ECO:0000353"}
_STRUCTURE = {"ECO:0007744", "ECO:0007829", "ECO:0000312"}
_SIMILARITY = {"ECO:0000250", "ECO:0000266", "ECO:0008006"}
_INFERENCE = {"ECO:0000305", "ECO:0000303"}
_PREDICTED = {"ECO:0000255", "ECO:0000256", "ECO:0000259"}

EVIDENCE_LABELS = {
    "experimental": "Expérimentale",
    "structure": "Déduite d’une structure 3D",
    "similarity": "Par similarité",
    "inference": "Déduction du curateur ou de l’auteur",
    "predicted": "Prédiction (analyse de séquence)",
    "unknown": "Non précisée",
}
EVIDENCE_RANK = ["experimental", "structure", "similarity", "inference", "predicted", "unknown"]


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

def evidence_of(feature: dict) -> str:
    codes = {e.get("evidenceCode") for e in feature.get("evidences") or []}
    if codes & _EXPERIMENTAL:
        return "experimental"
    if codes & _STRUCTURE:
        return "structure"
    if codes & _SIMILARITY:
        return "similarity"
    if codes & _INFERENCE:
        return "inference"
    if codes & _PREDICTED:
        return "predicted"
    return "unknown"


def uniprot_segments(entry: dict) -> list[dict]:
    """Segments « Transmembrane » d'UniProt avec la nature de leur preuve."""
    segments = []
    for feature in entry.get("features", []):
        if feature.get("type") != "Transmembrane":
            continue
        location = feature.get("location") or {}
        start = (location.get("start") or {}).get("value")
        end = (location.get("end") or {}).get("value")
        if not start or not end:
            continue
        evidence = evidence_of(feature)
        segments.append(
            {"start": start, "end": end, "label": f"TM{len(segments) + 1}", "evidence": evidence, "evidence_label": EVIDENCE_LABELS[evidence]}
        )
    return segments


def structure_segments(residues: dict[int, dict], half_thickness: float) -> list[dict]:
    """
    Portions de chaîne dans la tranche hydrophobe du modèle (|z| ≤ demi-épaisseur),
    d'au moins STRUCTURE_MIN_LENGTH résidus (trous de STRUCTURE_MAX_GAP résidus tolérés).
    """
    inside = sorted(n for n, r in residues.items() if r.get("z") is not None and abs(r["z"]) <= half_thickness)
    runs: list[list[int]] = []
    for n in inside:
        if runs and n - runs[-1][-1] <= STRUCTURE_MAX_GAP + 1:
            runs[-1].append(n)
        else:
            runs.append([n])
    segments = []
    for run in runs:
        if run[-1] - run[0] + 1 < STRUCTURE_MIN_LENGTH:
            continue
        plddt = [residues[n]["plddt"] for n in run if residues[n].get("plddt") is not None]
        segments.append(
            {
                "start": run[0],
                "end": run[-1],
                "label": f"Tranche {len(segments) + 1}",
                "mean_plddt": round(sum(plddt) / len(plddt), 1) if plddt else None,
            }
        )
    return segments


# ---------------------------------------------------------------------------
# Segments communs
# ---------------------------------------------------------------------------

def _overlap(a: dict, b: dict) -> int:
    return min(a["end"], b["end"]) - max(a["start"], b["start"]) + 1


def _spans(segments: list[dict]) -> str:
    return ", ".join(f"{s['start']}–{s['end']}" for s in segments)


def group_segments(sources: dict[str, list[dict]]) -> list[dict]:
    """Regroupe les segments de toutes les sources qui se recouvrent (au moins MIN_OVERLAP résidus)."""
    items = sorted(((s["start"], s["end"], name, s) for name, segs in sources.items() for s in segs), key=lambda t: (t[0], t[1]))
    loci: list[dict] = []
    for start, end, name, segment in items:
        locus = loci[-1] if loci else None
        if locus and min(end, locus["end"]) - max(start, locus["start"]) + 1 >= MIN_OVERLAP:
            locus["end"] = max(locus["end"], end)
            locus["members"].setdefault(name, []).append(segment)
        else:
            loci.append({"start": start, "end": end, "members": {name: [segment]}})
    return loci


def _confidence(present: list[str], available: list[str], shift: int, uniprot_evidence: str | None) -> tuple[str, str]:
    independent = [s for s in present if s != "kd"]
    usable = [s for s in available if s != "kd"]
    if uniprot_evidence in ("experimental", "structure") and len(independent) >= 2:
        return "forte", f"Annotation UniProt {EVIDENCE_LABELS[uniprot_evidence].lower()}, confirmée par une autre source"
    if len(usable) >= 2 and len(independent) == len(usable) and shift <= SHIFT_MINOR:
        return "forte", "Toutes les sources s’accordent, bornes à ±5 résidus"
    if len(independent) >= 2:
        return "moyenne", "Plusieurs sources, " + ("bornes décalées" if shift > SHIFT_MINOR else "mais pas toutes")
    if len(independent) == 1:
        return "faible", f"Une seule source ({SOURCE_LABELS[independent[0]]})"
    return "faible", "Seulement l’estimation par hydropathie"


def compare_topologies(
    length: int,
    sources: dict[str, dict],
    chosen: str,
    chosen_segments: list[dict],
    helices: list[dict] | None = None,
) -> dict:
    """
    `sources` : {nom: {"segments": [...], "n_terminus": ..., ...}} pour chaque
    source disponible. Renvoie les segments communs, leur confiance et les
    divergences entre sources.
    """
    available = [name for name in ("deeptmhmm", "uniprot", "structure", "kd") if name in sources]
    loci = group_segments({name: sources[name]["segments"] for name in available})
    helices = helices or []

    rows, divergences = [], []
    for k, locus in enumerate(loci, start=1):
        members = locus["members"]
        present = [name for name in available if name in members]
        # Décalage des bornes entre les vraies sources (l'hydropathie ne compte que si elle est seule)
        compared = [n for n in present if n != "kd"] or present
        starts = [m["start"] for name in compared for m in members[name]]
        ends = [m["end"] for name in compared for m in members[name]]
        shift = max(max(starts) - min(starts), max(ends) - min(ends))
        uniprot_evidence = None
        if "uniprot" in members:
            uniprot_evidence = min((m["evidence"] for m in members["uniprot"]), key=EVIDENCE_RANK.index)
        level, reason = _confidence(present, available, shift, uniprot_evidence)
        main = next((s for s in chosen_segments if _overlap(s, locus) >= MIN_OVERLAP), None)
        label = main["label"] if main else f"Segment candidat {k}"
        helix = next((h for h in helices if _overlap(h, locus) >= MIN_OVERLAP), None)
        structure_plddt = next((m.get("mean_plddt") for m in members.get("structure", [])), None)

        notes = []
        missing = [SOURCE_LABELS[n] for n in available if n not in members and n != "kd"]
        if missing and any(n != "kd" for n in present):
            notes.append(f"absent de {', '.join(missing)}")
        split = [SOURCE_LABELS[n] for n in present if len(members[n]) > 1]
        if split:
            notes.append(f"découpé en plusieurs segments par {', '.join(split)}")
        if shift > SHIFT_MINOR:
            notes.append(f"bornes décalées de {shift} résidus")
        if helix and helix.get("crossing") == "partial":
            notes.append("l’hélice ne traverse pas la bicouche dans le modèle")
        if helix and helix.get("mean_plddt") is not None and helix["mean_plddt"] < CONFIDENT_PLDDT:
            notes.append(f"modèle peu fiable ici (pLDDT {round(helix['mean_plddt'])})")

        rows.append(
            {
                "id": k,
                "label": label,
                "start": locus["start"],
                "end": locus["end"],
                "in_chosen": main is not None,
                "sources": {
                    name: [{"start": m["start"], "end": m["end"], **({"evidence": m["evidence"]} if "evidence" in m else {})} for m in members[name]]
                    for name in present
                },
                "shift": shift,
                "uniprot_evidence": uniprot_evidence,
                "structure_plddt": structure_plddt,
                "helix_crossing": helix.get("crossing") if helix else None,
                "confidence": level,
                "confidence_reason": reason,
                "notes": notes,
            }
        )

        independent_missing = [n for n in ("deeptmhmm", "uniprot") if n in available and n not in members]
        if independent_missing and any(n in members for n in ("deeptmhmm", "uniprot")):
            divergences.append(
                {
                    "severity": "majeure",
                    "position": locus["start"],
                    "text": f"{label} ({locus['start']}–{locus['end']}) : présent selon "
                    f"{', '.join(SOURCE_LABELS[n] for n in present)}, absent de {', '.join(SOURCE_LABELS[n] for n in independent_missing)}.",
                }
            )
        elif shift > SHIFT_MINOR and len([n for n in present if n != "kd"]) >= 2:
            detail = " ; ".join(f"{SOURCE_LABELS[n]} {_spans(members[n])}" for n in present if n != "kd")
            divergences.append(
                {
                    "severity": "majeure" if shift > SHIFT_MAJOR else "mineure",
                    "position": locus["start"],
                    "text": f"{label} : bornes décalées de {shift} résidus ({detail}).",
                }
            )
        if helix and helix.get("crossing") == "partial":
            divergences.append(
                {
                    "severity": "mineure",
                    "position": locus["start"],
                    "text": f"{label} : l’hélice correspondante du modèle n’atteint pas les deux faces de la bicouche.",
                }
            )

    # Nombre de segments et type de protéine
    counts = {name: len(sources[name]["segments"]) for name in available}
    if "deeptmhmm" in counts and "uniprot" in counts and counts["deeptmhmm"] != counts["uniprot"]:
        divergences.insert(
            0,
            {"severity": "majeure", "position": None, "text": f"Nombre de segments : {counts['deeptmhmm']} selon DeepTMHMM, {counts['uniprot']} selon UniProt."},
        )
    deeptmhmm = sources.get("deeptmhmm")
    if deeptmhmm and deeptmhmm.get("is_membrane") is False and counts.get("uniprot"):
        divergences.insert(
            0,
            {"severity": "majeure", "position": None, "text": f"DeepTMHMM classe la protéine comme non membranaire ({deeptmhmm.get('predicted_type')}) alors qu’UniProt annote des segments."},
        )

    # Côté de l'extrémité N-terminale
    sides = {name: sources[name].get("n_terminus") for name in available if sources[name].get("n_terminus") in ("in", "out")}
    if len(set(sides.values())) > 1:
        text = ", ".join(f"{SOURCE_LABELS[n]} {'cytoplasmique' if s == 'in' else 'externe'}" for n, s in sides.items())
        divergences.insert(0, {"severity": "majeure", "position": None, "text": f"Côté de l’extrémité N-terminale : {text}."})

    agreeing = sum(1 for r in rows if r["confidence"] == "forte")
    return {
        "chosen": chosen,
        "sources": [
            {
                "id": name,
                "label": SOURCE_LABELS[name],
                "kind": SOURCE_KINDS[name],
                "count": counts[name],
                "n_terminus": sources[name].get("n_terminus"),
                "note": sources[name].get("note"),
                "segments": sources[name]["segments"],
            }
            for name in available
        ],
        "segments": rows,
        "divergences": divergences,
        "summary": {
            "segments": len(rows),
            "strong": agreeing,
            "major_divergences": sum(1 for d in divergences if d["severity"] == "majeure"),
            "minor_divergences": sum(1 for d in divergences if d["severity"] == "mineure"),
        },
    }


# ---------------------------------------------------------------------------
# Orientation calculée et ses limites
# ---------------------------------------------------------------------------

def orientation_report(structure: dict | None, topology_source: str, topology_label: str, opm: dict | None) -> dict:
    """Épaisseur utilisée, origine du côté cytoplasmique et limites de l'orientation calculée."""
    membrane = (structure or {}).get("membrane")
    limits: list[str] = []
    if not structure or not membrane:
        return {
            "status": "indisponible",
            "label": "Aucune orientation calculée",
            "thickness": None,
            "limits": ["Aucune structure 3D placée dans la membrane : les zones des résidus sont déduites de la topologie seule."],
            "opm": None,
        }

    source = structure.get("source", "modèle")
    limits.append(
        f"Orientation calculée en ajustant une bicouche plane sur le modèle {source} (méthode simplifiée inspirée de PPM et TMDET) : "
        "ce n’est pas une mesure expérimentale."
    )
    limits.append(
        f"La bicouche est cherchée autour de l’axe des segments {topology_label} (±35°, centre à ±4 Å) : l’accord du modèle avec "
        "cette source n’est pas une confirmation indépendante."
    )
    if membrane.get("side_method") == "topology":
        limits.append(f"Le côté cytoplasmique est repris de la topologie {topology_label}, pas observé.")
    else:
        kr_in, kr_out = membrane.get("kr_inside", 0), membrane.get("kr_outside", 0)
        limits.append(
            f"Le côté cytoplasmique vient de la règle « positive-inside » (K/R : {kr_in} côté interne, {kr_out} côté externe), "
            "une tendance statistique" + (" ; l’écart est faible, le côté est incertain." if abs(kr_in - kr_out) <= 2 else ".")
        )
    if membrane.get("at_search_limit"):
        limits.append(f"L’épaisseur ajustée ({membrane['thickness']} Å) est à la limite de la recherche (22–38 Å) : elle n’est pas contrainte par le modèle.")
    tm_plddt = structure.get("tm_mean_plddt")
    if tm_plddt is not None and tm_plddt < CONFIDENT_PLDDT:
        limits.append(f"pLDDT moyen des segments transmembranaires : {round(tm_plddt)} (< 70) : la géométrie des hélices est peu fiable.")
    window = structure.get("window")
    if window and not window.get("complete"):
        limits.append(f"Seuls les résidus {window['start']}–{window['end']} sont modélisés.")
    limits.append(
        "Chaîne isolée, sans lipides ni partenaires : dans un oligomère ou un complexe, l’inclinaison et les surfaces exposées peuvent différer."
    )

    opm_report = None
    if opm and opm.get("pdb_id"):
        opm_report = {
            "pdb_id": opm["pdb_id"],
            "thickness": opm.get("hydrophobic_thickness"),
            "tilt": opm.get("tilt_angle"),
            "n_terminus": opm.get("n_terminus"),
            "thickness_difference": round(membrane["thickness"] - opm["hydrophobic_thickness"], 1) if opm.get("hydrophobic_thickness") else None,
            "n_terminus_agrees": opm.get("n_terminus") == membrane.get("n_terminus") if opm.get("n_terminus") else None,
        }
        limits.append(
            f"OPM ({opm['pdb_id']}) est lui aussi une orientation calculée (méthode PPM), mais sur une structure expérimentale : "
            "c’est la meilleure référence disponible, pas une mesure directe de la position dans la membrane."
        )
    else:
        limits.append("Aucune orientation de référence (OPM, calculée sur une structure expérimentale) ne permet de la vérifier.")

    return {
        "status": "calculée",
        "label": "Orientation calculée (non validée expérimentalement)",
        "thickness": membrane["thickness"],
        "thickness_method": "Ajustée sur le modèle : épaisseur hydrophobe de 22 à 38 Å qui place le plus de résidus hydrophobes exposés dans la tranche",
        "at_search_limit": bool(membrane.get("at_search_limit")),
        "side_method": membrane.get("side_method"),
        "n_terminus": membrane.get("n_terminus"),
        "limits": limits,
        "opm": opm_report,
    }
