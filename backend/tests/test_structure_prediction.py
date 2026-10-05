"""Structure prédite (ESMFold) : placement dans la membrane, interprétation, routes."""

import math

import numpy as np
import pytest

from app.services import membrane_embedding_service as me
from app.services import structure_prediction_service as sp

ONE_TO_THREE = {v: k for k, v in me.THREE_TO_ONE.items()}

# Faisceau de 4 hélices : N-terminal et boucles riches en Lys/Arg côté
# cytoplasmique (z < 0), boucles acides côté externe (z > 0)
N_TAIL = "MKRKS"
HELIX = "LWLIVALLIVLFAVLLIAVWL"
HELIX_CHARGED = "LWLIVALLIDLFAVLLIAVWL"  # Asp au cœur de la bicouche
LOOP_OUT = "GDESGN"
LOOP_IN = "GKRKRG"
C_TAIL = "SKRKE"
PARTS = [N_TAIL, HELIX, LOOP_OUT, HELIX, LOOP_IN, HELIX_CHARGED, LOOP_OUT, HELIX, C_TAIL]
SEQUENCE = "".join(PARTS)
HELIX_LENGTH = len(HELIX)


def _tm_segments():
    segments, position = [], 1
    for part in PARTS:
        if len(part) == HELIX_LENGTH:
            segments.append({"start": position, "end": position + HELIX_LENGTH - 1})
        position += len(part)
    return segments


def _rotation(ax: float, az: float) -> np.ndarray:
    a, b = math.radians(ax), math.radians(az)
    rx = np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])
    rz = np.array([[math.cos(b), -math.sin(b), 0], [math.sin(b), math.cos(b), 0], [0, 0, 1]])
    return rz @ rx


def bundle_pdb(sequence: str = SEQUENCE, rotation: np.ndarray | None = None, plddt: float = 0.85) -> str:
    """Cα d'un faisceau idéal (membrane = plan z = 0), pLDDT sur 0–1 comme ESMFold."""
    axes = [(-5.0, -5.0), (5.0, -5.0), (5.0, 5.0), (-5.0, 5.0)]
    coords, helix_index, z_end = [], 0, -15.0
    for part in PARTS:
        if len(part) == HELIX_LENGTH:
            cx, cy = axes[helix_index]
            up = helix_index % 2 == 0
            for i in range(HELIX_LENGTH):
                angle = math.radians(100 * i)
                z = -15 + 1.5 * i if up else 15 - 1.5 * i
                coords.append((cx + 2.3 * math.cos(angle), cy + 2.3 * math.sin(angle), z))
            z_end = 15.0 if up else -15.0
            helix_index += 1
        else:
            # Boucle ou extrémité hors de la bicouche, du côté de l'hélice voisine
            side = 1 if (z_end > 0 and coords) else -1
            x0, y0 = coords[-1][:2] if coords else axes[0]
            for i in range(len(part)):
                coords.append((x0 + 1.0 * i, y0 + 0.5 * i, side * (17 + 1.0 * (i % 3))))
    points = np.array(coords)
    if rotation is not None:
        points = points @ rotation.T + np.array([12.0, -7.0, 30.0])
    lines = []
    for i, (aa, (x, y, z)) in enumerate(zip(sequence, points), start=1):
        lines.append(
            f"ATOM  {i:5d}  CA  {ONE_TO_THREE[aa]} A{i:4d}    {x:8.3f}{y:8.3f}{z:8.3f}  1.00{plddt:6.2f}           C"
        )
    return "\n".join(lines + ["END"]) + "\n"


def test_parse_pdb_rescales_esmfold_plddt():
    _, residues, scale = me.parse_pdb(bundle_pdb())
    assert scale == 100.0
    assert len(residues) == len(SEQUENCE)
    assert residues[0]["aa"] == "M" and residues[0]["plddt"] == pytest.approx(85.0)


@pytest.mark.parametrize("rotation", [None, _rotation(40, 25)])
def test_embedding_recovers_membrane(rotation):
    result = me.embed_structure(bundle_pdb(rotation=rotation), SEQUENCE, _tm_segments())
    assert result["embedded"]
    membrane = result["membrane"]
    assert 24 <= membrane["thickness"] <= 36
    assert membrane["side_method"] == "positive_inside"
    assert membrane["n_terminus"] == "in"
    assert membrane["kr_inside"] > membrane["kr_outside"]
    helices = result["helices"]
    assert len(helices) == 4
    assert all(h["crosses"] and h["tilt"] < 15 for h in helices)
    assert [h["direction"] for h in helices] == ["in_to_out", "out_to_in", "in_to_out", "out_to_in"]
    # Asp du TM3, au cœur de la bicouche
    assert [r["aa"] for r in result["buried_charged"]] == ["D"]
    assert result["aromatic_belt"] and {r["aa"] for r in result["aromatic_belt"]} == {"W"}
    # Coordonnées réorientées : faces DUM de part et d'autre de z = 0
    dum = [line for line in result["pdb"].splitlines() if line.startswith("HETATM")]
    assert dum and {line[13] for line in dum} == {"O", "N"}


def test_truncated_segments_are_extended_along_the_helix():
    # Segments annotés trop courts de 5 résidus de chaque côté : leurs extrémités
    # s'arrêtent à 7,5 Å du centre, mais l'hélice réelle atteint les faces
    segments = [{"start": s["start"] + 5, "end": s["end"] - 5} for s in _tm_segments()]
    result = me.embed_structure(bundle_pdb(), SEQUENCE, segments)
    for helix, segment in zip(result["helices"], _tm_segments()):
        assert helix["crossing"] == "full"
        assert (helix["helix_start"], helix["helix_end"]) == (segment["start"], segment["end"])


def test_extend_helix_stops_outside_helices():
    _, residues, _ = me.parse_pdb(bundle_pdb())
    ca = np.array([r["ca"] for r in residues])
    first = _tm_segments()[0]
    a, b = first["start"] - 1, first["end"] - 1
    # Boucles en ligne droite : aucun tour d'hélice
    assert me.extend_helix(ca, a + 3, b - 3) == (a, b)


def test_known_topology_overrides_positive_inside():
    result = me.embed_structure(bundle_pdb(), SEQUENCE, _tm_segments(), n_terminus="out")
    assert result["membrane"]["side_method"] == "topology"
    assert result["membrane"]["n_terminus"] == "out"
    assert result["helices"][0]["direction"] == "out_to_in"


def test_offset_renumbers_residues():
    segments = [{"start": s["start"] + 100, "end": s["end"] + 100} for s in _tm_segments()]
    result = me.embed_structure(bundle_pdb(), SEQUENCE, segments, offset=100)
    assert result["residues"][0]["number"] == 101
    assert result["helices"][0]["start"] == segments[0]["start"]


def test_without_segments_structure_is_not_embedded():
    result = me.embed_structure(bundle_pdb(), SEQUENCE, [])
    assert result["embedded"] is False
    assert "HETATM" not in result["pdb"]


def test_choose_window_covers_tm_segments():
    assert sp.choose_window(300, []) == (1, 300)
    segments = [{"start": 600, "end": 620}, {"start": 700, "end": 720}]
    start, end = sp.choose_window(1000, segments, max_length=400)
    assert end - start + 1 == 400
    assert start <= 600 and end >= 720


def test_predict_structure_and_interpretation(monkeypatch):
    monkeypatch.setattr(sp, "fold_sequence", lambda seq: bundle_pdb(seq))
    result = sp.predict_structure(SEQUENCE, tm_segments=_tm_segments(), tm_source="uniprot", n_terminus="in")
    assert result["window"] == {"start": 1, "end": len(SEQUENCE), "complete": True, "max_length": sp.MAX_LENGTH}
    assert [s["label"] for s in result["tm_segments"]] == ["TM1", "TM2", "TM3", "TM4"]
    topics = [note["topic"] for note in result["interpretation"]]
    assert {"confidence", "membrane", "topology", "helices", "residues", "limits"} <= set(topics)
    topology = next(n for n in result["interpretation"] if n["topic"] == "topology")
    assert "UniProt" in topology["text"]


def test_fold_sequence_rejects_long_sequences():
    from app.services.esmfold_service import StructurePredictionError, fold_sequence

    with pytest.raises(StructurePredictionError):
        fold_sequence("A" * 401)


def test_sequence_route_runs_prediction(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    monkeypatch.setattr(sp, "fold_sequence", lambda seq: bundle_pdb(seq))
    with TestClient(app) as client:
        r = client.post(
            "/api/predicted-structure/sequence",
            json={"sequence": SEQUENCE, "tm_segments": _tm_segments(), "n_terminus": "in", "tm_source": "deeptmhmm"},
        )
        assert r.status_code == 200
        assert r.json()["tm_source"] == "deeptmhmm"
        job = client.get(f"/api/jobs/{r.json()['id']}").json()
        assert job["status"] == "succeeded", job.get("error")
        assert job["result"]["membrane"]["side_method"] == "topology"
        assert len(job["result"]["helices"]) == 4


def test_sequence_route_validation():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        assert client.post("/api/predicted-structure/sequence", json={"sequence": "MKT"}).status_code == 400
        bad = {"sequence": SEQUENCE, "tm_segments": [{"start": 10, "end": 500}]}
        assert client.post("/api/predicted-structure/sequence", json=bad).status_code == 400


def test_accession_route_uses_uniprot_topology(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    first = _tm_segments()[0]
    entry = {
        "entryType": "UniProtKB reviewed (Swiss-Prot)",
        "sequence": {"value": SEQUENCE, "length": len(SEQUENCE)},
        "features": [
            {"type": "Topological domain", "description": "Cytoplasmic",
             "location": {"start": {"value": 1}, "end": {"value": first["start"] - 1}}},
        ] + [
            {"type": "Transmembrane", "location": {"start": {"value": s["start"]}, "end": {"value": s["end"]}}}
            for s in _tm_segments()
        ],
    }
    monkeypatch.setattr("app.services.uniprot_service._fetch_entry_cached", lambda acc: entry)
    monkeypatch.setattr(sp, "fold_sequence", lambda seq: bundle_pdb(seq))
    with TestClient(app) as client:
        r = client.get("/api/predicted-structure/P99999")
        assert r.status_code == 200 and r.json()["tm_source"] == "uniprot"
        job = client.get(f"/api/jobs/{r.json()['id']}").json()
        assert job["status"] == "succeeded", job.get("error")
        assert job["result"]["membrane"]["n_terminus"] == "in"
        assert job["result"]["membrane"]["side_method"] == "topology"


# ---------------------------------------------------------------------------
# Superposition avec une structure expérimentale
# ---------------------------------------------------------------------------

def _experimental_pdb(rotation, shift=(5.0, -3.0, 8.0), offset=10, displaced=(), ligand_near=None):
    """Faisceau tourné et numéroté autrement (auteur = UniProt + offset), boucle éventuellement déplacée, ligand."""
    lines = []
    for line in bundle_pdb().splitlines():
        if not line.startswith("ATOM"):
            continue
        number = int(line[22:26])
        xyz = np.array([float(line[30:38]), float(line[38:46]), float(line[46:54])])
        if number in displaced:
            xyz = xyz + np.array([0.0, 8.0, 0.0])
        x, y, z = rotation @ xyz + np.array(shift)
        lines.append(line[:21] + "B" + f"{number + offset:4d}" + line[26:30] + f"{x:8.3f}{y:8.3f}{z:8.3f}" + line[54:])
    if ligand_near is not None:
        _, residues, _ = me.parse_pdb(bundle_pdb())
        ca = np.array(residues[ligand_near - 1]["ca"]) + np.array([2.0, 0.0, 0.0])
        x, y, z = rotation @ ca + np.array(shift)
        lines.append(f"HETATM 9001  C1  RET B 301    {x:8.3f}{y:8.3f}{z:8.3f}  1.00 20.00           C")
    return "\n".join(lines + ["END"]) + "\n"


def _mapping(offset=10):
    return {
        "available": True,
        "segments": [{"chain": "B", "unp_start": 1, "unp_end": len(SEQUENCE), "offset": offset, "linear": True}],
    }


def _prediction(monkeypatch):
    monkeypatch.setattr(sp, "fold_sequence", lambda seq: bundle_pdb(seq))
    return sp.predict_structure(SEQUENCE, tm_segments=_tm_segments(), tm_source="uniprot", n_terminus="in")


def test_kabsch_recovers_rotation():
    from app.services.structure_comparison_service import kabsch

    points = np.random.default_rng(0).normal(size=(30, 3)) * 10
    rotation = _rotation(70, -40)
    moved = points @ rotation.T + np.array([1.0, 2.0, 3.0])
    r, t = kabsch(points, moved)
    assert np.allclose(points @ r.T + t, moved, atol=1e-6)


def test_identical_structures_superpose_exactly(monkeypatch):
    from app.services.structure_comparison_service import compare_structures

    prediction = _prediction(monkeypatch)
    result = compare_structures(prediction, _experimental_pdb(_rotation(50, 120)), "1abc", _mapping())
    assert result["chain"] == "B"
    assert result["pairs"] == len(SEQUENCE)
    assert result["tm_score"] > 0.99 and result["rmsd_all"] < 0.01
    assert result["deviant_regions"] == [] and result["mutations"] == []
    assert all(h["tilt_difference"] < 1 for h in result["helices"])
    # Chaîne expérimentale renumérotée en UniProt et placée dans la membrane du modèle
    first = next(line for line in result["pdb"].splitlines() if line.startswith("ATOM"))
    assert first[21] == "E" and int(first[22:26]) == 1


def test_displaced_loop_is_reported_without_spoiling_the_core(monkeypatch):
    from app.services.structure_comparison_service import compare_structures

    prediction = _prediction(monkeypatch)
    loop = [r for r in prediction["regions"] if r["label"].startswith("Boucle")][0]
    displaced = set(range(loop["start"], loop["end"] + 1))
    result = compare_structures(prediction, _experimental_pdb(_rotation(10, 10), displaced=displaced), "1abc", _mapping())
    # Superposition sur le cœur : hélices intactes, boucle signalée
    assert result["rmsd_close"] < 0.01
    assert [(d["start"], d["end"]) for d in result["deviant_regions"]] == [(loop["start"], loop["end"])]
    stats = {r["start"]: r for r in result["regions"]}
    assert stats[loop["start"]]["mean_distance"] == pytest.approx(8.0, abs=0.01)
    assert all(r["mean_distance"] < 0.01 for r in result["regions"] if r["kind"] == "tm")


def test_experimental_ligand_site_is_transferred(monkeypatch):
    from app.services.structure_comparison_service import compare_structures

    prediction = _prediction(monkeypatch)
    result = compare_structures(prediction, _experimental_pdb(_rotation(0, 0), ligand_near=40), "1abc", _mapping())
    assert result["ligands"][0]["ligand"] == "RET"
    assert 40 in [r["number"] for r in result["ligands"][0]["residues"]]
    assert any(n["topic"] == "ligands" for n in result["interpretation"])


def test_compare_route(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app
    from app.services import structure_comparison_service as cs

    monkeypatch.setattr(sp, "fold_sequence", lambda seq: bundle_pdb(seq))
    monkeypatch.setattr(cs, "fetch_pdb_text", lambda pdb_id: _experimental_pdb(_rotation(30, 30)))
    monkeypatch.setattr(cs.sifts_service, "get_mapping", lambda pdb_id, acc: _mapping())
    with TestClient(app) as client:
        job = client.post(
            "/api/predicted-structure/sequence",
            json={"sequence": SEQUENCE, "tm_segments": _tm_segments(), "n_terminus": "in", "tm_source": "uniprot"},
        ).json()
        url = f"/api/predicted-structure/jobs/{job['id']}/compare"
        assert client.get(f"{url}/1abc").status_code == 400  # nom « query » : pas une entrée UniProt
        r = client.get(f"{url}/1abc?accession=P99999")
        assert r.status_code == 200, r.text
        assert r.json()["tm_score"] > 0.99
        assert client.get(f"{url}/not-an-id?accession=P99999").status_code in (400, 404)
        assert client.get("/api/predicted-structure/jobs/unknown/compare/1abc").status_code == 404


def test_numbering_inferred_from_sequence_when_sifts_is_incomplete():
    from app.services.structure_comparison_service import infer_segments, parse_atoms

    segments = infer_segments(parse_atoms(_experimental_pdb(_rotation(0, 0), offset=-13)), SEQUENCE)
    assert segments == [{"chain": "B", "unp_start": 1, "unp_end": len(SEQUENCE), "offset": -13, "linear": True}]


def test_alphafold_route_places_and_compares(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app
    from app.services import structure_comparison_service as cs

    entry = {
        "entryType": "UniProtKB reviewed (Swiss-Prot)",
        "sequence": {"value": SEQUENCE, "length": len(SEQUENCE)},
        "features": [
            {"type": "Transmembrane", "location": {"start": {"value": s["start"]}, "end": {"value": s["end"]}}}
            for s in _tm_segments()
        ],
    }
    # Modèle AlphaFold : pLDDT déjà sur 0–100
    alphafold_pdb = "\n".join(
        line[:60] + f"{float(line[60:66]) * 100:6.2f}" + line[66:] if line.startswith("ATOM") else line
        for line in bundle_pdb().splitlines()
    )
    monkeypatch.setattr("app.services.uniprot_service._fetch_entry_cached", lambda acc: entry)
    monkeypatch.setattr(cs, "get_alphafold", lambda acc: {"available": True, "pdb_url": "af.pdb", "sequence": SEQUENCE, "model_id": "AF-P99999-F1"})
    monkeypatch.setattr(cs, "fetch_alphafold_pdb", lambda url: alphafold_pdb)
    monkeypatch.setattr(cs, "fetch_pdb_text", lambda pdb_id: _experimental_pdb(_rotation(20, 60)))
    monkeypatch.setattr(cs.sifts_service, "get_mapping", lambda pdb_id, acc: _mapping())
    with TestClient(app) as client:
        r = client.get("/api/alphafold/P99999/compare/1abc")
        assert r.status_code == 200, r.text
        model, comparison = r.json()["model"], r.json()["comparison"]
        assert model["mean_plddt"] == pytest.approx(85.0)
        assert model["tm_source"] == "uniprot" and len(model["helices"]) == 4
        assert "AlphaFold" in model["interpretation"][-1]["text"]
        assert comparison["tm_score"] > 0.99


def test_other_chains_of_the_crystal_are_superposed_too(monkeypatch):
    from app.services.structure_comparison_service import compare_structures, molecule_names

    prediction = _prediction(monkeypatch)
    crystal = _experimental_pdb(_rotation(30, 40))
    # Deuxième copie de la protéine (chaîne C) et en-tête COMPND
    copy = [line[:21] + "C" + line[22:] for line in crystal.splitlines() if line.startswith("ATOM")]
    header = [
        "COMPND    MOL_ID: 1;",
        "COMPND   2 MOLECULE: BUNDLE PROTEIN;",
        "COMPND   3 CHAIN: B, C;",
    ]
    crystal = "\n".join(header + crystal.splitlines()[:-1] + copy + ["END"]) + "\n"
    assert molecule_names(crystal) == {"B": "BUNDLE PROTEIN", "C": "BUNDLE PROTEIN"}

    result = compare_structures(prediction, crystal, "1abc", _mapping(), chain="B")
    assert result["chain"] == "B" and result["molecule"] == "BUNDLE PROTEIN"
    assert result["other_chains"] == [{"chain": "C", "molecule": "BUNDLE PROTEIN", "residues": len(SEQUENCE), "fused": False}]
    others = [line for line in result["pdb_others"].splitlines() if line.startswith("ATOM")]
    assert len(others) == len(SEQUENCE) and all(line[21] == "C" for line in others)
