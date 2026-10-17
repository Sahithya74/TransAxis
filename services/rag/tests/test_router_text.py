from __future__ import annotations

from datetime import date

import numpy as np
import pytest

from app.embeddings import HashingEmbedder
from app.router import parse_period, route_question
from app.text import best_sentences, indian_group, inr, keyword_terms, snippet

TODAY = date(2026, 10, 16)


@pytest.mark.parametrize(
    ("text", "start", "end"),
    [
        ("revenue last month", "2026-09-01", "2026-09-30"),
        ("this month so far", "2026-10-01", "2026-10-16"),
        ("in August", "2026-08-01", "2026-08-31"),
        ("december", "2025-12-01", "2025-12-31"),
        ("this financial year", "2026-04-01", "2026-10-16"),
        ("last financial year", "2025-04-01", "2026-03-31"),
        ("Q1", "2026-04-01", "2026-06-30"),
        ("Q4 FY26", "2026-01-01", "2026-03-31"),
        ("last 7 days", "2026-10-10", "2026-10-16"),
        ("from 2026-09-10 to 2026-09-20", "2026-09-10", "2026-09-20"),
        ("last quarter", "2026-07-01", "2026-09-30"),
    ],
)
def test_periods(text, start, end):
    p = parse_period(text, TODAY)
    assert p is not None
    assert (p.start.isoformat(), p.end.isoformat()) == (start, end)


def test_no_period_and_the_may_trap():
    assert parse_period("what is the toll policy", TODAY) is None
    assert parse_period("may I claim a toll paid in cash?", TODAY) is None


@pytest.mark.parametrize(
    ("question", "kind", "metrics"),
    [
        ("What is the detention charge in the Coromandel contract?", "document", []),
        ("What were our revenue and profit last month?", "structured", ["finance"]),
        ("Which customers owe us the most?", "structured", ["ageing"]),
        ("Are we within the fuel policy limit this month?", "hybrid", ["fuel"]),
        ("What is the fuel policy?", "document", []),
        ("What's our profit?", "clarify", ["finance"]),
        ("How are we doing?", "clarify", []),
        ("How many open alerts are there?", "structured", ["safety"]),
    ],
)
def test_routes(question, kind, metrics):
    r = route_question(question, [], TODAY)
    assert r.kind == kind
    assert r.metrics == metrics


def test_clarification_offers_ready_made_questions():
    r = route_question("What's our profit?", [], TODAY)
    assert r.clarification and [o["label"] for o in r.clarification["options"]] == ["This month", "Last month", "This financial year"]
    assert r.clarification["options"][1]["question"] == "What's our profit last month?"


def test_follow_ups_keep_the_previous_period():
    history = [{"role": "user", "content": "What was our revenue in August?"}, {"role": "assistant", "content": "..."}]
    r = route_question("And the fuel efficiency?", history, TODAY)
    assert r.kind == "structured" and r.period and r.period.label == "August 2026"


def test_vehicle_numbers_are_recognised():
    r = route_question("Fuel efficiency of tn 04 fm 1945 last month", [], TODAY)
    assert r.vehicle == "TN04FM1945"


def test_hashing_embeddings_are_deterministic_and_meaningful():
    e = HashingEmbedder()
    a = np.array(e.embed_query("driver food allowance per day"))
    b = np.array(e.embed_documents(["Drivers receive a food allowance of Rs 350 per day on the road."])[0])
    c = np.array(e.embed_documents(["Tyres are rotated every 10,000 km."])[0])
    assert e.embed_query("driver food allowance per day") == a.tolist()
    assert abs(np.linalg.norm(a) - 1) < 1e-9
    assert float(a @ b) > float(a @ c) + 0.2


def test_text_helpers():
    assert keyword_terms("The drivers' charges") == ["driver", "charge"]
    assert indian_group(12345678) == "1,23,45,678"
    assert inr("468551.4") == "₹4,68,551"
    assert best_sentences("Tyres are checked weekly. Food allowance is Rs 350 per day. Tolls use FASTag.", "food allowance", 1) == ["Food allowance is Rs 350 per day."]
    s = snippet("x " * 400 + "the detention charge is Rs 1500 after four free hours " + "y " * 400, "detention charge", 120)
    assert "detention charge" in s and s.startswith("…") and s.endswith("…")
