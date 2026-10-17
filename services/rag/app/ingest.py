"""Turning uploaded files into searchable chunks: parse (PDF by page, Word by heading, CSV by rows, text by
heading), split into overlapping chunks, embed, and store in MySQL and the vector index."""

from __future__ import annotations

import csv
import io
import logging
import re
import threading
from dataclasses import dataclass
from pathlib import Path

from .config import Settings
from .embeddings import Embedder
from .repository import ChunkIn, Repository, utcnow
from .vectorstore import VectorStore

log = logging.getLogger("rag.ingest")


class ParseError(Exception):
    """A problem with the file itself; the message is shown to the person who uploaded it."""


@dataclass(frozen=True)
class Section:
    text: str
    page: int | None = None
    heading: str | None = None


# ------------------------------------------------------------------ parsers


def decode(data: bytes) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


def _clean(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def parse_pdf(path: Path) -> list[Section]:
    from pypdf import PdfReader

    try:
        reader = PdfReader(str(path))
        if reader.is_encrypted and not reader.decrypt(""):
            raise ParseError("The PDF is password-protected. Upload an unprotected copy.")
        pages = [Section(text=_clean(page.extract_text() or ""), page=i + 1) for i, page in enumerate(reader.pages)]
    except ParseError:
        raise
    except Exception as e:
        raise ParseError("The PDF could not be read. It may be damaged.") from e
    if not any(s.text for s in pages):
        raise ParseError("No text was found in the PDF. Scanned documents need OCR, which isn't available here.")
    return [s for s in pages if s.text]


def parse_docx(path: Path) -> list[Section]:
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    try:
        document = docx.Document(str(path))
    except Exception as e:
        raise ParseError("The Word file could not be read. It may be damaged, or an older .doc file.") from e
    sections: list[Section] = []
    heading: str | None = None
    buf: list[str] = []

    def flush() -> None:
        text = _clean("\n\n".join(buf))
        if text:
            sections.append(Section(text=text, heading=heading))
        buf.clear()

    for block in document.iter_inner_content():
        if isinstance(block, Paragraph):
            text = block.text.strip()
            style = (block.style.name if block.style is not None else "") or ""
            if text and (style.lower().startswith("heading") or style == "Title"):
                flush()
                heading = text[:250]
            elif text:
                buf.append(text)
        elif isinstance(block, Table):
            rows = [" | ".join(cell.text.strip() for cell in row.cells) for row in block.rows]
            buf.append("\n".join(r for r in rows if r.strip(" |")))
    flush()
    if not sections:
        raise ParseError("The Word file has no text.")
    return sections


def parse_csv(path: Path) -> list[Section]:
    text = decode(path.read_bytes())
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    rows = [r for r in csv.reader(io.StringIO(text), dialect) if any(c.strip() for c in r)]
    if len(rows) < 2:
        raise ParseError("The CSV needs a header row and at least one data row.")
    header = [h.strip() or f"Column {i + 1}" for i, h in enumerate(rows[0])]
    lines = ["; ".join(f"{h}: {v.strip()}" for h, v in zip(header, row) if v.strip()) for row in rows[1:]]
    # Each row repeats its column names, so a passage still makes sense on its own.
    sections = []
    for start in range(0, len(lines), 25):
        block = lines[start : start + 25]
        sections.append(Section(text="\n".join(block), heading=f"Rows {start + 1}–{start + len(block)}"))
    return sections


_MD_HEADING = re.compile(r"^#{1,6}\s+(.+)$")
_NUM_HEADING = re.compile(r"^\d+(?:\.\d+)*[.)]?\s+[A-Z][^.!?]{0,80}$")


def _is_caps_heading(line: str) -> bool:
    letters = [c for c in line if c.isalpha()]
    return 3 <= len(letters) and len(line) <= 70 and all(c.isupper() for c in letters)


def _is_short_heading(lines: list[str], i: int) -> bool:
    """A short capitalised line with no closing punctuation, standing alone after a blank line and
    followed by text, as in plain-text documents ("Payment terms")."""
    s = lines[i].strip()
    if not s or len(s) > 60 or len(s.split()) > 6 or not s[0].isupper() or s[-1] in ".,;:!?":
        return False
    after_blank = i == 0 or not lines[i - 1].strip()
    before_text = i + 1 < len(lines) and bool(lines[i + 1].strip())
    return after_blank and before_text and i > 0


def parse_text(path: Path) -> list[Section]:
    text = _clean(decode(path.read_bytes()))
    if not text:
        raise ParseError("The file is empty.")
    sections: list[Section] = []
    heading: str | None = None
    buf: list[str] = []
    lines = text.split("\n")
    for i, line in enumerate(lines):
        stripped = line.strip()
        m = _MD_HEADING.match(stripped)
        if m or _NUM_HEADING.match(stripped) or (_is_caps_heading(stripped) and len(stripped.split()) <= 8) or _is_short_heading(lines, i):
            if any(b.strip() for b in buf):
                sections.append(Section(text=_clean("\n".join(buf)), heading=heading))
            buf = []
            heading = (m.group(1) if m else stripped)[:250]
        else:
            buf.append(line)
    if any(b.strip() for b in buf):
        sections.append(Section(text=_clean("\n".join(buf)), heading=heading))
    return sections


def parse_file(path: Path, mime: str, filename: str) -> list[Section]:
    ext = Path(filename).suffix.lower()
    if ext == ".pdf" or mime == "application/pdf":
        return parse_pdf(path)
    if ext == ".docx":
        return parse_docx(path)
    if ext == ".csv" or mime == "text/csv":
        return parse_csv(path)
    if ext in (".txt", ".md") or mime.startswith("text/"):
        return parse_text(path)
    raise ParseError(f"Unsupported file type {ext or mime}.")


# ------------------------------------------------------------------ chunking


def _split_long(paragraph: str, size: int) -> list[str]:
    """Breaks an over-long paragraph at sentence ends, then at spaces."""
    parts, cur = [], ""
    for sent in re.split(r"(?<=[.!?])\s+", paragraph):
        while len(sent) > size:
            cut = sent.rfind(" ", 0, size)
            cut = cut if cut > size // 2 else size
            parts.append((cur + " " + sent[:cut]).strip() if cur else sent[:cut])
            cur, sent = "", sent[cut:].strip()
        if cur and len(cur) + 1 + len(sent) > size:
            parts.append(cur)
            cur = sent
        else:
            cur = (cur + " " + sent).strip()
    if cur:
        parts.append(cur)
    return parts


def _tail(text: str, overlap: int) -> str:
    if overlap <= 0 or len(text) <= overlap:
        return ""
    tail = text[-overlap:]
    space = tail.find(" ")
    return tail[space + 1 :] if 0 <= space < overlap // 2 else tail


def chunk_sections(sections: list[Section], size: int = 900, overlap: int = 150) -> list[ChunkIn]:
    """Packs paragraphs into chunks of about `size` characters. Consecutive chunks of a section share
    `overlap` characters so a sentence split across them is still found. The section heading leads
    each chunk, so passages stay understandable (and searchable) on their own."""
    if overlap >= size:
        raise ValueError("overlap must be smaller than size")
    chunks: list[ChunkIn] = []

    def emit(body: str, s: Section) -> None:
        content = f"{s.heading}\n{body}" if s.heading else body
        chunks.append(ChunkIn(seq=len(chunks), content=content, page=s.page, section=s.heading, token_count=len(content.split())))

    for s in sections:
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", s.text) if p.strip()]
        pieces: list[str] = []
        for p in paragraphs:
            pieces.extend([p] if len(p) <= size else _split_long(p, size))
        buf = ""
        for piece in pieces:
            if buf and len(buf) + 2 + len(piece) > size:
                emit(buf, s)
                tail = _tail(buf, overlap)
                buf = f"{tail} {piece}".strip() if tail and len(tail) + 1 + len(piece) <= size else piece
            else:
                buf = f"{buf}\n\n{piece}" if buf else piece
        if buf.strip():
            emit(buf, s)
    return chunks


# ------------------------------------------------------------------ pipeline


def storage_path(upload_dir: Path, storage_key: str) -> Path:
    """Resolves a storage key inside the upload folder, refusing anything that would escape it."""
    path = (upload_dir / storage_key).resolve()
    if upload_dir.resolve() not in path.parents:
        raise ParseError("The stored file path is invalid.")
    if not path.is_file():
        raise ParseError("The file is missing from storage. Upload it again.")
    return path


class Ingestor:
    def __init__(self, repo: Repository, store: VectorStore, embedder: Embedder, settings: Settings) -> None:
        self.repo, self.store, self.embedder, self.settings = repo, store, embedder, settings
        self._lock = threading.Lock()  # one document at a time keeps memory and the embedded index calm

    def run(self, org_id: int, doc_id: int) -> str:
        with self._lock:
            doc = self.repo.get_document(org_id, doc_id)
            if doc is None or doc.status == "superseded":
                return "skipped"
            self.repo.set_status(doc_id, "processing", 5, error=None)
            try:
                sections = parse_file(storage_path(self.settings.upload_dir, doc.storage_key), doc.mime, doc.original_name)
                self.repo.set_status(doc_id, "processing", 30)
                chunks = chunk_sections(sections, self.settings.chunk_size, self.settings.chunk_overlap)
                if not chunks:
                    raise ParseError("No readable text was found in the file.")
                vectors: list[list[float]] = []
                for start in range(0, len(chunks), 32):
                    batch = chunks[start : start + 32]
                    vectors.extend(self.embedder.embed_documents([f"{doc.title}\n{c.content}" for c in batch]))
                    self.repo.set_status(doc_id, "processing", 30 + int(50 * (start + len(batch)) / len(chunks)))
                ids = self.repo.replace_chunks(org_id, doc_id, chunks)
                self.store.delete_document(org_id, doc_id)
                self.store.upsert(org_id, doc_id, doc.classification, list(zip(ids, vectors)))
                pages = [s.page for s in sections if s.page is not None]
                self.repo.set_status(
                    doc_id,
                    "ready",
                    100,
                    error=None,
                    page_count=max(pages) if pages else None,
                    chunk_count=len(chunks),
                    embedding_model=self.embedder.name,
                    processed_at=utcnow(),
                )
                log.info("document %s ready: %s chunks", doc_id, len(chunks))
                return "ready"
            except ParseError as e:
                self._discard(org_id, doc_id)
                self.repo.set_status(doc_id, "failed", 100, error=str(e)[:480], chunk_count=0)
                return "failed"
            except Exception:
                log.exception("document %s failed", doc_id)
                self._discard(org_id, doc_id)
                self.repo.set_status(doc_id, "failed", 100, error="Processing failed unexpectedly. Try reprocessing it.", chunk_count=0)
                return "failed"

    def reconcile(self) -> int:
        """Removes vectors whose chunk no longer exists or now belongs to another document, for example
        after the demo data is reset. Searches already ignore them; this keeps them from taking up slots."""
        removed = 0
        with self._lock:
            for batch in self.store.points():
                owners = self.repo.chunk_owners([pid for pid, _ in batch])
                stale = [pid for pid, doc in batch if owners.get(pid) != doc]
                self.store.delete_points(stale)
                removed += len(stale)
        if removed:
            log.info("removed %s stale vectors", removed)
        return removed

    def forget(self, org_id: int, doc_id: int) -> None:
        with self._lock:
            self._discard(org_id, doc_id)

    def _discard(self, org_id: int, doc_id: int) -> None:
        self.store.delete_document(org_id, doc_id)
        self.repo.delete_chunks(org_id, doc_id)
