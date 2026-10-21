# MemProtScope

**Plateforme web d'analyse bioinformatique des protéines membranaires**, permettant d'explorer les relations entre leurs séquences, leurs structures tridimensionnelles et leurs propriétés fonctionnelles.

MemProtScope intègre plusieurs approches complémentaires :

- **Analyse des séquences** : récupération des informations depuis UniProt, recherche de séquences homologues, alignement multiple et filtrage.
- **Conservation évolutive** : identification des positions conservées et variables.
- **Analyse phylogénétique** : reconstruction d'arbres par la méthode Neighbor-Joining.
- **Analyse de coévolution** : détection de paires de positions statistiquement associées par information mutuelle corrigée par APC (MIp) et identification de secteurs protéiques par SCA associée à ICA.
- **Analyse structurale** : prédiction de la topologie membranaire avec DeepTMHMM, récupération des structures expérimentales depuis RCSB PDB et des structures prédites depuis AlphaFold DB.
- **Visualisation 3D** : exploration des résidus conservés et des positions candidates issues des analyses de coévolution dans leur contexte structural, avec prise en compte de l'orientation membranaire.

**Objectif :** réunir différentes méthodes bioinformatiques dans une interface interactive afin de faciliter l'exploration des relations entre séquence, structure et fonction des protéines membranaires.

## Sources de données et outils

### Bases de données

| Source | Utilisation |
|---|---|
| **UniProt** | Séquences, annotations et caractéristiques des protéines |
| **RCSB PDB** | Structures expérimentales |
| **PDBe (SIFTS)** | Correspondance entre les positions UniProt et les structures PDB |
| **AlphaFold DB** | Structures prédites |
| **OPM** | Orientation des protéines dans la membrane |
| **InterPro et Pfam** | Domaines et familles de protéines |
| **Gene Ontology (QuickGO)** | Annotations fonctionnelles et codes de preuve |
| **TCDB** | Classification des transporteurs |
| **PubMed** | Références bibliographiques |

### Outils et méthodes

| Outil / méthode | Utilisation |
|---|---|
| **MMseqs2** (serveur ColabFold, base UniRef) | Recherche d'homologues et alignement multiple |
| **Divergence de Jensen-Shannon** | Score de conservation des positions |
| **Neighbor-Joining** (avec bootstrap) | Arbre phylogénétique |
| **IQ-TREE** (maximum de vraisemblance, UFBoot) | Arbre phylogénétique (optionnel, si installé sur le serveur) |
| **MIp** (information mutuelle corrigée par APC) | Paires de positions coévoluant |
| **SCA + ICA** | Secteurs protéiques |
| **DeepTMHMM** (via BioLib) | Prédiction de la topologie membranaire |
| **ESMFold** (ESM Atlas) | Prédiction de structure |
| **3Dmol.js et Mol\*** | Visualisation 3D des structures |

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

Les calculs longs (DeepTMHMM, recherche d'homologues, conservation et arbres phylogénétiques)
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

## Membrane Evolution & Function Explorer

Page `/explorateur` (import), résultats sur `/explorateur/<tâche>` avec un onglet par étape : analyse d'une famille de protéines membranaires
homologues importée en FASTA (ou orthologues UniRef50 d'une entrée UniProt,
avec option de recherche étendue MMseqs2).

1. Homologues : alignement ancré sur la séquence de référence (ou alignement
   fourni repris tel quel).
2. Conservation de chaque position (Jensen-Shannon, grades 1–9) et arbre
   phylogénétique (Neighbor-Joining, bootstrap).
3. Topologie (DeepTMHMM, UniProt ou Kyte-Doolittle) et orientation : modèle
   AlphaFold DB (ou ESMFold) placé dans la membrane, comparé à OPM.
4. Cartographie : profondeur, enfouissement et positions candidates
   (fonctionnelles, structurales, interface) avec leurs raisons.
5. Coévolution, deux méthodes sur le même alignement : MIp (information
   mutuelle + APC : paires, carte de contacts confrontée au modèle, réseaux) et
   SCA (Statistical Coupling Analysis + ICA : secteurs de résidus), chacune
   cartographiée sur la structure dans la membrane, puis comparées.

La page d'une protéine n'en garde qu'un aperçu (onglet Évolution : profil de
conservation) avec un lien vers l'Explorateur.

Route : `POST /api/explorer` (calcul en file), `GET /api/explorer/homologs/{accession}`.

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
