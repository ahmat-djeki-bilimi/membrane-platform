"""Cache persistant, file de calculs et routes de l'API."""

from fastapi.testclient import TestClient

from app import jobs
from app.cache import cached
from app.main import app


def test_cached_function_called_once():
    calls = []

    @cached("test:square")
    def square(x):
        calls.append(x)
        return {"value": x * x}

    assert square(4) == {"value": 16}
    assert square(4) == {"value": 16}
    assert calls == [4]


def test_cache_skips_errors():
    calls = []

    @cached("test:flaky", store_if=lambda v: not v.get("error"))
    def flaky():
        calls.append(1)
        return {"error": "indisponible"}

    flaky()
    flaky()
    assert len(calls) == 2


def test_job_runs_and_is_deduplicated(monkeypatch):
    runs = []

    def fake_predict(sequence, name="query"):
        runs.append(sequence)
        return {"is_membrane": True, "tm_segments": [{"start": 1, "end": 20}]}

    monkeypatch.setattr("app.services.membrane_service.predict_topology_isolated", fake_predict)

    first = jobs.submit("deeptmhmm", {"sequence": "MKTL", "name": "a"}, key_params={"sequence": "MKTL"})
    job = jobs.get(first["id"])
    assert job["status"] == "succeeded"
    assert job["result"]["tm_segments"][0]["end"] == 20

    # Même séquence, autre nom : résultat réutilisé, pas de nouveau calcul
    second = jobs.submit("deeptmhmm", {"sequence": "MKTL", "name": "b"}, key_params={"sequence": "MKTL"})
    assert second["id"] == first["id"]
    assert runs == ["MKTL"]


def test_failed_job_records_error(monkeypatch):
    def broken(sequence, name="query"):
        raise RuntimeError("BioLib indisponible")

    monkeypatch.setattr("app.services.membrane_service.predict_topology_isolated", broken)
    job = jobs.get(jobs.submit("deeptmhmm", {"sequence": "MKTW"})["id"])
    assert job["status"] == "failed"
    assert "BioLib indisponible" in job["error"]


def test_api_health_and_jobs():
    with TestClient(app) as client:
        assert client.get("/api/health").json()["status"] == "ok"
        assert client.get("/api/jobs/inexistant").status_code == 404


def test_api_uniprot_from_cache(monkeypatch):
    entry = {
        "primaryAccession": "P07550",
        "entryType": "UniProtKB reviewed (Swiss-Prot)",
        "proteinDescription": {"recommendedName": {"fullName": {"value": "Beta-2 adrenergic receptor"}}},
        "organism": {"scientificName": "Homo sapiens"},
        "sequence": {"value": "MGQPGNGSAF", "length": 10},
        "features": [
            {"type": "Transmembrane", "description": "Helical", "location": {"start": {"value": 2}, "end": {"value": 8}}}
        ],
    }
    monkeypatch.setattr("app.services.uniprot_service._fetch_entry_cached", lambda acc: entry)

    with TestClient(app) as client:
        data = client.get("/api/uniprot/p07550").json()
        assert data["protein_name"] == "Beta-2 adrenergic receptor"
        membrane = client.get("/api/membrane/P07550").json()
        # DeepTMHMM désactivé pendant les tests : annotations UniProt
        assert membrane["method"] == "UniProt annotation"
        assert membrane["tm_segments"] == [{"start": 2, "end": 8, "label": "TM1"}]
        assert membrane["is_membrane"] is True


def test_api_sequence_validation():
    with TestClient(app) as client:
        assert client.post("/api/membrane/sequence", json={"sequence": "123"}).status_code == 400
