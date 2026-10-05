"""Comptes utilisateurs, projets et analyses enregistrées."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app import auth
from app.db import session_scope
from app.models import Project, SavedAnalysis, User, utcnow

router = APIRouter(prefix="/api", tags=["Comptes et projets"])


# --- Comptes -----------------------------------------------------------------

class RegisterRequest(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(max_length=200)
    name: str = Field(default="", max_length=120)


class LoginRequest(BaseModel):
    email: str
    password: str


def _session_response(user: dict) -> dict:
    return {"token": auth.create_session(user["id"]), "user": user}


@router.post("/auth/register", status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest):
    email = payload.email.lower().strip()
    if not auth.EMAIL_RE.match(email):
        raise HTTPException(400, "Adresse e-mail invalide.")
    if len(payload.password) < auth.MIN_PASSWORD_LENGTH:
        raise HTTPException(400, f"Le mot de passe doit contenir au moins {auth.MIN_PASSWORD_LENGTH} caractères.")
    try:
        with session_scope() as session:
            user = User(email=email, name=payload.name.strip(), password_hash=auth.hash_password(payload.password))
            session.add(user)
            session.flush()
            user_dict = user.to_dict()
    except IntegrityError:
        raise HTTPException(409, "Un compte existe déjà avec cette adresse.")
    return _session_response(user_dict)


@router.post("/auth/login")
def login(payload: LoginRequest):
    user = auth.find_user_by_email(payload.email)
    # Message identique dans les deux cas : ne révèle pas l'existence du compte
    if user is None or not auth.verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Adresse e-mail ou mot de passe incorrect.")
    return _session_response(user.to_dict())


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(token: str | None = Depends(auth.bearer_token)):
    if token:
        auth.revoke_session(token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/auth/me")
def me(user: dict = Depends(auth.current_user)):
    return user


# --- Projets -----------------------------------------------------------------

class ProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=5000)


class AnalysisRequest(BaseModel):
    kind: Literal["accession", "sequence", "structure"]
    title: str = Field(min_length=1, max_length=255)
    payload: dict = Field(default_factory=dict)
    notes: str = Field(default="", max_length=5000)


def _owned_project(session, project_id: str, user: dict) -> Project:
    project = session.get(Project, project_id)
    # 404 aussi pour le projet d'un autre utilisateur : son existence n'est pas révélée
    if project is None or project.owner_id != user["id"]:
        raise HTTPException(404, "Projet introuvable.")
    return project


@router.get("/projects")
def list_projects(user: dict = Depends(auth.current_user)):
    with session_scope() as session:
        projects = session.scalars(
            select(Project).where(Project.owner_id == user["id"]).order_by(Project.updated_at.desc())
        ).all()
        return [p.to_dict() for p in projects]


@router.post("/projects", status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectRequest, user: dict = Depends(auth.current_user)):
    with session_scope() as session:
        project = Project(owner_id=user["id"], name=payload.name.strip(), description=payload.description.strip())
        session.add(project)
        session.flush()
        return project.to_dict()


@router.get("/projects/{project_id}")
def get_project(project_id: str, user: dict = Depends(auth.current_user)):
    with session_scope() as session:
        return _owned_project(session, project_id, user).to_dict(with_analyses=True)


@router.patch("/projects/{project_id}")
def update_project(project_id: str, payload: ProjectRequest, user: dict = Depends(auth.current_user)):
    with session_scope() as session:
        project = _owned_project(session, project_id, user)
        project.name = payload.name.strip()
        project.description = payload.description.strip()
        session.flush()
        return project.to_dict()


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: str, user: dict = Depends(auth.current_user)):
    with session_scope() as session:
        session.delete(_owned_project(session, project_id, user))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/projects/{project_id}/analyses", status_code=status.HTTP_201_CREATED)
def save_analysis(project_id: str, payload: AnalysisRequest, user: dict = Depends(auth.current_user)):
    with session_scope() as session:
        project = _owned_project(session, project_id, user)
        analysis = SavedAnalysis(
            project_id=project.id,
            kind=payload.kind,
            title=payload.title.strip(),
            payload=payload.payload,
            notes=payload.notes.strip(),
        )
        session.add(analysis)
        # Le projet remonte en tête de liste
        project.updated_at = utcnow()
        session.flush()
        return analysis.to_dict()


@router.delete("/projects/{project_id}/analyses/{analysis_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_analysis(project_id: str, analysis_id: str, user: dict = Depends(auth.current_user)):
    with session_scope() as session:
        project = _owned_project(session, project_id, user)
        analysis = session.get(SavedAnalysis, analysis_id)
        if analysis is None or analysis.project_id != project.id:
            raise HTTPException(404, "Analyse introuvable.")
        session.delete(analysis)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
