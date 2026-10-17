"""HTTP entry points. Run with: uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8001

Every route except /health needs a service token from the API; this service is never exposed directly."""

from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager
from datetime import date
from typing import Literal

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .assistant import Assistant, ToolsFactory
from .auth import AuthError, Principal, verify_service_token
from .config import Settings, load_settings
from .embeddings import Embedder, make_embedder
from .ingest import Ingestor
from .llm import ClaudeWriter
from .repository import MySqlRepository, Repository
from .tools import MetricTools
from .vectorstore import VectorStore

log = logging.getLogger("rag")


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class AskBody(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    history: list[Turn] = Field(default_factory=list, max_length=6)


def default_tools(settings: Settings) -> ToolsFactory:
    def make(p: Principal) -> MetricTools:
        return MetricTools(settings.api_base_url, p.access_token or "", date.fromisoformat(p.today) if p.today else date.today())

    return make


def create_app(
    settings: Settings | None = None,
    repo: Repository | None = None,
    store: VectorStore | None = None,
    embedder: Embedder | None = None,
    tools: ToolsFactory | None = None,
    writer: ClaudeWriter | None = None,
    reconcile_on_start: bool = True,
) -> FastAPI:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = settings or load_settings()
    embedder = embedder or make_embedder(settings.embedding_provider)
    if repo is None:
        if settings.db is None:
            raise RuntimeError("DATABASE_URL is not set")
        repo = MySqlRepository(settings.db)
    store = store or VectorStore(settings.qdrant_location, embedder.dim, embedder.name)
    if writer is None and settings.wants_claude:
        writer = ClaudeWriter(settings.anthropic_api_key, settings.anthropic_model)
    ingestor = Ingestor(repo, store, embedder, settings)
    assistant = Assistant(repo, store, embedder, settings, writer, tools or default_tools(settings))

    stop = threading.Event()

    def housekeeping() -> None:
        while not stop.is_set():
            try:
                ingestor.reconcile()
            except Exception:
                log.exception("vector clean-up failed")
            stop.wait(1800)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        log.info("RAG service ready: embeddings %s, answers %s", embedder.name, "Claude " + writer.model if writer else "mock mode")
        if reconcile_on_start:
            threading.Thread(target=housekeeping, name="rag-housekeeping", daemon=True).start()
        yield
        stop.set()
        store.close()

    app = FastAPI(title="TransAxis RAG", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.ingestor, app.state.assistant, app.state.repo, app.state.store = ingestor, assistant, repo, store

    def principal(authorization: str = Header(default="")) -> Principal:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise HTTPException(status_code=401, detail="Missing service token")
        try:
            return verify_service_token(token, settings.service_secret)
        except AuthError as e:
            raise HTTPException(status_code=401, detail=str(e)) from e

    @app.exception_handler(Exception)
    async def unexpected(_request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error", exc_info=exc)
        return JSONResponse(status_code=500, content={"detail": "The document service hit an unexpected error."})

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "embedding": embedder.name, "llm": assistant.mode, "model": writer.model if writer else None}

    @app.get("/internal/v1/status")
    def status(p: Principal = Depends(principal)) -> dict:
        return {
            "documentsReady": repo.count_ready(p.org_id, p.classifications),
            "mode": assistant.mode,
            "model": writer.model if writer else None,
            "embedding": embedder.name,
        }

    @app.post("/internal/v1/documents/{doc_id}/ingest", status_code=202)
    def ingest(doc_id: int, background: BackgroundTasks, p: Principal = Depends(principal)) -> dict:
        background.add_task(ingestor.run, p.org_id, doc_id)
        return {"accepted": True}

    @app.delete("/internal/v1/documents/{doc_id}")
    def forget(doc_id: int, p: Principal = Depends(principal)) -> dict:
        ingestor.forget(p.org_id, doc_id)
        return {"deleted": True}

    @app.post("/internal/v1/ask")
    def ask(body: AskBody, p: Principal = Depends(principal)) -> dict:
        return assistant.ask(p, body.question.strip(), [t.model_dump() for t in body.history])

    return app
