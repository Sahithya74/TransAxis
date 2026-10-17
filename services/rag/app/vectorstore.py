"""Vector search with Qdrant: embedded on disk by default, in memory for tests, or a server when QDRANT_URL is set.
Every search carries an organisation and classification filter built from the service token."""

from __future__ import annotations

import threading
from collections.abc import Sequence

from qdrant_client import QdrantClient, models


class VectorStore:
    def __init__(self, location: str, dim: int, embedding_name: str) -> None:
        if location == ":memory:":
            self.client = QdrantClient(location=":memory:")
        elif location.startswith(("http://", "https://")):
            self.client = QdrantClient(url=location)
        else:
            self.client = QdrantClient(path=location)
        # One collection per embedding model, so switching providers never mixes vector spaces.
        self.collection = "chunks_" + "".join(ch if ch.isalnum() else "_" for ch in embedding_name)
        self._lock = threading.Lock()
        if not self.client.collection_exists(self.collection):
            self.client.create_collection(self.collection, vectors_config=models.VectorParams(size=dim, distance=models.Distance.COSINE))

    @staticmethod
    def _scope(org_id: int, classifications: Sequence[str] | None = None, doc_id: int | None = None) -> models.Filter:
        must: list[models.FieldCondition] = [models.FieldCondition(key="org_id", match=models.MatchValue(value=org_id))]
        if classifications is not None:
            must.append(models.FieldCondition(key="classification", match=models.MatchAny(any=list(classifications))))
        if doc_id is not None:
            must.append(models.FieldCondition(key="document_id", match=models.MatchValue(value=doc_id)))
        return models.Filter(must=must)

    def upsert(self, org_id: int, doc_id: int, classification: str, items: Sequence[tuple[int, list[float]]]) -> None:
        if not items:
            return
        points = [
            models.PointStruct(id=chunk_id, vector=vector, payload={"org_id": org_id, "document_id": doc_id, "classification": classification})
            for chunk_id, vector in items
        ]
        with self._lock:
            self.client.upsert(self.collection, points=points, wait=True)

    def delete_document(self, org_id: int, doc_id: int) -> None:
        with self._lock:
            self.client.delete(self.collection, points_selector=models.FilterSelector(filter=self._scope(org_id, doc_id=doc_id)), wait=True)

    def search(self, org_id: int, classifications: Sequence[str], vector: list[float], limit: int) -> list[tuple[int, float]]:
        if not classifications:
            return []
        with self._lock:
            res = self.client.query_points(self.collection, query=vector, query_filter=self._scope(org_id, classifications), limit=limit, with_payload=False)
        return [(int(p.id), float(p.score)) for p in res.points]

    def points(self, batch: int = 256):
        """Yields (point id, document id) for every stored vector, in batches."""
        offset = None
        while True:
            with self._lock:
                found, offset = self.client.scroll(self.collection, limit=batch, offset=offset, with_payload=["document_id"], with_vectors=False)
            yield [(int(p.id), (p.payload or {}).get("document_id")) for p in found]
            if offset is None or not found:
                return

    def delete_points(self, ids: Sequence[int]) -> None:
        if ids:
            with self._lock:
                self.client.delete(self.collection, points_selector=models.PointIdsList(points=list(ids)), wait=True)

    def close(self) -> None:
        self.client.close()
