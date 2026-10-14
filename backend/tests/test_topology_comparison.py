"""Comparaison DeepTMHMM / UniProt / structure 3D et limites de l'orientation calculée."""

from app.services import explorer_service as ex
from app.services import topology_comparison_service as tc

from tests.test_explorer import family, fasta


def _feature(start, end, code=None):
    feature = {"type": "Transmembrane", "location": {"start": {"value": start}, "end": {"value": end}}}
    if code:
        feature["evidences"] = [{"evidenceCode": code}]
    return feature


def test_uniprot_evidence():
    entry = {"features": [_feature(10, 30, "ECO:0000255"), _feature(40, 60, "ECO:0000269"), _feature(70, 90, "ECO:0007744"), _feature(100, 120)]}
    segments = tc.uniprot_segments(entry)
    assert [s["evidence"] for s in segments] == ["predicted", "experimental", "structure", "unknown"]
    assert segments[1]["evidence_label"] == "Expérimentale"


def test_structure_segments_from_depth():
    residues = {n: {"z": 0.0 if 20 <= n <= 40 or 60 <= n <= 66 else 30.0, "plddt": 80.0} for n in range(1, 100)}
    residues[30]["z"] = 25.0  # un résidu hors tranche : trou toléré
    segments = tc.structure_segments(residues, 15.0)
    assert [(s["start"], s["end"]) for s in segments] == [(20, 40)]
    assert segments[0]["mean_plddt"] == 80.0


def test_compare_topologies_divergences_and_confidence():
    sources = {
        "deeptmhmm": {"segments": [{"start": 10, "end": 30}, {"start": 50, "end": 70}, {"start": 100, "end": 120}], "n_terminus": "in"},
        "uniprot": {"segments": [{"start": 12, "end": 32, "evidence": "predicted"}, {"start": 62, "end": 82, "evidence": "experimental"}], "n_terminus": "out"},
        "kd": {"segments": [{"start": 11, "end": 29}]},
    }
    chosen = [{"start": 10, "end": 30, "label": "TM1"}, {"start": 50, "end": 70, "label": "TM2"}, {"start": 100, "end": 120, "label": "TM3"}]
    result = tc.compare_topologies(150, sources, "deeptmhmm", chosen)
    rows = {r["label"]: r for r in result["segments"]}
    assert rows["TM1"]["confidence"] == "forte" and rows["TM1"]["shift"] == 2
    assert rows["TM2"]["shift"] == 12 and rows["TM2"]["uniprot_evidence"] == "experimental"
    assert rows["TM3"]["confidence"] == "faible"
    texts = " ".join(d["text"] for d in result["divergences"])
    assert "Nombre de segments : 3 selon DeepTMHMM, 2 selon UniProt" in texts
    assert "N-terminale" in texts
    assert "TM3" in texts and "absent de UniProt" in texts
    assert "décalées de 12" in texts
    assert result["summary"]["major_divergences"] >= 3


def test_orientation_is_never_experimental():
    assert tc.orientation_report(None, "kd", "estimées", None)["status"] == "indisponible"
    structure = {
        "source": "AlphaFold",
        "membrane": {"thickness": 30.0, "at_search_limit": True, "side_method": "positive_inside", "kr_inside": 5, "kr_outside": 4, "n_terminus": "in"},
        "tm_mean_plddt": 60.0,
        "window": None,
    }
    report = tc.orientation_report(structure, "uniprot", "UniProt", {"pdb_id": "1ABC", "hydrophobic_thickness": 32.0, "n_terminus": "out"})
    assert report["status"] == "calculée" and "non validée" in report["label"]
    text = " ".join(report["limits"])
    assert "pas une mesure expérimentale" in text
    assert "positive-inside" in text and "incertain" in text
    assert "limite de la recherche" in text and "pLDDT" in text
    assert "OPM (1ABC) est lui aussi une orientation calculée" in text
    assert report["opm"]["thickness_difference"] == -2.0 and report["opm"]["n_terminus_agrees"] is False


def test_run_explorer_includes_topology_comparison():
    result = ex.run_explorer(fasta(family(20)))
    comparison = result["topology_comparison"]
    assert comparison["chosen"] == "kd"
    assert [s["id"] for s in comparison["sources"]] == ["kd"]
    assert len(comparison["segments"]) == 2
    assert all(s["confidence"] == "faible" for s in comparison["segments"])
    assert result["orientation"]["status"] == "indisponible"
    assert "deeptmhmm" not in result["topology"]
