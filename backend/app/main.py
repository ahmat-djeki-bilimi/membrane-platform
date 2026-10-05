"""Création de l'application FastAPI."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import jobs
from app.config import get_settings
from app.db import init_db
from app.routers import accounts, evolution, membrane, proteins, structures, system

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s : %(message)s")
logger = logging.getLogger("memprotscope")


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    init_db()
    if settings.embedded_worker:
        from app.tasks import start_embedded_worker

        start_embedded_worker()
    recovered = jobs.recover_interrupted()
    if recovered:
        logger.info("%d tâche(s) interrompue(s) relancée(s)", recovered)
    yield
    if settings.embedded_worker:
        from app.tasks import stop_embedded_worker

        stop_embedded_worker()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="MemProtScope API",
        description="Analyse structurale et fonctionnelle des protéines membranaires",
        version="1.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    for module in (system, accounts, proteins, structures, membrane, evolution):
        app.include_router(module.router)

    @app.get("/", include_in_schema=False)
    def root():
        return {"message": "MemProtScope backend is running", "status": "ok", "docs": "/docs"}

    return app


app = create_app()
