"""Alignement ancré et scores de conservation."""

from app.services.alignment import BLOSUM62, align_to_query
from app.services.conservation_service import (
    grade_scores,
    henikoff_weights,
    jensen_shannon,
    select_representatives,
)

QUERY = "MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQ"


def test_blosum62_is_symmetric():
    assert BLOSUM62["W"]["W"] == 11 and BLOSUM62["C"]["C"] == 9
    assert all(BLOSUM62[a][b] == BLOSUM62[b][a] for a in BLOSUM62 for b in BLOSUM62)


def test_alignment_identical_and_mutated():
    assert align_to_query(QUERY, QUERY).anchored == QUERY
    mutant = QUERY[:10] + "W" + QUERY[11:]
    result = align_to_query(QUERY, mutant)
    assert result.anchored[10] == "W" and result.coverage == 1.0


def test_alignment_places_deletion_and_skips_insertion():
    deleted = align_to_query(QUERY, QUERY[:20] + QUERY[25:])
    assert deleted.anchored[20:25] == "-----"
    assert deleted.identity == 1.0
    inserted = align_to_query(QUERY, QUERY[:30] + "GGGGGG" + QUERY[30:])
    # Ancrage sur la requête : l'insertion de l'homologue n'apparaît pas
    assert inserted.anchored == QUERY


def test_alignment_fragment_coverage():
    fragment = align_to_query(QUERY, QUERY[15:45])
    assert fragment.anchored[:15] == "-" * 15
    assert abs(fragment.coverage - 30 / len(QUERY)) < 1e-9


def test_henikoff_downweights_redundant_sequences():
    weights = henikoff_weights(["AAAA", "AAAA", "CCCC"])
    assert abs(sum(weights) - 1) < 1e-9
    # La séquence unique pèse autant que les deux copies réunies
    assert abs(weights[2] - (weights[0] + weights[1])) < 1e-9


def test_jensen_shannon_ranks_conserved_above_variable():
    weights = [0.25] * 4
    conserved, _, _ = jensen_shannon("LLLL", weights)
    variable, _, _ = jensen_shannon("LIVA", weights)
    gapped, gap_fraction, _ = jensen_shannon("LL--", weights)
    assert conserved > variable
    assert gapped < conserved and gap_fraction == 0.5
    assert jensen_shannon("----", weights)[0] == 0.0


def test_grades_span_one_to_nine():
    grades = grade_scores([i / 100 for i in range(100)])
    assert min(grades) == 1 and max(grades) == 9
    assert grades[0] == 1 and grades[-1] == 9


def _member(acc, taxon, uniref100, entry_name=None, fragment=False):
    return {
        "memberIdType": "UniProtKB ID",
        "memberId": entry_name or f"{acc}_SPECIES",
        "accessions": [acc],
        "organismTaxId": taxon,
        "uniref100Id": uniref100,
        "sequenceLength": 400,
        "proteinName": "Receptor (Fragment)" if fragment else "Receptor",
    }


def test_representatives_one_per_species_swissprot_first():
    members = [
        _member("Q000A1", 9606, "U1"),  # requête
        _member("A0A001", 10090, "U2"),  # TrEMBL souris
        _member("P11111", 10090, "U3", entry_name="ADRB2_MOUSE"),  # Swiss-Prot souris
        _member("A0A002", 9598, "U4", fragment=True),  # fragment exclu
        _member("A0A003", 9913, "U5"),
    ]
    chosen = select_representatives(members, "Q000A1")
    assert [m["accessions"][0] for m in chosen] == ["P11111", "A0A003"]


def _feature(kind, start, end, description=""):
    return {"type": kind, "description": description, "location": {"start": {"value": start}, "end": {"value": end}}}


def test_membrane_regions_kcsa_like():
    from app.services.conservation_service import membrane_regions

    entry = {
        "features": [
            _feature("Topological domain", 1, 27, "Cytoplasmic"),
            _feature("Transmembrane", 28, 50, "Helical"),
            _feature("Topological domain", 51, 61, "Extracellular"),
            _feature("Intramembrane", 62, 72, "Helical; Pore-forming"),
            _feature("Intramembrane", 73, 80, "Pore-forming"),
            _feature("Topological domain", 81, 87, "Extracellular"),
            _feature("Transmembrane", 88, 111, "Helical"),
            _feature("Topological domain", 112, 160, "Cytoplasmic"),
        ]
    }
    regions = membrane_regions(entry, 160)
    assert [r["label"] for r in regions] == [
        "Extrémité N-terminale",
        "TM1",
        "Boucle extérieure 1",
        "Intramembranaire 1",
        "Intramembranaire 2",
        "Boucle extérieure 2",
        "TM2",
        "Extrémité C-terminale",
    ]
    # Les régions couvrent toute la séquence sans chevauchement
    covered = [p for r in regions for p in range(r["start"], r["end"] + 1)]
    assert covered == list(range(1, 161))


def test_membrane_regions_soluble_protein():
    from app.services.conservation_service import membrane_regions

    assert membrane_regions({"features": [_feature("Domain", 1, 80, "Globin")]}, 141) == []


def test_parse_a3m_removes_insertions():
    from app.services.homology_service import parse_a3m

    a3m = (
        ">101\nMKTAYIAK\n"
        ">UniRef100_A0A001\t120\t0.875\t1e-30\nMKTaaAYIAR\n"
        ">UniRef100_A0A002\t80\t0.500\t1e-10\n--TAYIqqqA-\n"
        ">UniRef100_BROKEN\t10\t0.1\t1\nMK\n"
    )
    hits = parse_a3m(a3m, 8)
    assert [h["id"] for h in hits] == ["UniRef100_A0A001", "UniRef100_A0A002"]
    assert hits[0]["row"] == "MKTAYIAR" and hits[0]["identity"] == 0.875
    assert hits[1]["row"] == "--TAYIA-"


def test_regions_from_estimated_segments():
    from app.services.conservation_service import regions_from_segments

    regions = regions_from_segments([{"start": 10, "end": 30}, {"start": 50, "end": 70}], 90, estimated=True)
    assert [r["label"] for r in regions] == [
        "Extrémité N-terminale",
        "TM1 (estimé)",
        "Boucle 1",
        "TM2 (estimé)",
        "Extrémité C-terminale",
    ]
    assert regions_from_segments([], 90, estimated=True) == []


def test_sequence_route_recognises_uniprot_entry(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    calls = []
    monkeypatch.setattr(
        "app.routers.evolution.find_identical_entry",
        lambda seq: {"uniparc_id": "UPI1", "accession": "P02945", "reviewed": True},
    )
    monkeypatch.setattr(
        "app.services.conservation_service.compute_conservation",
        lambda acc, source="uniref50": calls.append((acc, source)) or {"accession": acc},
    )
    with TestClient(app) as client:
        r = client.post("/api/conservation/sequence", json={"sequence": "M" * 30})
        assert r.status_code == 200
        assert r.json()["matched_entry"]["accession"] == "P02945"
    assert calls == [("P02945", "uniref50")]


def test_sequence_route_validates_length():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        assert client.post("/api/conservation/sequence", json={"sequence": "MKT"}).status_code == 400
