"""Analyse d'un modèle AlphaFold : correspondance UniProt, confiance, contacts, poches, sites."""

import math

from fastapi.testclient import TestClient

from app.main import app
from app.services import model_analysis_service as ma

NAMES = ["N", "CA", "C", "O", "CB"]


def _atom(serial, name, resi, xyz, plddt):
    x, y, z = xyz
    return f"ATOM  {serial:5d}  {name:<3} ALA A{resi:4d}    {x:8.3f}{y:8.3f}{z:8.3f}  1.00{plddt:6.2f}           {name[0]}"


def shell_model(radius: float = 7.0, points: int = 700, plddt: float = 90.0) -> tuple[str, int]:
    """Coque sphérique d'atomes (5 par résidu) entourant une cavité vide."""
    golden = math.pi * (3 - math.sqrt(5))
    lines = []
    for k in range(points):
        y = 1 - 2 * (k + 0.5) / points
        r = math.sqrt(1 - y * y)
        theta = golden * k
        xyz = (radius * r * math.cos(theta), radius * y, radius * r * math.sin(theta))
        lines.append(_atom(k + 1, NAMES[k % 5], k // 5 + 1, xyz, plddt))
    return "\n".join(lines) + "\nEND\n", points // 5


def test_mapping_exact_and_differences():
    text, n = shell_model()
    _, residues = ma.model_residues(text)
    assert len(residues) == n and residues[0]["aa"] == "A" and residues[0]["plddt"] == 90.0
    assert ma.check_mapping(residues, "A" * n, "A" * n)["status"] == "exacte"
    changed = ma.check_mapping(residues, "A" * 4 + "W" + "A" * (n - 5), "A" * n)
    assert changed["status"] == "version"
    different = ma.check_mapping(residues, "A" * 4 + "W" + "A" * (n - 5), None)
    assert different["status"] == "differences" and different["mismatches"] == [{"position": 5, "model": "A", "uniprot": "W"}]
    assert ma.check_mapping(residues, "A" * (n + 10), "A" * (n + 10))["status"] == "partielle"


def test_confidence_low_regions():
    residues = [{"resi": k, "plddt": 40.0 if 10 <= k <= 20 else 92.0} for k in range(1, 50)]
    summary = ma.confidence_summary(residues)
    assert summary["low_regions"] == [{"start": 10, "end": 20, "length": 11}]
    assert summary["bands"]["very_low"] == round(11 / 49, 3)


def test_pocket_detected_in_cavity_and_sites_classified():
    text, n = shell_model()
    atoms, residues = ma.model_residues(text)
    pockets = ma.detect_pockets(atoms, residues)["pockets"]
    assert pockets, "la cavité centrale doit être détectée"
    best = pockets[0]
    assert all(abs(c) < 2.5 for c in best["center"])
    assert best["reliable"] and best["burial"] > 0.75 and len(best["residues"]) > 20

    lining = best["residues"][0]
    entry = {
        "features": [
            {"type": "Active site", "location": {"start": {"value": lining}, "end": {"value": lining}}, "evidences": [{"evidenceCode": "ECO:0000269"}]},
            {"type": "Binding site", "location": {"start": {"value": lining}, "end": {"value": lining}}, "ligand": {"name": "Zn(2+)"}, "evidences": [{"evidenceCode": "ECO:0000255"}]},
            {"type": "Transmembrane", "location": {"start": {"value": 1}, "end": {"value": 20}}},
        ]
    }
    sites = ma.annotated_sites(entry)
    assert [s["confirmed"] for s in sites] == [True, False]
    assert sites[1]["description"] == "Zn(2+)" and sites[1]["status"] == "Annoté sans preuve expérimentale"
    ma.link_sites(pockets, sites, {r["resi"]: r["plddt"] for r in residues})
    assert sites[0]["pockets"] == [best["id"]]
    assert "confirmé expérimentalement" in best["status"]


def test_full_analysis_never_presents_model_as_experimental():
    text, n = shell_model(plddt=60.0)
    result = ma.analyze_model_text(text, "P00000", {"model_id": "AF-P00000-F1", "sequence": "A" * n}, {"sequence": {"value": "A" * n}, "features": []})
    assert result["experimental"] is False and result["mapping"]["status"] == "exacte"
    assert result["confidence"]["mean_plddt"] == 60.0
    assert all(not p["reliable"] for p in result["pockets"]["pockets"])
    assert all("Poche prédite" in p["status"] for p in result["pockets"]["pockets"])
    assert result["contacts"]["total"] > 0
    assert all(j - i >= ma.MIN_SEPARATION for i, j, _ in result["contacts"]["pairs"])
    assert any("pas une structure expérimentale" in limit for limit in result["limits"])


def test_route_validates_and_handles_missing_model(monkeypatch):
    client = TestClient(app)
    assert client.get("/api/alphafold/PAS-OK!/analysis").status_code in (400, 404)
    monkeypatch.setattr(ma, "get_alphafold", lambda accession: {"accession": accession, "available": False})
    response = client.get("/api/alphafold/Q99999/analysis")
    assert response.status_code == 200 and response.json()["available"] is False


def test_curator_inference_and_cofactor_attachment():
    entry = {
        "features": [
            {"type": "Site", "description": "Primary proton acceptor", "location": {"start": {"value": 98}, "end": {"value": 98}}, "evidences": [{"evidenceCode": "ECO:0000305"}]},
            {"type": "Modified residue", "description": "N6-(retinylidene)lysine", "location": {"start": {"value": 229}, "end": {"value": 229}}, "evidences": [{"evidenceCode": "ECO:0000269"}]},
            {"type": "Modified residue", "description": "Phosphoserine", "location": {"start": {"value": 5}, "end": {"value": 5}}, "evidences": [{"evidenceCode": "ECO:0000269"}]},
        ]
    }
    sites = ma.annotated_sites(entry)
    assert [(s["type"], s["evidence"], s["confirmed"]) for s in sites] == [("Site", "inference", False), ("Cofacteur lié", "experimental", True)]
