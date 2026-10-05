"""
Exécution isolée de DeepTMHMM : lit {"sequence", "name"} en JSON sur l'entrée
standard et écrit le résultat en JSON sur la sortie standard.

BioLib crée des threads que Python attend à l'arrêt : lancé dans un processus
séparé, il ne peut plus bloquer l'arrêt ou le rechargement de l'API.
"""

import json
import sys

from app.services.membrane_service import predict_topology


def main() -> int:
    request = json.load(sys.stdin)
    try:
        result = predict_topology(request["sequence"], request.get("name", "query"))
    except Exception as exc:  # message transmis au processus parent
        json.dump({"error": str(exc)}, sys.stdout)
        return 1
    json.dump({"result": result}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
