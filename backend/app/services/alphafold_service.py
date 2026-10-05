"""AlphaFold DB : modèle prédit d'une entrée UniProt."""

from app import http
from app.cache import cached, is_successful

ALPHAFOLD_API = "https://alphafold.ebi.ac.uk/api/prediction"


def summarize_model(accession: str, data: list[dict]) -> dict:
    # Modèle canonique de l'entrée UniProt
    model = next((m for m in data if m.get("uniprotAccession") == accession), data[0])
    sequence = model.get("uniprotSequence") or model.get("sequence") or ""
    confidence = model.get("globalMetricValue", model.get("confidenceAvgLocalScore"))

    return {
        "accession": accession,
        "available": True,
        "model_id": model.get("modelEntityId") or model.get("entryId"),
        "alphafold_id": model.get("entryId"),
        "protein_name": model.get("uniprotDescription"),
        "organism": model.get("organismScientificName"),
        "gene": model.get("gene"),
        "sequence": sequence,
        "sequence_length": len(sequence) or (model.get("uniprotEnd") or 0),
        "pdb_url": model.get("pdbUrl"),
        "pdbUrl": model.get("pdbUrl"),
        "cif_url": model.get("cifUrl"),
        "pae_url": model.get("paeDocUrl"),
        "pae_image_url": model.get("paeImageUrl"),
        "plddt_url": model.get("plddtDocUrl"),
        "confidence": confidence,
        "confidence_avg": confidence,
        "plddt_fractions": {
            "very_high": model.get("fractionPlddtVeryHigh"),
            "confident": model.get("fractionPlddtConfident"),
            "low": model.get("fractionPlddtLow"),
            "very_low": model.get("fractionPlddtVeryLow"),
        },
        "tool": model.get("toolUsed"),
        "created": model.get("modelCreatedDate"),
        "model_created": model.get("modelCreatedDate"),
        "latest_version": model.get("latestVersion"),
    }


@cached("alphafold:model", store_if=is_successful)
def get_alphafold(accession: str) -> dict:
    try:
        response = http.get(f"{ALPHAFOLD_API}/{accession}")
        if response.status_code != 200:
            return {"accession": accession, "available": False, "reason": "not_found"}
        data = response.json()
        if not data:
            return {"accession": accession, "available": False, "reason": "not_found"}
        return summarize_model(accession, data)
    except Exception as e:
        return {"accession": accession, "available": False, "error": str(e)}
