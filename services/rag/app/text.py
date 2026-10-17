"""Small text utilities shared by chunking, embeddings, keyword scoring and answer snippets."""

from __future__ import annotations

import re

STOPWORDS = frozenset(
    """a an and are as at be been but by can could did do does for from had has have how i if in into is it its
    me my of on or our out should so than that the their them then there these they this to us was we were what
    when where which who whom why will with would you your about after all also any before being both each
    few more most no not only other over same some such too under until up very via vs per please tell show
    give list much many""".split()
)

_WORD = re.compile(r"[a-z0-9]+(?:[./'][a-z0-9]+)*")


def _restore_e(base: str) -> str:
    """charg -> charge, approv -> approve, caus -> cause; process and fill stay as they are."""
    if base[-1] in "gvcz" or (base[-1] == "s" and base[-2:] != "ss"):
        return base + "e"
    return base


def _stem(w: str) -> str:
    """Very light stemming so "charges", "charged" and "charging" all meet "charge". Codes and numbers
    are left alone."""
    if any(ch.isdigit() for ch in w) or w.endswith("ss"):
        return w
    if len(w) >= 5 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) >= 6 and w.endswith("ing"):
        return _restore_e(w[:-3])
    if len(w) >= 5 and w.endswith("ed"):
        return w[:-1] if w[-3] == "e" else _restore_e(w[:-2])
    if len(w) >= 5 and w.endswith("es") and (w[-3] in "sxz" or w[-4:-2] in ("ch", "sh")):
        return w[:-2]
    if len(w) >= 4 and w.endswith("s"):
        return w[:-1]
    return w


def keyword_terms(text: str) -> list[str]:
    """Lower-cased, stop-word-free, lightly stemmed terms, in order."""
    return [_stem(w) for w in _WORD.findall(text.lower()) if len(w) > 1 and w not in STOPWORDS]


_SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])|\n+")


_SOFT_WRAP = re.compile(r"(?<![.!?:|])\n(?=[a-z(])")


def sentences(text: str) -> list[str]:
    # PDF text keeps the page's line breaks; a line that continues in lower case is the same sentence.
    joined = _SOFT_WRAP.sub(" ", text)
    return [s.strip() for s in _SENTENCE.split(joined) if s and s.strip()]


def coverage(text: str, terms: set[str]) -> int:
    """How many of the given terms the text contains."""
    return len(terms & set(keyword_terms(text)))


def best_sentences(text: str, query: str, limit: int = 2) -> list[str]:
    """The sentences sharing the most terms with the query, kept in their original order. Short lines
    (headings, titles) are used only when there is nothing else."""
    terms = set(keyword_terms(query))
    sents = sentences(text)
    # Prefer real sentences over headings and table rows.
    full = [s for s in sents if len(s) >= 30 and len(s.split()) >= 5 and " | " not in s] or sents
    if not full:
        return []
    scored = [(sum(1 for t in set(keyword_terms(s)) if t in terms), i, s) for i, s in enumerate(full)]
    best = max(score for score, _, _ in scored)
    if best == 0:
        return full[:limit]
    # A second sentence earns its place only if it is about the question too.
    top = [x for x in sorted(scored, key=lambda x: (-x[0], x[1])) if x[0] > 0][:limit]
    return [s for _, _, s in sorted(top, key=lambda x: x[1])]


def snippet(text: str, query: str, max_len: int = 320) -> str:
    """A window of the passage around its best match, trimmed at word boundaries."""
    flat = re.sub(r"\s+", " ", text).strip()
    if len(flat) <= max_len:
        return flat
    terms = [t for t in keyword_terms(query) if len(t) > 2]
    low = flat.lower()
    hits = [low.find(t) for t in terms if low.find(t) >= 0]
    start = max(0, min(hits) - max_len // 4) if hits else 0
    end = min(len(flat), start + max_len)
    start = max(0, end - max_len)
    if start > 0:
        space = flat.find(" ", start)
        start = space + 1 if 0 <= space < start + 30 else start
    if end < len(flat):
        space = flat.rfind(" ", start, end)
        end = space if space > start + max_len // 2 else end
    return ("…" if start > 0 else "") + flat[start:end].strip() + ("…" if end < len(flat) else "")


def indian_group(n: int) -> str:
    """12345678 -> 1,23,45,678 (Indian digit grouping)."""
    s = str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return ("-" if n < 0 else "") + s


def inr(value: object) -> str:
    try:
        n = round(float(value))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return "—"
    return f"₹{indian_group(n)}"
