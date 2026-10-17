"""The ask pipeline: route the question, retrieve only what the reader may see, look up figures with the
reader's own permissions, write the answer, then check it."""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date

from .auth import Principal
from .config import Settings
from .embeddings import Embedder
from .llm import GENERIC_TERMS, ClaudeWriter, Draft, LlmUnavailable, Passage, compose_mock, unsupported_numbers, validate_citations
from .repository import ChunkHit, Repository
from .router import route_question
from .text import keyword_terms, snippet
from .tools import METRIC_LABELS, MetricTools, ToolDenied, ToolFailed
from .vectorstore import VectorStore

RRF_K = 60
CANDIDATES = 20


@dataclass(frozen=True)
class Retrieved:
    hit: ChunkHit
    score: float
    vector: float | None
    keyword: float | None


class Retriever:
    """Hybrid search: vector similarity and MySQL full-text, merged by reciprocal rank fusion."""

    def __init__(self, repo: Repository, store: VectorStore, embedder: Embedder) -> None:
        self.repo, self.store, self.embedder = repo, store, embedder
        self.lexical_embedder = embedder.name.startswith("hashing")

    def search(self, p: Principal, question: str, limit: int) -> list[Retrieved]:
        cls = p.classifications
        if not cls:
            return []
        vec = self.store.search(p.org_id, cls, self.embedder.embed_query(question), CANDIDATES)
        kw = self.repo.keyword_search(p.org_id, cls, question, CANDIDATES)
        fused: dict[int, float] = {}
        for ranking in (vec, kw):
            for rank, (cid, _) in enumerate(ranking):
                fused[cid] = fused.get(cid, 0.0) + 1.0 / (RRF_K + rank + 1)
        vec_scores, kw_scores = dict(vec), dict(kw)
        order = sorted(fused, key=lambda c: -fused[c])
        # Loading re-checks organisation, classification and status in MySQL: a stale vector can't leak.
        hits = {h.chunk_id: h for h in self.repo.load_chunks(p.org_id, cls, order)}
        specific = set(keyword_terms(question)) - GENERIC_TERMS
        out: list[Retrieved] = []
        for cid in order:
            h = hits.get(cid)
            if h is None:
                continue
            v, k = vec_scores.get(cid), kw_scores.get(cid)
            if not self._relevant(h, v, k, specific):
                continue
            out.append(Retrieved(h, fused[cid], v, k))
            if len(out) >= limit:
                break
        return out

    def _relevant(self, h: ChunkHit, v: float | None, k: float | None, specific: set[str]) -> bool:
        if self.lexical_embedder:
            # Hashing vectors measure word overlap, so ask for overlap on the words that carry the meaning.
            if specific and not specific & set(keyword_terms(f"{h.title} {h.content}")):
                return False
            return (k is not None and k > 0) or (v is not None and v >= 0.12)
        return (k is not None and k > 0 and v is not None and v >= 0.35) or (v is not None and v >= 0.55)


ToolsFactory = Callable[[Principal], MetricTools]


class Assistant:
    def __init__(self, repo: Repository, store: VectorStore, embedder: Embedder, settings: Settings, writer: ClaudeWriter | None, tools_factory: ToolsFactory) -> None:
        self.retriever = Retriever(repo, store, embedder)
        self.settings = settings
        self.writer = writer
        self.tools_factory = tools_factory

    @property
    def mode(self) -> str:
        return "claude" if self.writer else "mock"

    def ask(self, p: Principal, question: str, history: list[dict]) -> dict:
        started = time.perf_counter()
        today = date.fromisoformat(p.today) if p.today else date.today()
        route = route_question(question, history, today)
        result: dict = {
            "route": route.kind,
            "period": route.period.as_dict() if route.period else None,
            "citations": [],
            "structured": [],
            "clarification": None,
            "mode": self.mode,
            "model": None,
            "warnings": [],
        }

        def done(answer: str) -> dict:
            result["answer"] = answer
            result["latencyMs"] = int((time.perf_counter() - started) * 1000)
            return result

        if route.kind == "clarify":
            result["clarification"] = route.clarification
            return done(route.clarification["question"] if route.clarification else "Could you say more?")

        warnings: list[str] = result["warnings"]
        facts: list[str] = []
        if route.kind in ("structured", "hybrid"):
            if not p.access_token:
                warnings.append("Figures can't be looked up for this request.")
            else:
                tools = self.tools_factory(p)
                try:
                    for metric in route.metrics:
                        try:
                            out = tools.run(metric, route.period, route.vehicle)
                        except ToolDenied:
                            warnings.append(f"You don't have access to {METRIC_LABELS.get(metric, metric)}, so those figures are left out.")
                            continue
                        except ToolFailed:
                            warnings.append(f"The {METRIC_LABELS.get(metric, metric)} couldn't be loaded just now.")
                            continue
                        result["structured"].extend(r.as_dict() for r in out.results)
                        facts.extend(out.facts)
                finally:
                    tools.close()

        passages: list[Passage] = []
        if route.kind in ("document", "hybrid"):
            hits = self.retriever.search(p, question, self.settings.top_k)
            passages = [Passage(i + 1, r.hit, r.score, snippet(r.hit.content, question)) for i, r in enumerate(hits)]
            if not passages and route.kind == "hybrid":
                warnings.append("No document passage matched this question, so only the figures are shown.")

        if not passages and not facts:
            if not p.classifications and route.kind == "document":
                return done("You don't have access to any documents, so I can't answer from them.")
            return done(
                "I couldn't find anything about this in the documents you can access. Try other words, or check that "
                "the document has been uploaded and shows as Ready in the library."
            )

        draft: Draft | None = None
        if self.writer:
            try:
                draft = self.writer.write(question, history, passages, facts)
            except LlmUnavailable as e:
                warnings.append(str(e))
        if draft is None:
            draft = compose_mock(question, passages, facts)

        text, cited, citation_warnings = validate_citations(draft.text, passages)
        warnings.extend(citation_warnings + draft.warnings)
        if draft.mode == "claude":
            loose = unsupported_numbers(text, facts + [ps.hit.content for ps in passages] + [question])
            if loose:
                warnings.append(f"These numbers don't appear in the sources, so check them before relying on them: {', '.join(loose[:6])}.")
        result["mode"], result["model"] = draft.mode, draft.model
        result["citations"] = [
            {
                "index": ps.index,
                "chunkId": ps.hit.chunk_id,
                "documentId": ps.hit.document_id,
                "title": ps.hit.title,
                "filename": ps.hit.filename,
                "page": ps.hit.page,
                "section": ps.hit.section,
                "snippet": ps.snippet,
                "score": round(ps.score, 4),
            }
            for ps in passages
            if ps.index in cited
        ]
        return done(text)
