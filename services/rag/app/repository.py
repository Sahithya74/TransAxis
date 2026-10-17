"""Document rows and chunks in MySQL. Every query is scoped by organisation, and searches also check the
document's classification and status, so a stale vector can never surface a passage the reader can't open."""

from __future__ import annotations

import re
from collections.abc import Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol

import pymysql
import pymysql.cursors

from .config import DbConfig
from .text import keyword_terms


@dataclass(frozen=True)
class DocumentRow:
    id: int
    org_id: int
    title: str
    classification: str
    status: str
    storage_key: str
    mime: str
    original_name: str


@dataclass(frozen=True)
class ChunkIn:
    seq: int
    content: str
    page: int | None
    section: str | None
    token_count: int


@dataclass(frozen=True)
class ChunkHit:
    chunk_id: int
    document_id: int
    title: str
    filename: str
    classification: str
    page: int | None
    section: str | None
    content: str


class Repository(Protocol):
    def get_document(self, org_id: int, doc_id: int) -> DocumentRow | None: ...
    def set_status(self, doc_id: int, status: str, progress: int, **fields: object) -> None: ...
    def replace_chunks(self, org_id: int, doc_id: int, chunks: Sequence[ChunkIn]) -> list[int]: ...
    def delete_chunks(self, org_id: int, doc_id: int) -> None: ...
    def keyword_search(self, org_id: int, classifications: Sequence[str], query: str, limit: int) -> list[tuple[int, float]]: ...
    def load_chunks(self, org_id: int, classifications: Sequence[str], chunk_ids: Sequence[int]) -> list[ChunkHit]: ...
    def count_ready(self, org_id: int, classifications: Sequence[str]) -> int: ...
    def chunk_owners(self, chunk_ids: Sequence[int]) -> dict[int, int]: ...


_STATUS_FIELDS = {"error", "page_count", "chunk_count", "embedding_model", "processed_at"}


class MySqlRepository:
    """One short-lived connection per operation: the service handles a few requests a minute."""

    def __init__(self, cfg: DbConfig) -> None:
        self.cfg = cfg

    @contextmanager
    def _conn(self):
        conn = pymysql.connect(
            host=self.cfg.host,
            port=self.cfg.port,
            user=self.cfg.user,
            password=self.cfg.password,
            database=self.cfg.database,
            charset="utf8mb4",
            autocommit=True,
            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=5,
        )
        try:
            yield conn
        finally:
            conn.close()

    def ping(self) -> bool:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
            return True

    def get_document(self, org_id: int, doc_id: int) -> DocumentRow | None:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, org_id, title, classification, status, storage_key, mime, original_name "
                "FROM documents WHERE id = %s AND org_id = %s",
                (doc_id, org_id),
            )
            r = cur.fetchone()
        return DocumentRow(**r) if r else None

    def set_status(self, doc_id: int, status: str, progress: int, **fields: object) -> None:
        unknown = set(fields) - _STATUS_FIELDS
        if unknown:
            raise ValueError(f"Unknown document fields: {unknown}")
        cols = ["status = %s", "progress = %s"] + [f"{k} = %s" for k in fields]
        values = [status, progress, *fields.values(), doc_id]
        with self._conn() as conn, conn.cursor() as cur:
            # A superseded or deleted document stays as it is, even if processing finishes late.
            cur.execute(f"UPDATE documents SET {', '.join(cols)} WHERE id = %s AND status <> 'superseded'", values)

    def replace_chunks(self, org_id: int, doc_id: int, chunks: Sequence[ChunkIn]) -> list[int]:
        with self._conn() as conn:
            conn.begin()
            try:
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM document_chunks WHERE document_id = %s AND org_id = %s", (doc_id, org_id))
                    if chunks:
                        cur.executemany(
                            "INSERT INTO document_chunks (org_id, document_id, seq, page, section, content, token_count) "
                            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                            [(org_id, doc_id, c.seq, c.page, c.section, c.content, c.token_count) for c in chunks],
                        )
                    cur.execute("SELECT id, seq FROM document_chunks WHERE document_id = %s ORDER BY seq", (doc_id,))
                    ids = {r["seq"]: r["id"] for r in cur.fetchall()}
                conn.commit()
            except Exception:
                conn.rollback()
                raise
        return [ids[c.seq] for c in chunks]

    def delete_chunks(self, org_id: int, doc_id: int) -> None:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM document_chunks WHERE document_id = %s AND org_id = %s", (doc_id, org_id))

    def keyword_search(self, org_id: int, classifications: Sequence[str], query: str, limit: int) -> list[tuple[int, float]]:
        if not classifications:
            return []
        # Natural-language mode ignores boolean operators, so the question can be passed as it is.
        q = re.sub(r"\s+", " ", query)[:500]
        marks = ", ".join(["%s"] * len(classifications))
        sql = (
            "SELECT c.id, MATCH(c.content) AGAINST (%s IN NATURAL LANGUAGE MODE) AS score "
            "FROM document_chunks c JOIN documents d ON d.id = c.document_id "
            f"WHERE c.org_id = %s AND d.org_id = %s AND d.status = 'ready' AND d.classification IN ({marks}) "
            "AND MATCH(c.content) AGAINST (%s IN NATURAL LANGUAGE MODE) "
            "ORDER BY score DESC LIMIT %s"
        )
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(sql, (q, org_id, org_id, *classifications, q, limit))
            return [(int(r["id"]), float(r["score"])) for r in cur.fetchall()]

    def load_chunks(self, org_id: int, classifications: Sequence[str], chunk_ids: Sequence[int]) -> list[ChunkHit]:
        if not chunk_ids or not classifications:
            return []
        id_marks = ", ".join(["%s"] * len(chunk_ids))
        cls_marks = ", ".join(["%s"] * len(classifications))
        sql = (
            "SELECT c.id AS chunk_id, c.document_id, d.title, d.original_name AS filename, d.classification, "
            "c.page, c.section, c.content FROM document_chunks c JOIN documents d ON d.id = c.document_id "
            f"WHERE c.id IN ({id_marks}) AND c.org_id = %s AND d.org_id = %s AND d.status = 'ready' "
            f"AND d.classification IN ({cls_marks})"
        )
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(sql, (*chunk_ids, org_id, org_id, *classifications))
            rows = cur.fetchall()
        return [ChunkHit(**r) for r in rows]

    def chunk_owners(self, chunk_ids: Sequence[int]) -> dict[int, int]:
        if not chunk_ids:
            return {}
        marks = ", ".join(["%s"] * len(chunk_ids))
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(f"SELECT id, document_id FROM document_chunks WHERE id IN ({marks})", tuple(chunk_ids))
            return {int(r["id"]): int(r["document_id"]) for r in cur.fetchall()}

    def count_ready(self, org_id: int, classifications: Sequence[str]) -> int:
        if not classifications:
            return 0
        marks = ", ".join(["%s"] * len(classifications))
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                f"SELECT COUNT(*) AS n FROM documents WHERE org_id = %s AND status = 'ready' AND classification IN ({marks})",
                (org_id, *classifications),
            )
            return int(cur.fetchone()["n"])


@dataclass
class _MemDoc:
    row: DocumentRow
    status: str
    progress: int = 0
    fields: dict = field(default_factory=dict)


class MemoryRepository:
    """In-memory stand-in used by the tests. Keyword search is a simple term-frequency score."""

    def __init__(self) -> None:
        self.docs: dict[int, _MemDoc] = {}
        self.chunks: dict[int, tuple[int, int, ChunkIn]] = {}  # chunk id -> (org, doc, chunk)
        self._next_chunk = 1

    def add_document(self, row: DocumentRow) -> None:
        self.docs[row.id] = _MemDoc(row=row, status=row.status)

    def status_of(self, doc_id: int) -> _MemDoc:
        return self.docs[doc_id]

    def get_document(self, org_id: int, doc_id: int) -> DocumentRow | None:
        d = self.docs.get(doc_id)
        if not d or d.row.org_id != org_id:
            return None
        return DocumentRow(**{**d.row.__dict__, "status": d.status})

    def set_status(self, doc_id: int, status: str, progress: int, **fields: object) -> None:
        d = self.docs[doc_id]
        if d.status == "superseded":
            return
        d.status, d.progress = status, progress
        d.fields.update(fields)

    def replace_chunks(self, org_id: int, doc_id: int, chunks: Sequence[ChunkIn]) -> list[int]:
        self.delete_chunks(org_id, doc_id)
        ids = []
        for c in chunks:
            self.chunks[self._next_chunk] = (org_id, doc_id, c)
            ids.append(self._next_chunk)
            self._next_chunk += 1
        return ids

    def delete_chunks(self, org_id: int, doc_id: int) -> None:
        for cid in [k for k, (o, d, _) in self.chunks.items() if o == org_id and d == doc_id]:
            del self.chunks[cid]

    def _visible(self, org_id: int, classifications: Sequence[str], doc_id: int) -> bool:
        d = self.docs.get(doc_id)
        return bool(d) and d.row.org_id == org_id and d.status == "ready" and d.row.classification in classifications

    def keyword_search(self, org_id: int, classifications: Sequence[str], query: str, limit: int) -> list[tuple[int, float]]:
        terms = set(keyword_terms(query))
        scored = []
        for cid, (o, d, c) in self.chunks.items():
            if o != org_id or not self._visible(org_id, classifications, d):
                continue
            words = keyword_terms(c.content)
            score = float(sum(1 for w in words if w in terms))
            if score > 0:
                scored.append((cid, score))
        scored.sort(key=lambda x: -x[1])
        return scored[:limit]

    def load_chunks(self, org_id: int, classifications: Sequence[str], chunk_ids: Sequence[int]) -> list[ChunkHit]:
        out = []
        for cid in chunk_ids:
            item = self.chunks.get(cid)
            if not item:
                continue
            o, d, c = item
            if o != org_id or not self._visible(org_id, classifications, d):
                continue
            row = self.docs[d].row
            out.append(ChunkHit(cid, d, row.title, row.original_name, row.classification, c.page, c.section, c.content))
        return out

    def chunk_owners(self, chunk_ids: Sequence[int]) -> dict[int, int]:
        return {cid: self.chunks[cid][1] for cid in chunk_ids if cid in self.chunks}

    def count_ready(self, org_id: int, classifications: Sequence[str]) -> int:
        return sum(1 for d in self.docs.values() if d.row.org_id == org_id and d.status == "ready" and d.row.classification in classifications)


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)
