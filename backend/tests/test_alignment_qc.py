"""Contrôle qualité de l'alignement : gaps, couverture, diversité, régions mal alignées, masques."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import alignment_qc_service as qc
from app.services import explorer_service as ex
from app.services.coevolution_service import compute_coevolution
from app.services.conservation_service import analyze_alignment, grades_with_mask

from tests.test_explorer import REFERENCE, family, fasta


def test_sequence_stats_coverage_and_internal_gaps():
    stats = qc.sequence_stats("--AB---CD-E--")
    assert stats["start"] == 3 and stats["end"] == 11
    assert stats["longest_internal_gap"] == 3
    assert stats["internal_gaps"] == 2
    assert stats["coverage"] == round(5 / 13, 3)
    assert qc.sequence_stats("----")["coverage"] == 0


def test_column_stats_and_poor_regions():
    query = "MKLVAIGLLFAVILGLVAWLRKDNGSEQ"
    # Les 8 dernières colonnes : gaps ou résidus sans rapport (W face à K, D, N…)
    good = query[:20]
    rows = [good + "--------", good + "WWWWWWWW", good + "--------", good + "PPPPPPPP"]
    columns = qc.column_stats(query, rows)
    assert columns["gap_fraction"][0] == 0 and columns["gap_fraction"][-1] == 0.5
    assert columns["identity"][0] == 1 and columns["similarity"][0] == 1
    regions = qc.poor_regions(columns)
    assert len(regions) == 1
    assert regions[0]["end"] == len(query) and regions[0]["start"] > 15
    masked, reasons = qc.column_mask(columns, regions, qc.normalize_params({"mask_poor_regions": True}))
    assert masked[-1] and not masked[0]
    assert "mal alignée" in reasons[-1]
    masked, reasons = qc.column_mask(columns, regions, qc.normalize_params({"max_column_gaps": 0.4}))
    assert sum(masked) == 8 and "gaps" in reasons[-1]


def test_quality_control_filters_sequences_and_keeps_numbering():
    sequences = family(20)
    alignment = ex.build_alignment(ex.parse_fasta(fasta(sequences)), 0)
    rows, homologs = list(alignment["rows"]), list(alignment["homologs"])
    # Une séquence tronquée et une séquence trouée
    rows[0] = rows[0][:40] + "-" * (len(REFERENCE) - 40)
    rows[1] = rows[1][:10] + "-" * 25 + rows[1][35:]
    kept_rows, kept, report = qc.quality_control(REFERENCE, rows, homologs, {"min_coverage": 0.6, "max_internal_gap": 20})
    removed = {h["accession"]: h["reasons"] for h in report["removed"]}
    assert set(removed) == {homologs[0]["accession"], homologs[1]["accession"]}
    assert "Couverture" in removed[homologs[0]["accession"]][0]
    assert "Trou interne" in removed[homologs[1]["accession"]][0]
    assert len(kept_rows) == len(rows) - 2
    assert report["mapping"]["columns"] == len(REFERENCE) == len(report["columns"]["gap_fraction"])
    assert report["diversity"]["neff"] > 1
    assert 0 < report["diversity"]["mean_pairwise_identity"] < 1


def test_quality_control_rejects_inconsistent_rows():
    with pytest.raises(ValueError):
        qc.quality_control("MKV", ["MK"], [{"accession": "a", "identity": 1}])


def test_masked_columns_keep_positions_and_are_excluded():
    rows = family(40)
    mask = [False] * len(REFERENCE)
    for k in range(30, 40):
        mask[k] = True
    homologs = [{"accession": f"h{k}", "identity": 0.8} for k in range(len(rows))]
    result = analyze_alignment(REFERENCE, rows, homologs, [], [], mask=mask)
    # Correspondance exacte : position k = résidu k de la référence, masquée ou non
    for k, p in enumerate(result["positions"]):
        assert p["position"] == k + 1 and p["residue"] == REFERENCE[k]
        assert p["masked"] == mask[k]
        assert 1 <= p["grade"] <= 9
    assert all(not mask[p["position"] - 1] for p in result["summary"]["most_conserved"])

    coevolution = compute_coevolution([REFERENCE] + rows, mask=mask)
    assert all(not mask[p["i"] - 1] and not mask[p["j"] - 1] for p in coevolution["pairs"])
    assert (coevolution["pairs"][0]["i"], coevolution["pairs"][0]["j"]) == (15, 51)


def test_grades_with_mask_rank_reliable_columns_only():
    scores = [0.1, 0.2, 0.3, 0.9, 0.05]
    grades = grades_with_mask(scores, [True, True, True, False, True])
    assert grades[3] == max(grades[:3] + grades[4:])
    assert grades_with_mask(scores, [True] * 5) == grades_with_mask(scores, [False] * 5)


def test_run_explorer_with_quality_control():
    text = fasta(family(30))
    plain = ex.run_explorer(text)
    assert plain["qc"]["summary"]["masked_columns"] == 0
    assert plain["qc"]["mapping"]["exact"]
    result = ex.run_explorer(text, qc={"max_column_gaps": 0.0, "min_coverage": 0.5})
    assert [p["position"] for p in result["positions"]] == list(range(1, len(REFERENCE) + 1))
    assert all(not c.get("masked") for c in result["positions"] if c["position"] in {x["position"] for x in result["candidates"]})
    assert {n["topic"] for n in result["interpretation"]} >= {"quality"}


def test_explorer_route_quality_params():
    client = TestClient(app)
    assert client.post("/api/explorer", json={"fasta": fasta(family(12)), "qc": {"min_coverage": 2}}).status_code == 422
    base = client.post("/api/explorer", json={"fasta": fasta(family(12))}).json()
    # Réglages par défaut : même tâche que sans contrôle qualité
    assert client.post("/api/explorer", json={"fasta": fasta(family(12)), "qc": {}}).json()["id"] == base["id"]
    job = client.post("/api/explorer", json={"fasta": fasta(family(12)), "qc": {"max_column_gaps": 0.3, "mask_poor_regions": True}}).json()
    done = client.get(f"/api/jobs/{job['id']}").json()
    assert done["params"]["qc"] == {"max_column_gaps": 0.3, "mask_poor_regions": True}
    assert done["result"]["qc"]["params"]["max_column_gaps"] == 0.3
