import requests

RCSB_SEARCH_URL = "https://search.rcsb.org/rcsbsearch/v2/query"
RCSB_ENTRY_URL = "https://data.rcsb.org/rest/v1/core/entry"
RCSB_ENTITY_URL = "https://data.rcsb.org/rest/v1/core/polymer_entity"


def search_pdb_by_uniprot(accession: str) -> list[dict]:
    accession = accession.upper().strip()

    query = {
        "query": {
            "type": "terminal",
            "service": "text",
            "parameters": {
                "attribute": "rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession",
                "operator": "exact_match",
                "value": accession,
            },
        },
        "return_type": "entry",
        "request_options": {
            "paginate": {"start": 0, "rows": 20},
            "sort": [{"sort_by": "score", "direction": "desc"}],
        },
    }

    response = requests.post(RCSB_SEARCH_URL, json=query, timeout=30)

    if response.status_code != 200:
        raise RuntimeError(f"RCSB search error: {response.text}")

    data = response.json()
    pdb_ids = [item["identifier"] for item in data.get("result_set", [])]

    return [get_full_pdb_summary(pdb_id) for pdb_id in pdb_ids]


def get_full_pdb_summary(pdb_id: str) -> dict:
    pdb_id = pdb_id.upper()

    entry_response = requests.get(f"{RCSB_ENTRY_URL}/{pdb_id}", timeout=30)

    if entry_response.status_code != 200:
        return empty_structure(pdb_id)

    entry = entry_response.json()

    title = entry.get("struct", {}).get("title", "-")

    methods = entry.get("exptl", [])
    method = methods[0].get("method", "-") if methods else "-"

    resolution = None
    refine = entry.get("refine", [])
    if refine:
        resolution = refine[0].get("ls_d_res_high")

    release_date = entry.get("rcsb_accession_info", {}).get(
        "initial_release_date", "-"
    )

    r_free = None
    r_work = None
    if refine:
        r_free = refine[0].get("ls_R_factor_R_free")
        r_work = refine[0].get("ls_R_factor_R_work")

    validation = get_validation(entry)
    macromolecules = get_macromolecules(pdb_id, entry)

    return {
        "pdb_id": pdb_id,
        "title": title,
        "method": method,
        "resolution": resolution,
        "release_date": release_date,
        "viewer_url": f"https://files.rcsb.org/view/{pdb_id}.pdb",

        "experimental_snapshot": {
            "method": method,
            "resolution": resolution,
            "r_free": r_free,
            "r_work": r_work,
            "release_date": release_date,
            "starting_model": "experimental",
        },

        "validation": validation,
        "macromolecules": macromolecules,
    }


def get_validation(entry: dict) -> dict:
    validation_info = entry.get("rcsb_entry_info", {})

    return {
        "clashscore": validation_info.get("clashscore"),
        "ramachandran_outliers": validation_info.get(
            "ramachandran_outliers_percent"
        ),
        "sidechain_outliers": validation_info.get("sidechain_outliers_percent"),
        "rsrz_outliers": validation_info.get("rsrz_outliers_percent"),
    }


def get_macromolecules(pdb_id: str, entry: dict) -> list[dict]:
    entities = entry.get("rcsb_entry_container_identifiers", {}).get(
        "polymer_entity_ids", []
    )

    results = []

    for entity_id in entities:
        url = f"{RCSB_ENTITY_URL}/{pdb_id}/{entity_id}"
        response = requests.get(url, timeout=30)

        if response.status_code != 200:
            continue

        entity = response.json()

        description = entity.get("rcsb_polymer_entity", {}).get(
            "pdbx_description", "-"
        )

        chains = entity.get("rcsb_polymer_entity_container_identifiers", {}).get(
            "asym_ids", []
        )

        sequence_length = entity.get("entity_poly", {}).get(
            "rcsb_sample_sequence_length", "-"
        )

        organisms = entity.get("rcsb_entity_source_organism", [])
        organism = "-"
        if organisms:
            organism = organisms[0].get("scientific_name", "-")

        mutation_count = entity.get("rcsb_polymer_entity", {}).get(
            "pdbx_mutation", "-"
        )

        results.append(
            {
                "entity_id": entity_id,
                "molecule": description,
                "chains": chains,
                "sequence_length": sequence_length,
                "organism": organism,
                "details": mutation_count,
                "image_url": f"https://cdn.rcsb.org/images/structures/{pdb_id.lower()}_assembly-1.jpeg",
            }
        )

    return results


def empty_structure(pdb_id: str) -> dict:
    return {
        "pdb_id": pdb_id,
        "title": "-",
        "method": "-",
        "resolution": None,
        "release_date": "-",
        "viewer_url": f"https://files.rcsb.org/view/{pdb_id}.pdb",
        "experimental_snapshot": {},
        "validation": {},
        "macromolecules": [],
    }