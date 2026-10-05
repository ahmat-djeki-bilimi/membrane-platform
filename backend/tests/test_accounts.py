"""Comptes utilisateurs, sessions, projets et analyses enregistrées."""

import pytest
from fastapi.testclient import TestClient

from app.auth import hash_password, verify_password
from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def register(client, email="ada@example.org", password="motdepasse-solide"):
    r = client.post("/api/auth/register", json={"email": email, "password": password, "name": "Ada"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_password_hashing():
    stored = hash_password("secret-123")
    assert stored.startswith("scrypt$") and "secret-123" not in stored
    assert verify_password("secret-123", stored)
    assert not verify_password("autre", stored)
    # Sel aléatoire : deux empreintes différentes pour le même mot de passe
    assert hash_password("secret-123") != stored


def test_register_login_logout(client):
    headers = register(client)
    assert client.get("/api/auth/me", headers=headers).json()["email"] == "ada@example.org"

    # Connexion insensible à la casse de l'adresse
    r = client.post("/api/auth/login", json={"email": "ADA@example.org", "password": "motdepasse-solide"})
    assert r.status_code == 200

    assert client.post("/api/auth/logout", headers=headers).status_code == 204
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_register_validation(client):
    assert client.post("/api/auth/register", json={"email": "pas-un-mail", "password": "12345678"}).status_code == 400
    assert client.post("/api/auth/register", json={"email": "a@b.org", "password": "court"}).status_code == 400
    register(client, "dup@example.org")
    assert client.post("/api/auth/register", json={"email": "dup@example.org", "password": "12345678"}).status_code == 409


def test_login_does_not_reveal_accounts(client):
    register(client)
    wrong_password = client.post("/api/auth/login", json={"email": "ada@example.org", "password": "mauvais!!"})
    unknown = client.post("/api/auth/login", json={"email": "inconnu@example.org", "password": "mauvais!!"})
    assert wrong_password.status_code == unknown.status_code == 401
    assert wrong_password.json() == unknown.json()


def test_projects_require_login(client):
    assert client.get("/api/projects").status_code == 401
    assert client.get("/api/projects", headers={"Authorization": "Bearer faux"}).status_code == 401


def test_project_lifecycle(client):
    headers = register(client)
    project = client.post("/api/projects", json={"name": "Canaux potassiques"}, headers=headers).json()

    saved = client.post(
        f"/api/projects/{project['id']}/analyses",
        json={"kind": "accession", "title": "KcsA", "payload": {"accession": "P0A334"}},
        headers=headers,
    )
    assert saved.status_code == 201

    detail = client.get(f"/api/projects/{project['id']}", headers=headers).json()
    assert detail["analysis_count"] == 1
    assert detail["analyses"][0]["payload"] == {"accession": "P0A334"}

    renamed = client.patch(f"/api/projects/{project['id']}", json={"name": "Canaux K+"}, headers=headers)
    assert renamed.json()["name"] == "Canaux K+"

    analysis_id = detail["analyses"][0]["id"]
    assert client.delete(f"/api/projects/{project['id']}/analyses/{analysis_id}", headers=headers).status_code == 204
    assert client.delete(f"/api/projects/{project['id']}", headers=headers).status_code == 204
    assert client.get("/api/projects", headers=headers).json() == []


def test_projects_are_private(client):
    owner = register(client, "owner@example.org")
    intruder = register(client, "intrus@example.org")
    project = client.post("/api/projects", json={"name": "Privé"}, headers=owner).json()

    assert client.get(f"/api/projects/{project['id']}", headers=intruder).status_code == 404
    assert client.delete(f"/api/projects/{project['id']}", headers=intruder).status_code == 404
    assert client.get("/api/projects", headers=intruder).json() == []


def test_analysis_kind_is_validated(client):
    headers = register(client)
    project = client.post("/api/projects", json={"name": "P"}, headers=headers).json()
    r = client.post(f"/api/projects/{project['id']}/analyses", json={"kind": "autre", "title": "x"}, headers=headers)
    assert r.status_code == 422


def test_deleting_user_cascades(client):
    from sqlalchemy import delete, func, select

    from app.db import session_scope
    from app.models import AuthSession, Project, User

    headers = register(client, "cascade@example.org")
    client.post("/api/projects", json={"name": "À supprimer"}, headers=headers)
    with session_scope() as session:
        session.execute(delete(User).where(User.email == "cascade@example.org"))
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Project)) == 0
        assert session.scalar(select(func.count()).select_from(AuthSession)) == 0


def test_unicode_titles(client):
    headers = register(client)
    project = client.post("/api/projects", json={"name": "Canaux K⁺ · β2"}, headers=headers).json()
    saved = client.post(
        f"/api/projects/{project['id']}/analyses",
        json={"kind": "structure", "title": "KcsA · 1BL8", "payload": {"pdb_id": "1BL8"}},
        headers=headers,
    )
    assert saved.status_code == 201
    assert saved.json()["title"] == "KcsA · 1BL8"
