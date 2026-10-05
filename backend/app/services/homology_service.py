"""
Recherche d'homologues à partir d'une séquence.

- UniParc : retrouve l'entrée UniProt d'une séquence identique (instantané).
- MMseqs2 : recherche d'homologues dans UniRef via le serveur public de
  ColabFold (Mirdita et al., 2022). Gratuit pour un usage non commercial et
  limité en débit ; une plateforme très fréquentée devra héberger son propre
  serveur MMseqs2 (MMSEQS_SERVER_URL).
"""

import io
import re
import tarfile
import time

from app import http
from app.cache import cached
from app.config import get_settings

UNIPARC_SEQUENCE = "https://rest.uniprot.org/uniparc/sequence"
UNIREF_SEARCH = "https://rest.uniprot.org/uniref/search"

POLL_SECONDS = 5
MAX_WAIT_SECONDS = 20 * 60


class HomologySearchError(Exception):
    pass


# ---------------------------------------------------------------------------
# UniParc
# ---------------------------------------------------------------------------

@cached("uniparc:accession", store_if=lambda v: v is not None)
def _lookup(sequence: str) -> dict | None:
    response = http.get(UNIPARC_SEQUENCE, params={"format": "json", "sequence": sequence})
    if response.status_code in (400, 404):
        return None
    response.raise_for_status()
    data = response.json()

    swissprot, trembl = [], []
    for ref in data.get("uniParcCrossReferences", []):
        if not ref.get("active"):
            continue
        database = ref.get("database", "")
        if database == "UniProtKB/Swiss-Prot":
            swissprot.append(ref.get("id"))
        elif database == "UniProtKB/TrEMBL":
            trembl.append(ref.get("id"))
    accessions = [a for a in swissprot + trembl if a]
    if not accessions:
        return None
    return {"uniparc_id": data.get("uniParcId"), "accession": accessions[0], "reviewed": bool(swissprot)}


def find_identical_entry(sequence: str) -> dict | None:
    """Entrée UniProt dont la séquence est identique (Swiss-Prot en priorité)."""
    sequence = re.sub(r"[^A-Za-z]", "", sequence).upper()
    if not sequence:
        return None
    try:
        return _lookup(sequence)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# MMseqs2 (serveur ColabFold)
# ---------------------------------------------------------------------------

def _server() -> str:
    return get_settings().mmseqs_server_url.rstrip("/")


def run_mmseqs(sequence: str) -> list[dict]:
    """
    Recherche MMseqs2 dans UniRef ; renvoie les homologues avec leur ligne
    d'alignement ancrée sur la séquence (insertions retirées).
    """
    submit = http.post(f"{_server()}/ticket/msa", data={"q": f">query\n{sequence}\n", "mode": "all"}, timeout=60)
    submit.raise_for_status()
    ticket = submit.json()

    waited = 0
    while ticket.get("status") in ("PENDING", "RUNNING", "UNKNOWN"):
        if waited >= MAX_WAIT_SECONDS:
            raise HomologySearchError("La recherche MMseqs2 n'a pas abouti dans le délai imparti.")
        time.sleep(POLL_SECONDS)
        waited += POLL_SECONDS
        ticket = http.get(f"{_server()}/ticket/{ticket['id']}").json()

    status = ticket.get("status")
    if status == "RATELIMIT":
        raise HomologySearchError("Le serveur MMseqs2 limite les requêtes : réessayez dans quelques minutes.")
    if status == "MAINTENANCE":
        raise HomologySearchError("Le serveur MMseqs2 est en maintenance.")
    if status != "COMPLETE":
        raise HomologySearchError(f"Recherche MMseqs2 en échec ({status}).")

    archive = http.get(f"{_server()}/result/download/{ticket['id']}", timeout=120)
    archive.raise_for_status()
    with tarfile.open(fileobj=io.BytesIO(archive.content)) as tar:
        member = tar.extractfile("uniref.a3m")
        if member is None:
            raise HomologySearchError("Résultat MMseqs2 incomplet.")
        a3m = member.read().decode("utf-8", errors="replace")
    return parse_a3m(a3m, len(sequence))


def parse_a3m(a3m: str, query_length: int) -> list[dict]:
    """
    Lit un fichier A3M produit par MMseqs2. Les minuscules (insertions par
    rapport à la requête) sont retirées : chaque ligne a la longueur de la
    requête. La première entrée (la requête) est ignorée.
    """
    hits, header = [], None
    for line in a3m.splitlines():
        if line.startswith(">"):
            header = line[1:].strip()
            continue
        if header is None or not line.strip():
            continue
        row = re.sub(r"[a-z.]", "", line.strip())
        fields = header.replace("\x00", "").split("\t")
        header = None
        if len(row) != query_length:
            continue
        identifier = fields[0].split()[0]
        identity = None
        if len(fields) > 2:
            try:
                identity = float(fields[2])
            except ValueError:
                identity = None
        hits.append({"id": identifier, "row": row, "identity": identity})
    # La première séquence est la requête elle-même
    return hits[1:] if hits and hits[0]["id"] in ("query", "101") else hits


def fetch_uniref_organisms(ids: list[str]) -> dict[str, dict]:
    """Organisme représentatif de clusters UniRef100 (identifiants encore valides)."""
    found: dict[str, dict] = {}
    for start in range(0, len(ids), 50):
        batch = [i for i in ids[start:start + 50] if i.startswith("UniRef")]
        if not batch:
            continue
        try:
            response = http.get(
                UNIREF_SEARCH,
                params={"query": " OR ".join(f"id:{i}" for i in batch), "fields": "id,organism,name", "size": 50},
            )
            response.raise_for_status()
        except Exception:
            continue
        for item in response.json().get("results", []):
            organisms = item.get("organisms") or []
            found[item["id"]] = {
                "organism": (item.get("representativeMember") or {}).get("organismName")
                or (organisms[0].get("scientificName") if organisms else None),
                "taxon_id": organisms[0].get("taxonId") if organisms else None,
                "name": (item.get("name") or "").removeprefix("Cluster: "),
            }
    return found
