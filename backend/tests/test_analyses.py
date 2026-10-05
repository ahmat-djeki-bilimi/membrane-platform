"""Calculs scientifiques : Ramachandran, contacts, topologie, tri des structures."""

from app.services.membrane_orientation_service import estimate_tm_segments, extract_topology
from app.services.pdb_service import sort_structures, summarize_pdb_entry
from app.services.structure_quality_service import (
    _compute_contact_windows,
    _group_residues,
    _rama_status,
)


# --- Ramachandran -----------------------------------------------------------

def test_rama_general_residues():
    assert _rama_status("ALA", -60, -45) == "favored"  # hélice α
    assert _rama_status("VAL", -120, 130) == "favored"  # feuillet β
    assert _rama_status("ALA", 60, 45) == "allowed"  # hélice gauche
    assert _rama_status("ALA", 80, -150) == "outlier"


def test_rama_glycine_is_never_an_outlier():
    assert _rama_status("GLY", 10, 175) == "allowed"
    # Région β « miroir », accessible à la glycine
    assert _rama_status("GLY", 80, -150) == "favored"
    assert _rama_status("GLY", 60, -45) == "favored"  # symétrique de l'hélice α


def test_rama_proline_phi_restriction():
    assert _rama_status("PRO", -65, 145) == "favored"
    assert _rama_status("PRO", -150, 145) == "outlier"


# --- Contacts atomiques -----------------------------------------------------

def _atom(chain, resi, name, resn, x, y=0.0, z=0.0, element=None):
    return {
        "atom": name,
        "resn": resn,
        "chain": chain,
        "resi": resi,
        "icode": "",
        "coord": (x, y, z),
        "element": element or name[0],
    }


def _chain(n, spacing=3.8):
    return [_atom("A", i, "CA", "ALA", i * spacing, element="C") for i in range(1, n + 1)]


def test_contacts_none_in_ideal_chain():
    atoms = _chain(20)
    result = _compute_contact_windows(atoms, _group_residues(atoms))
    assert result["score"] == 100.0
    assert result["bad_windows"] == []


def test_contacts_detect_overlap():
    atoms = _chain(20)
    # Résidus 15 à 17 repliés sur les résidus 4 à 6 : foyer de chevauchements
    for index, target in ((14, 5), (15, 6), (16, 4)):
        atoms[index] = _atom("A", index + 1, "CA", "ALA", target * 3.8 + 0.5, element="C")
    result = _compute_contact_windows(atoms, _group_residues(atoms))
    flagged = result["bad_windows"] + result["warning_windows"]
    assert any(w["start"] <= 5 <= w["end"] for w in flagged)
    # Les fenêtres éloignées du foyer restent correctes
    assert all(w["status"] == "good" for w in result["all_windows"] if w["start"] > 7 and w["end"] < 14)


def test_contacts_ignore_disulfide():
    atoms = _chain(20)
    atoms.append(_atom("A", 3, "SG", "CYS", 40.0, element="S"))
    atoms.append(_atom("A", 12, "SG", "CYS", 42.05, element="S"))
    result = _compute_contact_windows(atoms, _group_residues(atoms))
    assert result["bad_windows"] == []


# --- Topologie UniProt ------------------------------------------------------

def _topo(start, end, description):
    return {"type": "Topological domain", "description": description,
            "location": {"start": {"value": start}, "end": {"value": end}}}


def test_extract_topology_sides():
    features = [_topo(1, 29, "Extracellular"), _topo(57, 70, "Cytoplasmic"), _topo(327, 413, "Cytoplasmic")]
    n_side, c_side, domains = extract_topology(features)
    assert (n_side, c_side) == ("out", "in")
    assert len(domains) == 3


def test_estimate_tm_segments_finds_hydrophobic_helix():
    sequence = "MKKRSEDKRKDE" + "LLLLVVVIIIAAALLLFFLLV" + "KRKDEDSGRKKDEESNTQKDERKG"
    segments = estimate_tm_segments(sequence)
    assert len(segments) == 1
    assert 10 <= segments[0]["start"] <= 16 and 30 <= segments[0]["end"] <= 36


def test_estimate_tm_segments_soluble():
    assert estimate_tm_segments("MKDEKRSTNQ" * 10) == []


# --- Structures PDB ---------------------------------------------------------

def _entry(pdb_id, resolution, aligned_length):
    return {
        "rcsb_id": pdb_id,
        "exptl": [{"method": "X-RAY DIFFRACTION"}],
        "rcsb_entry_info": {"resolution_combined": [resolution]},
        "polymer_entities": [
            {
                "rcsb_id": f"{pdb_id}_1",
                "rcsb_polymer_entity_container_identifiers": {
                    "auth_asym_ids": ["A"],
                    "reference_sequence_identifiers": [{"database_accession": "P07550"}],
                },
                "rcsb_polymer_entity_align": [
                    {
                        "reference_database_accession": "P07550",
                        "aligned_regions": [{"ref_beg_seq_id": 1, "length": aligned_length}],
                    }
                ],
            }
        ],
    }


def test_summarize_pdb_entry_coverage():
    s = summarize_pdb_entry(_entry("2RH1", 2.4, 230), "P07550", 413)
    assert s["coverage_percent"] == round(100 * 230 / 413, 1)
    assert s["coverage_ranges"] == [{"start": 1, "end": 230}]
    assert s["chains"] == ["A"]


def test_fragments_are_ranked_after_full_structures():
    fragment = summarize_pdb_entry(_entry("1FRG", 1.5, 28), "P07550", 413)
    full = summarize_pdb_entry(_entry("2RH1", 2.4, 330), "P07550", 413)
    ranked = sort_structures([fragment, full])
    assert [s["pdb_id"] for s in ranked] == ["2RH1", "1FRG"]
