"""Contrôles de fiabilité de la MIp et de la SCA."""

import random

import numpy as np

from app.services import coevolution_robustness_service as cr
from app.services import explorer_service as ex
from app.services.coevolution_service import compute_coevolution
from app.services.sca_service import compute_sca

from tests.test_explorer import AA, REFERENCE, family, fasta


def test_alignment_diagnostics_detects_redundancy_and_subfamilies():
    varied = [REFERENCE] + family(60)
    diagnostics = cr.alignment_diagnostics(varied)
    checks = {c["id"]: c for c in diagnostics["checks"]}
    assert set(checks) == {"depth", "redundancy", "gaps", "phylogeny"}
    assert checks["redundancy"]["status"] == "ok"

    redundant = [REFERENCE] + [family(1)[0]] * 60
    assert {c["id"]: c for c in cr.alignment_diagnostics(redundant)["checks"]}["redundancy"]["status"] == "probleme"

    # Deux sous-familles très différentes : forte structure phylogénétique
    rng = random.Random(2)
    other = "".join(rng.choice(AA) for _ in REFERENCE)
    split = [REFERENCE] + [s if k % 2 else "".join(o if rng.random() > 0.1 else rng.choice(AA) for o in other) for k, s in enumerate(family(60))]
    assert cr.alignment_diagnostics(split)["pc1_share"] > diagnostics["pc1_share"]

    homologs = [{"lineage": {"phylum": "Chordata" if k < 55 else "Arthropoda"}} for k in range(60)]
    taxonomy = {c["id"]: c for c in cr.alignment_diagnostics(varied, homologs=homologs)["checks"]}["taxonomy"]
    assert taxonomy["status"] == "probleme"


def test_shuffle_keeps_composition():
    rows = [REFERENCE] + family(20)
    shuffled = cr._shuffled(rows, np.random.default_rng(0))
    assert shuffled[0] == REFERENCE
    for k in range(len(REFERENCE)):
        assert sorted(r[k] for r in rows[1:]) == sorted(r[k] for r in shuffled[1:])


def test_mip_robustness_keeps_true_coupling():
    rows = [REFERENCE] + family(80)
    coevolution = compute_coevolution(rows)
    robustness = cr.mip_robustness(rows, coevolution)
    best = coevolution["pairs"][0]
    assert (best["i"], best["j"]) == (15, 51)
    assert best["stability"] == 1.0 and best["above_null"] is True
    assert robustness["subsamples"] == 4 and robustness["null_max_score"] < best["score"]
    assert coevolution["distribution"]["above_z3"] >= 1
    assert coevolution["parameters"]["pseudocount"] == 0.2


def test_replicate_budget():
    assert cr.replicate_budget(100, 100) == (4, 2)
    assert cr.replicate_budget(1000, 600) == (2, 1)
    assert cr.replicate_budget(2000, 1500) == (0, 0)


def test_contact_benchmark():
    pairs = [{"i": 1, "j": 10 + k, "distance": 5.0 if k % 2 == 0 else 12.0, "contact": k % 2 == 0, "confident": True} for k in range(40)]
    benchmark = cr.contact_benchmark({"pairs": pairs, "length": 100, "random_precision": 0.05}, {"source": "AlphaFold"})
    assert benchmark["top_precision"] == 0.5 and benchmark["enrichment"] == 10.0
    assert benchmark["curve"][0] == [1, 1.0]
    assert "non expérimentale" in benchmark["structure_note"]
    assert cr.contact_benchmark({"pairs": pairs, "length": 100}, None) is None


def test_sca_conservation_controls_and_stability():
    rows = [REFERENCE] + family(80)
    sca = compute_sca(rows)
    assert sca["parameters"]["sector_z"] == 2.5
    assert sca["first_mode_conservation_r"] is not None
    assert len(sca["loading_histograms"]) == sca["components"]
    fixed = compute_sca(rows, components=sca["components"])
    assert fixed["random_threshold"] is None and fixed["parameters"]["random_trials"] == 0
    for sector in sca["sectors"]:
        assert "covariance_z" in sector and "loading_conservation_r" in sector
    test = cr.sca_stability(rows, sca)
    assert test["subsamples"] == 4
    for sector in sca["sectors"]:
        assert 0 <= sector["stability"] <= 1
        assert sector["signal"] in ("covariance collective", "dominé par la conservation", "indéterminé")


def test_run_explorer_includes_controls():
    result = ex.run_explorer(fasta(family(60)))
    coevolution = result["coevolution"]
    assert coevolution["diagnostics"]["checks"]
    assert coevolution["robustness"]["subsamples"] == 4
    assert coevolution["benchmark"] is None  # pas de structure hors ligne
    assert result["sca"]["stability_test"]["subsamples"] == 4
