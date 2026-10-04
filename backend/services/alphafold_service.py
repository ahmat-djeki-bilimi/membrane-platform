import requests


def get_alphafold_model(accession: str) -> dict:
    accession = accession.upper().strip()
    url = f"https://alphafold.ebi.ac.uk/api/prediction/{accession}"

    response = requests.get(url, timeout=30)

    if response.status_code != 200:
        return {
            "accession": accession,
            "available": False,
            "error": "AlphaFold model not found",
        }

    data = response.json()

    if not data:
        return {
            "accession": accession,
            "available": False,
            "error": "Empty AlphaFold result",
        }

    model = data[0]

    return {
        "accession": accession,
        "available": True,
        "model_id": model.get("entryId"),
        "protein_name": model.get("uniprotDescription"),
        "organism": model.get("organismScientificName"),
        "gene": model.get("gene"),
        "sequence": model.get("sequence"),
        "sequence_length": len(model.get("sequence", "")),
        "pdb_url": model.get("pdbUrl"),
        "cif_url": model.get("cifUrl"),
        "pae_url": model.get("paeDocUrl"),
        "confidence": model.get("confidenceAvgLocalScore"),
        "created": model.get("modelCreatedDate"),
        "latest_version": model.get("latestVersion"),
    }