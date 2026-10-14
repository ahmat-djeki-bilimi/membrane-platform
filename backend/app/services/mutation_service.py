"""
Analyse d'une substitution d'acide aminé (« mutation in silico »).

Pour un résidu d'une entrée UniProt et un acide aminé proposé, rassemble :
1. les changements de propriétés physico-chimiques (hydropathie, volume,
   charge, BLOSUM62, distance de Grantham) ;
2. la conservation évolutive à cette position (calcul de conservation de la
   plateforme : grade, acides aminés observés chez les homologues) ;
3. l'environnement structural dans le modèle AlphaFold (confiance,
   enfouissement, structure secondaire, segment membranaire) ;
4. les contacts locaux et leur nature (pont salin, liaison hydrogène,
   disulfure, empilement aromatique, contact hydrophobe) ;
5. les annotations fonctionnelles à la position ou à proximité (sites,
   variants documentés, modifications, domaines).

Les conséquences possibles sont formulées comme des hypothèses, avec leurs
arguments et la manière de les vérifier. Aucun verdict (« délétère »,
« neutre ») n'est rendu : ces règles ne prédisent pas l'effet d'une mutation.
"""

import math

import numpy as np

from app import jobs
from app.services import uniprot_service
from app.services.alignment import BLOSUM62
from app.services.alphafold_service import get_alphafold
from app.services.functional_annotation_service import functional_sites, functional_variants, interpro_matches
from app.services.membrane_orientation_service import KYTE_DOOLITTLE
from app.services.model_analysis_service import geometry_summary, model_residues
from app.services.structure_comparison_service import fetch_alphafold_pdb
from app.services.topology_comparison_service import EVIDENCE_LABELS, evidence_of

AMINO_ACIDS = "ACDEFGHIKLMNPQRSTVWY"
NAMES = {
    "A": "alanine", "R": "arginine", "N": "asparagine", "D": "aspartate", "C": "cystéine", "Q": "glutamine", "E": "glutamate",
    "G": "glycine", "H": "histidine", "I": "isoleucine", "L": "leucine", "K": "lysine", "M": "méthionine", "F": "phénylalanine",
    "P": "proline", "S": "sérine", "T": "thréonine", "W": "tryptophane", "Y": "tyrosine", "V": "valine",
}
# Volumes des résidus (Å³, Zamyatnin 1972)
VOLUME = {
    "A": 88.6, "R": 173.4, "N": 114.1, "D": 111.1, "C": 108.5, "Q": 143.8, "E": 138.4, "G": 60.1, "H": 153.2, "I": 166.7,
    "L": 166.7, "K": 168.6, "M": 162.9, "F": 189.9, "P": 112.7, "S": 89.0, "T": 116.1, "W": 227.8, "Y": 193.6, "V": 140.0,
}
CHARGE = {"D": -1, "E": -1, "K": 1, "R": 1}
CLASSES = {
    **{a: "hydrophobe" for a in "AVILMFWC"},
    **{a: "polaire" for a in "STNQYH"},
    **{a: "chargé" for a in "DEKR"},
    "G": "particulier (flexible)",
    "P": "particulier (rigide)",
}
# Grantham (1974) : composition, polarité, volume ; distance = 50,723 × √(α Δc² + β Δp² + γ Δv²)
GRANTHAM_C = {"S": 1.42, "R": 0.65, "L": 0, "P": 0.39, "T": 0.71, "A": 0, "V": 0, "G": 0.74, "I": 0, "F": 0, "Y": 0.20, "C": 2.75, "H": 0.58, "Q": 0.89, "N": 1.33, "K": 0.33, "D": 1.38, "E": 0.92, "M": 0, "W": 0.13}
GRANTHAM_P = {"S": 9.2, "R": 10.5, "L": 4.9, "P": 8.0, "T": 8.6, "A": 8.1, "V": 5.9, "G": 9.0, "I": 5.2, "F": 5.2, "Y": 6.2, "C": 5.5, "H": 10.4, "Q": 10.5, "N": 11.6, "K": 11.3, "D": 13.0, "E": 12.3, "M": 5.7, "W": 5.4}
GRANTHAM_V = {"S": 32, "R": 124, "L": 111, "P": 32.5, "T": 61, "A": 31, "V": 84, "G": 3, "I": 111, "F": 132, "Y": 136, "C": 55, "H": 96, "Q": 85, "N": 56, "K": 119, "D": 54, "E": 83, "M": 105, "W": 170}

# Atomes des chaînes latérales
DONOR_ACCEPTOR = {"N", "O"}
NEGATIVE_ATOMS = {"OD1", "OD2", "OE1", "OE2"}
POSITIVE_ATOMS = {"NZ", "NH1", "NH2", "NE", "ND1", "NE2"}
AROMATIC_ATOMS = {"CG", "CD1", "CD2", "CE1", "CE2", "CZ", "CE3", "CZ2", "CZ3", "CH2", "NE1", "ND1", "NE2"}
BACKBONE = {"N", "CA", "C", "O"}
# Chaînes latérales capables de liaisons hydrogène
HBOND_SIDE_CHAIN = set("STNQDEKRHYWC")

CONTACT_DISTANCE = 4.5
SITE_PROXIMITY = 6.0
BURIED, EXPOSED = 22, 14  # voisins Cβ à 10 Å (mêmes seuils que l'Explorateur)
CONSERVATION_VERSION = 4  # CONSERVATION_METHOD_VERSION du routeur évolution

LIMITS = [
    "Ces règles décrivent les propriétés de la substitution et de son environnement : elles ne prédisent pas l’effet de la mutation.",
    "L’environnement est lu dans un modèle AlphaFold de la protéine seule (sans partenaire, ligand, lipide ni autre conformation).",
    "Une position conservée peut tolérer certaines substitutions, et une position variable peut être critique dans cette protéine précise.",
    "Seule l’expérience (expression, stabilité, activité, liaison) ou un prédicteur dédié et validé (par ex. sur des données de mutagenèse profonde) permet de conclure.",
]


class MutationError(ValueError):
    pass


# ---------------------------------------------------------------------------
# 1. Propriétés
# ---------------------------------------------------------------------------

def grantham(a: str, b: str) -> int:
    value = 50.723 * math.sqrt(
        1.833 * (GRANTHAM_C[a] - GRANTHAM_C[b]) ** 2 + 0.1018 * (GRANTHAM_P[a] - GRANTHAM_P[b]) ** 2 + 0.000399 * (GRANTHAM_V[a] - GRANTHAM_V[b]) ** 2
    )
    return int(round(value))


def grantham_class(distance: int) -> str:
    # Li et al. (1984)
    if distance <= 50:
        return "conservatrice"
    if distance <= 100:
        return "modérément conservatrice"
    if distance <= 150:
        return "modérément radicale"
    return "radicale"


def property_change(wild: str, mutant: str) -> dict:
    distance = grantham(wild, mutant)
    return {
        "wild": {"aa": wild, "name": NAMES[wild], "class": CLASSES[wild], "hydropathy": KYTE_DOOLITTLE[wild], "volume": VOLUME[wild], "charge": CHARGE.get(wild, 0)},
        "mutant": {"aa": mutant, "name": NAMES[mutant], "class": CLASSES[mutant], "hydropathy": KYTE_DOOLITTLE[mutant], "volume": VOLUME[mutant], "charge": CHARGE.get(mutant, 0)},
        "delta_hydropathy": round(KYTE_DOOLITTLE[mutant] - KYTE_DOOLITTLE[wild], 1),
        "delta_volume": round(VOLUME[mutant] - VOLUME[wild], 1),
        "delta_charge": CHARGE.get(mutant, 0) - CHARGE.get(wild, 0),
        "class_change": CLASSES[wild] != CLASSES[mutant],
        "blosum62": BLOSUM62[wild][mutant],
        "grantham": distance,
        "grantham_class": grantham_class(distance),
    }


# ---------------------------------------------------------------------------
# 2. Conservation
# ---------------------------------------------------------------------------

def conservation_at(accession: str, position: int) -> dict:
    """Conservation à la position (calcul en file de la plateforme : statut si pas encore prêt)."""
    try:
        job = jobs.submit("conservation", {"accession": accession, "source": "uniref50", "version": CONSERVATION_VERSION})
    except Exception as error:
        return {"status": "failed", "error": str(error)[:200]}
    if job["status"] != "succeeded":
        return {"status": job["status"], "error": job.get("error")}
    result = job["result"] or {}
    point = next((p for p in result.get("positions", []) if p["position"] == position), None)
    if point is None:
        return {"status": "succeeded", "available": False}
    return {
        "status": "succeeded",
        "available": True,
        "grade": point["grade"],
        "score": point["score"],
        "gap_fraction": point["gap_fraction"],
        "wild_frequency": point.get("query_residue_frequency"),
        "observed": point.get("top_residues", []),
        "sequences": result.get("sequence_count"),
        "method": result.get("method"),
    }


def mutant_frequency(conservation: dict, mutant: str) -> float | None:
    if not conservation.get("available"):
        return None
    return next((r["frequency"] for r in conservation["observed"] if r["residue"] == mutant), 0.0)


# ---------------------------------------------------------------------------
# 3–4. Environnement structural et contacts
# ---------------------------------------------------------------------------

def _distance(a, b) -> float:
    return float(np.linalg.norm(np.asarray(a) - np.asarray(b)))


def _side_atoms(residue: dict) -> dict:
    side = {k: v for k, v in residue["atoms"].items() if k not in BACKBONE}
    return side or {"CA": residue["atoms"]["CA"]}


def classify_contacts(target: dict, residues: list[dict], mutant: str) -> list[dict]:
    """Résidus en contact avec la chaîne latérale du résidu étudié, et nature probable du contact."""
    wild = target["aa"]
    side = _side_atoms(target)
    contacts = []
    for other in residues:
        if abs(other["resi"] - target["resi"]) < 2:
            continue
        pairs = [(na, ca, nb, cb) for na, ca in side.items() for nb, cb in other["atoms"].items()]
        distances = [(na, nb, _distance(ca, cb)) for na, ca, nb, cb in pairs]
        close = [d for d in distances if d[2] <= CONTACT_DISTANCE]
        if not close:
            continue
        kinds = []
        if any(na in NEGATIVE_ATOMS and nb in POSITIVE_ATOMS or na in POSITIVE_ATOMS and nb in NEGATIVE_ATOMS for na, nb, d in close if d <= 4.0) and wild in "DEKRH":
            kinds.append("pont salin")
        if wild == "C" and other["aa"] == "C" and any(na == "SG" and nb == "SG" and d <= 2.5 for na, nb, d in close):
            kinds.append("pont disulfure")
        if any(na[0] in DONOR_ACCEPTOR and nb[0] in DONOR_ACCEPTOR and d <= 3.5 for na, nb, d in close):
            kinds.append("liaison hydrogène")
        if wild in "FYWH" and other["aa"] in "FYWH" and any(na in AROMATIC_ATOMS and nb in AROMATIC_ATOMS and d <= 4.5 for na, nb, d in close):
            kinds.append("empilement aromatique")
        if wild in "AVILMFWCP" and other["aa"] in "AVILMFWCP" and any(na[0] == "C" and nb[0] == "C" for na, nb, d in close):
            kinds.append("contact hydrophobe")
        # Le contact peut-il être conservé par l'acide aminé proposé ?
        at_risk = []
        if "pont salin" in kinds and CHARGE.get(mutant, 0) != CHARGE.get(wild, 0):
            at_risk.append("pont salin")
        if "pont disulfure" in kinds and mutant != "C":
            at_risk.append("pont disulfure")
        if "liaison hydrogène" in kinds and mutant not in HBOND_SIDE_CHAIN and any(na[0] in DONOR_ACCEPTOR and na not in BACKBONE for na, nb, d in close):
            at_risk.append("liaison hydrogène")
        if "empilement aromatique" in kinds and mutant not in "FYWH":
            at_risk.append("empilement aromatique")
        contacts.append(
            {
                "resi": other["resi"],
                "aa": other["aa"],
                "distance": round(min(d for _, _, d in close), 1),
                "kinds": kinds or ["contact de van der Waals"],
                "at_risk": at_risk,
                "plddt": other["plddt"],
            }
        )
    return sorted(contacts, key=lambda c: c["distance"])


def structural_environment(accession: str, position: int, sequence: str, mutant: str) -> dict:
    try:
        model = get_alphafold(accession)
        text = fetch_alphafold_pdb(model["pdb_url"]) if model.get("available") and model.get("pdb_url") else None
    except Exception:
        text, model = None, {}
    if not text:
        return {"available": False, "reason": "Aucun modèle AlphaFold pour cette entrée."}
    if (model.get("sequence") or "") != sequence:
        return {"available": False, "reason": "Le modèle AlphaFold a été calculé sur une autre version de la séquence : numérotation non fiable."}
    _, residues = model_residues(text)
    target = next((r for r in residues if r["resi"] == position), None)
    if target is None:
        return {"available": False, "reason": "Résidu absent du modèle."}

    cb = {r["resi"]: np.asarray(r["atoms"].get("CB") or r["atoms"]["CA"]) for r in residues if "CA" in r["atoms"]}
    neighbours = sum(1 for k, v in cb.items() if k != position and np.linalg.norm(v - cb[position]) < 10.0)
    secondary = geometry_summary(residues, target["chain"])["secondary"]
    index = next(k for k, r in enumerate(residues) if r["resi"] == position)
    state = {"H": "hélice α", "E": "brin β", "C": "boucle ou coude"}[secondary[index]]
    return {
        "available": True,
        "model_id": model.get("model_id"),
        "plddt": target["plddt"],
        "reliable": (target["plddt"] or 0) >= 70,
        "neighbours": neighbours,
        "burial": "enfoui" if neighbours >= BURIED else "exposé" if neighbours <= EXPOSED else "intermédiaire",
        "secondary": state,
        "contacts": classify_contacts(target, residues, mutant),
        "_residues": residues,
    }


def membrane_context(entry: dict, position: int) -> dict:
    """Segment transmembranaire ou côté de la membrane (annotations UniProt)."""
    for feature in entry.get("features", []):
        kind = feature.get("type")
        location = feature.get("location") or {}
        start, end = (location.get("start") or {}).get("value"), (location.get("end") or {}).get("value")
        if not start or not end or not start <= position <= end:
            continue
        if kind in ("Transmembrane", "Intramembrane"):
            half = (end - start) / 2
            depth = 1 - abs(position - (start + end) / 2) / max(half, 1)
            return {
                "zone": "transmembranaire" if kind == "Transmembrane" else "intramembranaire",
                "segment": f"{start}–{end}",
                # 1 : milieu du segment (cœur de la bicouche) ; 0 : extrémité (interface)
                "depth": round(depth, 2),
                "core": depth >= 0.4,
                "evidence_label": EVIDENCE_LABELS[evidence_of(feature)],
            }
        if kind == "Topological domain":
            return {"zone": "hors membrane", "side": feature.get("description"), "evidence_label": EVIDENCE_LABELS[evidence_of(feature)]}
    return {"zone": "inconnue"}


# ---------------------------------------------------------------------------
# 5. Annotations
# ---------------------------------------------------------------------------

PTM_TYPES = {"Modified residue", "Glycosylation", "Lipidation", "Disulfide bond", "Cross-link"}


def merge_sites(sites: list[dict]) -> list[dict]:
    """Un site par (type, position) : les ligands d'un même résidu sont réunis."""
    merged: dict[tuple, dict] = {}
    for site in sites:
        key = (site["type"], site["start"], site["end"])
        if key not in merged:
            merged[key] = {**site, "ligands": [site["ligand"]] if site["ligand"] else []}
            continue
        current = merged[key]
        if site["ligand"] and site["ligand"] not in current["ligands"]:
            current["ligands"].append(site["ligand"])
        current["experimental"] = current["experimental"] or site["experimental"]
        if site["experimental"]:
            current["evidence_label"] = site["evidence_label"]
        current["references"] = (current["references"] + [r for r in site["references"] if r not in current["references"]])[:8]
    for site in merged.values():
        site["ligand"] = ", ".join(site["ligands"]) or None
    return list(merged.values())


def annotations_at(entry: dict, accession: str, position: int, mutant: str, residues: list[dict] | None) -> dict:
    sites = merge_sites(functional_sites(entry))
    variants = functional_variants(entry)

    # Sites proches dans l'espace (atomes à moins de 6 Å), pas seulement dans la séquence
    near_3d: set[int] = set()
    if residues:
        target = next((r for r in residues if r["resi"] == position), None)
        if target:
            atoms = np.array(list(target["atoms"].values()))
            for r in residues:
                other = np.array(list(r["atoms"].values()))
                if np.min(np.linalg.norm(atoms[:, None, :] - other[None, :, :], axis=-1)) <= SITE_PROXIMITY:
                    near_3d.add(r["resi"])
    at_site = [s for s in sites if s["start"] <= position <= s["end"]]
    nearby = [
        {**s, "proximity": "3D" if any(s["start"] <= n <= s["end"] for n in near_3d) else "séquence"}
        for s in sites
        if s not in at_site and (any(s["start"] <= n <= s["end"] for n in near_3d) or abs(s["start"] - position) <= 3)
    ]

    ptms = []
    for feature in entry.get("features", []):
        if feature.get("type") not in PTM_TYPES:
            continue
        location = feature.get("location") or {}
        start, end = (location.get("start") or {}).get("value"), (location.get("end") or {}).get("value")
        # Pont disulfure : seules ses deux cystéines comptent
        hit = position in (start, end) if feature.get("type") == "Disulfide bond" else bool(start and end and start <= position <= end)
        if hit:
            ptms.append({"type": feature.get("type"), "description": feature.get("description"), **{"evidence_label": EVIDENCE_LABELS[evidence_of(feature)], "experimental": evidence_of(feature) in ("experimental", "structure")}})

    documented = [v for v in variants if v["start"] <= position <= v["end"]]
    same = [v for v in documented if mutant in v["alternatives"]]
    try:
        domains = [e for e in interpro_matches(accession)["entries"] if any(l["start"] <= position <= l["end"] for l in e["locations"]) and e["database"] in ("interpro", "pfam", "prosite", "profile", "smart")]
    except Exception:
        domains = []
    return {
        "at_site": at_site,
        "nearby_sites": nearby,
        "ptms": ptms,
        "documented_variants": documented,
        "same_substitution": same,
        "domains": [{"database": d["database_label"], "accession": d["accession"], "name": d["name"]} for d in domains],
    }


# ---------------------------------------------------------------------------
# Hypothèses
# ---------------------------------------------------------------------------

def _h(kind: str, title: str, text: str, test: str | None = None) -> dict:
    return {"kind": kind, "title": title, "text": text, "test": test}


def hypotheses(wild: str, mutant: str, props: dict, conservation: dict, environment: dict, membrane: dict, notes: dict) -> list[dict]:
    """Arguments pour (« attention ») ou contre (« modéré ») un effet, toujours au conditionnel."""
    out = []
    frequency = mutant_frequency(conservation, mutant)
    if conservation.get("available"):
        grade = conservation["grade"]
        if grade >= 8 and (frequency or 0) < 0.01:
            out.append(_h("attention", "Position très conservée", f"Grade {grade}/9 et {NAMES[mutant]} n’est pas observée chez les homologues : la substitution pourrait être mal tolérée par la famille.", "Comparer l’expression et l’activité du mutant à celles de la protéine sauvage."))
        elif (frequency or 0) >= 0.05:
            out.append(_h("modere", "Substitution présente dans la famille", f"{NAMES[mutant].capitalize()} est observée chez {round(frequency * 100)} % des homologues à cette position : elle est compatible avec ce repliement, ce qui ne garantit pas une fonction identique ici."))
        elif grade <= 3:
            out.append(_h("modere", "Position variable", f"Grade {grade}/9 : la position change souvent au cours de l’évolution ; une contrainte forte y est moins probable."))
    if environment.get("available"):
        buried = environment["burial"] == "enfoui"
        if buried and props["delta_volume"] >= 40:
            out.append(_h("attention", "Encombrement possible", f"Résidu enfoui et chaîne latérale plus volumineuse (+{props['delta_volume']:.0f} Å³) : risque de gêne stérique avec les résidus voisins.", "Mesurer la stabilité (dénaturation thermique) ou modéliser le mutant."))
        if buried and props["delta_volume"] <= -40:
            out.append(_h("attention", "Cavité possible", f"Résidu enfoui et chaîne latérale plus petite ({props['delta_volume']:.0f} Å³) : une cavité pourrait réduire la stabilité.", "Mesurer la stabilité du mutant."))
        wild_charge, mutant_charge = props["wild"]["charge"], props["mutant"]["charge"]
        if buried and wild_charge and mutant_charge and wild_charge != mutant_charge:
            out.append(_h("attention", "Inversion de charge", "Charge de signe opposé dans une région enfouie : les interactions électrostatiques locales seraient inversées."))
        elif buried and mutant_charge and not wild_charge:
            out.append(_h("attention", "Charge enfouie", "Une charge introduite dans une région enfouie est coûteuse en énergie sauf si un partenaire la compense."))
        elif buried and wild_charge and not mutant_charge:
            out.append(_h("incertain", "Charge enfouie supprimée", "Une charge enfouie est rarement là par hasard (pont salin, site, transfert de proton) : la retirer pourrait toucher ce rôle."))
        if environment["secondary"] == "hélice α" and mutant == "P" and wild != "P":
            out.append(_h("attention", "Proline dans une hélice", "La proline casse ou coude les hélices α : la géométrie locale pourrait changer.", "Vérifier la structure secondaire (dichroïsme circulaire) ou modéliser le mutant."))
        if environment["secondary"] == "hélice α" and mutant == "G" and wild != "G":
            out.append(_h("attention", "Glycine dans une hélice", "La glycine rend l’hélice plus flexible et moins stable."))
        if wild in "GP" and mutant not in "GP":
            out.append(_h("attention", f"{NAMES[wild].capitalize()} remplacée", f"La {NAMES[wild]} donne souvent une géométrie particulière (coude, charnière) que l’acide aminé proposé ne reproduit pas."))
        for contact in environment["contacts"]:
            for kind in contact["at_risk"]:
                out.append(_h("attention", f"{kind.capitalize()} avec {contact['aa']}{contact['resi']}", f"Dans le modèle, le résidu forme un(e) {kind} avec {contact['aa']}{contact['resi']} ({contact['distance']} Å) que {NAMES[mutant]} ne peut probablement pas maintenir."))
        if not environment["reliable"]:
            out.append(_h("incertain", "Environnement incertain", f"pLDDT {round(environment['plddt'] or 0)} : le modèle est peu fiable ici (région souvent mobile ou désordonnée) ; les arguments structuraux sont fragiles."))
        if environment["burial"] == "exposé" and props["grantham"] <= 100 and not notes["at_site"]:
            out.append(_h("modere", "Résidu exposé, substitution modérée", "Les substitutions modérées en surface sont souvent mieux tolérées, sauf si la surface sert d’interface avec un partenaire."))
    if membrane.get("zone") == "transmembranaire" and membrane.get("core"):
        # Groupe polaire nouveau seulement si le résidu d'origine était apolaire
        if (props["mutant"]["charge"] != 0 or mutant in "NQ") and props["wild"]["class"] not in ("chargé", "polaire"):
            out.append(_h("attention", "Polarité au cœur de la membrane", f"Introduire {NAMES[mutant]} au milieu d’un segment transmembranaire expose un groupe polaire aux lipides : insertion ou orientation du segment possiblement modifiées.", "Vérifier l’adressage à la membrane et la topologie du mutant."))
        if props["wild"]["charge"] != 0 or wild in "NQ":
            out.append(_h("attention", "Résidu polaire conservé dans la membrane ?", f"Un résidu {props['wild']['class']} au cœur de la membrane a souvent un rôle (transport, liaison, interaction entre hélices) : le remplacer pourrait toucher ce rôle."))
    if wild == "C" and any(p["type"] == "Disulfide bond" for p in notes["ptms"]):
        out.append(_h("attention", "Pont disulfure annoté", "Cette cystéine forme un pont disulfure annoté : il serait rompu."))
    if mutant == "C" and wild != "C":
        out.append(_h("incertain", "Cystéine introduite", "Une cystéine libre peut former des ponts disulfure non natifs ou être oxydée."))
    for site in notes["at_site"]:
        out.append(_h("attention", f"{site['type']} annoté à cette position", f"{site['type']}{(' (' + site['ligand'] + ')') if site['ligand'] else ''} — preuve : {site['evidence_label'].lower()}. Le rôle de la position pourrait être touché.", "Mesurer l’activité ou la liaison du ligand."))
    if notes["nearby_sites"]:
        names = ", ".join(f"{s['type'].lower()} {s['start']}" for s in notes["nearby_sites"][:4])
        out.append(_h("incertain", "Proche d’un site annoté", f"À proximité de : {names}. Un effet indirect sur ce site est possible."))
    for ptm in notes["ptms"]:
        if ptm["type"] != "Disulfide bond":
            out.append(_h("attention", "Modification annotée à cette position", f"{ptm['type']} : {ptm['description'] or ''} ({ptm['evidence_label'].lower()}). La modification pourrait ne plus être possible."))
    for variant in notes["same_substitution"]:
        out.append(_h("documente", "Même substitution déjà documentée", f"{variant['kind']} {wild}{variant['start']}{mutant} : {variant['description'] or 'effet non décrit'} ({'expérimental' if variant['experimental'] else variant['evidence_label'].lower()})."))
    if props["grantham_class"] == "radicale":
        out.append(_h("incertain", "Substitution radicale", f"Distance de Grantham {props['grantham']} : propriétés très différentes ; seul le contexte (ci-dessus) dit si cela compte."))
    return out


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------

def substitution_profile(wild: str, conservation: dict) -> list[dict]:
    """Les 19 substitutions possibles à cette position, avec leurs mesures simples."""
    return [
        {
            "aa": aa,
            "blosum62": BLOSUM62[wild][aa],
            "grantham": grantham(wild, aa),
            "delta_hydropathy": round(KYTE_DOOLITTLE[aa] - KYTE_DOOLITTLE[wild], 1),
            "delta_volume": round(VOLUME[aa] - VOLUME[wild], 1),
            "homolog_frequency": mutant_frequency(conservation, aa),
        }
        for aa in AMINO_ACIDS
        if aa != wild
    ]


def analyze_mutation(accession: str, position: int, mutant: str) -> dict:
    accession, mutant = accession.upper().strip(), mutant.upper().strip()
    if mutant not in AMINO_ACIDS:
        raise MutationError("Acide aminé proposé invalide.")
    entry = uniprot_service.fetch_entry(accession)
    sequence = (entry.get("sequence") or {}).get("value") or ""
    if not 1 <= position <= len(sequence):
        raise MutationError(f"Position hors de la séquence (1 à {len(sequence)}).")
    wild = sequence[position - 1]
    if wild not in AMINO_ACIDS:
        raise MutationError(f"Résidu {wild} non standard à cette position.")
    if wild == mutant:
        raise MutationError("L’acide aminé proposé est identique au résidu sauvage.")

    props = property_change(wild, mutant)
    conservation = conservation_at(accession, position)
    environment = structural_environment(accession, position, sequence, mutant)
    residues = environment.pop("_residues", None)
    membrane = membrane_context(entry, position)
    notes = annotations_at(entry, accession, position, mutant, residues)
    return {
        "accession": accession,
        "position": position,
        "wild": wild,
        "mutant": mutant,
        "label": f"{wild}{position}{mutant}",
        "context": sequence[max(0, position - 8):position - 1].lower() + wild + sequence[position:position + 7].lower(),
        "properties": props,
        "conservation": conservation,
        "mutant_homolog_frequency": mutant_frequency(conservation, mutant),
        "environment": environment,
        "membrane": membrane,
        "annotations": notes,
        "hypotheses": hypotheses(wild, mutant, props, conservation, environment, membrane, notes),
        "profile": substitution_profile(wild, conservation),
        "limits": LIMITS,
    }
