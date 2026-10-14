"""Annotation fonctionnelle : InterPro, Gene Ontology, sites, variants et nature des preuves."""

from fastapi.testclient import TestClient

from app.main import app
from app.services import functional_annotation_service as fa

ENTRY = {
    "primaryAccession": "P99999",
    "entryType": "UniProtKB reviewed (Swiss-Prot)",
    "sequence": {"length": 300},
    "uniProtKBCrossReferences": [
        {"database": "GO", "id": "GO:0004930", "properties": [{"key": "GoTerm", "value": "F:G protein-coupled receptor activity"}, {"key": "GoEvidenceType", "value": "IDA:UniProtKB"}]},
        {"database": "GO", "id": "GO:0005886", "properties": [{"key": "GoTerm", "value": "C:plasma membrane"}, {"key": "GoEvidenceType", "value": "IEA:Ensembl"}]},
        {"database": "GO", "id": "GO:0007186", "properties": [{"key": "GoTerm", "value": "P:signaling"}, {"key": "GoEvidenceType", "value": "IBA:GO_Central"}]},
        {"database": "Pfam", "id": "PF00001"},
    ],
    "features": [
        {"type": "Active site", "location": {"start": {"value": 50}, "end": {"value": 50}}, "description": "Proton donor", "evidences": [{"evidenceCode": "ECO:0000255"}]},
        {"type": "Binding site", "location": {"start": {"value": 113}, "end": {"value": 113}}, "ligand": {"name": "(R)-adrenaline", "id": "ChEBI:CHEBI:71406"}, "evidences": [{"evidenceCode": "ECO:0000269", "source": "PubMed", "id": "24056936"}]},
        {"type": "Mutagenesis", "location": {"start": {"value": 79}, "end": {"value": 79}}, "description": "Affects binding of catecholamines.", "alternativeSequence": {"originalSequence": "D", "alternativeSequences": ["N"]}},
        {"type": "Natural variant", "location": {"start": {"value": 15}, "end": {"value": 15}}, "description": "in dbSNP:rs33973603", "featureCrossReferences": [{"database": "dbSNP", "id": "rs33973603"}], "alternativeSequence": {"originalSequence": "N", "alternativeSequences": ["S"]}},
        {"type": "Natural variant", "location": {"start": {"value": 200}, "end": {"value": 200}}, "description": "in HYPO; reduced activity", "featureCrossReferences": [{"database": "MIM", "id": "123456"}], "evidences": [{"evidenceCode": "ECO:0000269", "source": "PubMed", "id": "1"}]},
    ],
}

INTERPRO = [
    {
        "metadata": {"accession": "PF00001", "name": "7tm_1", "source_database": "pfam", "type": "family", "integrated": "IPR000276"},
        "proteins": [{"entry_protein_locations": [{"fragments": [{"start": 50, "end": 290}]}]}],
    },
    {
        "metadata": {"accession": "IPR000276", "name": "GPCR, rhodopsin-like", "source_database": "interpro", "type": "family", "integrated": None},
        "proteins": [{"entry_protein_locations": [{"fragments": [{"start": 35, "end": 300}]}]}],
    },
    {"metadata": {"accession": "PS00237", "name": "sans position", "source_database": "prosite"}, "proteins": []},
]


def test_go_evidence_classification():
    assert fa.go_evidence("IDA")[0] == "experimental"
    assert fa.go_evidence("IEA")[0] == "electronic"
    assert fa.go_evidence("IBA")[0] == "phylogenetic"
    terms = fa.gene_ontology(ENTRY)
    assert [(t["aspect"], t["experimental"]) for t in terms] == [("C", False), ("F", True), ("P", False)]
    assert terms[1]["assigned_by"] == "UniProtKB" and terms[1]["evidence_label"] == "Expérimentale"


def test_sites_and_variants_evidence():
    sites = fa.functional_sites(ENTRY)
    assert [(s["type"], s["experimental"]) for s in sites] == [("Résidu catalytique", False), ("Site de liaison", True)]
    assert sites[1]["ligand"] == "(R)-adrenaline" and sites[1]["references"] == [{"source": "PubMed", "id": "24056936"}]
    variants = {v["start"]: v for v in fa.functional_variants(ENTRY)}
    assert variants[79]["kind"] == "Mutagenèse dirigée" and variants[79]["experimental"] and variants[79]["functional"]
    assert not variants[15]["functional"] and variants[15]["dbsnp"] == "rs33973603" and not variants[15]["experimental"]
    assert variants[200]["functional"] and variants[200]["disease"]


def test_interpro_matches(monkeypatch):
    monkeypatch.setattr(fa, "fetch_interpro", lambda accession: INTERPRO)
    result = fa.interpro_matches("P99999")
    assert [e["database"] for e in result["entries"]] == ["interpro", "pfam"]
    assert result["entries"][1]["database_label"] == "Pfam" and result["entries"][1]["experimental"] is False

    def broken(accession):
        raise RuntimeError("hors ligne")

    monkeypatch.setattr(fa, "fetch_interpro", broken)
    assert fa.interpro_matches("P99999")["available"] is False


def test_build_annotation_summary():
    result = fa.build_annotation(ENTRY, {"available": True, "entries": []})
    assert result["reviewed"] and "Swiss-Prot" in result["uniprot_status"]
    assert result["summary"]["go"] == {"total": 3, "experimental": 1}
    assert result["summary"]["catalytic"] == 1 and result["summary"]["binding"] == 1
    assert result["summary"]["functional_variants"] == 2


def test_route(monkeypatch):
    client = TestClient(app)
    assert client.get("/api/annotations/PAS-OK!").status_code in (400, 404)
    monkeypatch.setattr("app.services.uniprot_service.fetch_entry", lambda accession: ENTRY)
    monkeypatch.setattr(fa, "fetch_interpro", lambda accession: INTERPRO)
    data = client.get("/api/annotations/P99999").json()
    assert data["summary"]["signatures"] == 2 and len(data["go"]) == 3
