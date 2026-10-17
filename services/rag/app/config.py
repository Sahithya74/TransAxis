"""Settings: process environment first, then the repository's .env file for anything not set."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlparse

REPO_ROOT = Path(__file__).resolve().parents[3]


def load_dotenv(path: Path) -> None:
    """Fills in variables the environment doesn't already define. Values are never logged."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class DbConfig:
    host: str
    port: int
    user: str
    password: str
    database: str


def parse_mysql_url(url: str) -> DbConfig:
    u = urlparse(url)
    if u.scheme not in ("mysql", "mysql2"):
        raise ValueError("DATABASE_URL must be a mysql:// URL")
    return DbConfig(
        host=u.hostname or "127.0.0.1",
        port=u.port or 3306,
        user=unquote(u.username or ""),
        password=unquote(u.password or ""),
        database=u.path.lstrip("/"),
    )


@dataclass(frozen=True)
class Settings:
    db: DbConfig | None
    service_secret: str
    upload_dir: Path
    #: A folder (embedded Qdrant), ":memory:" (tests) or an http(s) URL of a Qdrant server.
    qdrant_location: str
    embedding_provider: str
    #: "auto" uses Claude when credentials are configured, "claude" always tries it, "mock" never does.
    llm_provider: str
    anthropic_api_key: str | None
    anthropic_model: str
    #: Where metric tools call the API, with the asking user's own token.
    api_base_url: str
    chunk_size: int = 900
    chunk_overlap: int = 150
    top_k: int = 6

    @property
    def wants_claude(self) -> bool:
        if self.llm_provider == "claude":
            return True
        return self.llm_provider == "auto" and bool(self.anthropic_api_key or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def _resolve(path: str) -> Path:
    p = Path(path)
    return (p if p.is_absolute() else REPO_ROOT / p).resolve()


def load_settings() -> Settings:
    load_dotenv(REPO_ROOT / ".env")
    env = os.environ
    db_url = env.get("RAG_DATABASE_URL") or env.get("DATABASE_URL")
    qdrant = env.get("QDRANT_URL") or env.get("QDRANT_PATH") or "./storage/qdrant"
    if qdrant != ":memory:" and not qdrant.startswith(("http://", "https://")):
        qdrant = str(_resolve(qdrant))
    return Settings(
        db=parse_mysql_url(db_url) if db_url else None,
        service_secret=env.get("RAG_SERVICE_SECRET", ""),
        upload_dir=_resolve(env.get("UPLOAD_DIR") or "./storage/uploads"),
        qdrant_location=qdrant,
        embedding_provider=(env.get("EMBEDDING_PROVIDER") or "hashing").lower(),
        llm_provider=(env.get("LLM_PROVIDER") or "auto").lower(),
        anthropic_api_key=env.get("ANTHROPIC_API_KEY") or None,
        anthropic_model=env.get("ANTHROPIC_MODEL") or "claude-opus-5-5",
        api_base_url=env.get("RAG_API_BASE_URL") or f"http://127.0.0.1:{env.get('API_PORT', '4000')}/api/v1",
        chunk_size=int(env.get("RAG_CHUNK_SIZE", "900")),
        chunk_overlap=int(env.get("RAG_CHUNK_OVERLAP", "150")),
        top_k=int(env.get("RAG_TOP_K", "6")),
    )
