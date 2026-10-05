"""Lecture des résultats des outils externes (DeepTMHMM, OPM, SIFTS)."""

from app.services.membrane_service import parse_deeptmhmm_output
from app.services.opm_service import _parse_segments
from app.services.sifts_service import _segment, map_range


def test_deeptmhmm_bacteriorhodopsin(fixtures_dir):
    gff = (fixtures_dir / "bacteriorhodopsin.gff3").read_text()
    three_line = (fixtures_dir / "bacteriorhodopsin.3line").read_text()
    result = parse_deeptmhmm_output(gff, three_line)

    assert result["is_membrane"] is True
    assert result["type_code"] == "TM"
    assert len(result["tm_segments"]) == 7
    assert result["tm_segments"][0] == {"start": 24, "end": 42, "label": "TM1", "kind": "helix"}
    # Bactériorhodopsine : extrémité N-terminale extracellulaire
    assert result["n_terminus"] == "out"
    assert result["signal_peptide"] is None


def test_deeptmhmm_globular_protein():
    gff = "##gff-version 3\nX\tinside\t1\t141\n"
    result = parse_deeptmhmm_output(gff, ">X | GLOB\nMVLS\nIIII\n")
    assert result["is_membrane"] is False
    assert result["tm_segments"] == []


def test_deeptmhmm_signal_peptide():
    gff = "X\tsignal\t1\t22\nX\toutside\t23\t60\nX\tTMhelix\t61\t80\nX\tinside\t81\t120\n"
    result = parse_deeptmhmm_output(gff, ">X | SP+TM\nM\nS\n")
    assert result["signal_peptide"] == {"start": 1, "end": 22}
    # Le peptide signal est ignoré pour déterminer l'orientation
    assert result["n_terminus"] == "out"


def test_opm_segments():
    assert _parse_segments("1(31-56),2(70-92), 3( 104 - 129 )") == [
        {"start": 31, "end": 56},
        {"start": 70, "end": 92},
        {"start": 104, "end": 129},
    ]
    assert _parse_segments("") == []


def test_sifts_segment_and_mapping():
    # 2RH1 : récepteur β2 (numérotation identique) et lysozyme T4 (décalage +1000)
    receptor = _segment(
        {
            "chain_id": "A",
            "unp_start": 1,
            "unp_end": 230,
            "start": {"author_residue_number": None},
            "end": {"author_residue_number": 230},
        }
    )
    assert receptor == {"chain": "A", "unp_start": 1, "unp_end": 230, "offset": 0, "linear": True}

    lysozyme = _segment(
        {
            "chain_id": "A",
            "unp_start": 2,
            "unp_end": 162,
            "start": {"author_residue_number": 1002},
            "end": {"author_residue_number": 1162},
        }
    )
    assert lysozyme["offset"] == 1000 and lysozyme["linear"]

    mapping = {"segments": [receptor, {**receptor, "unp_start": 264, "unp_end": 365}]}
    # Segment chevauchant la région absente 231–263 : découpé en deux
    assert map_range(mapping, 220, 270) == [
        {"chain": "A", "start": 220, "end": 230},
        {"chain": "A", "start": 264, "end": 270},
    ]
    assert map_range(mapping, 240, 250) == []


def test_sifts_without_observed_residues():
    assert _segment({"unp_start": 1, "unp_end": 10, "start": {}, "end": {}}) is None
