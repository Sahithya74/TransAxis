"""Embedding providers.

- ``hashing`` (default): deterministic feature hashing of terms and term pairs. No download, no randomness,
  so tests and offline demos behave the same every run. It captures word overlap, not meaning; the keyword
  half of hybrid search covers the rest.
- ``fastembed``: local semantic embeddings (BAAI/bge-small-en-v1.5). Optional; install requirements-semantic.txt.
"""

from __future__ import annotations

import hashlib
import logging
from typing import Protocol

import numpy as np

from .text import keyword_terms

log = logging.getLogger("rag.embeddings")


class Embedder(Protocol):
    name: str
    dim: int

    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...
    def embed_query(self, text: str) -> list[float]: ...


class HashingEmbedder:
    name = "hashing-v1"
    dim = 512

    @staticmethod
    def _bucket(feature: str) -> tuple[int, float]:
        h = int.from_bytes(hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest(), "big")
        return h % HashingEmbedder.dim, (1.0 if (h >> 63) & 1 else -1.0)

    def _vector(self, text: str) -> list[float]:
        v = np.zeros(self.dim, dtype=np.float64)
        terms = keyword_terms(text)
        for t in terms:
            i, sign = self._bucket(t)
            v[i] += sign
        for a, b in zip(terms, terms[1:]):
            i, sign = self._bucket(f"{a}_{b}")
            v[i] += 0.5 * sign
        v = np.sign(v) * np.log1p(np.abs(v))  # damp repeated terms in long passages
        norm = float(np.linalg.norm(v))
        return (v / norm).tolist() if norm > 0 else v.tolist()

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vector(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vector(text)


class FastEmbedEmbedder:
    name = "bge-small-en-v1.5"
    dim = 384

    def __init__(self) -> None:
        from fastembed import TextEmbedding  # optional dependency

        self._model = TextEmbedding("BAAI/bge-small-en-v1.5")

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [list(map(float, v)) for v in self._model.embed(texts)]

    def embed_query(self, text: str) -> list[float]:
        return [float(x) for x in next(iter(self._model.query_embed([text])))]


def make_embedder(provider: str) -> Embedder:
    if provider == "fastembed":
        try:
            return FastEmbedEmbedder()
        except Exception as e:  # missing package or model download failure
            log.warning("fastembed unavailable (%s); using hashing embeddings", type(e).__name__)
    return HashingEmbedder()
