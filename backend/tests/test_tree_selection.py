"""Stratégies de sélection des séquences, IQ-TREE et routes de l'arbre."""

import os
import random

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import iqtree_service as iq
from app.services import phylogeny_service as ps
from app.services import tree_selection_service as ts

from tests.test_explorer import AA, REFERENCE, family, fasta


def _result():
    """Résultat d'Explorateur simulé : deux familles de séquences, trois embranchements."""
    rng = random.Random(7)
    other = "".join(rng.choice(AA) for _ in REFERENCE)
    msa, homologs = [], []
    phyla = ["Chordata", "Arthropoda", "Nematoda"]
    for k in range(30):
        base = REFERENCE if k < 20 else other
        row = "".join(c if rng.random() > 0.15 else rng.choice(AA) for c in base)
        identity = sum(a == b for a, b in zip(row, REFERENCE)) / len(REFERENCE)
        accession = f"H{k:02d}"
        msa.append({"accession": accession, "organism": f"Genre{k % 6} espece{k}", "row": row})
        homologs.append(
            {"accession": accession, "organism": f"Genre{k % 6} espece{k}", "taxon_id": 1000 + k, "identity": identity, "coverage": 1.0, "lineage": {"phylum": phyla[k % 3]}}
        )
    return {"query_sequence": REFERENCE, "msa": msa, "homologs": homologs, "qc": None}


def test_closest_strategy():
    result = _result()
    selection = ts.select_sequences(result, "closest", 5)
    best = sorted(result["homologs"], key=lambda h: -h["identity"])[:5]
    assert selection["ids"] == [h["accession"] for h in best]
    assert selection["label"] == "Homologues les plus proches"


def test_taxonomic_strategy_covers_groups():
    selection = ts.select_sequences(_result(), "taxonomic", 6)
    assert selection["details"]["rank"] == "phylum" and selection["details"]["groups_covered"] == 3
    phyla = [int(a[1:]) % 3 for a in selection["ids"]]
    assert sorted(phyla) == [0, 0, 1, 1, 2, 2]


def test_diversity_strategy_reaches_distant_subfamily():
    result = _result()
    closest = set(ts.select_sequences(result, "closest", 6)["ids"])
    diverse = ts.select_sequences(result, "diversity", 6)
    # Les séquences 20 à 29 forment une sous-famille éloignée : la diversité la couvre, la proximité non
    assert any(int(a[1:]) >= 20 for a in diverse["ids"]) and not any(int(a[1:]) >= 20 for a in closest)
    assert diverse["details"]["mean_nearest_distance"] > 0


def test_custom_strategy_and_unknown():
    result = _result()
    assert ts.select_sequences(result, "custom", 0, ["H03", "H01", "inconnu"])["ids"] == ["H01", "H03"]
    with pytest.raises(ts.SelectionError):
        ts.select_sequences(result, "hasard", 5)


def test_parse_iqtree_newick_and_supports():
    names = ["s0", "s1", "s2", "s3", "s4"]
    newick = "(s0:0.1,s1:0.2,((s2:0.1,s3:0.1)87.5/99:0.3,s4:0.2)45/62:0.05);"
    edges, labels = iq.parse_newick(newick, names)
    assert len(edges) == 7 and labels[7] == (0.875, 0.99) and labels[6] == (0.45, 0.62)
    ufboot, alrt = iq.split_supports(edges, labels, 5)
    assert ufboot == {0b01100: 0.99, 0b11100: 0.62} and alrt[0b01100] == 0.875
    # Même bipartitions que l'enracinement de la plateforme
    root = ps.midpoint_root(edges, 5)
    ps._annotate(root, ufboot, 5)
    newick_out = ps.to_newick(root, [{"id": n} for n in names])
    # La racine coupe la branche {s2, s3} : son support figure des deux côtés de la racine
    assert ")99:" in newick_out and ")62:" in newick_out


IQTREE = os.environ.get("IQTREE_TEST_BINARY")


@pytest.mark.skipif(not IQTREE, reason="IQ-TREE non installé (variable IQTREE_TEST_BINARY)")
def test_build_tree_with_iqtree(monkeypatch):
    monkeypatch.setattr(iq, "find_binary", lambda: IQTREE)
    monkeypatch.setattr(ps, "fetch_lineages", lambda ids: {})
    result = _result()
    msa = result["msa"][:12]
    tree = ps.build_tree(REFERENCE, {"id": "ref"}, msa, result["homologs"], method="ml", ml_model="LG+G4")
    assert tree["method_id"] == "ml" and tree["ml"]["version"].startswith("2.")
    assert tree["support"]["replicates"] == 1000 and tree["robustness"]["internal_branches"] == 10
    assert tree["robustness"]["recommended"]["ufboot"] == 0.95
    assert tree["leaf_count"] == 13 and "iqtree2 -s alignement.fasta" in tree["ml"]["command"]


def test_tree_routes(monkeypatch):
    client = TestClient(app)
    job = client.post("/api/explorer", json={"fasta": fasta(family(20)) + ">route arbre\nMKV\n"}).json()
    tools = client.get("/api/explorer/phylogeny-tools").json()
    assert tools["nj"]["available"] and "closest" in tools["strategies"]

    preview = client.get(f"/api/explorer/{job['id']}/tree/selection?strategy=diversity&count=8").json()
    assert len(preview["ids"]) == 8 and preview["strategy"] == "diversity"

    built = client.post(f"/api/explorer/{job['id']}/tree", json={"strategy": "closest", "count": 8, "replicates": 100}).json()
    done = client.get(f"/api/jobs/{built['id']}").json()
    assert done["status"] == "succeeded", done["error"]
    tree = done["result"]["tree"]
    assert tree["leaf_count"] == 9 and tree["selection"]["strategy"] == "closest"
    assert tree["data_quality"]["checks"] and tree["robustness"]["fraction_70"] is not None

    monkeypatch.setattr(iq, "find_binary", lambda: None)
    refused = client.post(f"/api/explorer/{job['id']}/tree", json={"strategy": "closest", "count": 8, "method": "ml"})
    assert refused.status_code == 400 and "IQ-TREE" in refused.json()["detail"]
    assert client.post(f"/api/explorer/{job['id']}/tree", json={"strategy": "custom"}).status_code == 400
