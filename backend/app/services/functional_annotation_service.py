"""
Annotation fonctionnelle d'une entrée UniProt, avec la source et la nature de
chaque information.

- Domaines et signatures : InterPro et ses bases membres (Pfam, PROSITE
  motifs et profils, SMART, CDD, PANTHER…), avec leurs positions. Ce sont
  des correspondances calculées (InterProScan) : prédictions par signature.
- Gene Ontology : termes de l'entrée UniProt et leur code de preuve GO
  (expérimental, phylogénétique, calculé, déclaratif, électronique).
- Sites : résidus catalytiques (« Active site »), sites de liaison (avec le
  ligand) et autres sites, avec leur code de preuve ECO.
- Variants : mutagenèse dirigée (expérimentale par définition) et variants
  naturels documentés, avec leur effet décrit et les références.

Une information n'est dite « expérimentale » que si son code de preuve
l'indique ; tout le reste est présenté comme prédiction ou inférence.
"""

from app import http
from app.cache import cached
from app.services import uniprot_service
from app.services.topology_comparison_service import EVIDENCE_LABELS, evidence_of

INTERPRO_API = "https://www.ebi.ac.uk/interpro/api/entry/all/protein/uniprot/{accession}/?page_size=200"
MAX_PAGES = 5

DATABASES = {
    "interpro": "InterPro",
    "pfam": "Pfam",
    "prosite": "PROSITE (motif)",
    "profile": "PROSITE (profil)",
    "smart": "SMART",
    "cdd": "CDD",
    "panther": "PANTHER",
    "cathgene3d": "CATH-Gene3D",
    "ssf": "SUPERFAMILY",
    "prints": "PRINTS",
    "pirsf": "PIRSF",
    "hamap": "HAMAP",
    "ncbifam": "NCBIfam",
    "sfld": "SFLD",
    "antifam": "AntiFam",
}
# Ordre d'affichage : InterPro puis les signatures les plus utilisées
DATABASE_ORDER = ["interpro", "pfam", "prosite", "profile", "smart", "cdd", "ncbifam", "hamap", "pirsf", "prints", "panther", "cathgene3d", "ssf", "sfld"]

# Codes de preuve Gene Ontology (geneontology.org/docs/guide-go-evidence-codes)
GO_EVIDENCE = {
    "experimental": ({"EXP", "IDA", "IPI", "IMP", "IGI", "IEP", "HTP", "HDA", "HMP", "HGI", "HEP"}, "Expérimentale"),
    "phylogenetic": ({"IBA", "IBD", "IKR", "IRD"}, "Inférée par phylogénie"),
    "computational": ({"ISS", "ISO", "ISA", "ISM", "IGC", "RCA"}, "Analyse calculée (curée)"),
    "author": ({"TAS", "NAS"}, "Déclaration d’auteur"),
    "curator": ({"IC", "ND"}, "Inférence du curateur"),
    "electronic": ({"IEA"}, "Électronique (automatique)"),
}
GO_ASPECTS = {"F": "Fonction moléculaire", "P": "Processus biologique", "C": "Composant cellulaire"}
SITE_TYPES = {"Active site": "Résidu catalytique", "Binding site": "Site de liaison", "Site": "Site fonctionnel"}
EXPERIMENTAL = {"experimental", "structure"}


# ---------------------------------------------------------------------------
# Preuves
# ---------------------------------------------------------------------------

def go_evidence(code: str) -> tuple[str, str]:
    for category, (codes, label) in GO_EVIDENCE.items():
        if code in codes:
            return category, label
    return "unknown", "Non précisée"


def _references(feature: dict) -> list[dict]:
    """Références citées par une annotation (PubMed, PDB…), sans doublon."""
    seen, refs = set(), []
    for e in feature.get("evidences") or []:
        source, identifier = e.get("source"), e.get("id")
        if source and identifier and (source, identifier) not in seen:
            seen.add((source, identifier))
            refs.append({"source": source, "id": identifier})
    return refs[:8]


def _evidence(feature: dict) -> dict:
    kind = evidence_of(feature)
    return {"evidence": kind, "evidence_label": EVIDENCE_LABELS[kind], "experimental": kind in EXPERIMENTAL, "references": _references(feature)}


def _location(feature: dict) -> tuple[int | None, int | None]:
    location = feature.get("location") or {}
    return (location.get("start") or {}).get("value"), (location.get("end") or {}).get("value")


# ---------------------------------------------------------------------------
# InterPro et bases membres
# ---------------------------------------------------------------------------

@cached("interpro:matches", ttl=30 * 24 * 3600, store_if=lambda v: v is not None)
def fetch_interpro(accession: str) -> list[dict] | None:
    url, results, pages = INTERPRO_API.format(accession=accession), [], 0
    while url and pages < MAX_PAGES:
        response = http.get(url, timeout=40)
        if response.status_code == 204:
            return []
        response.raise_for_status()
        data = response.json()
        results.extend(data.get("results") or [])
        url, pages = data.get("next"), pages + 1
    return results


def interpro_matches(accession: str) -> dict:
    try:
        raw = fetch_interpro(accession)
    except Exception as error:
        return {"available": False, "error": f"InterPro injoignable : {error}"[:200], "entries": []}
    entries = []
    for item in raw or []:
        meta = item.get("metadata") or {}
        database = meta.get("source_database")
        locations = []
        for protein in item.get("proteins") or []:
            for location in protein.get("entry_protein_locations") or []:
                for fragment in location.get("fragments") or []:
                    locations.append({"start": fragment["start"], "end": fragment["end"]})
        if not locations:
            continue
        entries.append(
            {
                "database": database,
                "database_label": DATABASES.get(database, database),
                "accession": meta.get("accession"),
                "name": meta.get("name"),
                "type": meta.get("type"),
                "integrated": meta.get("integrated"),
                "locations": sorted(locations, key=lambda l: l["start"]),
                "evidence": "Prédiction par signature (InterProScan)",
                "experimental": False,
                "link": f"https://www.ebi.ac.uk/interpro/entry/{database}/{meta.get('accession')}/",
            }
        )
    entries.sort(key=lambda e: (DATABASE_ORDER.index(e["database"]) if e["database"] in DATABASE_ORDER else 99, e["locations"][0]["start"]))
    return {"available": True, "entries": entries}


# ---------------------------------------------------------------------------
# UniProt : GO, sites, variants
# ---------------------------------------------------------------------------

def gene_ontology(entry: dict) -> list[dict]:
    terms = []
    for ref in entry.get("uniProtKBCrossReferences") or []:
        if ref.get("database") != "GO":
            continue
        props = {p["key"]: p["value"] for p in ref.get("properties") or []}
        term = props.get("GoTerm", "")
        aspect, _, name = term.partition(":")
        code, _, assigned_by = props.get("GoEvidenceType", "").partition(":")
        category, label = go_evidence(code)
        terms.append(
            {
                "id": ref.get("id"),
                "aspect": aspect,
                "aspect_label": GO_ASPECTS.get(aspect, aspect),
                "name": name,
                "evidence_code": code,
                "evidence": category,
                "evidence_label": label,
                "experimental": category == "experimental",
                "assigned_by": assigned_by or None,
                "link": f"https://www.ebi.ac.uk/QuickGO/term/{ref.get('id')}",
            }
        )
    order = list(GO_EVIDENCE)
    terms.sort(key=lambda t: (t["aspect"], order.index(t["evidence"]) if t["evidence"] in order else 99, t["name"]))
    return terms


def functional_sites(entry: dict) -> list[dict]:
    sites = []
    for feature in entry.get("features") or []:
        kind = SITE_TYPES.get(feature.get("type"))
        start, end = _location(feature)
        if not kind or not start or not end:
            continue
        ligand = feature.get("ligand") or {}
        sites.append(
            {
                "type": kind,
                "start": start,
                "end": end,
                "description": feature.get("description") or None,
                "ligand": ligand.get("name"),
                "ligand_id": ligand.get("id"),
                **_evidence(feature),
            }
        )
    return sorted(sites, key=lambda s: (s["start"], s["type"]))


def functional_variants(entry: dict) -> list[dict]:
    variants = []
    for feature in entry.get("features") or []:
        kind = feature.get("type")
        if kind not in ("Mutagenesis", "Natural variant"):
            continue
        start, end = _location(feature)
        if not start or not end:
            continue
        change = feature.get("alternativeSequence") or {}
        alternatives = change.get("alternativeSequences") or []
        description = feature.get("description") or ""
        xrefs = feature.get("featureCrossReferences") or []
        evidence = _evidence(feature)
        if kind == "Mutagenesis":
            # Mutagenèse dirigée : toujours une expérience, même sans code de preuve
            evidence = {**evidence, "experimental": True, "evidence": "experimental", "evidence_label": EVIDENCE_LABELS["experimental"]}
        effect = description.split(";")[0].strip()
        variants.append(
            {
                "kind": "Mutagenèse dirigée" if kind == "Mutagenesis" else "Variant naturel",
                "start": start,
                "end": end,
                "original": change.get("originalSequence"),
                "alternatives": alternatives,
                "description": description or None,
                # Un variant naturel sans effet décrit (« in dbSNP:… ») n'est pas « fonctionnel » documenté
                "functional": kind == "Mutagenesis" or bool(effect and not effect.lower().startswith("in dbsnp")),
                # Lien avec une maladie : référence OMIM ou mention explicite dans la description
                "disease": any(x.get("database") == "MIM" for x in xrefs)
                or any(w in description.lower() for w in ("disease", "syndrome", "deficiency", "cancer", "carcinoma")),
                "dbsnp": next((x.get("id") for x in xrefs if x.get("database") == "dbSNP"), None),
                **evidence,
            }
        )
    return sorted(variants, key=lambda v: (v["start"], v["kind"]))


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------

def _count(items: list[dict]) -> dict:
    return {"total": len(items), "experimental": sum(1 for i in items if i["experimental"])}


def build_annotation(entry: dict, interpro: dict) -> dict:
    reviewed = uniprot_service.is_reviewed(entry)
    go, sites, variants = gene_ontology(entry), functional_sites(entry), functional_variants(entry)
    return {
        "accession": entry.get("primaryAccession"),
        "length": (entry.get("sequence") or {}).get("length"),
        "uniprot_status": "Swiss-Prot (annotation revue manuellement)" if reviewed else "TrEMBL (annotation automatique, non revue)",
        "reviewed": reviewed,
        "interpro": interpro,
        "go": go,
        "sites": sites,
        "variants": variants,
        "summary": {
            "go": _count(go),
            "sites": _count(sites),
            "catalytic": sum(1 for s in sites if s["type"] == "Résidu catalytique"),
            "binding": sum(1 for s in sites if s["type"] == "Site de liaison"),
            "variants": _count(variants),
            "functional_variants": sum(1 for v in variants if v["functional"]),
            "signatures": len(interpro.get("entries", [])),
            "databases": sorted({e["database_label"] for e in interpro.get("entries", [])}),
        },
        "sources": [
            {"name": "UniProtKB", "detail": "Gene Ontology, sites, variants ; preuve ECO de chaque annotation", "url": f"https://www.uniprot.org/uniprotkb/{entry.get('primaryAccession')}/entry"},
            {"name": "InterPro", "detail": "Domaines et signatures de Pfam, PROSITE, SMART, CDD…", "url": f"https://www.ebi.ac.uk/interpro/protein/UniProt/{entry.get('primaryAccession')}/"},
            {"name": "Gene Ontology", "detail": "Codes de preuve GO", "url": "https://geneontology.org/docs/guide-go-evidence-codes/"},
        ],
    }


def functional_annotation(accession: str) -> dict:
    entry = uniprot_service.fetch_entry(accession)
    return build_annotation(entry, interpro_matches(accession))
