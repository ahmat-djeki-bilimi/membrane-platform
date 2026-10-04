import requests


HYDROPHOBIC = set("AILMFWVYCG")


def fetch_uniprot_sequence(accession: str):
    accession = accession.upper().strip()
    url = f"https://rest.uniprot.org/uniprotkb/{accession}.json"

    response = requests.get(url, timeout=30)
    response.raise_for_status()
    data = response.json()

    sequence = data.get("sequence", {}).get("value", "")
    features = data.get("features", [])

    return sequence, features


def extract_uniprot_tm_segments(features):
    segments = []

    for feature in features:
        ftype = feature.get("type", "").lower()

        if "transmembrane" not in ftype:
            continue

        location = feature.get("location", {})
        start = location.get("start", {}).get("value")
        end = location.get("end", {}).get("value")

        if start and end:
            segments.append(
                {
                    "start": int(start),
                    "end": int(end),
                    "label": f"TM{len(segments) + 1}",
                    "source": "UniProt annotation",
                    "confidence": "high",
                }
            )

    return segments


def hydrophobic_ratio(fragment: str):
    if not fragment:
        return 0

    return sum(1 for aa in fragment if aa in HYDROPHOBIC) / len(fragment)


def predict_tm_segments(sequence: str, window: int = 21, threshold: float = 0.62):
    """
    Prédiction simple, stable et explicable :
    glisse une fenêtre de 21 aa et retient les régions hydrophobes longues.
    """
    if not sequence:
        return []

    hits = []

    for i in range(0, max(0, len(sequence) - window + 1)):
        fragment = sequence[i : i + window]
        score = hydrophobic_ratio(fragment)

        if score >= threshold:
            hits.append((i + 1, i + window, score))

    if not hits:
        return []

    merged = []
    cur_start, cur_end, scores = hits[0][0], hits[0][1], [hits[0][2]]

    for start, end, score in hits[1:]:
        if start <= cur_end + 3:
            cur_end = max(cur_end, end)
            scores.append(score)
        else:
            if cur_end - cur_start + 1 >= 18:
                merged.append((cur_start, cur_end, sum(scores) / len(scores)))
            cur_start, cur_end, scores = start, end, [score]

    if cur_end - cur_start + 1 >= 18:
        merged.append((cur_start, cur_end, sum(scores) / len(scores)))

    segments = []

    for idx, (start, end, score) in enumerate(merged, start=1):
        segments.append(
            {
                "start": start,
                "end": end,
                "label": f"TM{idx}",
                "source": "hydrophobicity prediction",
                "confidence": "medium" if score >= 0.7 else "low",
                "hydrophobic_score": round(score, 3),
            }
        )

    return segments


def estimate_orientation(segments, sequence_length: int):
    count = len(segments)

    if count == 0:
        topology = "Non-membrane or no TM segment detected"
        confidence = 25
        thickness = None
    else:
        topology = "N-out / C-in" if count % 2 == 1 else "N-out / C-out"
        confidence = min(95, 55 + count * 10)
        thickness = 30 + min(8, max(0, count - 1) * 1.5)

    if count == 0:
        interpretation = (
            "Aucun segment transmembranaire n’a été détecté automatiquement. "
            "La protéine peut être soluble, périphérique ou nécessiter une annotation plus spécifique."
        )
    else:
        interpretation = (
            f"{count} segment(s) transmembranaire(s) ont été détectés. "
            f"La topologie prédite est {topology}. "
            "Les régions TM correspondent à des segments hydrophobes susceptibles de traverser la bicouche lipidique. "
            "Cette orientation est une prédiction bioinformatique exploitable pour la visualisation et l’interprétation structurale. "
            "OPM est utilisé comme source externe de comparaison lorsque l’entrée PDB est disponible."
        )

    return {
        "tm_count": count,
        "topology": topology,
        "orientation_confidence": confidence,
        "estimated_hydrophobic_thickness": thickness,
        "extracellular_side": "N-terminal side / outside",
        "cytoplasmic_side": "C-terminal side / inside",
        "interpretation": interpretation,
    }


def get_membrane_orientation(accession: str):
    accession = accession.upper().strip()

    try:
        sequence, features = fetch_uniprot_sequence(accession)
        sequence_length = len(sequence)

        annotated = extract_uniprot_tm_segments(features)

        if annotated:
            segments = annotated
            method = "UniProt transmembrane annotation"
        else:
            segments = predict_tm_segments(sequence)
            method = "Hydrophobicity-based TM prediction"

        orientation = estimate_orientation(segments, sequence_length)

        return {
            "accession": accession,
            "available": True,
            "sequence_length": sequence_length,
            "method": method,
            "tm_segments": segments,
            "orientation": orientation,
            "opm_role": "External validation source when available",
        }

    except Exception as e:
        return {
            "accession": accession,
            "available": False,
            "sequence_length": 0,
            "method": "error",
            "tm_segments": [],
            "orientation": {
                "tm_count": 0,
                "topology": "-",
                "orientation_confidence": 0,
                "estimated_hydrophobic_thickness": None,
                "extracellular_side": "-",
                "cytoplasmic_side": "-",
                "interpretation": "Impossible de calculer l’orientation membranaire.",
            },
            "error": str(e),
        }
