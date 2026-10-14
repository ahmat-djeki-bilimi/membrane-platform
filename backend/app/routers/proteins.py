"""Routes « protéine » : fiche UniProt et domaines annotés."""

import re

from fastapi import APIRouter, HTTPException, Query

from app.services import uniprot_service as uniprot
from app.services.functional_annotation_service import functional_annotation
from app.services.mutation_service import MutationError, analyze_mutation

router = APIRouter(prefix="/api", tags=["Protéines"])


@router.get("/uniprot/{accession}")
def get_uniprot(accession: str):
    accession = accession.upper().strip()
    try:
        return uniprot.summarize_entry(uniprot.fetch_entry(accession))
    except uniprot.UniProtNotFound:
        return {"accession": accession, "available": False, "error": "UniProt entry not found"}
    except Exception as e:
        return {"accession": accession, "available": False, "error": str(e)}


@router.get("/domains/{accession}")
def get_domains(accession: str):
    """Domaines et régions annotés dans UniProtKB (aucune région inventée)."""
    accession = accession.upper().strip()
    try:
        entry = uniprot.fetch_entry(accession)
    except uniprot.UniProtNotFound:
        return {"accession": accession, "domains": [], "error": "UniProt entry not found"}
    except Exception as e:
        return {"accession": accession, "domains": [], "error": str(e)}

    domains = uniprot.domain_features(entry)
    return {
        "accession": accession,
        "sequence_length": entry.get("sequence", {}).get("length", 0),
        "source": "UniProtKB",
        "domains": domains,
        "interpretation": (
            f"{len(domains)} région(s) annotée(s) dans UniProtKB."
            if domains
            else "Aucun domaine ni région annoté dans UniProtKB pour cette entrée."
        ),
    }


@router.get("/annotations/{accession}")
def get_annotations(accession: str):
    """
    Annotation fonctionnelle : domaines et signatures InterPro (Pfam, PROSITE…),
    Gene Ontology, résidus catalytiques, sites de liaison et variants
    fonctionnels, avec la source et la nature (expérimentale ou prédite) de chacun.
    """
    accession = accession.upper().strip()
    if not re.fullmatch(r"[A-Z0-9]{6,10}", accession):
        raise HTTPException(400, "Accession UniProt invalide.")
    try:
        return functional_annotation(accession)
    except uniprot.UniProtNotFound:
        raise HTTPException(404, "Entrée UniProt introuvable.")
    except Exception:
        raise HTTPException(502, "UniProt est injoignable pour le moment : réessayez dans quelques instants.")


@router.get("/mutation/{accession}")
def get_mutation(accession: str, position: int = Query(..., ge=1), to: str = Query(..., min_length=1, max_length=1)):
    """
    Substitution d'un résidu : propriétés, conservation, environnement 3D,
    contacts et annotations. Les conséquences sont des hypothèses, jamais un verdict.
    """
    accession = accession.upper().strip()
    if not re.fullmatch(r"[A-Z0-9]{6,10}", accession):
        raise HTTPException(400, "Accession UniProt invalide.")
    try:
        return analyze_mutation(accession, position, to)
    except MutationError as error:
        raise HTTPException(400, str(error))
    except uniprot.UniProtNotFound:
        raise HTTPException(404, "Entrée UniProt introuvable.")
