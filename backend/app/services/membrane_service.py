"""
Prédiction de topologie membranaire par DeepTMHMM (DTU, via BioLib).

L'appel est bloquant (de quelques secondes à plusieurs minutes selon la file
BioLib) : il est exécuté par le worker de la file de calculs, jamais pendant
une requête HTTP.
"""

import re
from typing import Dict, List, Optional

from app.config import get_settings

# Étiquette de la ligne d'en-tête du fichier .3line → type lisible
PROTEIN_TYPES = {
    "TM": ("Protéine membranaire en hélices α", True),
    "SP+TM": ("Protéine membranaire en hélices α avec peptide signal", True),
    "BETA": ("Protéine membranaire en tonneau β", True),
    "SP+BETA": ("Protéine membranaire en tonneau β avec peptide signal", True),
    "GLOB": ("Protéine globulaire (non membranaire)", False),
    "SP": ("Protéine globulaire sécrétée (peptide signal)", False),
}

TM_FEATURES = {"tmhelix", "beta sheet"}


def parse_deeptmhmm_output(gff_text: str, three_line_text: str) -> Dict:
    tm_segments: List[Dict] = []
    signal_peptide: Optional[Dict] = None
    regions: List[Dict] = []

    for line in gff_text.splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        cols = line.split("\t")
        if len(cols) < 4:
            continue
        feature = cols[1].strip().lower()
        try:
            start, end = int(cols[2]), int(cols[3])
        except ValueError:
            continue

        regions.append({"type": feature, "start": start, "end": end})
        if feature in TM_FEATURES:
            tm_segments.append(
                {
                    "start": start,
                    "end": end,
                    "label": f"TM{len(tm_segments) + 1}",
                    "kind": "beta" if feature == "beta sheet" else "helix",
                }
            )
        elif feature == "signal":
            signal_peptide = {"start": start, "end": end}

    type_match = re.search(r"^>.*\|\s*([A-Z+]+)\s*$", three_line_text, flags=re.MULTILINE)
    type_code = type_match.group(1) if type_match else None
    predicted_type, is_membrane = PROTEIN_TYPES.get(
        type_code or "", ("Type non déterminé", bool(tm_segments))
    )

    # Côté de l'extrémité N-terminale (première région hors peptide signal)
    n_terminus = None
    for region in regions:
        if region["type"] == "inside":
            n_terminus = "in"
            break
        if region["type"] in ("outside", "periplasm"):
            n_terminus = "out"
            break
        if region["type"] in TM_FEATURES:
            break

    topology_lines = [l for l in three_line_text.splitlines() if l.strip()]
    topology = topology_lines[2].strip() if len(topology_lines) >= 3 else None

    return {
        "is_membrane": is_membrane,
        "predicted_type": predicted_type,
        "type_code": type_code,
        "tm_segments": tm_segments,
        "signal_peptide": signal_peptide,
        "n_terminus": n_terminus,
        "topology": topology,
        "raw_output": gff_text,
    }


def _read_output(job, suffix: str) -> str:
    for f in job.list_output_files():
        if f.path.lower().endswith(suffix):
            return f.get_data().decode("utf-8", errors="ignore")
    return ""


class DeepTMHMMError(Exception):
    pass


def deeptmhmm_enabled() -> bool:
    """Actif si la configuration l'autorise et si pybiolib est installé."""
    if not get_settings().deeptmhmm_enabled:
        return False
    try:
        import biolib  # noqa: F401
    except ImportError:
        return False
    return True


def predict_topology(sequence: str, name: str = "query") -> Dict:
    """Exécute DeepTMHMM et renvoie la topologie analysée (appel bloquant)."""
    sequence = re.sub(r"[^A-Za-z]", "", sequence).upper()
    if not sequence:
        raise DeepTMHMMError("Séquence vide.")

    import biolib  # import tardif : dépendance lourde et optionnelle

    # Nom simple : DeepTMHMM réutilise l'en-tête FASTA dans ses noms de fichiers
    safe_name = re.sub(r"[^A-Za-z0-9_.-]", "_", name) or "query"
    fasta = f">{safe_name}\n{sequence}\n".encode()

    app = biolib.load("DTU/DeepTMHMM")
    # Fichier transmis en mémoire : un chemin Windows absolu n'est pas
    # correctement relayé par BioLib.
    job = app.cli(args=["--fasta", "input.fasta"], files={"input.fasta": fasta})

    if job.get_exit_code() != 0:
        stderr = job.get_stderr().decode("utf-8", errors="ignore")[-500:]
        raise DeepTMHMMError(f"DeepTMHMM a échoué : {stderr}")

    gff_text = _read_output(job, ".gff3")
    if not gff_text:
        raise DeepTMHMMError("DeepTMHMM n'a renvoyé aucun résultat exploitable.")
    return parse_deeptmhmm_output(gff_text, _read_output(job, ".3line"))


def deeptmhmm_response(result: Dict, **extra) -> Dict:
    """Format de réponse commun aux routes membranaires."""
    return {
        **extra,
        "method": "DeepTMHMM",
        "is_membrane": result["is_membrane"],
        "predicted_type": result["predicted_type"],
        "tm_segments": result["tm_segments"],
        "count": len(result["tm_segments"]),
        "signal_peptide": result.get("signal_peptide"),
        "n_terminus": result.get("n_terminus"),
        "topology": result.get("topology"),
    }


# Processus DeepTMHMM en cours, interrompus à l'arrêt du serveur
_running_processes: set = set()


def predict_topology_isolated(sequence: str, name: str = "query", timeout: int = 3 * 3600) -> Dict:
    """Exécute DeepTMHMM dans un processus séparé (voir app/tools/deeptmhmm_cli.py)."""
    import json
    import subprocess
    import sys

    from app.config import BACKEND_DIR

    process = subprocess.Popen(
        [sys.executable, "-m", "app.tools.deeptmhmm_cli"],
        cwd=BACKEND_DIR,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
    _running_processes.add(process)
    try:
        stdout, stderr = process.communicate(json.dumps({"sequence": sequence, "name": name}), timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        raise DeepTMHMMError(f"DeepTMHMM n'a pas répondu en {timeout // 60} minutes.")
    finally:
        _running_processes.discard(process)

    # Dernière ligne JSON de la sortie (BioLib peut écrire des journaux avant)
    payload = None
    for line in reversed(stdout.strip().splitlines()):
        try:
            payload = json.loads(line)
            break
        except ValueError:
            continue
    if payload is None:
        raise DeepTMHMMError(f"Processus DeepTMHMM interrompu : {stderr.strip()[-300:] or 'aucune sortie'}")
    if "error" in payload:
        raise DeepTMHMMError(payload["error"])
    return payload["result"]


def stop_running_predictions() -> None:
    """Interrompt les prédictions en cours (arrêt du serveur) ; elles seront relancées."""
    for process in list(_running_processes):
        process.kill()
