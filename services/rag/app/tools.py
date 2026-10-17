"""Figures for structured questions. The service never queries business tables itself: it calls the API's own
report endpoints with the asking user's token, so permissions and definitions are exactly those of the app."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date

import httpx2

from .router import Period
from .text import indian_group, inr


class ToolDenied(Exception):
    """The user isn't allowed to see these figures."""


class ToolFailed(Exception):
    """The figures couldn't be loaded."""


@dataclass(frozen=True)
class StructuredResult:
    metric: str
    value: str
    params: dict
    link: str | None

    def as_dict(self) -> dict:
        return {"metric": self.metric, "value": self.value, "params": self.params, "link": self.link}


@dataclass
class ToolOutput:
    results: list[StructuredResult] = field(default_factory=list)
    #: Plain statements handed to the language model as the only figures it may use.
    facts: list[str] = field(default_factory=list)


METRIC_LABELS = {
    "finance": "revenue, costs and profit",
    "ageing": "money owed by customers",
    "trip_profit": "trip profitability",
    "fuel": "fuel figures",
    "vehicles": "vehicle performance",
    "drivers": "driver performance",
    "customers": "revenue by customer",
    "maintenance": "maintenance costs",
    "expenses": "expense claims",
    "fleet": "fleet status",
    "safety": "safety alerts and incidents",
}


def _num(v: object) -> float:
    try:
        return float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0


def _pct(part: float, whole: float) -> str:
    return f"{round(part / whole * 100, 1)}%" if whole else "—"


class MetricTools:
    def __init__(self, base_url: str, token: str, today: date, http: httpx2.Client | None = None) -> None:
        self.http = http or httpx2.Client(base_url=base_url, headers={"authorization": f"Bearer {token}"}, timeout=15.0)
        self.today = today

    def close(self) -> None:
        self.http.close()

    def _get(self, path: str, params: dict | None = None) -> dict:
        try:
            r = self.http.get(path, params=params)
        except httpx2.HTTPError as e:
            raise ToolFailed(path) from e
        if r.status_code in (401, 403):
            raise ToolDenied(path)
        if r.status_code >= 400:
            raise ToolFailed(f"{path}: {r.status_code}")
        return r.json()

    def run(self, metric: str, period: Period | None, vehicle: str | None) -> ToolOutput:
        handler: Callable[[Period | None, str | None], ToolOutput] = getattr(self, f"_{metric}")
        return handler(period, vehicle)

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _pq(p: Period) -> str:
        return f"period=custom&from={p.start.isoformat()}&to={p.end.isoformat()}"

    @staticmethod
    def _params(p: Period | None, **extra: object) -> dict:
        out: dict = {"from": p.start.isoformat(), "to": p.end.isoformat(), "period": p.label} if p else {}
        out.update({k: v for k, v in extra.items() if v is not None})
        return out

    def _table(self, key: str, p: Period) -> dict:
        return self._get(f"/reports/{key}", {"from": p.start.isoformat(), "to": p.end.isoformat()})

    # ------------------------------------------------------------------ metric families

    def _finance(self, p: Period | None, _vehicle: str | None) -> ToolOutput:
        assert p is not None
        s = self._get("/finance/summary", {"from": p.start.isoformat(), "to": p.end.isoformat()})
        link = f"/finance?{self._pq(p)}"
        params = self._params(p)
        c = s["costs"]
        margin = f" ({s['marginPct']}% of revenue)" if s.get("marginPct") is not None else ""
        out = ToolOutput()
        out.results = [
            StructuredResult("Revenue earned", inr(s["revenueEarned"]), params, link),
            StructuredResult("Costs", inr(c["total"]), params, link),
            StructuredResult("Gross profit", inr(s["grossProfit"]) + margin, params, link),
            StructuredResult("Collected", inr(s["collected"]), params, "/invoices?tab=receipts"),
        ]
        out.facts = [
            f"Period: {p.label} ({p.start.isoformat()} to {p.end.isoformat()}).",
            f"Revenue earned (approved freight of trips delivered in the period, before GST): {inr(s['revenueEarned'])}.",
            f"Invoiced in the period, net of credit notes: {inr(s['invoiced'])}.",
            f"Collected in the period, including TDS deducted by customers: {inr(s['collected'])}.",
            f"Costs booked in the period: {inr(c['total'])} in total, made up of fuel {inr(c['fuel'])}, driver and crew pay {inr(c['crew'])}, "
            f"trip expenses {inr(c['tripExpenses'])}, repairs and maintenance {inr(c['maintenance'])}, and hire and office {inr(c['other'])}.",
            f"Gross profit: {inr(s['grossProfit'])}{margin}.",
            f"Outstanding from customers today: {inr(s['outstanding'])}, of which {inr(s['overdue'])} is overdue.",
        ]
        return out

    def _ageing(self, _p: Period | None, _vehicle: str | None) -> ToolOutput:
        today = self.today.isoformat()
        s = self._get("/finance/summary", {"from": today, "to": today})
        t = self._get("/reports/receivables-ageing", {"from": today, "to": today})
        rows = sorted(t.get("rows", []), key=lambda r: -_num(r.get("total")))
        overdue_rows = sorted(rows, key=lambda r: -(_num(r.get("total")) - _num(r.get("current"))))
        out = ToolOutput()
        params = {"asOf": today}
        out.results = [
            StructuredResult("Outstanding now", inr(s["outstanding"]), params, "/invoices"),
            StructuredResult("Overdue now", inr(s["overdue"]), params, "/invoices?status=overdue"),
            StructuredResult("Over 90 days overdue", inr(s["ageing"]["90_plus"]), params, "/reports?report=receivables-ageing"),
        ]
        if overdue_rows and _num(overdue_rows[0].get("total")) - _num(overdue_rows[0].get("current")) > 0:
            top = overdue_rows[0]
            out.results.append(StructuredResult("Most overdue customer", f"{top['customer']}: {inr(_num(top['total']) - _num(top['current']))} overdue", params, "/invoices?status=overdue"))
        a = s["ageing"]
        out.facts = [
            f"As of {today}: {inr(s['outstanding'])} is outstanding from customers and {inr(s['overdue'])} of it is overdue.",
            f"By days past due: not yet due {inr(a['current'])}; 1–30 days {inr(a['1_30'])}; 31–60 days {inr(a['31_60'])}; 61–90 days {inr(a['61_90'])}; over 90 days {inr(a['90_plus'])}.",
        ]
        for r in overdue_rows[:5]:
            od = _num(r.get("total")) - _num(r.get("current"))
            if od > 0:
                out.facts.append(f"{r['customer']} owes {inr(r['total'])} in total, of which {inr(od)} is overdue ({inr(r.get('90_plus'))} over 90 days).")
        return out

    def _trip_profit(self, p: Period | None, vehicle: str | None) -> ToolOutput:
        assert p is not None
        rows = self._get("/reports/trip-profitability", {"from": p.start.isoformat(), "to": p.end.isoformat()})["data"]
        if vehicle:
            rows = [r for r in rows if r["vehicle"]["registrationNo"].replace(" ", "").upper() == vehicle]
        out = ToolOutput()
        params = self._params(p, vehicle=vehicle)
        link = f"/reports?{self._pq(p)}"
        if not rows:
            out.facts = [f"No trips were delivered in {p.label}{f' by {vehicle}' if vehicle else ''}."]
            out.results = [StructuredResult("Trips delivered", "0", params, link)]
            return out
        revenue = sum(_num(r["revenue"]) for r in rows)
        profit = sum(_num(r["profit"]) for r in rows)
        with_margin = [r for r in rows if r.get("marginPct") is not None]
        best = max(with_margin, key=lambda r: r["marginPct"]) if with_margin else None
        worst = min(with_margin, key=lambda r: r["marginPct"]) if with_margin else None
        provisional = sum(1 for r in rows if r.get("provisional"))
        out.results = [
            StructuredResult("Trips delivered", str(len(rows)), params, link),
            StructuredResult("Trip profit", f"{inr(profit)} ({_pct(profit, revenue)} of {inr(revenue)} revenue)", params, link),
        ]
        if best:
            out.results.append(StructuredResult("Best margin", f"{best['trip']['tripNo']} ({best['trip']['originCity']} to {best['trip']['destinationCity']}): {best['marginPct']}%", params, f"/trips/{best['trip']['id']}"))
        if worst and worst is not best:
            out.results.append(StructuredResult("Lowest margin", f"{worst['trip']['tripNo']} ({worst['trip']['originCity']} to {worst['trip']['destinationCity']}): {worst['marginPct']}%", params, f"/trips/{worst['trip']['id']}"))
        out.facts = [
            f"Period: {p.label}. {len(rows)} trips delivered{f' by {vehicle}' if vehicle else ''}, with revenue {inr(revenue)} and profit after fuel, trip expenses and crew pay of {inr(profit)} ({_pct(profit, revenue)}).",
            f"{provisional} of these trips are provisional: their costs may still change (for example fuel not recorded, expenses awaiting approval or crew pay not yet accrued).",
        ]
        if best:
            out.facts.append(f"Highest margin: {best['trip']['tripNo']}, {best['trip']['originCity']} to {best['trip']['destinationCity']} for {best['customer']}, {best['marginPct']}% (profit {inr(best['profit'])}).")
        if worst and worst is not best:
            out.facts.append(f"Lowest margin: {worst['trip']['tripNo']}, {worst['trip']['originCity']} to {worst['trip']['destinationCity']} for {worst['customer']}, {worst['marginPct']}% (profit {inr(worst['profit'])}).")
        return out

    def _fuel(self, p: Period | None, vehicle: str | None) -> ToolOutput:
        assert p is not None
        t = self._table("fuel-efficiency", p)
        rows = t.get("rows", [])
        if vehicle:
            rows = [r for r in rows if str(r["vehicle"]).replace(" ", "").upper() == vehicle]
        out = ToolOutput()
        params = self._params(p, vehicle=vehicle)
        link = f"/fuel?tab=vehicles&{self._pq(p)}"
        if not rows:
            out.facts = [f"No fuel fills were recorded in {p.label}{f' for {vehicle}' if vehicle else ''}."]
            out.results = [StructuredResult("Fuel fills", "0", params, link)]
            return out
        litres = sum(_num(r["litres"]) for r in rows)
        spend = sum(_num(r["amount"]) for r in rows)
        flagged = sum(int(_num(r["anomalies"])) for r in rows)
        measured = [r for r in rows if r.get("kmpl") is not None]
        weight = sum(_num(r["litres"]) for r in measured)
        avg = round(sum(_num(r["kmpl"]) * _num(r["litres"]) for r in measured) / weight, 2) if weight else None
        below = sorted(
            [r for r in measured if r.get("declared") and _num(r["kmpl"]) < 0.85 * _num(r["declared"])],
            key=lambda r: _num(r["kmpl"]) / _num(r["declared"]),
        )
        out.results = [
            StructuredResult("Fuel spend", inr(spend), params, link),
            StructuredResult("Litres", indian_group(round(litres)), params, link),
            StructuredResult("Average km/L", str(avg) if avg is not None else "Not measured", params, link),
            StructuredResult("Flagged fills", str(flagged), params, f"/fuel?anomaly=true"),
        ]
        out.facts = [
            f"Period: {p.label}{f', vehicle {vehicle}' if vehicle else ''}. Fuel spend {inr(spend)} on {indian_group(round(litres))} litres.",
            f"Average mileage, measured full tank to full tank and weighted by litres: {avg} km/L." if avg is not None else "Mileage could not be measured (no consecutive full-tank fills).",
            f"{flagged} fill{' was' if flagged == 1 else 's were'} flagged as unusual (low mileage, more litres than the tank holds, or odometer errors).",
        ]
        for r in below[:5]:
            out.facts.append(f"{r['vehicle']} ({r['type']}) averaged {r['kmpl']} km/L against an expected {r['declared']} km/L.")
        return out

    def _vehicles(self, p: Period | None, vehicle: str | None) -> ToolOutput:
        assert p is not None
        t = self._table("vehicle-performance", p)
        rows = t.get("rows", [])
        link = f"/reports?report=vehicle-performance&{self._pq(p)}"
        params = self._params(p, vehicle=vehicle)
        out = ToolOutput()
        if vehicle:
            rows = [r for r in rows if str(r["vehicle"]).replace(" ", "").upper() == vehicle]
            if not rows:
                out.facts = [f"No vehicle {vehicle} was found in the fleet report."]
                return out
            r = rows[0]
            out.results = [
                StructuredResult("Trips delivered", str(r["trips"]), params, link),
                StructuredResult("Contribution", inr(r["profit"]), params, link),
                StructuredResult("Utilisation", f"{r['utilisation']}%", params, link),
                StructuredResult("Cost per km", inr(r["costPerKm"]) if r.get("costPerKm") else "—", params, link),
            ]
            out.facts = [
                f"{r['vehicle']} ({r['type']}) in {p.label}: {r['trips']} trips, {indian_group(int(r['km']))} km, revenue {inr(r['revenue'])}, fuel {inr(r['fuel'])}, "
                f"maintenance {inr(r['maintenance'])}, crew and trip costs {inr(r['otherCosts'])}, contribution {inr(r['profit'])}, utilisation {r['utilisation']}%."
            ]
            return out
        tot = t.get("totals") or {}
        active = [r for r in rows if r.get("trips")]
        best = max(active, key=lambda r: _num(r["profit"]), default=None)
        idle = sorted(rows, key=lambda r: _num(r["utilisation"]))[:3]
        out.results = [
            StructuredResult("Trips delivered", str(tot.get("trips", 0)), params, link),
            StructuredResult("Fleet contribution", inr(tot.get("profit")), params, link),
        ]
        if best:
            out.results.append(StructuredResult("Highest contribution", f"{best['vehicle']}: {inr(best['profit'])}", params, link))
        out.facts = [f"Period: {p.label}. The fleet delivered {tot.get('trips', 0)} trips over {indian_group(int(_num(tot.get('km'))))} km, revenue {inr(tot.get('revenue'))}, contribution {inr(tot.get('profit'))} (before overheads)."]
        if best:
            out.facts.append(f"Highest contribution: {best['vehicle']} with {inr(best['profit'])} from {best['trips']} trips.")
        for r in idle:
            out.facts.append(f"Low utilisation: {r['vehicle']} was on a trip {r['utilisation']}% of the period.")
        return out

    def _drivers(self, p: Period | None, _vehicle: str | None) -> ToolOutput:
        assert p is not None
        t = self._table("driver-performance", p)
        rows = [r for r in t.get("rows", []) if r.get("trips")]
        link = f"/reports?report=driver-performance&{self._pq(p)}"
        params = self._params(p)
        out = ToolOutput()
        rated = [r for r in rows if r.get("onTime") is not None and r["trips"] >= 2]
        best = sorted(rated, key=lambda r: (-r["onTime"], -r["trips"]))[:3]
        worst = sorted(rated, key=lambda r: (r["onTime"], -r["trips"]))[:3]
        trips = sum(r["trips"] for r in rows)
        on_time = sum(round(r["onTime"] * r["trips"] / 100) for r in rows if r.get("onTime") is not None)
        out.results = [
            StructuredResult("Trips delivered", str(trips), params, link),
            StructuredResult("On time", _pct(on_time, trips), params, link),
        ]
        if best:
            out.results.append(StructuredResult("Most punctual", f"{best[0]['driver']}: {best[0]['onTime']}% of {best[0]['trips']} trips", params, link))
        out.facts = [f"Period: {p.label}. {len(rows)} drivers delivered {trips} trips; {_pct(on_time, trips)} were on time (delivered within 30 minutes of the planned end)."]
        out.facts += [f"{r['driver']}: {r['onTime']}% on time over {r['trips']} trips, {r['alerts']} safety alerts, {r['incidents']} incidents." for r in best]
        out.facts += [f"Least punctual: {r['driver']}: {r['onTime']}% on time over {r['trips']} trips." for r in worst if r not in best]
        return out

    def _customers(self, p: Period | None, _vehicle: str | None) -> ToolOutput:
        assert p is not None
        t = self._table("revenue-by-customer", p)
        rows = sorted(t.get("rows", []), key=lambda r: -_num(r["revenue"]))
        link = f"/reports?report=revenue-by-customer&{self._pq(p)}"
        params = self._params(p)
        out = ToolOutput()
        out.results = [StructuredResult(f"#{i + 1} {r['customer']}", inr(r["revenue"]), params, link) for i, r in enumerate(rows[:3])]
        out.facts = [f"Period: {p.label}. Revenue by customer (freight earned on delivered trips, before GST):"]
        out.facts += [f"{r['customer']}: {inr(r['revenue'])} from {r['trips']} trips; invoiced {inr(r['invoiced'])}, collected {inr(r['collected'])}, outstanding now {inr(r['outstanding'])}." for r in rows[:6]]
        return out

    def _maintenance(self, p: Period | None, vehicle: str | None) -> ToolOutput:
        assert p is not None
        t = self._table("maintenance-cost", p)
        rows = t.get("rows", [])
        if vehicle:
            rows = [r for r in rows if str(r["vehicle"]).replace(" ", "").upper() == vehicle]
        link = f"/reports?report=maintenance-cost&{self._pq(p)}"
        params = self._params(p, vehicle=vehicle)
        total = sum(_num(r["total"]) for r in rows)
        jobs = sum(int(_num(r["jobs"])) for r in rows)
        breakdowns = sum(int(_num(r["breakdowns"])) for r in rows)
        downtime = round(sum(_num(r["downtime"]) for r in rows), 1)
        out = ToolOutput()
        out.results = [
            StructuredResult("Maintenance cost", inr(total), params, link),
            StructuredResult("Jobs completed", str(jobs), params, link),
            StructuredResult("Breakdowns", str(breakdowns), params, link),
        ]
        out.facts = [f"Period: {p.label}{f', vehicle {vehicle}' if vehicle else ''}. {jobs} workshop jobs completed for {inr(total)}, including {breakdowns} breakdowns; vehicles were off the road for {downtime} hours."]
        for r in sorted(rows, key=lambda r: -_num(r["total"]))[:3]:
            out.facts.append(f"{r['vehicle']}: {r['jobs']} jobs costing {inr(r['total'])} (parts {inr(r['parts'])}, labour {inr(r['labour'])}).")
        return out

    def _expenses(self, p: Period | None, _vehicle: str | None) -> ToolOutput:
        assert p is not None
        t = self._table("expenses-by-category", p)
        rows = t.get("rows", [])
        tot = t.get("totals") or {}
        link = f"/expenses?status=submitted"
        params = self._params(p)
        out = ToolOutput()
        out.results = [
            StructuredResult("Approved expenses", inr(tot.get("approved")), params, f"/reports?report=expenses-by-category&{self._pq(p)}"),
            StructuredResult("Awaiting approval", inr(tot.get("pending")), params, link),
        ]
        out.facts = [f"Period: {p.label}. Expense claims: {inr(tot.get('approved'))} approved, {inr(tot.get('pending'))} awaiting approval, {inr(tot.get('rejected'))} rejected."]
        for r in sorted(rows, key=lambda r: -_num(r["approved"]))[:5]:
            out.facts.append(f"{r['category']}: {r['count']} claims, {inr(r['approved'])} approved, {inr(r['pending'])} pending.")
        return out

    def _fleet(self, _p: Period | None, _vehicle: str | None) -> ToolOutput:
        s = self._get("/vehicles/summary")
        by, comp = s["byStatus"], s["compliance"]
        params = {"asOf": s.get("asOf")}
        out = ToolOutput()
        out.results = [
            StructuredResult("Vehicles", str(s["total"]), params, "/vehicles"),
            StructuredResult("Available now", str(by.get("available", 0)), params, "/vehicles?status=available"),
            StructuredResult("Expired documents", str(comp.get("expired", 0)), params, "/vehicles?compliance=expired"),
        ]
        out.facts = [
            f"As of {s.get('asOf')}: {s['total']} vehicles. Available {by.get('available', 0)}, assigned {by.get('assigned', 0)}, on a trip {by.get('on_trip', 0)}, "
            f"under maintenance {by.get('under_maintenance', 0)}, unavailable {by.get('unavailable', 0)}, retired {by.get('retired', 0)}.",
            f"Compliance (excluding retired vehicles): {comp.get('expired', 0)} with an expired document, {comp.get('missing', 0)} missing documents, "
            f"{comp.get('expiring', 0)} expiring within {s.get('expiryWarningDays')} days, {comp.get('ok', 0)} fully compliant.",
        ]
        return out

    def _safety(self, _p: Period | None, _vehicle: str | None) -> ToolOutput:
        s = self._get("/tracking/summary")
        a = s["openAlerts"]
        out = ToolOutput()
        out.results = [
            StructuredResult("Open critical alerts", str(a["critical"]), {}, "/control-room"),
            StructuredResult("Open warnings", str(a["warning"]), {}, "/alerts"),
            StructuredResult("Active incidents", str(s["activeIncidents"]), {}, "/incidents"),
            StructuredResult("Missed check-ins", str(s["missedCheckins"]), {}, "/control-room"),
        ]
        out.facts = [
            f"Right now: {a['critical']} critical and {a['warning']} warning safety alerts are open, {s['activeIncidents']} incidents are active and {s['missedCheckins']} driver check-ins are missed.",
            f"{s['live']} vehicles are reporting positions and {s['stale']} have no recent position."
            + (" Positions in this demo are simulated." if s.get("simulated") else ""),
        ]
        return out
