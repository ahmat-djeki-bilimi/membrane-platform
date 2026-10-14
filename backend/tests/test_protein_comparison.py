"""Comparaison de protéines : correspondance des résidus, structures, domaines, topologies, propriétés."""

import math
import random

import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.services import physicochemical_service as pc
from app.services import protein_comparison_service as pcs

AA = "ACDEFGHIKLMNPQRSTVWY"


def protein(accession, sequence, domains=(), segments=(), n_terminus=None):
    return {
        "accession": accession,
        "name": accession,
        "sequence": sequence,
        "length": len(sequence),
        "domains": list(domains),
        "topology": {"source": "uniprot", "segments": list(segments), "n_terminus": n_terminus},
        "properties": pc.properties(sequence),
    }


def test_physicochemical_properties():
    assert pc.properties("G")["molecular_weight"] == round(57.0519 + 18.01524, 1)
    assert pc.isoelectric_point("KKKKKKKKRR") > 10 > 4 > pc.isoelectric_point("DDDDDDEEEE")
    props = pc.properties("AVILMFWC" * 3)
    assert props["gravy"] > 1 and props["hydrophobic_fraction"] == 1.0
    assert len(props["hydropathy_profile"]) == 24


def test_pairwise_maps_residues_across_lengths():
    rng = random.Random(3)
    core = "".join(rng.choice(AA) for _ in range(120))
    a = protein("A", core)
    b = protein("B", "MSTNQ" + core[:60] + "GGSGGSGG" + core[60:])  # extension N-terminale et insertion
    result = pcs.pairwise(a, b)
    mapping = dict(result["pairs"])
    assert mapping[0] == 5 and mapping[59] == 64 and mapping[60] == 73
    assert result["identity"] == 1.0 and result["reliability"] == "fiable"
    assert result["coverage_a"] == 1.0 and result["coverage_b"] < 1.0

    unrelated = pcs.pairwise(a, protein("C", "".join(rng.choice(AA) for _ in range(120))))
    assert unrelated["reliability"] in ("non_significative", "a_verifier")


def test_star_alignment_keeps_every_residue_once():
    rng = random.Random(4)
    core = "".join(rng.choice(AA) for _ in range(80))
    proteins = [protein("A", core), protein("B", "MKV" + core[:40] + "WWW" + core[40:]), protein("C", core[10:])]
    maps = [{}] + [{i: j for i, j in pcs.pairwise(proteins[0], p)["pairs"]} for p in proteins[1:]]
    alignment = pcs.star_alignment(proteins, maps)
    for p, prot in enumerate(proteins):
        numbers = [c[p] for c in alignment["columns"] if c[p]]
        assert numbers == list(range(1, prot["length"] + 1))  # chaque résidu une fois, dans l'ordre
        assert alignment["rows"][p].replace("-", "") == prot["sequence"]
    reference_columns = [c for c, k in zip(alignment["columns"], alignment["kinds"]) if k == "reference"]
    assert [c[0] for c in reference_columns] == list(range(1, 81))
    assert reference_columns[0][2] is None and reference_columns[10][2] == 1
    assert alignment["kinds"].count("insertion") == 6  # MKV et WWW


def _model(coords, plddt=90.0):
    return {"ca": {k + 1: (np.array(c), plddt) for k, c in enumerate(coords)}, "text": "", "same_sequence": True}


def test_superpose_recovers_rotation():
    rng = np.random.default_rng(0)
    coords = np.cumsum(rng.normal(size=(60, 3)) * 2, axis=0)
    angle = 0.7
    rotation = np.array([[math.cos(angle), -math.sin(angle), 0], [math.sin(angle), math.cos(angle), 0], [0, 0, 1]])
    moved = coords @ rotation.T + np.array([5.0, -3.0, 2.0])
    result = pcs.superpose(_model(coords), _model(moved), [(k, k) for k in range(60)], 60, 60)
    assert result["rmsd"] < 0.01 and result["tm_score_a"] > 0.99 and result["confirmed"] == 1.0
    text = "ATOM      1  CA  ALA A   1       1.000   2.000   3.000  1.00 90.00           C"
    assert pcs.transform_pdb(text, np.eye(3), np.array([1.0, 0, 0]))[30:38].strip() == "2.000"


def test_topology_and_domains_in_alignment_frame():
    rng = random.Random(5)
    core = "".join(rng.choice(AA) for _ in range(100))
    a = protein("A", core, domains=[{"type": "Domaine", "name": "PDZ 1", "start": 10, "end": 40}], segments=[{"start": 50, "end": 70}, {"start": 80, "end": 95}], n_terminus="in")
    b = protein("B", "MKVL" + core, domains=[{"type": "Domaine", "name": "PDZ 2", "start": 14, "end": 44}], segments=[{"start": 54, "end": 74}], n_terminus="out")
    alignment = pcs.star_alignment([a, b], [{}, {i: j for i, j in pcs.pairwise(a, b)["pairs"]}])
    topology = pcs.compare_topologies([a, b], alignment)
    assert len(topology["segments"]) == 2 and topology["segments"][0]["shared"] == 2
    text = " ".join(topology["differences"])
    assert "Nombre de segments" in text and "N-terminale" in text and "absent chez B" in text
    domains = pcs.compare_domains([a, b], alignment)
    assert domains[0]["name"] == "PDZ" and domains[0]["shared"] == 2 and domains[0]["aligned_overlap"] == 1.0


def test_compare_proteins_offline(monkeypatch):
    rng = random.Random(6)
    core = "".join(rng.choice(AA) for _ in range(90))
    fake = {"P11111": protein("P11111", core), "P22222": protein("P22222", "MA" + core), "P33333": protein("P33333", core[5:])}
    monkeypatch.setattr(pcs, "load_protein", lambda accession: fake[accession])
    monkeypatch.setattr(pcs, "load_model", lambda p: None)
    result = pcs.compare_proteins(["P11111", "P22222", "P33333"], reference=1)
    assert set(result["pairwise"]) == {"0-1", "0-2", "1-2"}
    assert result["pairwise"]["0-1"]["pairs"][0] == [1, 3]
    assert result["reference"] == 1 and len(result["alignment"]["rows"]) == 3
    assert result["structures"]["superposed"] == [] and result["structures"]["models"][0]["available"] is False


def test_route_validation():
    client = TestClient(app)
    assert client.post("/api/comparison", json={"accessions": ["P02945"]}).status_code == 422
    assert client.post("/api/comparison", json={"accessions": ["P02945", "P02945"]}).status_code == 400
    assert client.post("/api/comparison", json={"accessions": ["P02945", "PAS OK"]}).status_code == 400
    assert client.post("/api/comparison", json={"accessions": ["P02945", "P0DMS8"], "reference": 5}).status_code == 400
