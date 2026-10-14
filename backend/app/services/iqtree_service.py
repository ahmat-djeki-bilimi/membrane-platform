"""
Arbre par maximum de vraisemblance avec IQ-TREE (Minh et al., 2020).

IQ-TREE est un programme externe : il est cherché à l'emplacement configuré
(IQTREE_PATH), sinon dans le PATH (iqtree3, iqtree2, iqtree). Sans lui, la
plateforme propose seulement Neighbor-Joining.

Support des branches : bootstrap ultrarapide (UFBoot2, Hoang et al., 2018)
et test SH-aLRT (Guindon et al., 2010), 1 000 réplicats chacun. Seuils
recommandés par leurs auteurs : UFBoot ≥ 95 %, SH-aLRT ≥ 80 %.
"""

import re
import shutil
import subprocess
import tempfile
import time
from functools import lru_cache
from pathlib import Path

from app.config import get_settings

CANDIDATES = ("iqtree3", "iqtree2", "iqtree")
ML_MODELS = {
    "LG+G4": {
        "label": "LG+G4 (modèle fixé)",
        "text": "Matrice LG et hétérogénéité des vitesses entre sites (loi gamma, 4 catégories) : modèle général des protéines, rapide.",
    },
    "MFP": {
        "label": "ModelFinder (choix automatique)",
        "text": "Le modèle le mieux adapté aux données est choisi par le critère BIC (Kalyaanamoorthy et al., 2017) : plus long, plus rigoureux.",
    },
}
DEFAULT_ML_MODEL = "LG+G4"
UFBOOT_REPLICATES = 1000
ALRT_REPLICATES = 1000
UFBOOT_THRESHOLD = 0.95
ALRT_THRESHOLD = 0.80


class IqtreeError(RuntimeError):
    pass


def find_binary() -> str | None:
    configured = get_settings().iqtree_path.strip()
    if configured:
        return configured if Path(configured).exists() or shutil.which(configured) else None
    return next((path for name in CANDIDATES if (path := shutil.which(name))), None)


@lru_cache(maxsize=4)
def _version(binary: str) -> str | None:
    try:
        output = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=30).stdout
    except Exception:
        return None
    match = re.search(r"IQ-TREE.*?version\s+([\w.\-]+)", output, flags=re.IGNORECASE)
    return match.group(1) if match else None


def availability() -> dict:
    binary = find_binary()
    version = _version(binary) if binary else None
    return {
        "available": bool(binary and version),
        "version": version,
        "models": ML_MODELS,
        "ufboot_replicates": UFBOOT_REPLICATES,
        "alrt_replicates": ALRT_REPLICATES,
        "help": None
        if binary and version
        else "IQ-TREE n’est pas installé sur le serveur. Installez IQ-TREE 2 ou 3 (iqtree.github.io) et indiquez son chemin dans IQTREE_PATH, ou ajoutez-le au PATH.",
    }


def write_fasta(path: Path, names: list[str], rows: list[str]) -> None:
    path.write_text("".join(f">{name}\n{row}\n" for name, row in zip(names, rows)), encoding="ascii")


def run_iqtree(rows: list[str], model: str = DEFAULT_ML_MODEL, seed: int = 1) -> dict:
    """
    Arbre ML d'un alignement (une ligne par séquence, même longueur). Les
    séquences sont nommées s0, s1… dans l'ordre des lignes.
    """
    binary = find_binary()
    version = _version(binary) if binary else None
    if not binary or not version:
        raise IqtreeError("IQ-TREE n’est pas disponible sur ce serveur.")
    if len(rows) < 4:
        raise IqtreeError("Il faut au moins 4 séquences pour un arbre de maximum de vraisemblance avec bootstrap.")
    if model not in ML_MODELS:
        raise IqtreeError(f"Modèle inconnu : {model}.")

    settings = get_settings()
    names = [f"s{k}" for k in range(len(rows))]
    with tempfile.TemporaryDirectory(prefix="iqtree-") as tmp:
        folder = Path(tmp)
        alignment = folder / "alignment.fasta"
        write_fasta(alignment, names, rows)
        prefix = folder / "arbre"
        options = [
            "-st", "AA", "-m", model,
            "-B", str(UFBOOT_REPLICATES), "-alrt", str(ALRT_REPLICATES),
            "-T", str(max(1, settings.iqtree_threads)), "--seed", str(seed),
            "-redo", "--quiet",
        ]
        command = [binary, "-s", str(alignment), *options, "--prefix", str(prefix)]
        start = time.monotonic()
        try:
            completed = subprocess.run(command, capture_output=True, text=True, timeout=settings.iqtree_timeout_seconds)
        except subprocess.TimeoutExpired:
            raise IqtreeError(f"IQ-TREE n’a pas terminé en {settings.iqtree_timeout_seconds // 60} minutes.")
        treefile = prefix.with_suffix(".treefile")
        if completed.returncode != 0 or not treefile.exists():
            log = prefix.with_suffix(".log")
            detail = (log.read_text(errors="replace") if log.exists() else completed.stderr or completed.stdout)[-800:]
            raise IqtreeError(f"IQ-TREE a échoué : {detail.strip()}")
        report = prefix.with_suffix(".iqtree").read_text(errors="replace") if prefix.with_suffix(".iqtree").exists() else ""
        chosen = re.search(r"Best-fit model according to BIC:\s*(\S+)", report) or re.search(r"Model of substitution:\s*(\S+)", report)
        likelihood = re.search(r"Log-likelihood of the tree:\s*(-?[\d.]+)", report)
        return {
            "newick": treefile.read_text().strip(),
            "names": names,
            "version": version,
            "model": chosen.group(1) if chosen else model,
            "requested_model": model,
            "log_likelihood": float(likelihood.group(1)) if likelihood else None,
            "runtime": round(time.monotonic() - start, 1),
            # Commande à relancer telle quelle sur l'alignement exporté (reproductibilité)
            "command": " ".join(["iqtree2", "-s", "alignement.fasta", *options, "--prefix", "arbre"]),
        }


# ---------------------------------------------------------------------------
# Lecture du Newick d'IQ-TREE
# ---------------------------------------------------------------------------

def parse_newick(text: str, names: list[str]) -> tuple[list[tuple[int, int, float]], dict[int, tuple[float | None, float | None]]]:
    """
    Arêtes (nœud, nœud, longueur) avec les feuilles numérotées comme `names`
    (0…n-1) et les nœuds internes à partir de n ; supports (SH-aLRT, UFBoot)
    de chaque nœud interne, en fraction.
    """
    index = {name: k for k, name in enumerate(names)}
    n = len(names)
    edges: list[tuple[int, int, float]] = []
    labels: dict[int, tuple[float | None, float | None]] = {}
    position = 0
    next_id = n
    text = text.strip().rstrip(";")

    def read_label() -> str:
        nonlocal position
        start = position
        while position < len(text) and text[position] not in ",():;":
            position += 1
        return text[start:position]

    def read_length() -> float:
        nonlocal position
        if position < len(text) and text[position] == ":":
            position += 1
            start = position
            while position < len(text) and text[position] not in ",()":
                position += 1
            return float(text[start:position] or 0)
        return 0.0

    def node() -> int:
        nonlocal position, next_id
        if text[position] == "(":
            position += 1
            me = next_id
            next_id += 1
            children = []
            while True:
                child = node()
                children.append((child, read_length()))
                if text[position] == ",":
                    position += 1
                    continue
                if text[position] == ")":
                    position += 1
                    break
                raise IqtreeError("Newick illisible.")
            label = read_label()
            if label:
                parts = [float(p) if p else None for p in label.split("/")]
                alrt, ufboot = (parts + [None, None])[:2] if len(parts) == 2 else (None, parts[0])
                labels[me] = (alrt / 100 if alrt is not None else None, ufboot / 100 if ufboot is not None else None)
            for child, length in children:
                edges.append((me, child, max(length, 0.0)))
            return me
        name = read_label()
        if name not in index:
            raise IqtreeError(f"Séquence inconnue dans l’arbre IQ-TREE : {name}.")
        return index[name]

    node()
    return edges, labels


def split_supports(edges: list[tuple[int, int, float]], labels: dict[int, tuple], n: int) -> tuple[dict[int, float], dict[int, float]]:
    """Supports UFBoot et SH-aLRT indexés par bipartition (côté sans la feuille 0), comme pour Neighbor-Joining."""
    children: dict[int, list[int]] = {}
    for parent, child, _ in edges:
        children.setdefault(parent, []).append(child)
    full = (1 << n) - 1
    ufboot, alrt = {}, {}

    def mask(node: int) -> int:
        if node < n:
            return 1 << node
        value = 0
        for child in children.get(node, []):
            value |= mask(child)
        if node in labels:
            split = value if not value & 1 else full & ~value
            if 1 < bin(split).count("1") < n - 1:
                a, u = labels[node]
                if u is not None:
                    ufboot[split] = u
                if a is not None:
                    alrt[split] = a
        return value

    roots = set(children) - {c for cs in children.values() for c in cs}
    for root in roots:
        mask(root)
    return ufboot, alrt
