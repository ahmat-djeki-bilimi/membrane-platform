"""Membrane Evolution & Function Explorer : import FASTA, coévolution, cartographie."""

import random

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import explorer_service as ex
from app.services.coevolution_service import apc, compute_coevolution, encode, sequence_weights

AA = "ACDEFGHIKLMNPQRSTVWY"
# Deux segments hydrophobes (Kyte-Doolittle) séparés par des boucles polaires
REFERENCE = (
    "MSKNDERQTP"
    + "LLVAIGLLFAVILGLVAWL"
    + "RKDNGSEQTKPDGSRE"
    + "AIVLLGFVLAILVGALIVW"
    + "KRDESNQTGPEDKRSQ"
)


def family(count: int = 80, seed: int = 3) -> list[str]:
    """Homologues mutés au hasard ; les positions 15 et 51 changent toujours ensemble."""
    rng = random.Random(seed)
    sequences = []
    for _ in range(count):
        seq = list(REFERENCE)
        for k in range(len(seq)):
            if k not in (14, 50) and rng.random() < 0.25:
                seq[k] = rng.choice(AA)
        a, b = rng.choice([("I", "F"), ("W", "G"), ("D", "K"), ("E", "R")])
        seq[14], seq[50] = a, b
        sequences.append("".join(seq))
    return sequences


def fasta(sequences: list[str], prefix: str = "seq") -> str:
    lines = [f">ref Référence OS=Homo sapiens OX=9606\n{REFERENCE}"]
    lines += [f">{prefix}{i} Homologue OS=Espèce {i} OX={1000 + i}\n{s}" for i, s in enumerate(sequences)]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Import FASTA
# ---------------------------------------------------------------------------

def test_parse_fasta_headers_and_accessions():
    text = (
        ">sp|P02945|BACR_HALSA Bacteriorhodopsin OS=Halobacterium salinarum OX=2242 GN=bop\nMLELLPTAVE\nGVSQAQ\n"
        ">UniRef100_Q9XYZ1 cluster\nMLEL-PTAV\n"
        ">ma_sequence\nMLELL*\n"
        ">ma_sequence\nMLELLA\n"
    )
    records = ex.parse_fasta(text)
    assert [r["id"] for r in records] == ["sp|P02945|BACR_HALSA", "UniRef100_Q9XYZ1", "ma_sequence", "ma_sequence_2"]
    assert records[0]["accession"] == "P02945"
    assert records[0]["sequence"] == "MLELLPTAVEGVSQAQ"
    assert records[0]["organism"] == "Halobacterium salinarum" and records[0]["taxon_id"] == 2242
    assert records[0]["description"] == "Bacteriorhodopsin"
    assert records[1]["accession"] == "Q9XYZ1" and records[1]["sequence"] == "MLELPTAV"
    assert records[2]["accession"] is None


def test_parse_fasta_rejects_plain_sequence():
    with pytest.raises(ex.ExplorerError):
        ex.parse_fasta("MLELLPTAVEGVSQAQ")


def test_validate_limits():
    with pytest.raises(ex.ExplorerError):
        ex.validate(ex.parse_fasta(f">a\n{REFERENCE}\n"), 0)
    with pytest.raises(ex.ExplorerError):
        ex.validate(ex.parse_fasta(">a\nMKV\n>b\nMKV\n"), 0)
    # Une seule séquence suffit avec la recherche étendue
    ex.validate(ex.parse_fasta(f">a\n{REFERENCE}\n"), 0, expand=True)
    records = ex.parse_fasta(fasta(family(3)))
    ex.validate(records, 2)
    with pytest.raises(ex.ExplorerError):
        ex.validate(records, 10)


def test_prealigned_input_keeps_reference_columns():
    text = ">ref\nMK-LVAIG\n>h1\nMKALVAIG\n>h2\nMR-LV-IG\n"
    records = ex.parse_fasta(text)
    assert ex.is_prealigned(records)
    with pytest.raises(ex.ExplorerError):
        # Référence trop courte pour l'analyse complète, mais l'alignement est lisible
        ex.validate(records, 0)
    alignment = ex.build_alignment(records, 0)
    assert alignment["prealigned"]
    assert alignment["query"] == "MKLVAIG"
    rows = dict(zip([h["accession"] for h in alignment["homologs"]], alignment["rows"]))
    assert rows["h1"] == "MKLVAIG"  # insertion par rapport à la référence retirée
    assert rows["h2"] == "MRLV-IG"


def test_alignment_excludes_duplicates_and_unrelated():
    records = ex.parse_fasta(fasta([REFERENCE, family(1)[0], "W" * 30]))
    alignment = ex.build_alignment(records, 0)
    reasons = {e["id"]: e["reason"] for e in alignment["excluded"]}
    assert "identique" in reasons["seq0"]
    assert "seq2" in reasons
    assert len(alignment["rows"]) == 1


def test_regions_with_sides_alternate():
    segments = [{"start": 11, "end": 29, "label": "TM1"}, {"start": 46, "end": 64, "label": "TM2"}]
    regions = ex.regions_with_sides(segments, len(REFERENCE), "in", estimated=False)
    loops = [r for r in regions if r["kind"] != "tm"]
    assert [r["side"] for r in loops] == ["in", "out", "in"]
    assert loops[1]["label"] == "Boucle extérieure 1"


# ---------------------------------------------------------------------------
# Coévolution
# ---------------------------------------------------------------------------

def test_sequence_weights_downweight_copies():
    codes = encode(["AAAAAAAAAA", "AAAAAAAAAA", "CCCCCCCCCC"])
    weights = sequence_weights(codes)
    assert np.allclose(weights, [0.5, 0.5, 1.0])


def test_apc_removes_column_background():
    mi = np.array([[0, 2, 2], [2, 0, 1], [2, 1, 0]], dtype=float)
    corrected = apc(mi, np.array([True, True, True]))
    assert corrected[0, 1] < mi[0, 1]
    assert np.allclose(corrected, corrected.T)


def test_coevolution_finds_coupled_pair():
    result = compute_coevolution([REFERENCE] + family())
    best = result["pairs"][0]
    assert (best["i"], best["j"]) == (15, 51)
    assert best["z"] > 3
    assert all(p["j"] - p["i"] >= 5 for p in result["pairs"])
    assert result["neff"] > 50


def test_coevolution_rejects_tiny_alignment():
    with pytest.raises(ValueError):
        compute_coevolution(["MKV"])


# ---------------------------------------------------------------------------
# Structure orientée
# ---------------------------------------------------------------------------

def _pdb(points: list[tuple[float, float, float]]) -> str:
    lines = []
    for k, (x, y, z) in enumerate(points, start=1):
        lines.append(f"ATOM  {k:5d}  CA  ALA A{k:4d}    {x:8.3f}{y:8.3f}{z:8.3f}  1.00 90.00           C")
    return "\n".join(lines) + "\nEND\n"


def test_structure_features_zones_and_contacts():
    # Une colonne verticale de Cα tous les 3,8 Å, de z = -30 à z = +30
    points = [(0.0, 0.0, -30 + 3.8 * k) for k in range(17)]
    features = ex.structure_features(_pdb(points), half_thickness=15.0)
    zones = {n: r["zone"] for n, r in features["residues"].items()}
    assert zones[1] == "in" and zones[17] == "out"
    assert zones[9] == "core"  # z ≈ 0,4
    assert zones[6] == "interface_in"  # z = -11
    # Résidus voisins le long de la chaîne exclus (|i - j| ≥ 5) : aucun contact à 8 Å
    assert features["contacts"] == []
    folded = points[:5] + [(1.0, 0.0, -30 + 3.8 * k) for k in range(5)]
    assert [1, 6] in ex.structure_features(_pdb(folded), None)["contacts"]


# ---------------------------------------------------------------------------
# Analyse complète (sans réseau : référence non reconnue, pas de structure)
# ---------------------------------------------------------------------------

def test_run_explorer_offline():
    result = ex.run_explorer(fasta(family(60)))
    assert result["reference"]["id"] == "ref"
    assert result["reference"]["accession"] is None
    assert result["input"]["kept"] == 60
    assert len(result["msa"]) == 60
    assert result["topology"]["source"] == "kd"
    assert len(result["topology"]["segments"]) == 2
    assert result["structure"] is None
    # Arbre construit hors ligne (groupes taxonomiques indisponibles sans réseau)
    assert result["tree"] is not None and result["tree"]["leaf_count"] == 61
    assert any("Structure 3D indisponible" in w for w in result["warnings"])

    positions = result["positions"]
    assert len(positions) == len(REFERENCE)
    assert positions[20]["zone"] == "membrane"
    assert positions[0]["zone"] == "loop"

    coevolution = result["coevolution"]
    assert (coevolution["pairs"][0]["i"], coevolution["pairs"][0]["j"]) == (15, 51)
    assert coevolution["pairs"][0]["kind"] == "inter_helix"
    assert positions[14]["couplings"] >= 1
    assert result["candidates"]
    assert all(c["reasons"] for c in result["candidates"])
    assert {n["topic"] for n in result["interpretation"]} >= {"family", "candidates", "coevolution"}
    # SCA et comparaison avec la MIp
    assert result["sca"] is not None and result["comparison"] is not None
    for sector in result["sca"]["sectors"]:
        assert sector["size"] == len(sector["residues"]) >= 3
        assert all(positions[r["position"] - 1]["sector"] == sector["id"] for r in sector["residues"])


def test_explorer_route_validates_and_submits(monkeypatch):
    client = TestClient(app)
    assert client.post("/api/explorer", json={"fasta": "MKV"}).status_code == 400
    assert client.post("/api/explorer", json={"fasta": f">a\n{REFERENCE}\n"}).status_code == 400
    bad = client.post("/api/explorer", json={"fasta": fasta(family(3)), "accession": "PAS-OK"})
    assert bad.status_code == 400

    response = client.post("/api/explorer", json={"fasta": fasta(family(12))})
    assert response.status_code == 200
    job = response.json()
    assert job["sequence_count"] == 13
    # File en mode immédiat : la tâche est déjà terminée
    done = client.get(f"/api/jobs/{job['id']}").json()
    assert done["status"] == "succeeded"
    assert done["result"]["input"]["kept"] == 12
    # Même famille : même tâche
    assert client.post("/api/explorer", json={"fasta": fasta(family(12))}).json()["id"] == job["id"]


def test_significance_of_alignments():
    from app.services.alignment import anchored_score, significance

    records = ex.parse_fasta(fasta(family(3)))
    alignment = ex.build_alignment(records, 0)
    for h in alignment["homologs"]:
        assert h["bits"] > 50 and h["evalue"] < 1e-10
    # Séquence sans rapport : score faible, E-value élevée
    _, unrelated = significance(anchored_score("MKVLAAGIV", "WWWWWWWWW"), 9, 9)
    assert unrelated > 1
    # Gaps internes pénalisés, extrémités libres
    assert anchored_score("AAAA", "-AA-") == 8
    assert anchored_score("AAAA", "A--A") == 8 - 12 - 1


def test_mmseqs_homologs_deduplicated_and_rescored(monkeypatch):
    records = ex.parse_fasta(f">ref\n{REFERENCE}\n>sp|P11111|X_Y homologue\n{family(1)[0]}\n")
    alignment = ex.build_alignment(records, 0)
    other = family(2, seed=9)[1]

    def fake_mmseqs(query):
        hits = [("UniRef100_P11111", family(1)[0]), ("UniRef100_REF000", REFERENCE), ("UniRef100_Q22222", other)]
        homologs = [{"accession": i, "identity": 0.8, "coverage": 1.0, "length": len(s), "bits": 999, "evalue": 1e-99} for i, s in hits]
        return [s for _, s in hits], homologs, {}

    monkeypatch.setattr(ex, "_mmseqs_alignment", fake_mmseqs)
    added = ex.add_mmseqs_homologs(alignment, "REF000")
    # P11111 est déjà importé, REF000 est la référence : seul Q22222 est ajouté
    assert added == 1
    new = next(h for h in alignment["homologs"] if h.get("source") == "mmseqs")
    assert new["accession"] == "UniRef100_Q22222"
    assert new["bits"] != 999 and new["evalue"] < 1e-10


# ---------------------------------------------------------------------------
# Sélection des homologues par l'utilisateur
# ---------------------------------------------------------------------------

def test_select_homologs_keeps_choice_and_returns_others():
    alignment = ex.build_alignment(ex.parse_fasta(fasta(family(5))), 0)
    ids = [h["accession"] for h in alignment["homologs"]]
    unselected, missing = ex.select_homologs(alignment, [ids[0], ids[2], "absent"])
    assert [h["accession"] for h in alignment["homologs"]] == [ids[0], ids[2]]
    assert len(alignment["rows"]) == 2
    assert {h["accession"] for h in unselected} == set(ids) - {ids[0], ids[2]}
    assert all(len(h["row"]) == len(REFERENCE) for h in unselected)
    assert missing == 1
    with pytest.raises(ex.ExplorerError):
        ex.select_homologs(alignment, ["absent"])


def test_run_explorer_with_selection():
    full = ex.run_explorer(fasta(family(30)))
    keep = [h["accession"] for h in full["homologs"][:12]]
    result = ex.run_explorer(fasta(family(30)), keep=keep)
    assert result["input"]["selection"] is True
    assert result["input"]["pool"] == 30
    assert result["input"]["kept"] == 12
    assert {h["accession"] for h in result["homologs"]} == set(keep)
    assert len(result["unselected"]) == 18
    assert result["tree"]["leaf_count"] == 13
    assert all("lineage" in h for h in result["homologs"])


def test_explorer_route_selection():
    client = TestClient(app)
    assert client.post("/api/explorer", json={"fasta": fasta(family(12)), "keep": []}).status_code == 400
    response = client.post("/api/explorer", json={"fasta": fasta(family(12)), "keep": ["seq3", "seq1", "seq1"]})
    assert response.status_code == 200
    done = client.get(f"/api/jobs/{response.json()['id']}").json()
    assert done["params"]["keep"] == ["seq1", "seq3"]
    assert done["result"]["input"]["kept"] == 2


def test_explorer_tree_on_selection():
    client = TestClient(app)
    job = client.post("/api/explorer", json={"fasta": fasta(family(15))}).json()
    ids = [m["accession"] for m in client.get(f"/api/jobs/{job['id']}").json()["result"]["msa"]][:6]
    assert client.post(f"/api/explorer/{job['id']}/tree", json={"ids": ids[:2]}).status_code == 422
    assert client.post(f"/api/explorer/{job['id']}/tree", json={"ids": ["x", "y", "z"]}).status_code == 400
    assert client.post("/api/explorer/inconnu/tree", json={"ids": ids}).status_code == 404
    response = client.post(f"/api/explorer/{job['id']}/tree", json={"ids": ids, "model": "p"})
    assert response.status_code == 200
    done = client.get(f"/api/jobs/{response.json()['id']}").json()
    assert done["status"] == "succeeded", done["error"]
    tree = done["result"]["tree"]
    assert tree["leaf_count"] == 7 and tree["model"]["id"] == "p"
    assert {leaf["id"] for leaf in tree["leaves"] if not leaf["is_query"]} == set(ids)
