"""
Prédiction de structure par ESMFold (Lin et al., Science 2023), via l'API
publique ESM Metagenomic Atlas. ESMFold prédit la structure à partir de la
seule séquence, sans alignement : rapide, mais en général moins précis
qu'AlphaFold pour les protéines ayant peu d'homologues.
"""

from app import http
from app.cache import cached
from app.config import get_settings

MAX_LENGTH = 400  # limite de l'API publique


class StructurePredictionError(Exception):
    pass


@cached("esmfold", ttl=180 * 24 * 3600)
def fold_sequence(sequence: str) -> str:
    """Fichier PDB prédit (pLDDT entre 0 et 1 dans la colonne B-factor)."""
    if len(sequence) > MAX_LENGTH:
        raise StructurePredictionError(f"ESMFold accepte au plus {MAX_LENGTH} résidus.")
    response = http.post(get_settings().esmfold_url, data=sequence, timeout=300)
    if response.status_code == 413:
        raise StructurePredictionError(f"ESMFold accepte au plus {MAX_LENGTH} résidus.")
    if response.status_code >= 400:
        raise StructurePredictionError(f"Service ESMFold indisponible (HTTP {response.status_code}).")
    text = response.text
    if "ATOM" not in text:
        raise StructurePredictionError("Réponse ESMFold inattendue.")
    return text
