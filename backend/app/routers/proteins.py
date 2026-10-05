"""Routes « protéine » : fiche UniProt et domaines annotés."""

from fastapi import APIRouter

from app.services import uniprot_service as uniprot

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
