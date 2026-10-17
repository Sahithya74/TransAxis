from __future__ import annotations

import pytest

from app.ingest import ParseError, Section, chunk_sections, parse_csv, parse_docx, parse_pdf, parse_text, storage_path
from conftest import POLICY, make_docx, make_pdf


def test_text_is_split_at_headings(tmp_path):
    p = tmp_path / "policy.txt"
    p.write_text(POLICY, encoding="utf-8")
    sections = parse_text(p)
    headings = [s.heading for s in sections]
    assert "2. Driver food allowance" in headings
    food = next(s for s in sections if s.heading == "2. Driver food allowance")
    assert "Rs 350 per day" in food.text


def test_csv_rows_carry_their_column_names(tmp_path):
    p = tmp_path / "rates.csv"
    p.write_text("Vehicle type,Rate per km,Minimum per trip\n20 ft container,2.50,1500\n32 ft MXL,3.00,1800\n", encoding="utf-8")
    sections = parse_csv(p)
    assert sections[0].heading == "Rows 1–2"
    assert "Vehicle type: 32 ft MXL; Rate per km: 3.00; Minimum per trip: 1800" in sections[0].text


def test_word_files_keep_headings_and_tables(tmp_path):
    p = tmp_path / "contract.docx"
    make_docx(p, [("h1", "Payment terms"), ("p", "Invoices are due within 30 days."), ("h1", "Detention"), ("p", "Detention is charged after 4 free hours."), ("table", "Hours|Charge\n4-10|1500\nOver 10|3000")])
    sections = parse_docx(p)
    assert [s.heading for s in sections] == ["Payment terms", "Detention"]
    assert "Over 10 | 3000" in sections[1].text


def test_pdf_pages_are_numbered(tmp_path):
    p = tmp_path / "sop.pdf"
    make_pdf(p, ["Hazardous goods SOP\nCheck in every 4 hours.", "SOS\nPress SOS and call 112 if anyone is hurt."])
    sections = parse_pdf(p)
    assert [s.page for s in sections] == [1, 2]
    assert "call 112" in sections[1].text


@pytest.mark.parametrize(
    ("name", "data", "message"),
    [
        ("broken.pdf", b"%PDF-1.4 this is not really a pdf", "could not be read"),
        ("empty.txt", b"", "empty"),
        ("broken.docx", b"PK\x03\x04 not a word file", "could not be read"),
        ("one-line.csv", b"only,a,header\n", "header row"),
    ],
)
def test_bad_files_fail_with_a_clear_message(tmp_path, name, data, message):
    from app.ingest import parse_file

    p = tmp_path / name
    p.write_bytes(data)
    with pytest.raises(ParseError, match=message):
        parse_file(p, "", name)


def test_chunks_respect_size_overlap_and_sections():
    long = " ".join(f"Sentence number {i} explains part of the procedure." for i in range(60))
    chunks = chunk_sections([Section(text=long, page=3, heading="Procedure")], size=300, overlap=60)
    assert len(chunks) > 3
    assert [c.seq for c in chunks] == list(range(len(chunks)))
    for c in chunks:
        assert c.page == 3 and c.section == "Procedure"
        assert c.content.startswith("Procedure\n")
        assert len(c.content) <= 300 + len("Procedure\n")
    # Consecutive chunks share text, so a sentence cut at a boundary is still findable.
    first_tail = chunks[0].content.split("\n", 1)[1][-40:]
    assert first_tail.split(" ", 1)[1] in chunks[1].content


def test_storage_paths_cannot_escape_the_upload_folder(tmp_path):
    (tmp_path / "secret.txt").write_text("nope")
    up = tmp_path / "uploads"
    up.mkdir()
    with pytest.raises(ParseError, match="invalid"):
        storage_path(up, "../secret.txt")


def test_ingestion_marks_documents_ready(ingestor, repo, add_doc):
    doc = add_doc(1, "policy.txt", POLICY.encode())
    assert ingestor.run(1, doc.id) == "ready"
    state = repo.status_of(doc.id)
    assert state.status == "ready" and state.progress == 100
    assert state.fields["chunk_count"] > 0 and state.fields["embedding_model"] == "hashing-v1"


def test_failed_parsing_is_recorded_and_leaves_nothing_searchable(ingestor, repo, add_doc, principal):
    doc = add_doc(1, "scan.pdf", b"%PDF-1.4 garbage")
    assert ingestor.run(1, doc.id) == "failed"
    state = repo.status_of(doc.id)
    assert state.status == "failed" and "could not be read" in state.fields["error"]
    assert repo.keyword_search(1, ["general"], "garbage", 5) == []


def test_superseded_documents_are_not_processed(ingestor, repo, add_doc):
    doc = add_doc(1, "old.txt", POLICY.encode(), status="superseded")
    assert ingestor.run(1, doc.id) == "skipped"
    assert repo.status_of(doc.id).status == "superseded"
