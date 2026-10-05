"""
Structure prédite d'une séquence quelconque (ESMFold), placée dans la
membrane et accompagnée d'une lecture biologique.
"""

import re

from app.services.esmfold_service import MAX_LENGTH, fold_sequence
from app.services.membrane_embedding_service import confidence_label, embed_structure
from app.services.membrane_orientation_service import estimate_tm_segments

TYPICAL_THICKNESS = (27.0, 33.0)  # cœur hydrophobe d'une membrane plasmique (Å)
TILTED = 30.0  # degrés
LOW_CONFIDENCE = 50.0
MIN_DISORDERED_LENGTH = 5
TOPOLOGY_SOURCES = {
    "deeptmhmm": "DeepTMHMM",
    "uniprot": "les domaines topologiques annotés dans UniProt",
    "user": "la topologie fournie",
}


def choose_window(length: int, segments: list[dict], max_length: int = MAX_LENGTH) -> tuple[int, int]:
    """Fenêtre de `max_length` résidus couvrant le plus de résidus transmembranaires."""
    if length <= max_length:
        return 1, length
    covered = [0] * (length + 2)
    for s in segments:
        for i in range(s["start"], s["end"] + 1):
            covered[i] = 1
    best_start, best = 1, -1
    for start in range(1, length - max_length + 2):
        total = sum(covered[start:start + max_length])
        # À couverture égale, fenêtre la plus centrée sur les segments
        if total > best:
            best_start, best = start, total
    if best <= 0:
        best_start = 1
    return best_start, best_start + max_length - 1


def _fmt(value: float) -> str:
    return f"{value:.0f}"


def _positions(items: list[dict], limit: int = 12) -> str:
    text = ", ".join(f"{i['aa']}{i['number']}" for i in items[:limit])
    return text + ("…" if len(items) > limit else "")


MODEL_INPUTS = {
    "ESMFold": "à partir de la seule séquence",
    "AlphaFold": "à partir de la séquence et de ses homologues",
}


def interpret(result: dict, tm_source: str, model: str = "ESMFold") -> list[dict]:
    """Lecture en phrases de la structure prédite (règles explicites, sans boîte noire)."""
    notes: list[dict] = []
    mean = result.get("mean_plddt")

    if not result.get("embedded"):
        notes.append(
            {
                "level": "info",
                "topic": "membrane",
                "title": "Aucun segment transmembranaire",
                "text": "Aucun segment transmembranaire n’est prédit dans la région modélisée : la structure est "
                "présentée sans membrane. La protéine est peut-être soluble, ou ancrée autrement (lipide, partenaire).",
            }
        )
        notes.append(
            {
                "level": "good" if (mean or 0) >= 70 else "warning",
                "topic": "confidence",
                "title": f"Confiance globale {confidence_label(mean)}",
                "text": f"pLDDT moyen {_fmt(mean or 0)} sur 100.",
            }
        )
        return notes

    tm, loops = result.get("tm_mean_plddt"), result.get("loop_mean_plddt")
    level = "good" if (tm or 0) >= 70 else "warning"
    text = f"pLDDT moyen {_fmt(tm or 0)} dans les hélices transmembranaires"
    if loops is not None:
        text += f", {_fmt(loops)} dans les boucles et extrémités"
    if (tm or 0) >= 70:
        text += ". L’architecture du cœur membranaire (position et empilement des hélices) est fiable."
    else:
        text += ". Même le cœur membranaire est incertain : à interpréter avec prudence, ou à comparer avec AlphaFold."
    if loops is not None and tm is not None and tm - loops >= 15:
        text += " Les boucles sont nettement moins sûres : leur conformation exacte ne doit pas être sur-interprétée."
    notes.append({"level": level, "topic": "confidence", "title": f"Cœur membranaire : confiance {confidence_label(tm)}", "text": text})

    disordered = [
        r for r in result["regions"]
        if r["kind"] != "tm" and (r["mean_plddt"] or 100) < LOW_CONFIDENCE and r["end"] - r["start"] + 1 >= MIN_DISORDERED_LENGTH
    ]
    if disordered:
        listing = " ; ".join(f"{r['label']} ({r['start']}–{r['end']}, pLDDT {_fmt(r['mean_plddt'])})" for r in disordered)
        notes.append(
            {
                "level": "info",
                "topic": "confidence",
                "title": "Régions probablement flexibles ou désordonnées",
                "text": f"{listing}. Dans les protéines membranaires, ces régions hors de la bicouche portent souvent "
                "des sites de régulation (phosphorylation, liaison de partenaires) plutôt qu’une structure stable.",
            }
        )

    membrane = result["membrane"]
    thickness = membrane["thickness"]
    low, high = TYPICAL_THICKNESS
    text = f"Épaisseur hydrophobe estimée : {_fmt(thickness)} Å"
    if low <= thickness <= high:
        text += f", dans la gamme habituelle d’une membrane plasmique ({_fmt(low)}–{_fmt(high)} Å)."
    elif thickness < low:
        text += f", plus mince que d’habitude ({_fmt(low)}–{_fmt(high)} Å) : membrane interne de mitochondrie, réticulum, ou hélices courtes."
    else:
        text += f", plus épaisse que d’habitude ({_fmt(low)}–{_fmt(high)} Å) : hélices longues, typiques par exemple de la membrane plasmique riche en cholestérol."
    if membrane["at_search_limit"]:
        text += " La valeur atteint la limite de la recherche : estimation peu sûre."
    notes.append({"level": "info", "topic": "membrane", "title": "Placement dans la bicouche", "text": text})

    if membrane["side_method"] == "topology":
        source = TOPOLOGY_SOURCES.get(tm_source, "la topologie fournie")
        side_text = f"Côté cytoplasmique fixé d’après {source}."
    else:
        side_text = (
            f"Côté cytoplasmique choisi par la règle « positive-inside » (von Heijne, 1989) : "
            f"{membrane['kr_inside']} Lys/Arg près de la face interne contre {membrane['kr_outside']} près de la face externe."
        )
        if abs(membrane["kr_inside"] - membrane["kr_outside"]) <= 1:
            side_text += " L’écart est faible : l’orientation inside/outside reste incertaine."
    n_side = "cytoplasmique (interne)" if membrane["n_terminus"] == "in" else "externe"
    window = result.get("window") or {"start": 1}
    subject = "Extrémité N-terminale" if window["start"] == 1 else f"Début de la région modélisée (résidu {window['start']})"
    notes.append(
        {
            "level": "info",
            "topic": "topology",
            "title": f"{subject} côté {n_side}",
            "text": side_text,
        }
    )

    helices = result["helices"]
    crossing = [h for h in helices if h["crosses"]]
    short = [h for h in helices if h.get("crossing") == "short"]
    tilted = [h for h in helices if h["tilt"] >= TILTED]
    partial = [h for h in helices if not h["crosses"]]
    text = f"{len(crossing)} hélice(s) sur {len(helices)} traversent la bicouche."
    if short:
        depth = lambda h: min(abs(h["reach_start"]), abs(h["reach_end"]))  # noqa: E731
        text += (
            " Hélice(s) courte(s), dont une extrémité s’arrête dans la bicouche et dont la boucle voisine termine "
            "la traversée : " + ", ".join(f"{h['label']} (extrémité à {_fmt(depth(h))} Å du centre, face à {_fmt(thickness / 2)} Å)" for h in short) + ". "
            "C’est fréquent quand une boucle plonge dans la membrane ou quand l’hélice borde une cavité ou un site actif."
        )
    if tilted:
        text += " Inclinées de plus de 30° : " + ", ".join(f"{h['label']} ({_fmt(h['tilt'])}°)" for h in tilted) + "."
        text += " Une forte inclinaison compense souvent une hélice longue, ou accompagne un mouvement fonctionnel (canal, transporteur)."
    if partial:
        text += (
            " Ne traversent pas toute la membrane : " + ", ".join(h["label"] for h in partial) + " : hélice réentrante, "
            "segment amphipathique d’interface, chaîne d’un oligomère modélisée seule, ou segment mal prédit."
        )
    notes.append({"level": "info" if not partial else "warning", "topic": "helices", "title": "Hélices transmembranaires", "text": text})

    belt = result["aromatic_belt"]
    if belt:
        outer = sum(1 for r in belt if r["face"] == "externe")
        notes.append(
            {
                "level": "good",
                "topic": "residues",
                "title": f"Ceinture aromatique : {len(belt)} Trp/Tyr aux interfaces",
                "text": f"{_positions(belt)} ({outer} face externe, {len(belt) - outer} face interne). Les tryptophanes et "
                "tyrosines se placent à la frontière entre les chaînes lipidiques et les têtes polaires : ils ancrent "
                "la protéine dans la bicouche. Leur présence aux deux faces conforte le placement calculé.",
            }
        )

    charged = result["buried_charged"]
    if charged:
        notes.append(
            {
                "level": "warning",
                "topic": "residues",
                "title": f"{len(charged)} résidu(s) chargé(s) au cœur de la membrane",
                "text": f"{_positions(charged)}. Une charge enfouie dans la bicouche coûte beaucoup d’énergie : quand elle est "
                "conservée, elle a presque toujours un rôle — liaison d’un ligand ou d’un ion, transfert de protons, "
                "pont salin entre hélices, ou interface avec une autre sous-unité. À croiser avec la conservation.",
            }
        )

    notes.append(
        {
            "level": "info",
            "topic": "limits",
            "title": "Limites de la prédiction",
            "text": f"{model} modélise une seule chaîne, {MODEL_INPUTS.get(model, 'à partir de la séquence')}, "
            "sans membrane, lipides, ligands ni "
            "partenaires : les oligomères et les changements de conformation ne sont pas représentés. Le placement "
            "dans la membrane est une estimation (ajustement d’une bicouche hydrophobe), pas une mesure.",
        }
    )
    return notes


def _segments(sequence: str, tm_segments: list[dict] | None, tm_source: str) -> tuple[list[dict], str]:
    """Segments TM fournis, numérotés TM1, TM2… ; sinon estimés (Kyte-Doolittle)."""
    if tm_segments is None:
        tm_segments = [{"start": s["start"], "end": s["end"]} for s in estimate_tm_segments(sequence)]
        tm_source = "kd"
    segments = [
        {"start": int(s["start"]), "end": int(s["end"]), "label": s.get("label") or f"TM{i}"}
        for i, s in enumerate(sorted(tm_segments, key=lambda s: s["start"]), start=1)
    ]
    return segments, tm_source


def place_model(
    pdb: str,
    sequence: str,
    name: str,
    tm_segments: list[dict] | None,
    tm_source: str,
    n_terminus: str | None,
    model: str,
) -> dict:
    """Modèle complet déjà calculé (AlphaFold DB), numéroté comme UniProt, placé dans la membrane."""
    tm_segments, tm_source = _segments(sequence, tm_segments, tm_source)
    side = n_terminus if n_terminus in ("in", "out") else None
    result = embed_structure(pdb, sequence, tm_segments, n_terminus=side)
    length = len(sequence)
    result.update(
        {
            "name": name,
            "length": length,
            "window": {"start": 1, "end": length, "complete": True, "max_length": length},
            "tm_source": tm_source,
            "tm_segments": tm_segments,
            "method": f"{model} + ajustement d’une bicouche hydrophobe",
        }
    )
    result["interpretation"] = interpret(result, tm_source, model)
    return result


def predict_structure(
    sequence: str,
    name: str = "query",
    tm_segments: list[dict] | None = None,
    tm_source: str = "kd",
    n_terminus: str | None = None,
    start: int | None = None,
) -> dict:
    sequence = re.sub(r"[^A-Za-z]", "", sequence).upper()
    tm_segments, tm_source = _segments(sequence, tm_segments, tm_source)

    if start is None:
        start, end = choose_window(len(sequence), tm_segments)
    else:
        start = max(1, min(int(start), max(1, len(sequence) - MAX_LENGTH + 1)))
        end = min(len(sequence), start + MAX_LENGTH - 1)
    modelled = sequence[start - 1:end]

    pdb = fold_sequence(modelled)
    # Côté d'entrée de la première hélice de la fenêtre : chaque segment
    # transmembranaire situé avant la fenêtre fait changer de côté
    known_side = None
    if n_terminus in ("in", "out"):
        before = sum(1 for s in tm_segments if s["end"] < start + 3)
        known_side = n_terminus if before % 2 == 0 else ("out" if n_terminus == "in" else "in")
    result = embed_structure(pdb, modelled, tm_segments, n_terminus=known_side, offset=start - 1)
    result.update(
        {
            "name": name,
            "length": len(sequence),
            "window": {"start": start, "end": end, "complete": start == 1 and end == len(sequence), "max_length": MAX_LENGTH},
            "tm_source": tm_source,
            "tm_segments": tm_segments,
            "method": "ESMFold (ESM Atlas) + ajustement d’une bicouche hydrophobe",
        }
    )
    result["interpretation"] = interpret(result, tm_source)
    return result
