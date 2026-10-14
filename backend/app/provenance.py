"""
Traçabilité des calculs (reproductibilité).

Pendant l'exécution d'une tâche, un « enregistreur » rassemble :
- les étapes du pipeline (début, durée, statut, message d'erreur) ;
- les sources de données consultées : version (release) quand le service la
  donne (UniProt), date de consultation, et si la réponse venait du cache de
  la plateforme (avec la date de mise en cache) ;
- les entrées (séquences, structures) et les outils utilisés ;
- l'environnement (versions de Python, numpy, code de la plateforme).

Les services appellent `step()`, `record_input()` ou `record_tool()` ; hors
d'une tâche, ces appels ne font rien.
"""

import contextvars
import hashlib
import json
import os
import platform
import subprocess
import sys
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from functools import lru_cache
from urllib.parse import urlparse

_current: contextvars.ContextVar["Recorder | None"] = contextvars.ContextVar("provenance", default=None)

# Hôte → base de données (sources consultées en direct)
HOSTS = [
    ("rest.uniprot.org", "UniProt"),
    ("www.ebi.ac.uk/interpro", "InterPro"),
    ("alphafold.ebi.ac.uk", "AlphaFold DB"),
    ("rcsb.org", "RCSB PDB"),
    ("www.ebi.ac.uk/pdbe", "PDBe / SIFTS"),
    ("opm", "OPM"),
    ("colabfold", "MMseqs2 (serveur ColabFold, UniRef)"),
    ("esmatlas", "ESMFold (ESM Atlas)"),
    ("biolib", "DeepTMHMM (BioLib)"),
]
# Espace de noms du cache → base de données (réponses déjà enregistrées)
CACHE_NAMESPACES = [
    ("uniprot", "UniProt"),
    ("uniparc", "UniProt"),
    ("uniref", "UniProt"),
    ("interpro", "InterPro"),
    ("alphafold", "AlphaFold DB"),
    ("pdb", "RCSB PDB"),
    ("rcsb", "RCSB PDB"),
    ("quality", "RCSB PDB"),
    ("opm", "OPM"),
    ("sifts", "PDBe / SIFTS"),
    ("explorer:mmseqs", "MMseqs2 (serveur ColabFold, UniRef)"),
    ("explorer:homologs", "UniProt"),
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def source_for_url(url: str) -> str | None:
    parsed = urlparse(url)
    target = f"{parsed.netloc}{parsed.path}"
    return next((name for fragment, name in HOSTS if fragment in target), None)


def source_for_namespace(namespace: str) -> str | None:
    return next((name for prefix, name in CACHE_NAMESPACES if namespace.startswith(prefix)), None)


class Recorder:
    def __init__(self, job_id: str, kind: str):
        self.job_id = job_id
        self.kind = kind
        self.steps: list[dict] = []
        self.sources: dict[str, dict] = {}
        self.inputs: list[dict] = []
        self.tools: dict[str, dict] = {}
        self.started = time.monotonic()

    # Sources de données
    def source(
        self,
        name: str,
        *,
        release: str | None = None,
        release_date: str | None = None,
        cached_at: str | None = None,
        failure: str | None = None,
    ) -> None:
        entry = self.sources.setdefault(
            name,
            {"name": name, "live_requests": 0, "cached_responses": 0, "failed_requests": 0, "last_error": None, "release": None, "release_date": None, "oldest_cache": None, "first_access": _now()},
        )
        if failure:
            entry["failed_requests"] += 1
            entry["last_error"] = failure[:300]
        elif cached_at:
            entry["cached_responses"] += 1
            if not entry["oldest_cache"] or cached_at < entry["oldest_cache"]:
                entry["oldest_cache"] = cached_at
        else:
            entry["live_requests"] += 1
        if release:
            entry["release"], entry["release_date"] = release, release_date or entry["release_date"]

    def input(self, kind: str, identifier: str, **details) -> None:
        if not any(i["kind"] == kind and i["id"] == identifier for i in self.inputs):
            self.inputs.append({"kind": kind, "id": identifier, **{k: v for k, v in details.items() if v is not None}})

    def tool(self, name: str, version: str | None = None, detail: str | None = None) -> None:
        self.tools[name] = {"name": name, "version": version, "detail": detail}

    @contextmanager
    def step(self, name: str, detail: str | None = None):
        record = {"name": name, "detail": detail, "status": "running", "started_at": _now(), "duration": None, "error": None, "cache_hits": 0}
        self.steps.append(record)
        before = sum(s["cached_responses"] for s in self.sources.values())
        start = time.monotonic()
        try:
            yield record
            record["status"] = "succeeded"
        except Exception as error:
            record["status"] = "failed"
            record["error"] = str(error)[:500]
            raise
        finally:
            record["duration"] = round(time.monotonic() - start, 2)
            record["cache_hits"] = sum(s["cached_responses"] for s in self.sources.values()) - before

    # Étapes séquentielles : chaque marque clôt la précédente
    def mark(self, name: str, detail: str | None = None) -> None:
        self.close()
        self._open = {
            "name": name,
            "detail": detail,
            "status": "running",
            "started_at": _now(),
            "duration": None,
            "error": None,
            "cache_hits": 0,
            "_start": time.monotonic(),
            "_cached": sum(s["cached_responses"] for s in self.sources.values()),
        }
        self.steps.append(self._open)

    def close(self, error: str | None = None) -> None:
        step = getattr(self, "_open", None)
        if not step:
            return
        step["status"] = "failed" if error else "succeeded"
        step["error"] = error[:500] if error else None
        step["duration"] = round(time.monotonic() - step.pop("_start"), 2)
        step["cache_hits"] = sum(s["cached_responses"] for s in self.sources.values()) - step.pop("_cached")
        self._open = None

    def to_dict(self) -> dict:
        return {
            "steps": self.steps,
            "sources": sorted(self.sources.values(), key=lambda s: s["name"]),
            "inputs": self.inputs,
            "tools": list(self.tools.values()),
            "duration": round(time.monotonic() - self.started, 2),
        }


def activate(recorder: Recorder):
    return _current.set(recorder)


def deactivate(token) -> None:
    _current.reset(token)


def current() -> Recorder | None:
    return _current.get()


@contextmanager
def step(name: str, detail: str | None = None):
    recorder = current()
    if recorder is None:
        yield None
        return
    with recorder.step(name, detail) as record:
        yield record


def mark(name: str, detail: str | None = None) -> None:
    """Début d'une étape du pipeline (la précédente est close)."""
    recorder = current()
    if recorder is not None:
        recorder.mark(name, detail)


def record_input(kind: str, identifier: str, **details) -> None:
    recorder = current()
    if recorder is not None:
        recorder.input(kind, identifier, **details)


def record_tool(name: str, version: str | None = None, detail: str | None = None) -> None:
    recorder = current()
    if recorder is not None:
        recorder.tool(name, version, detail)


def _record_live(url: str, response) -> None:
    """Source consultée en direct, et sa version si le service la donne."""
    recorder = current()
    if recorder is None:
        return
    name = source_for_url(url)
    if not name:
        return
    headers = getattr(response, "headers", {}) or {}
    recorder.source(name, release=headers.get("X-UniProt-Release"), release_date=headers.get("X-UniProt-Release-Date"))


def record_failure(url: str, error: Exception) -> None:
    """Requête vers une source externe en échec (service indisponible, délai dépassé…)."""
    recorder = current()
    name = source_for_url(url) if recorder is not None else None
    if name:
        recorder.source(name, failure=f"{type(error).__name__} : {error}")


def record_response(url: str, response) -> None:
    """Réponse reçue : une erreur HTTP compte comme un échec."""
    if getattr(response, "status_code", 200) >= 500:
        record_failure(url, RuntimeError(f"HTTP {response.status_code}"))
        return
    _record_live(url, response)


def record_cache_hit(namespace: str, created_at) -> None:
    """Appelé par le cache : réponse réutilisée, avec la date à laquelle elle a été obtenue."""
    recorder = current()
    if recorder is None:
        return
    name = source_for_namespace(namespace)
    if name:
        stamp = created_at.isoformat(timespec="seconds") if hasattr(created_at, "isoformat") else str(created_at)
        recorder.source(name, cached_at=stamp)


# ---------------------------------------------------------------------------
# Environnement et empreinte
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def code_version() -> str:
    """Version du code : variable APP_VERSION, sinon commit git, sinon inconnue."""
    if os.environ.get("APP_VERSION"):
        return os.environ["APP_VERSION"]
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=5, cwd=os.path.dirname(__file__)
        ).stdout.strip()
        return commit or "inconnue"
    except Exception:
        return "inconnue"


def environment() -> dict:
    import numpy

    return {
        "platform": "MemProtScope",
        "code_version": code_version(),
        "python": sys.version.split()[0],
        "numpy": numpy.__version__,
        "system": platform.system(),
    }


def fingerprint(kind: str, params: dict) -> str:
    """Empreinte des entrées et paramètres : deux exécutions de même empreinte ont les mêmes réglages."""
    payload = json.dumps({"kind": kind, "params": params}, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]
