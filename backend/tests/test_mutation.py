"""Analyse d'une substitution : propriétés, contacts, contexte membranaire, hypothèses sans verdict."""

import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.services import mutation_service as ms

SEQUENCE = "MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVVHSLAKWKRQTLGQHDFSAGEGLYTHMKALRPDEDRLSPLHSVYVDQWDWERVMGDGERQFSTLKSTVEAIWAGIKATEAAVSEEFGLAPFLPDQIHFVHSQELLSRYPDLDAKGRERAIAKDLGAVFLVGIGGKLSDGHRHDVRAPDYDDWUAQ"


def test_grantham_and_properties():
    assert abs(ms.grantham("S", "R") - 110) <= 2
    assert ms.grantham("I", "L") <= 10
    assert ms.grantham_class(23) == "conservatrice" and ms.grantham_class(180) == "radicale"
    props = ms.property_change("D", "K")
    assert props["delta_charge"] == 2 and props["blosum62"] == -1 and props["class_change"] is False


def _residue(resi, aa, atoms, plddt=90.0):
    return {"resi": resi, "aa": aa, "chain": "A", "plddt": plddt, "atoms": {k: tuple(v) for k, v in atoms.items()}}


def test_contacts_salt_bridge_and_risk():
    asp = _residue(10, "D", {"N": (0, 0, 0), "CA": (1, 0, 0), "C": (2, 0, 0), "O": (2, 1, 0), "CB": (1, 1, 0), "CG": (1, 2, 0), "OD1": (1, 3, 0), "OD2": (2, 2.5, 0)})
    lys = _residue(40, "K", {"N": (5, 6, 0), "CA": (4, 6, 0), "CB": (3, 5.5, 0), "NZ": (1, 5.8, 0)})
    far = _residue(80, "L", {"CA": (40, 40, 40)})
    contacts = ms.classify_contacts(asp, [asp, lys, far], "N")
    assert [c["resi"] for c in contacts] == [40]
    assert "pont salin" in contacts[0]["kinds"] and contacts[0]["at_risk"] == ["pont salin"]
    # Glutamate : même charge, le pont salin peut être conservé
    assert ms.classify_contacts(asp, [asp, lys], "E")[0]["at_risk"] == []


def test_membrane_context():
    entry = {"features": [{"type": "Transmembrane", "location": {"start": {"value": 20}, "end": {"value": 40}}}, {"type": "Topological domain", "description": "Cytoplasmic", "location": {"start": {"value": 41}, "end": {"value": 60}}}]}
    core = ms.membrane_context(entry, 30)
    assert core["zone"] == "transmembranaire" and core["core"] and core["depth"] == 1.0
    assert ms.membrane_context(entry, 21)["core"] is False
    assert ms.membrane_context(entry, 50) == {"zone": "hors membrane", "side": "Cytoplasmic", "evidence_label": "Non précisée"}


def test_merge_sites_groups_ligands():
    sites = [
        {"type": "Site de liaison", "start": 5, "end": 5, "ligand": "A", "experimental": False, "evidence_label": "x", "references": []},
        {"type": "Site de liaison", "start": 5, "end": 5, "ligand": "B", "experimental": True, "evidence_label": "Expérimentale", "references": [{"source": "PubMed", "id": "1"}]},
    ]
    merged = ms.merge_sites(sites)
    assert len(merged) == 1 and merged[0]["ligand"] == "A, B" and merged[0]["experimental"]


def test_analysis_offline_never_concludes(monkeypatch):
    entry = {
        "sequence": {"value": SEQUENCE},
        "features": [
            {"type": "Transmembrane", "location": {"start": {"value": 1}, "end": {"value": 21}}},
            {"type": "Mutagenesis", "location": {"start": {"value": 9}, "end": {"value": 9}}, "description": "Loss of activity.", "alternativeSequence": {"originalSequence": "Q", "alternativeSequences": ["E"]}},
            {"type": "Active site", "location": {"start": {"value": 9}, "end": {"value": 9}}, "evidences": [{"evidenceCode": "ECO:0000269"}]},
        ],
    }
    monkeypatch.setattr(ms.uniprot_service, "fetch_entry", lambda accession: entry)
    monkeypatch.setattr(ms, "conservation_at", lambda accession, position: {"status": "succeeded", "available": True, "grade": 9, "observed": [{"residue": "Q", "frequency": 1.0}]})
    monkeypatch.setattr(ms, "structural_environment", lambda *a: {"available": False, "reason": "hors ligne"})
    monkeypatch.setattr(ms, "interpro_matches", lambda accession: {"entries": []})
    result = ms.analyze_mutation("P99999", 9, "E")
    assert result["label"] == "Q9E" and result["wild"] == "Q"
    titles = [h["title"] for h in result["hypotheses"]]
    assert "Position très conservée" in titles and "Même substitution déjà documentée" in titles
    assert any("Résidu catalytique" in t for t in titles)
    assert len(result["profile"]) == 19
    text = " ".join(h["text"] for h in result["hypotheses"]).lower()
    for verdict in ("délétère", "pathogène", "bénigne", "neutre"):
        assert verdict not in text
    assert any("ne prédisent pas" in limit for limit in result["limits"])


def test_route_validation(monkeypatch):
    client = TestClient(app)
    monkeypatch.setattr(ms.uniprot_service, "fetch_entry", lambda accession: {"sequence": {"value": SEQUENCE}, "features": []})
    assert client.get("/api/mutation/P99999?position=2&to=K").status_code == 400  # K → K identique
    assert client.get("/api/mutation/P99999?position=9999&to=A").status_code == 400
    assert client.get("/api/mutation/P99999?position=2&to=X").status_code == 400
    assert client.get("/api/mutation/P99999?position=0&to=A").status_code == 422
