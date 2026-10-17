from __future__ import annotations

import time

import jwt
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from conftest import POLICY, SECRET


def token(org: int = 1, cls=("general",), secret: str = SECRET, aud: str = "transaxis-rag", lifetime: int = 60, iat: int | None = None) -> str:
    now = iat or int(time.time())
    claims = {"iss": "transaxis-api", "aud": aud, "sub": "7", "org": org, "perms": ["documents:read"], "cls": list(cls), "today": "2026-10-16", "tz": "Asia/Kolkata", "iat": now, "exp": now + lifetime}
    return jwt.encode(claims, secret, algorithm="HS256")


@pytest.fixture
def client(settings, repo, store, embedder):
    app = create_app(settings=settings, repo=repo, store=store, embedder=embedder, tools=lambda _p: None)
    with TestClient(app) as c:
        yield c


def test_health_needs_no_token(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json() == {"status": "ok", "embedding": "hashing-v1", "llm": "mock", "model": None}


@pytest.mark.parametrize(
    "auth",
    [
        None,
        "Bearer not-a-jwt",
        f"Bearer {token(secret='wrong-secret-' + 'y' * 40)}",
        f"Bearer {token(aud='someone-else')}",
        f"Bearer {token(iat=int(time.time()) - 600)}",
        f"Bearer {token(lifetime=3600)}",
    ],
)
def test_requests_without_a_valid_service_token_are_refused(client, auth):
    headers = {"authorization": auth} if auth else {}
    assert client.post("/internal/v1/ask", json={"question": "hello"}, headers=headers).status_code == 401


def test_ingest_then_ask(client, add_doc, repo):
    doc = add_doc(1, "policy.txt", POLICY.encode(), title="Fuel and expense policy")
    auth = {"authorization": f"Bearer {token()}"}
    assert client.post(f"/internal/v1/documents/{doc.id}/ingest", headers=auth).status_code == 202
    assert repo.status_of(doc.id).status == "ready"  # background tasks run before TestClient returns
    assert client.get("/internal/v1/status", headers=auth).json()["documentsReady"] == 1
    r = client.post("/internal/v1/ask", json={"question": "What is the driver food allowance per day?"}, headers=auth).json()
    assert "Rs 350 per day" in r["answer"] and r["citations"][0]["title"] == "Fuel and expense policy"
    assert client.delete(f"/internal/v1/documents/{doc.id}", headers=auth).json() == {"deleted": True}
    r2 = client.post("/internal/v1/ask", json={"question": "What is the driver food allowance per day?"}, headers=auth).json()
    assert r2["citations"] == []


def test_another_organisations_token_cannot_ingest_or_read(client, add_doc, repo):
    doc = add_doc(1, "policy.txt", POLICY.encode())
    other = {"authorization": f"Bearer {token(org=2)}"}
    client.post(f"/internal/v1/documents/{doc.id}/ingest", headers=other)
    assert repo.status_of(doc.id).status == "queued"


def test_question_length_is_limited(client):
    auth = {"authorization": f"Bearer {token()}"}
    assert client.post("/internal/v1/ask", json={"question": "x" * 1001}, headers=auth).status_code == 422
