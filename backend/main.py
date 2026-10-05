"""Point d'entrée conservé pour `uvicorn main:app` ; l'application est dans app/."""

from app.main import app  # noqa: F401
