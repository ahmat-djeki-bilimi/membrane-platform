"""RCSB PDB : structures expérimentales d'une protéine (une seule requête GraphQL)."""

from app import http
from app.cache import cached, is_successful

RCSB_SEARCH = "https://search.rcsb.org/rcsbsearch/v2/query"
RCSB_GRAPHQL = "https://data.rcsb.org/graphql"
MAX_PDB_ENTRIES = 100

RCSB_GRAPHQL_QUERY = """
query ($ids: [String!]!) {
  entries(entry_ids: $ids) {
    rcsb_id
    struct { title }
    exptl { method }
    rcsb_entry_info { resolution_combined }
    rcsb_accession_info { initial_release_date }
    refine { ls_R_factor_R_free ls_R_factor_R_work }
    pdbx_vrpt_summary_geometry { clashscore percent_ramachandran_outliers percent_rotamer_outliers }
    pdbx_vrpt_summary_diffraction { percent_RSRZ_outliers }
    polymer_entities {
      rcsb_id
      rcsb_polymer_entity { pdbx_description }
      entity_poly { rcsb_sample_sequence_length }
      rcsb_polymer_entity_container_identifiers {
        auth_asym_ids
        reference_sequence_identifiers { database_accession database_name }
      }
      rcsb_entity_source_organism { scientific_name }
      rcsb_polymer_entity_align { reference_database_accession aligned_regions { ref_beg_seq_id length } }
    }
  }
}
"""


def _first(items, default=None):
    return items[0] if items else default


def summarize_pdb_entry(entry: dict, accession: str, uniprot_length: int) -> dict:
    pdb_id = entry.get("rcsb_id")
    method = (_first(entry.get("exptl") or []) or {}).get("method") or "-"
    resolution = _first((entry.get("rcsb_entry_info") or {}).get("resolution_combined") or [])
    refine = _first(entry.get("refine") or []) or {}
    geometry = _first(entry.get("pdbx_vrpt_summary_geometry") or []) or {}
    diffraction = _first(entry.get("pdbx_vrpt_summary_diffraction") or []) or {}
    release_date = (entry.get("rcsb_accession_info") or {}).get("initial_release_date") or ""

    covered: set[int] = set()
    chains: list[str] = []
    macromolecules = []
    for entity in entry.get("polymer_entities") or []:
        ids = entity.get("rcsb_polymer_entity_container_identifiers") or {}
        entity_chains = ids.get("auth_asym_ids") or []
        refs = [r.get("database_accession") for r in ids.get("reference_sequence_identifiers") or []]
        is_target = accession in refs

        for align in entity.get("rcsb_polymer_entity_align") or []:
            if align.get("reference_database_accession") != accession:
                continue
            for region in align.get("aligned_regions") or []:
                start = region.get("ref_beg_seq_id") or 0
                covered.update(range(start, start + (region.get("length") or 0)))

        if is_target:
            chains.extend(entity_chains)

        organisms = sorted(
            {o.get("scientific_name") for o in entity.get("rcsb_entity_source_organism") or [] if o.get("scientific_name")}
        )
        macromolecules.append(
            {
                "entity_id": entity.get("rcsb_id"),
                "molecule": (entity.get("rcsb_polymer_entity") or {}).get("pdbx_description") or "-",
                "chains": entity_chains,
                "sequence_length": (entity.get("entity_poly") or {}).get("rcsb_sample_sequence_length") or "-",
                "organism": ", ".join(organisms) or "-",
                "details": "Entité ciblée" if is_target else "Autre entité",
                "is_target": is_target,
            }
        )

    coverage_ranges: list[list[int]] = []
    for pos in sorted(covered):
        if coverage_ranges and pos == coverage_ranges[-1][1] + 1:
            coverage_ranges[-1][1] = pos
        else:
            coverage_ranges.append([pos, pos])

    return {
        "pdb_id": pdb_id,
        "title": (entry.get("struct") or {}).get("title") or "-",
        "method": method,
        "resolution": resolution,
        "release_date": release_date,
        "viewer_url": f"https://www.rcsb.org/structure/{pdb_id}",
        "chains": sorted(set(chains)),
        "coverage_percent": round(100 * len(covered) / uniprot_length, 1) if uniprot_length else None,
        "coverage_ranges": [{"start": a, "end": b} for a, b in coverage_ranges],
        "experimental_snapshot": {
            "method": method,
            "resolution": resolution,
            "r_free": refine.get("ls_R_factor_R_free"),
            "r_work": refine.get("ls_R_factor_R_work"),
            "release_date": release_date,
        },
        "validation": {
            "clashscore": geometry.get("clashscore"),
            "ramachandran_outliers": geometry.get("percent_ramachandran_outliers"),
            "sidechain_outliers": geometry.get("percent_rotamer_outliers"),
            "rsrz_outliers": diffraction.get("percent_RSRZ_outliers"),
        },
        "macromolecules": macromolecules,
    }


def sort_structures(structures: list[dict]) -> list[dict]:
    """Structures couvrant au moins la moitié de la protéine d'abord, puis résolution et couverture."""
    return sorted(
        structures,
        key=lambda s: (
            0 if (s["coverage_percent"] or 0) >= 50 else 1,
            s["resolution"] if isinstance(s["resolution"], (int, float)) else 999,
            -(s["coverage_percent"] or 0),
        ),
    )


@cached("pdb:structures", ttl=24 * 3600, store_if=is_successful)
def get_pdb_structures(accession: str, uniprot_length: int) -> dict:
    search_query = {
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
        "request_options": {"paginate": {"start": 0, "rows": MAX_PDB_ENTRIES}},
    }

    try:
        search = http.post(RCSB_SEARCH, json=search_query)
        # 204 : aucune structure pour cette accession
        if search.status_code == 204:
            return {"accession": accession, "count": 0, "total_count": 0, "structures": []}
        if search.status_code != 200:
            return {"accession": accession, "count": 0, "structures": [], "error": "PDB search failed"}

        search_json = search.json()
        pdb_ids = [item["identifier"] for item in search_json.get("result_set", []) if item.get("identifier")]
        if not pdb_ids:
            return {"accession": accession, "count": 0, "total_count": 0, "structures": []}

        gql = http.post(RCSB_GRAPHQL, json={"query": RCSB_GRAPHQL_QUERY, "variables": {"ids": pdb_ids}}, timeout=40)
        gql.raise_for_status()
        entries = (gql.json().get("data") or {}).get("entries") or []

        structures = sort_structures([summarize_pdb_entry(e, accession, uniprot_length) for e in entries if e])
        return {
            "accession": accession,
            "count": len(structures),
            "total_count": search_json.get("total_count", len(structures)),
            "uniprot_length": uniprot_length,
            "structures": structures,
        }
    except Exception as e:
        return {"accession": accession, "count": 0, "structures": [], "error": str(e)}
