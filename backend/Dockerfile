FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt requirements-prod.txt ./
RUN pip install -r requirements-prod.txt

COPY app ./app
COPY migrations ./migrations
COPY alembic.ini main.py ./

RUN useradd --create-home memprot && mkdir -p /app/data && chown memprot /app/data
USER memprot

EXPOSE 8000
# Le worker utilise la même image avec une autre commande (voir docker-compose.yml)
# Migrations appliquées une fois, puis démarrage des serveurs
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2"]
