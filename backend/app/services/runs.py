"""
Exécutions des analyses (reproductibilité).

Chaque calcul de la plateforme est une tâche (table `jobs`) : paramètres,
statut, résultat, erreur, dates, et traçabilité (`provenance`). Ce module :
- décrit chaque type d'analyse (méthodes, outils et références, entrées) ;
- résume ses résultats en quelques indicateurs ;
- compare deux exécutions (paramètres, versions des sources, étapes,
  résultats) ;
- prépare les tableaux exportés en CSV.
"""

import csv
import hashlib
import io
from datetime import datetime, timedelta, timezone

KIND_LABELS = {
    "explorer": "Explorateur : famille, conservation, topologie, coévolution",
    "explorer_tree": "Arbre phylogénétique (sélection de l’Explorateur)",
    "conservation": "Conservation évolutive (entrée UniProt)",
    "conservation_sequence": "Conservation évolutive (séquence)",
    "deeptmhmm": "Topologie membranaire (DeepTMHMM)",
    "structure_prediction": "Structure prédite (ESMFold) placée dans la membrane",
    "protein_comparison": "Comparaison de protéines",
}

# Durée au-delà de laquelle une tâche « en cours » est probablement interrompue
STALE_AFTER = {"deeptmhmm": timedelta(hours=3, minutes=30)}
DEFAULT_STALE = timedelta(hours=1)

_ALIGN = {"name": "Alignement semi-global (Gotoh, BLOSUM62, gaps 11/1)", "reference": "Gotoh 1982 ; Henikoff & Henikoff 1992"}
_JS = {"name": "Conservation : divergence de Jensen-Shannon, poids de Henikoff, grades 1–9", "reference": "Capra & Singh 2007 ; Henikoff & Henikoff 1994"}
_TREE = {"name": "Arbre : distances (Kimura, Poisson ou p) + Neighbor-Joining, bootstrap", "reference": "Kimura 1983 ; Saitou & Nei 1987 ; Felsenstein 1985"}
_MIP = {"name": "Coévolution : information mutuelle + APC, tests de robustesse", "reference": "Dunn et al. 2008"}
_SCA = {"name": "Statistical Coupling Analysis + ICA", "reference": "Halabi et al. 2009 ; Rivoire et al. 2016"}
_DEEPTMHMM = {"name": "DeepTMHMM (BioLib)", "reference": "Hallgren et al. 2022"}
_ESMFOLD = {"name": "ESMFold (API ESM Atlas)", "reference": "Lin et al. 2023"}
_AF = {"name": "AlphaFold DB (modèles prédits)", "reference": "Jumper et al. 2021 ; Varadi et al. 2024"}
_MEMBRANE = {"name": "Placement dans la membrane : ajustement d’une bicouche (inspiré de PPM et TMDET)", "reference": "Lomize et al. 2012 ; Tusnády et al. 2005"}
_MMSEQS = {"name": "MMseqs2 (serveur ColabFold, UniRef)", "reference": "Steinegger & Söding 2017 ; Mirdita et al. 2022"}

METHODS = {
    "explorer": [_ALIGN, _JS, _TREE, _MIP, _SCA, _DEEPTMHMM, _AF, _ESMFOLD, _MEMBRANE, _MMSEQS],
    "explorer_tree": [_TREE],
    "conservation": [_ALIGN, _JS, _TREE, _MMSEQS],
    "conservation_sequence": [_ALIGN, _JS, _TREE, _MMSEQS],
    "deeptmhmm": [_DEEPTMHMM],
    "structure_prediction": [_ESMFOLD, _MEMBRANE],
    "protein_comparison": [_ALIGN, _AF, {"name": "Superposition : maximisation du TM-score puis Kabsch", "reference": "Zhang & Skolnick 2004 ; Kabsch 1976"}],
}


def methods(kind: str, params: dict) -> list[dict]:
    """Méthodes et outils d'un type d'analyse, avec la version de méthode de la plateforme."""
    version = params.get("version")
    selected = METHODS.get(kind, [])
    # Recherche étendue MMseqs2 seulement si elle a été demandée
    if kind == "explorer" and not params.get("expand"):
        selected = [m for m in selected if m is not _MMSEQS]
    if kind == "conservation" and params.get("source") != "mmseqs":
        selected = [m for m in selected if m is not _MMSEQS]
    return [{**m, "platform_version": version} for m in selected]


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def declared_inputs(kind: str, params: dict) -> list[dict]:
    """Entrées données par l'utilisateur (séquences résumées par leur empreinte)."""
    inputs = []
    if params.get("fasta"):
        fasta = params["fasta"]
        inputs.append({"kind": "FASTA", "id": f"{fasta.count('>')} séquence(s)", "sha256": _sha(fasta), "size": len(fasta)})
    if params.get("sequence"):
        inputs.append({"kind": "Séquence", "id": params.get("name") or "séquence", "length": len(params["sequence"]), "sha256": _sha(params["sequence"])})
    if params.get("accession"):
        inputs.append({"kind": "Entrée UniProt", "id": params["accession"]})
    for accession in params.get("accessions") or []:
        inputs.append({"kind": "Entrée UniProt", "id": accession})
    if params.get("job"):
        inputs.append({"kind": "Analyse d’origine", "id": params["job"]})
    if params.get("keep") is not None:
        inputs.append({"kind": "Sélection d’homologues", "id": f"{len(params['keep'])} homologue(s)"})
    return inputs


# ---------------------------------------------------------------------------
# Résumé des résultats
# ---------------------------------------------------------------------------

def _round(value, digits=3):
    return round(value, digits) if isinstance(value, float) else value


def summarize(kind: str, result: dict | None) -> dict:
    """Indicateurs principaux d'un résultat (pour l'aperçu, la comparaison et le rapport)."""
    if not result:
        return {}
    if kind == "explorer":
        co = result.get("coevolution") or {}
        precision = {p["label"]: p["precision"] for p in co.get("precision", [])}
        return {
            "Référence": (result.get("reference") or {}).get("accession") or (result.get("reference") or {}).get("id"),
            "Longueur": (result.get("reference") or {}).get("length"),
            "Homologues analysés": (result.get("input") or {}).get("kept"),
            "Neff (coévolution)": co.get("neff"),
            "Score de conservation moyen": _round((result.get("summary") or {}).get("mean_score")),
            "Segments TM": len((result.get("topology") or {}).get("segments", [])),
            "Source de la topologie": (result.get("topology") or {}).get("source"),
            "Structure": (result.get("structure") or {}).get("source"),
            "Fiabilité de la coévolution": (co.get("reliability") or {}).get("level"),
            "Précision L/5": precision.get("L/5"),
            "Secteurs SCA": len((result.get("sca") or {}).get("sectors", [])),
            "Positions candidates": len(result.get("candidates", [])),
            "Avertissements": len(result.get("warnings", [])),
        }
    if kind in ("conservation", "conservation_sequence"):
        return {
            "Séquences": result.get("sequence_count"),
            "Espèces": result.get("species_count"),
            "Longueur": result.get("length"),
            "Score moyen": _round((result.get("summary") or {}).get("mean_score")),
            "Méthode": result.get("method"),
        }
    if kind == "protein_comparison":
        proteins = [p["accession"] for p in result.get("proteins", [])]
        summary = {"Protéines": ", ".join(proteins), "Colonnes de l’alignement": len((result.get("alignment") or {}).get("columns", []))}
        for key, pair in (result.get("pairwise") or {}).items():
            a, b = map(int, key.split("-"))
            summary[f"Identité {proteins[a]}/{proteins[b]}"] = pair.get("identity")
            structure = (result.get("structures") or {}).get("pairs", {}).get(key)
            if structure:
                summary[f"TM-score {proteins[a]}/{proteins[b]}"] = max(structure["tm_score_a"], structure["tm_score_b"])
        return summary
    if kind == "explorer_tree":
        tree = result.get("tree") or {}
        return {"Séquences": tree.get("leaf_count"), "Modèle": (tree.get("model") or {}).get("label"), "Fiabilité": tree.get("reliability")}
    if kind == "deeptmhmm":
        return {"Type prédit": result.get("predicted_type"), "Segments TM": len(result.get("tm_segments") or []), "N-terminal": result.get("n_terminus")}
    if kind == "structure_prediction":
        return {"pLDDT moyen": result.get("mean_plddt"), "Placée dans la membrane": result.get("embedded"), "Épaisseur (Å)": (result.get("membrane") or {}).get("thickness")}
    return {k: v for k, v in result.items() if isinstance(v, (int, float, bool)) or (isinstance(v, str) and len(v) < 80)}


# ---------------------------------------------------------------------------
# État d'une exécution
# ---------------------------------------------------------------------------

def is_stale(job: dict) -> bool:
    """Tâche en cours depuis trop longtemps : probablement interrompue (arrêt du serveur ou du worker)."""
    if job["status"] not in ("queued", "running"):
        return False
    since = job.get("started_at") or job.get("created_at")
    if not since:
        return False
    started = datetime.fromisoformat(since)
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - started > STALE_AFTER.get(job["kind"], DEFAULT_STALE)


def describe(job: dict) -> dict:
    """Exécution sans son résultat complet (liste, comparaison)."""
    provenance = job.get("provenance") or {}
    return {
        **{k: v for k, v in job.items() if k not in ("result", "params")},
        "label": KIND_LABELS.get(job["kind"], job["kind"]),
        "stale": is_stale(job),
        "can_resume": job["status"] == "failed" or is_stale(job),
        "summary": summarize(job["kind"], job.get("result")),
        "inputs": provenance.get("declared_inputs") or declared_inputs(job["kind"], job.get("params") or {}),
        "params_digest": {k: (_digest(v) if isinstance(v, (str, list, dict)) and len(str(v)) > 120 else v) for k, v in (job.get("params") or {}).items()},
    }


def _digest(value) -> str:
    text = value if isinstance(value, str) else repr(value)
    return f"[{len(text)} caractères, empreinte {_sha(text)}]"


# ---------------------------------------------------------------------------
# Comparaison de deux exécutions
# ---------------------------------------------------------------------------

def _flatten(data: dict, prefix: str = "") -> dict:
    flat = {}
    for key, value in (data or {}).items():
        name = f"{prefix}{key}"
        if isinstance(value, dict):
            flat.update(_flatten(value, f"{name}."))
        elif isinstance(value, (str, list)) and len(str(value)) > 120:
            flat[name] = _digest(value)
        else:
            flat[name] = value
    return flat


def _diff(a: dict, b: dict) -> list[dict]:
    keys = list(dict.fromkeys(list(a) + list(b)))
    return [{"key": k, "a": a.get(k), "b": b.get(k), "same": a.get(k) == b.get(k)} for k in keys]


def _positions(result: dict | None, key: str) -> set:
    return {c["position"] for c in (result or {}).get(key, [])}


def compare(a: dict, b: dict) -> dict:
    pa, pb = a.get("provenance") or {}, b.get("provenance") or {}
    sources_a = {s["name"]: s for s in pa.get("sources", [])}
    sources_b = {s["name"]: s for s in pb.get("sources", [])}
    sources = []
    for name in sorted(set(sources_a) | set(sources_b)):
        sa, sb = sources_a.get(name, {}), sources_b.get(name, {})
        sources.append(
            {
                "name": name,
                "a": {"release": sa.get("release"), "live": sa.get("live_requests"), "cached": sa.get("cached_responses"), "oldest_cache": sa.get("oldest_cache")},
                "b": {"release": sb.get("release"), "live": sb.get("live_requests"), "cached": sb.get("cached_responses"), "oldest_cache": sb.get("oldest_cache")},
                "same_release": sa.get("release") == sb.get("release"),
            }
        )
    steps_b = {s["name"]: s for s in pb.get("steps", [])}
    steps = [
        {"name": s["name"], "a": {"status": s["status"], "duration": s["duration"]}, "b": {"status": steps_b.get(s["name"], {}).get("status"), "duration": steps_b.get(s["name"], {}).get("duration")}}
        for s in pa.get("steps", [])
    ] + [{"name": n, "a": {"status": None, "duration": None}, "b": {"status": s["status"], "duration": s["duration"]}} for n, s in steps_b.items() if n not in {x["name"] for x in pa.get("steps", [])}]

    overlaps = {}
    if a["kind"] == b["kind"] == "explorer":
        for key, label in (("candidates", "Positions candidates"), ("most_variable", "Positions les plus variables")):
            sa_, sb_ = _positions(a.get("result"), key), _positions(b.get("result"), key)
            if sa_ or sb_:
                overlaps[label] = {"a": len(sa_), "b": len(sb_), "shared": len(sa_ & sb_), "jaccard": round(len(sa_ & sb_) / len(sa_ | sb_), 3)}
        grades_a = {p["position"]: p["grade"] for p in (a.get("result") or {}).get("positions", [])}
        grades_b = {p["position"]: p["grade"] for p in (b.get("result") or {}).get("positions", [])}
        common = set(grades_a) & set(grades_b)
        if common:
            overlaps["Grades de conservation identiques"] = {"a": len(grades_a), "b": len(grades_b), "shared": sum(grades_a[k] == grades_b[k] for k in common), "jaccard": round(sum(grades_a[k] == grades_b[k] for k in common) / len(common), 3)}

    same_inputs = (pa.get("fingerprint") and pa.get("fingerprint") == pb.get("fingerprint"))
    return {
        "a": describe(a),
        "b": describe(b),
        "same_kind": a["kind"] == b["kind"],
        "same_fingerprint": bool(same_inputs),
        "params": _diff(_flatten(a.get("params") or {}), _flatten(b.get("params") or {})),
        "environment": _diff(pa.get("environment") or {}, pb.get("environment") or {}),
        "sources": sources,
        "steps": steps,
        "summary": _diff(summarize(a["kind"], a.get("result")), summarize(b["kind"], b.get("result"))),
        "overlaps": overlaps,
    }


# ---------------------------------------------------------------------------
# Exports CSV
# ---------------------------------------------------------------------------

def _csv(header: list[str], rows: list[list]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(header)
    writer.writerows(rows)
    return buffer.getvalue()


def csv_tables(job: dict) -> dict[str, str]:
    """Tableaux disponibles pour une exécution : nom → description."""
    tables = {"summary": "Indicateurs principaux", "steps": "Étapes du pipeline", "sources": "Sources de données et versions", "params": "Paramètres"}
    result = job.get("result") or {}
    if result.get("positions"):
        tables["positions"] = "Résultat par position (résidu)"
    if result.get("homologs"):
        tables["homologs"] = "Homologues"
    if (result.get("coevolution") or {}).get("pairs"):
        tables["pairs"] = "Paires de coévolution"
    if result.get("pairwise"):
        tables["pairwise"] = "Comparaisons deux à deux"
    return tables


def csv_table(job: dict, table: str) -> str:
    provenance = job.get("provenance") or {}
    result = job.get("result") or {}
    if table == "summary":
        return _csv(["indicateur", "valeur"], [[k, v] for k, v in summarize(job["kind"], result).items()])
    if table == "steps":
        return _csv(["etape", "statut", "duree_s", "reponses_cache", "erreur"], [[s["name"], s["status"], s["duration"], s.get("cache_hits"), s.get("error") or ""] for s in provenance.get("steps", [])])
    if table == "sources":
        return _csv(
            ["source", "version", "date_version", "requetes_directes", "reponses_cache", "cache_le_plus_ancien"],
            [[s["name"], s.get("release") or "", s.get("release_date") or "", s["live_requests"], s["cached_responses"], s.get("oldest_cache") or ""] for s in provenance.get("sources", [])],
        )
    if table == "params":
        return _csv(["parametre", "valeur"], [[k, v] for k, v in _flatten(job.get("params") or {}).items()])
    if table == "positions":
        positions = result.get("positions", [])
        keys = [k for k in ("position", "residue", "grade", "score", "gap_fraction", "masked", "region", "zone", "z", "burial", "plddt", "couplings", "network", "sector") if positions and k in positions[0]]
        return _csv(keys, [[p.get(k) for k in keys] for p in positions])
    if table == "homologs":
        keys = ["accession", "organism", "taxon_id", "identity", "coverage", "length", "bits", "evalue", "source"]
        return _csv(keys, [[h.get(k) for k in keys] for h in result.get("homologs", [])])
    if table == "pairs":
        keys = ["i", "j", "score", "z", "distance", "contact", "stability", "above_null"]
        return _csv(keys, [[p.get(k) for k in keys] for p in (result.get("coevolution") or {}).get("pairs", [])])
    if table == "pairwise":
        proteins = [p["accession"] for p in result.get("proteins", [])]
        rows = []
        for key, pair in result["pairwise"].items():
            a, b = map(int, key.split("-"))
            structure = (result.get("structures") or {}).get("pairs", {}).get(key) or {}
            rows.append([proteins[a], proteins[b], pair["identity"], pair["similarity"], pair["evalue"], pair["reliability"], structure.get("rmsd"), structure.get("tm_score_a"), structure.get("tm_score_b")])
        return _csv(["proteine_a", "proteine_b", "identite", "similarite", "evalue", "fiabilite", "rmsd", "tm_score_a", "tm_score_b"], rows)
    raise KeyError(table)
