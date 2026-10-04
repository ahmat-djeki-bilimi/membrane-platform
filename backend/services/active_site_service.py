import math
from collections import defaultdict, Counter
from typing import Dict, List, Tuple

import requests


WATER_NAMES = {"HOH", "WAT", "DOD"}

IONS = {
    "NA", "K", "CL", "MG", "MN", "CA", "ZN", "FE", "CU", "CO", "NI", "CD",
    "IOD", "BR", "F", "CS", "RB", "LI", "HG", "PB", "SR", "BA", "AL"
}

COMMON_BUFFERS = {
    "PEG", "MPD", "TRS", "MES", "HEP", "BME", "DMS", "DTT", "FMT", "ACE",
    "ACT", "EDO", "GOL", "SO4", "PO4", "NO3", "CIT", "TAR", "BOG", "LDA"
}

IMPORTANT_LIGANDS = {
    # cofactors / nucleotides
    "ATP", "ADP", "AMP", "GTP", "GDP", "GMP", "NAD", "NAP", "FAD", "FMN",
    # heme / metal cofactors
    "HEM", "HEC", "HEA", "BCL", "CLA",
    # rhodopsin / retinal variants
    "RET", "RAL", "REA", "RSB", "LYR", "PSB",
    # lipids / membrane-relevant ligands
    "CLR", "CHL", "PLM", "OLA", "DHA", "LMT", "POP", "POPC", "POPE",
    # common drugs/inhibitors
    "STI", "IMN", "ANP", "AGS", "SAH", "SAM"
}

AMINO_ACIDS = {
    "ALA", "ARG", "ASN", "ASP", "CYS", "GLN", "GLU", "GLY", "HIS", "ILE",
    "LEU", "LYS", "MET", "PHE", "PRO", "SER", "THR", "TRP", "TYR", "VAL",
    "SEC", "PYL"
}

FUNCTIONAL_RESIDUES = {"ASP", "GLU", "HIS", "LYS", "ARG", "SER", "THR", "TYR", "CYS", "TRP"}
HYDROPHOBIC_RESIDUES = {"LEU", "ILE", "VAL", "PHE", "TRP", "TYR", "MET", "ALA"}


def _fetch_text(url: str) -> str:
    response = requests.get(url, timeout=40)
    response.raise_for_status()
    return response.text


def _parse_pdb_atom(line: str):
    record = line[0:6].strip()
    atom = line[12:16].strip()
    resn = line[17:20].strip()
    chain = line[21].strip() or "A"

    try:
        resi = int(line[22:26].strip())
        x = float(line[30:38])
        y = float(line[38:46])
        z = float(line[46:54])
    except Exception:
        return None

    element = line[76:78].strip() or atom[0]

    return {
        "record": record,
        "atom": atom,
        "resn": resn,
        "chain": chain,
        "resi": resi,
        "coord": (x, y, z),
        "element": element.upper(),
    }


def _distance(a, b) -> float:
    return math.sqrt(
        (a[0] - b[0]) ** 2 +
        (a[1] - b[1]) ** 2 +
        (a[2] - b[2]) ** 2
    )


def _center(coords: List[Tuple[float, float, float]]):
    if not coords:
        return (0.0, 0.0, 0.0)

    return (
        sum(c[0] for c in coords) / len(coords),
        sum(c[1] for c in coords) / len(coords),
        sum(c[2] for c in coords) / len(coords),
    )


def _is_ligand_candidate(resn: str) -> bool:
    resn = resn.upper().strip()

    if resn in IMPORTANT_LIGANDS:
        return True

    if resn in WATER_NAMES:
        return False

    if resn in IONS:
        return False

    if resn in COMMON_BUFFERS:
        return False

    if resn in AMINO_ACIDS:
        return False

    return True


def _merge_ranges(residues: List[int], label: str, color: str):
    if not residues:
        return []

    residues = sorted(set(residues))
    ranges = []
    start = residues[0]
    end = residues[0]

    for r in residues[1:]:
        if r == end + 1:
            end = r
        else:
            ranges.append({"start": start, "end": end, "label": label, "color": color})
            start = end = r

    ranges.append({"start": start, "end": end, "label": label, "color": color})
    return ranges


def _nearby_residues_for_atoms(protein_atoms, ligand_atoms, cutoff: float):
    residue_hits = {}

    for lig_atom in ligand_atoms:
        for prot_atom in protein_atoms:
            d = _distance(lig_atom["coord"], prot_atom["coord"])

            if d <= cutoff:
                key = (prot_atom["chain"], prot_atom["resi"], prot_atom["resn"])
                if key not in residue_hits or d < residue_hits[key]:
                    residue_hits[key] = d

    return [
        {
            "chain": c,
            "resi": r,
            "resn": rn,
            "distance": round(dist, 2),
            "label": f"{rn}{r}",
        }
        for (c, r, rn), dist in sorted(residue_hits.items(), key=lambda item: item[1])
    ]


def _detect_covalent_modified_residues(protein_atoms):
    """
    Fallback expert :
    Certaines molécules biologiques, comme le retinal de la rhodopsine,
    peuvent être annotées comme résidu modifié ou liaison covalente.
    On repère ici les HETATM importants et les résidus fonctionnels autour.
    """
    modified = defaultdict(list)

    for atom in protein_atoms:
        resn = atom["resn"].upper()
        if resn not in AMINO_ACIDS and resn not in WATER_NAMES and resn not in IONS:
            modified[(resn, atom["chain"], atom["resi"])].append(atom)

    return modified


def _predict_functional_pocket(protein_atoms, max_residues: int = 18):
    """
    Fallback sans ligand :
    prédiction simple de poche fonctionnelle basée sur :
    - résidus fonctionnels
    - résidus hydrophobes
    - densité locale autour du centre de la protéine
    Ce n'est pas une preuve expérimentale, c'est une prédiction.
    """
    residues = defaultdict(list)

    for atom in protein_atoms:
        if atom["atom"] == "CA":
            residues[(atom["chain"], atom["resi"], atom["resn"])].append(atom)

    ca_atoms = [atoms[0] for atoms in residues.values() if atoms]
    if not ca_atoms:
        return []

    center = _center([a["coord"] for a in ca_atoms])

    candidates = []

    for (chain, resi, resn), atoms in residues.items():
        atom = atoms[0]
        d_center = _distance(atom["coord"], center)

        score = 0.0

        if resn in FUNCTIONAL_RESIDUES:
            score += 3.0

        if resn in HYDROPHOBIC_RESIDUES:
            score += 1.2

        # Plus proche du centre = souvent plus susceptible d'être dans une poche interne
        score += max(0, 5.0 - d_center / 8.0)

        # Densité locale approximative
        neighbors = 0
        for other in ca_atoms:
            if other is atom:
                continue
            if _distance(atom["coord"], other["coord"]) <= 10.0:
                neighbors += 1

        score += min(3.0, neighbors / 5.0)

        if score >= 3.5:
            candidates.append(
                {
                    "chain": chain,
                    "resi": resi,
                    "resn": resn,
                    "distance": round(d_center, 2),
                    "label": f"{resn}{resi}",
                    "pocket_score": round(score, 2),
                }
            )

    candidates.sort(key=lambda x: x["pocket_score"], reverse=True)
    return candidates[:max_residues]


def detect_active_site(pdb_id: str, cutoff: float = 5.0) -> Dict:
    pdb_id = pdb_id.upper().strip()
    pdb_url = f"https://files.rcsb.org/download/{pdb_id}.pdb"

    result = {
        "pdb_id": pdb_id,
        "cutoff": cutoff,
        "mode": "ligand_based",
        "ligands": [],
        "active_site_residues": [],
        "highlight_ranges": [],
        "predicted_pocket": [],
        "interpretation": "Aucun ligand pertinent détecté pour définir un site actif.",
        "confidence": "low",
    }

    try:
        pdb_text = _fetch_text(pdb_url)

        protein_atoms = []
        ligand_atoms = defaultdict(list)
        het_residue_names = Counter()

        for line in pdb_text.splitlines():
            if not (line.startswith("ATOM") or line.startswith("HETATM")):
                continue

            parsed = _parse_pdb_atom(line)
            if not parsed:
                continue

            if parsed["record"] == "ATOM":
                protein_atoms.append(parsed)

            elif parsed["record"] == "HETATM":
                het_residue_names[parsed["resn"]] += 1

                if _is_ligand_candidate(parsed["resn"]):
                    lig_key = (parsed["resn"], parsed["chain"], parsed["resi"])
                    ligand_atoms[lig_key].append(parsed)

        ligands = []
        all_active_residues = []

        for (resn, chain, resi), atoms in ligand_atoms.items():
            residues = _nearby_residues_for_atoms(protein_atoms, atoms, cutoff)

            if residues:
                all_active_residues.extend([r["resi"] for r in residues])

            ligands.append(
                {
                    "name": resn,
                    "chain": chain,
                    "resi": resi,
                    "atom_count": len(atoms),
                    "nearby_residues": residues[:60],
                    "type": "known_important" if resn in IMPORTANT_LIGANDS else "hetero_ligand",
                }
            )

        if ligands and all_active_residues:
            result["ligands"] = ligands
            result["active_site_residues"] = sorted(set(all_active_residues))
            result["highlight_ranges"] = _merge_ranges(
                all_active_residues,
                "Ligand-binding pocket",
                "#e11d48",
            )
            result["confidence"] = "high"
            result["interpretation"] = (
                f"{len(ligands)} ligand(s) détecté(s). "
                f"{len(set(all_active_residues))} résidu(s) sont situés à moins de {cutoff} Å. "
                "La poche est définie par proximité structurale avec un ligand PDB réel."
            )
            return result

        # Fallback expert : poche prédite sans ligand classique
        predicted = _predict_functional_pocket(protein_atoms)

        if predicted:
            residues = [r["resi"] for r in predicted]

            result["mode"] = "predicted_pocket"
            result["predicted_pocket"] = predicted
            result["active_site_residues"] = sorted(set(residues))
            result["highlight_ranges"] = _merge_ranges(
                residues,
                "Predicted functional pocket",
                "#7c3aed",
            )
            result["confidence"] = "medium"
            result["interpretation"] = (
                "Aucun ligand PDB classique n’a été détecté. "
                "Une poche fonctionnelle prédite est proposée à partir des résidus fonctionnels, "
                "hydrophobes et de la densité structurale locale. Cette prédiction doit être interprétée "
                "comme hypothèse, pas comme preuve expérimentale."
            )
        else:
            result["mode"] = "none"
            result["confidence"] = "low"
            result["interpretation"] = (
                "Aucun ligand pertinent ni poche fonctionnelle robuste n’a été détecté automatiquement. "
                "Il faut vérifier les annotations UniProt, la littérature ou utiliser un outil spécialisé de détection de cavités."
            )

        result["ligands"] = ligands
        result["detected_het_groups"] = dict(het_residue_names)

        return result

    except Exception as e:
        result["error"] = str(e)
        result["mode"] = "error"
        result["interpretation"] = "Erreur pendant l’analyse du site actif."
        return result
