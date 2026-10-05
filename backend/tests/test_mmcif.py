"""Lecture minimale du format mmCIF."""

from app.services import structure_comparison_service as cs
from app.services.mmcif import chain_aliases, parse_mmcif, read_categories

CIF = """data_TEST
#
_entity.id                 1
_entity.pdbx_description   'Cytochrome b'
#
loop_
_entity_poly.entity_id
1
#
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_alt_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_entity_id
_atom_site.label_seq_id
_atom_site.pdbx_PDB_ins_code
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.occupancy
_atom_site.B_iso_or_equiv
_atom_site.auth_seq_id
_atom_site.auth_comp_id
_atom_site.auth_asym_id
_atom_site.auth_atom_id
_atom_site.pdbx_PDB_model_num
ATOM   1 N N   . MET A 1 1 ? 1.000 2.000 3.000 1.00 10.00 1 MET AJ N   1
ATOM   2 C CA  . MET A 1 1 ? 2.000 2.000 3.000 1.00 11.00 1 MET AJ CA  1
ATOM   3 C CA  B MET A 1 1 ? 9.000 9.000 9.000 0.50 11.00 1 MET AJ CA  1
HETATM 4 C "C1'" . HEM B 2 . ? 4.000 5.000 6.000 1.00 20.00 401 HEM AJ "C1'" 1
ATOM   5 C CA  . GLY C 1 1 ? 7.000 8.000 9.000 1.00 12.00 1 GLY B CA  1
ATOM   6 C CA  . GLY C 1 1 ? 0.000 0.000 0.000 1.00 12.00 1 GLY B CA  2
#
"""


def test_read_categories_loop_and_key_value():
    tables = read_categories(CIF, {"_entity", "_atom_site"})
    assert tables["_entity"] == {"id": ["1"], "pdbx_description": ["Cytochrome b"]}
    assert tables["_atom_site"]["auth_atom_id"][3] == "C1'"
    assert len(tables["_atom_site"]["Cartn_x"]) == 6


def test_parse_mmcif_first_model_first_altloc():
    atoms, molecules = parse_mmcif(CIF)
    # Conformation B et second modèle ignorés
    assert [(a["chain"], a["name"], a["resi"]) for a in atoms] == [
        ("AJ", "N", 1), ("AJ", "CA", 1), ("AJ", "C1'", 401), ("B", "CA", 1)
    ]
    assert molecules == {"AJ": "Cytochrome b", "B": "Cytochrome b"}
    # Ligne PDB : chaîne d'un caractère, coordonnées aux bonnes colonnes
    line = atoms[1]["line"]
    assert line.startswith("ATOM") and line[12:16] == " CA " and line[17:20] == "MET"
    assert len(line[21].strip()) == 1 and line[21] != "B"
    assert float(line[30:38]) == 2.0 and int(line[22:26]) == 1
    assert atoms[2]["record"] == "HETATM" and atoms[2]["line"][17:20] == "HEM"


def test_parse_atoms_from_pdb_and_mmcif_agree():
    atoms, _ = parse_mmcif(CIF)
    pdb = "\n".join(a["line"] for a in atoms) + "\nEND\n"
    again = cs.parse_atoms(pdb)
    assert [(a["name"], a["resn"], a["resi"]) for a in again] == [(a["name"], a["resn"], a["resi"]) for a in atoms]
    assert all((a["coord"] == b["coord"]).all() for a, b in zip(again, atoms))


def test_read_structure_detects_format():
    atoms, molecules = cs.read_structure(CIF)
    assert len(atoms) == 4 and molecules["AJ"] == "Cytochrome b"


def test_chain_aliases_are_single_characters():
    aliases = chain_aliases(["A", "AA", "B", "AB"])
    assert aliases["A"] == "A" and aliases["B"] == "B"
    assert all(len(v) == 1 for v in aliases.values())
    assert len({aliases["AA"], aliases["AB"], "A", "B"}) == 4
