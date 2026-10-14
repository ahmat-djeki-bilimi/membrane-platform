"""Exécutions reproductibles : traçabilité, reprise, nouvelle exécution, comparaison, exports."""

import json

from fastapi.testclient import TestClient

from app import jobs, provenance
from app.db import session_scope
from app.main import app
from app.models import Job
from app.services import runs

from tests.test_explorer import family, fasta


def test_recorder_steps_sources_and_inputs():
    recorder = provenance.Recorder("x", "explorer")
    token = provenance.activate(recorder)
    try:
        provenance.mark("Étape 1")
        provenance.record_response("https://rest.uniprot.org/uniprotkb/P1.json", type("R", (), {"headers": {"X-UniProt-Release": "2026_03", "X-UniProt-Release-Date": "01-Jun-2026"}})())
        provenance.record_cache_hit("uniprot:entry", "2026-05-01T00:00:00+00:00")
        provenance.mark("Étape 2")
        provenance.record_input("Entrée UniProt", "P1")
        provenance.record_input("Entrée UniProt", "P1")
        recorder.close(error="boum")
    finally:
        provenance.deactivate(token)
    record = recorder.to_dict()
    assert [s["status"] for s in record["steps"]] == ["succeeded", "failed"]
    assert record["steps"][0]["cache_hits"] == 1 and record["steps"][1]["error"] == "boum"
    uniprot = record["sources"][0]
    assert uniprot["name"] == "UniProt" and uniprot["release"] == "2026_03" and uniprot["live_requests"] == 1 and uniprot["cached_responses"] == 1
    assert len(record["inputs"]) == 1
    # Hors d'une tâche : aucun effet
    provenance.mark("ignoré")
    assert provenance.current() is None


def test_job_records_provenance_and_exports():
    client = TestClient(app)
    job = client.post("/api/explorer", json={"fasta": fasta(family(12)) + ">extra provenance\nMKV\n"}).json()
    run = client.get(f"/api/runs/{job['id']}").json()
    assert run["status"] == "succeeded"
    provenance_record = run["provenance"]
    names = [s["name"] for s in provenance_record["steps"]]
    assert names[0].startswith("Lecture du FASTA") and "Coévolution (MIp) et contrôles de robustesse" in names
    assert all(s["status"] == "succeeded" for s in provenance_record["steps"])
    assert provenance_record["fingerprint"] and provenance_record["environment"]["python"]
    assert any(i["kind"] == "FASTA" for i in run["inputs"])
    assert run["summary"]["Homologues analysés"] == 12
    assert "positions" in run["tables"] and "pairs" in run["tables"]

    exported = client.get(f"/api/runs/{job['id']}/export.json")
    assert exported.headers["content-disposition"].startswith("attachment")
    data = json.loads(exported.content)
    assert data["result"]["input"]["kept"] == 12 and data["provenance"]["steps"]

    csv = client.get(f"/api/runs/{job['id']}/export.csv?table=positions").content.decode("utf-8-sig")
    assert csv.splitlines()[0].startswith("position;residue;grade")
    assert client.get(f"/api/runs/{job['id']}/export.csv?table=inconnu").status_code == 400

    pdf = client.get(f"/api/runs/{job['id']}/report.pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF") and len(pdf.content) > 3000

    listed = client.get(f"/api/runs?ids={job['id']},inconnu").json()
    assert [r["id"] for r in listed] == [job["id"]]


def test_rerun_and_compare():
    client = TestClient(app)
    job = client.post("/api/explorer", json={"fasta": fasta(family(14)) + ">extra compare\nMKV\n"}).json()
    second = client.post(f"/api/runs/{job['id']}/rerun").json()
    assert second["id"] != job["id"] and second["parent_id"] == job["id"] and second["status"] == "succeeded"
    comparison = client.get(f"/api/runs/compare?a={job['id']}&b={second['id']}").json()
    assert comparison["same_kind"] and comparison["same_fingerprint"]
    assert all(row["same"] for row in comparison["params"])
    assert comparison["overlaps"]["Positions candidates"]["jaccard"] == 1.0
    assert any(row["key"] == "Homologues analysés" and row["same"] for row in comparison["summary"])


def test_resume_failed_job_keeps_history(monkeypatch):
    client = TestClient(app)
    with session_scope() as session:
        job = Job(kind="explorer", input_key="test-reprise", params={"fasta": fasta(family(10)), "reference": 0}, status="failed", error="Serveur MMseqs2 injoignable", attempts=1)
        session.add(job)
        session.flush()
        job_id = job.id
    assert client.post("/api/runs/inconnu/resume").status_code == 404
    resumed = client.post(f"/api/runs/{job_id}/resume").json()
    assert resumed["status"] == "succeeded" and resumed["attempts"] == 2
    assert resumed["history"][0]["error"] == "Serveur MMseqs2 injoignable"
    # Une analyse terminée ne se reprend pas
    assert client.post(f"/api/runs/{job_id}/resume").status_code == 409


def test_stale_detection():
    old = {"kind": "explorer", "status": "running", "started_at": "2020-01-01T00:00:00+00:00", "created_at": "2020-01-01T00:00:00+00:00"}
    assert runs.is_stale(old)
    assert not runs.is_stale({**old, "status": "succeeded"})
    assert runs.describe({**old, "id": "x", "params": {}, "result": None})["can_resume"]


def test_report_handles_special_characters():
    from app.services.report_service import build_report, safe

    assert safe("≥ 70 % → Δ <b>") == "&gt;= 70 % -&gt; delta  &lt;b&gt;"
    pdf = build_report({"id": "abc", "kind": "deeptmhmm", "status": "failed", "params": {"sequence": "MKV" * 50}, "result": None, "error": "Délai dépassé ≥ 3 h", "attempts": 2, "history": [{"attempt": 1, "error": "x"}], "provenance": None})
    assert pdf.startswith(b"%PDF")
