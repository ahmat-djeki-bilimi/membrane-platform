# MemProtScope

Plateforme d'analyse des protéines membranaires : annotation UniProt, topologie
transmembranaire (DeepTMHMM), structures expérimentales (RCSB PDB) et prédites
(AlphaFold), validation structurale, orientation dans la membrane (OPM).

## Architecture

```
frontend/   Site Next.js (React, TypeScript, Tailwind)
backend/    API FastAPI
  app/
    main.py        création de l'application
    config.py      réglages (variables d'environnement / .env)
    db.py          base de données (SQLAlchemy)
    models.py      tables : tâches, cache, comptes, projets
    auth.py        mots de passe (scrypt) et sessions
    cache.py       cache persistant des réponses externes
    jobs.py        soumission et suivi des tâches
    tasks.py       file de calculs (Huey) et worker
    routers/       routes HTTP par thème
    services/      logique scientifique
    tools/         programmes isolés (DeepTMHMM)
  migrations/      migrations de la base (Alembic)
  tests/           tests (pytest), sans appel réseau
docker-compose.yml déploiement complet
```

| Composant | Développement | Production |
|---|---|---|
| Base de données | SQLite (`backend/data/`) | PostgreSQL |
| File de calculs | Huey + SQLite, worker intégré à l'API | Huey + Redis, worker séparé |

Les calculs longs (DeepTMHMM aujourd'hui ; alignements et phylogénie ensuite)
passent par la file : l'API répond immédiatement et le site suit l'avancement
(`GET /api/jobs/{id}`). Un même calcul n'est jamais lancé deux fois.

## Développement (Windows, sans Docker)

Backend :

```powershell
cd backend
python -m venv venv
venv\Scripts\pip install -r requirements-dev.txt
venv\Scripts\uvicorn main:app --reload
```

Documentation interactive de l'API : http://localhost:8000/docs

Frontend :

```powershell
cd frontend
npm install
npm run dev
```

Site : http://localhost:3000

Réglages optionnels : copier `backend/.env.example` en `backend/.env` et
`frontend/.env.example` en `frontend/.env.local`.

## Comptes et projets

Les utilisateurs créent un compte (`/connexion`), puis enregistrent leurs
analyses (accession, séquence collée ou structure) dans des projets
(`/projets`). Les mots de passe sont hachés avec scrypt ; la session est un
jeton aléatoire dont seule l'empreinte est conservée en base.

## Base de données et migrations

Le schéma évolue par migrations Alembic (`backend/migrations/versions/`). En
développement, elles s'appliquent au démarrage de l'API. Pour en créer une
après une modification de `app/models.py` :

```powershell
cd backend
venv\Scripts\alembic revision --autogenerate -m "description"
venv\Scripts\alembic upgrade head
```

## Tests

```powershell
cd backend;  venv\Scripts\python -m pytest
cd frontend; npm test; npm run typecheck
```

## Intégration continue

À chaque envoi sur GitHub, `.github/workflows/ci.yml` lance les tests du
backend, la vérification des types, les tests et la compilation du site, puis
construit les deux images Docker.

## Déploiement (Docker)

```bash
docker compose up --build
```

Variables utiles : `POSTGRES_PASSWORD`, `PUBLIC_SITE_URL` (origine autorisée par
l'API), `PUBLIC_API_URL` (adresse de l'API vue par les navigateurs, intégrée au
site lors de la compilation).

## Sources de données

UniProtKB · RCSB PDB · PDBe (SIFTS) · AlphaFold DB · DeepTMHMM (DTU, BioLib) · OPM
