"""Deciding how to answer a question: from documents, from the company's figures, both, or by asking what the
person means. Rule-based and deterministic, so the same question always takes the same route."""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Literal

RouteKind = Literal["document", "structured", "hybrid", "clarify"]


@dataclass(frozen=True)
class Period:
    start: date
    end: date
    label: str

    def as_dict(self) -> dict[str, str]:
        return {"from": self.start.isoformat(), "to": self.end.isoformat(), "label": self.label}


@dataclass
class Route:
    kind: RouteKind
    metrics: list[str] = field(default_factory=list)
    period: Period | None = None
    vehicle: str | None = None
    clarification: dict | None = None


# Metric families answered by the API's own reports. Order matters for display only.
METRIC_PATTERNS: dict[str, re.Pattern[str]] = {
    "trip_profit": re.compile(r"\b(trip profit\w*|profitab\w+ trips?|trips? (?:that )?(?:made|lost) money|loss[- ]making trips?|most profitable|least profitable)\b"),
    "ageing": re.compile(r"\b(ageing|aging|overdue|who owes|owes? us|owed|receivables?|outstanding|unpaid invoices?|dues)\b"),
    "fuel": re.compile(r"\b(fuel (?:efficiency|economy|consumption|cost|spend|usage)|mileage|km ?/ ?l|kmpl|km per lit(?:re|er)|diesel|pilferage|fuel fills?|fuel anomal\w*)\b"),
    "vehicles": re.compile(r"\b(utili[sz]ation|vehicle performance|best vehicles?|worst vehicles?|cost per km|idle vehicles?|vehicle contribution)\b"),
    "drivers": re.compile(r"\b(driver performance|on[- ]time|punctual\w*|best drivers?|late deliveries)\b"),
    "customers": re.compile(r"\b(top customers?|biggest customers?|revenue by customer|which customers?|customer revenue|largest customers?)\b"),
    "maintenance": re.compile(r"\b(maintenance (?:cost|spend)|repair (?:cost|spend)|breakdowns?|downtime|workshop (?:cost|spend))\b"),
    "expenses": re.compile(r"\b(expenses? by category|expense claims?|trip expenses?|tolls? spend|claims? pending)\b"),
    "fleet": re.compile(r"\b(how many (?:vehicles|trucks|lorries)|fleet size|vehicles? available|available vehicles?|fleet status|expired documents?|expiring documents?|compliance)\b"),
    "safety": re.compile(r"\b(safety alerts?|open alerts?|critical alerts?|active incidents?|open incidents?|how many incidents|missed check[- ]?ins?)\b"),
    "finance": re.compile(r"\b(revenue|turnover|income|earn(?:ed|ings)?|sales|collect(?:ed|ions?)?|receipts|profit|margin|p ?& ?l|costs?|spend(?:ing)?|expenditure|how (?:are|did) we do(?:ing)?|financial(?:s| performance)?)\b"),
}

# Plain words that suggest figures only when a period is mentioned too ("fuel spend this month"), so that
# "what is the fuel policy?" stays a document question.
WEAK_METRIC_PATTERNS: dict[str, re.Pattern[str]] = {
    "fuel": re.compile(r"\b(fuel|diesel)\b"),
    "expenses": re.compile(r"\b(expenses?|claims?|tolls?)\b"),
    "maintenance": re.compile(r"\b(maintenance|repairs?|servic(?:e|ing))\b"),
}

# Families whose answer depends on a period; the rest describe the present.
NEEDS_PERIOD = {"trip_profit", "fuel", "vehicles", "drivers", "customers", "maintenance", "expenses", "finance"}

DOC_CUES = re.compile(
    r"\b(polic(?:y|ies)|procedures?|sops?|contracts?|agreements?|clauses?|terms|rules?|allowed|allowances?|limits?|"
    r"penalt\w+|guidelines?|handbook|according to|documents?|what should|how (?:do|should|to|does)|process|steps|sla|"
    r"rate (?:card|sheet)|detention|demurrage|liabilit\w+|insurance|hazard\w*|explain|why|requirements?|entitled|"
    r"approval|approve|reimburs\w+|checklist|obligations?|notice period|escalat\w+|who (?:do|should) i|"
    r"what does .{1,60} say|says?|mentions?|notices?|circulars?|memos?|letters?|manual)\b"
)

VEHICLE_REG = re.compile(r"\b([A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{3,4})\b", re.IGNORECASE)

MONTHS = {name.lower(): i for i, name in enumerate(calendar.month_name) if name}
MONTHS.update({name.lower(): i for i, name in enumerate(calendar.month_abbr) if name})
MONTHS["sept"] = 9


def _month_range(y: int, m: int) -> tuple[date, date]:
    return date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])


def _fy_start(d: date) -> int:
    return d.year if d.month >= 4 else d.year - 1


def parse_period(text: str, today: date) -> Period | None:
    """Understands the periods people use in this business: months, quarters, Indian financial years
    (April to March), "last N days" and explicit ISO dates. Returns None when no period is mentioned."""
    t = text.lower()
    m = re.search(r"(?:from|between)\s+(\d{4}-\d{2}-\d{2})\s+(?:to|and|until)\s+(\d{4}-\d{2}-\d{2})", t)
    if m:
        a, b = date.fromisoformat(m.group(1)), date.fromisoformat(m.group(2))
        a, b = min(a, b), max(a, b)
        return Period(a, b, f"{a.isoformat()} to {b.isoformat()}")
    if re.search(r"\btoday\b", t):
        return Period(today, today, "Today")
    if re.search(r"\byesterday\b", t):
        y = today - timedelta(days=1)
        return Period(y, y, "Yesterday")
    m = re.search(r"\b(?:last|past|previous)\s+(\d{1,3})\s+days?\b", t)
    if m:
        n = max(1, min(366, int(m.group(1))))
        return Period(today - timedelta(days=n - 1), today, f"Last {n} days")
    if re.search(r"\bthis week\b", t):
        start = today - timedelta(days=today.weekday())
        return Period(start, today, "This week")
    if re.search(r"\b(?:last|previous) week\b", t):
        end = today - timedelta(days=today.weekday() + 1)
        return Period(end - timedelta(days=6), end, "Last week")
    if re.search(r"\b(?:this|current) month\b|\bmonth to date\b|\bmtd\b", t):
        return Period(today.replace(day=1), today, "This month")
    if re.search(r"\b(?:last|previous|past) month\b", t):
        y, mo = (today.year - 1, 12) if today.month == 1 else (today.year, today.month - 1)
        a, b = _month_range(y, mo)
        return Period(a, b, calendar.month_name[mo] + f" {y}")
    if re.search(r"\b(?:this|current) quarter\b|\bqtd\b", t):
        qm = today.month - (today.month - 1) % 3
        return Period(date(today.year, qm, 1), today, "This quarter")
    if re.search(r"\b(?:last|previous) quarter\b", t):
        qm = today.month - (today.month - 1) % 3
        end = date(today.year, qm, 1) - timedelta(days=1)
        start = date(end.year, end.month - 2, 1)
        return Period(start, end, "Last quarter")
    m = re.search(r"\bq([1-4])\b(?:\s*(?:fy)?\s*'?(\d{4}|\d{2})\b)?", t)
    if m:
        # Indian financial-year quarters: Q1 is April to June, Q4 is January to March. A year names the
        # financial year by its end, as in "Q2 FY27".
        q = int(m.group(1))
        if m.group(2):
            yr = int(m.group(2))
            fy = (2000 + yr if yr < 100 else yr) - 1
        else:
            fy = _fy_start(today)

        def bounds(fy: int) -> tuple[date, date]:
            y, first = (fy, 4 + 3 * (q - 1)) if q < 4 else (fy + 1, 1)
            return date(y, first, 1), _month_range(y, first + 2)[1]

        a, b = bounds(fy)
        if not m.group(2) and a > today:
            fy -= 1
            a, b = bounds(fy)
        return Period(a, min(b, today), f"Q{q} FY{fy}-{(fy + 1) % 100:02d}")
    if re.search(r"\b(?:last|previous) (?:financial |fiscal )?year\b|\blast fy\b", t):
        fy = _fy_start(today) - 1
        return Period(date(fy, 4, 1), date(fy + 1, 3, 31), f"FY {fy}-{str(fy + 1)[-2:]}")
    if re.search(r"\b(?:this|current) (?:financial |fiscal )?year\b|\bthis fy\b|\bytd\b|\byear to date\b|\bso far this year\b", t):
        fy = _fy_start(today)
        return Period(date(fy, 4, 1), today, f"FY {fy}-{str(fy + 1)[-2:]} to date")
    m = re.search(r"\b(" + "|".join(sorted(MONTHS, key=len, reverse=True)) + r")\b(?:\s+(\d{4}))?", t)
    if m and not re.search(r"\bmay (?:i|we|be|have|not)\b", t):
        mo = MONTHS[m.group(1)]
        y = int(m.group(2)) if m.group(2) else today.year
        if not m.group(2) and date(y, mo, 1) > today:
            y -= 1
        a, b = _month_range(y, mo)
        return Period(a, min(b, today), f"{calendar.month_name[mo]} {y}")
    return None


def _clarify_period(question: str) -> dict:
    base = question.rstrip(" ?.")
    return {
        "question": "Which period do you mean?",
        "options": [
            {"label": "This month", "question": f"{base} this month?"},
            {"label": "Last month", "question": f"{base} last month?"},
            {"label": "This financial year", "question": f"{base} this financial year?"},
        ],
    }


VAGUE = re.compile(r"^\s*(how (?:are|is) (?:we|it|things|the business) (?:doing|going)|any (?:updates?|news)|status|summary|report)\s*\??\s*$", re.IGNORECASE)


def route_question(question: str, history: list[dict], today: date) -> Route:
    q = question.lower()
    if VAGUE.match(question):
        return Route(
            kind="clarify",
            clarification={
                "question": "What would you like to look at?",
                "options": [
                    {"label": "Revenue and profit", "question": "What were our revenue, costs and profit this month?"},
                    {"label": "Overdue payments", "question": "Which customers owe us the most overdue money?"},
                    {"label": "Fuel efficiency", "question": "How was our fuel efficiency last month?"},
                    {"label": "Safety right now", "question": "How many open safety alerts and incidents are there?"},
                ],
            },
        )
    metrics = [k for k, pat in METRIC_PATTERNS.items() if pat.search(q)]
    doc = bool(DOC_CUES.search(q))
    mentioned = parse_period(question, today)
    if mentioned or not doc:
        metrics += [k for k, pat in WEAK_METRIC_PATTERNS.items() if k not in metrics and pat.search(q)]
    # "fuel cost" is a fuel question, not a general one; keep the general summary only when nothing narrower matched.
    if "finance" in metrics and len(metrics) > 1 and not re.search(r"\b(revenue|profit|margin|collect\w*|turnover|income|sales)\b", q):
        metrics.remove("finance")
    if "ageing" in metrics and "finance" in metrics and not re.search(r"\b(revenue|profit|margin|turnover|income|sales|costs?)\b", q):
        metrics.remove("finance")
    if "ageing" in metrics and "customers" in metrics and not re.search(r"\b(revenue|business|sales|trips)\b", q):
        metrics.remove("customers")
    if "trip_profit" in metrics and "finance" in metrics and not re.search(r"\b(revenue|overall|total|company)\b", q):
        metrics.remove("finance")
    reg = VEHICLE_REG.search(question)
    vehicle = re.sub(r"\s", "", reg.group(1)).upper() if reg else None

    if not metrics:
        return Route(kind="document", vehicle=vehicle)
    period = mentioned
    if period is None and any(m in NEEDS_PERIOD for m in metrics):
        # A follow-up such as "and the costs?" keeps the period of the previous question.
        for turn in reversed(history):
            if turn.get("role") == "user":
                period = parse_period(str(turn.get("content", "")), today)
                if period:
                    break
    kind: RouteKind = "hybrid" if doc else "structured"
    if period is None and any(m in NEEDS_PERIOD for m in metrics):
        return Route(kind="clarify", metrics=metrics, vehicle=vehicle, clarification=_clarify_period(question))
    return Route(kind=kind, metrics=metrics, period=period, vehicle=vehicle)
