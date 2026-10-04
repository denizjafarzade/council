"""The user's trading history -> exposure summary. No model calls.

Input: CSV with columns date,ticker,side,qty,price (side = buy or sell; lines starting with # are
comments). Trades are replayed in
date order with average cost. Tickers map to a market and sector only through the tickers we
already fetch (each market's index and the sector library's proxies); anything else is "not covered",
never guessed. Costs are converted to USD at the cached FX rate of each market, because a
portfolio mixing HKD, JPY and USD prices cannot be added up otherwise.

Only aggregated percentages (event_payload) ever reach a model or a recording.
"""

import csv
import io
from dataclasses import dataclass, field
from datetime import date

from schemas import DataPack

import orchestrator  # CACHE_DIR, patched in tests

# Instruments a user can hold: sector proxies and the index. FX and yield series map to a market
# but are not holdings.
ROLE_LABEL = {"idx": "Broad index"}
# US-listed proxies for other markets trade in dollars.
USD_LISTED = {"KSA"}


class PortfolioError(ValueError):
    pass


@dataclass
class Holding:
    ticker: str
    qty: float = 0.0
    avg_cost: float = 0.0  # local currency per share
    realised: float = 0.0  # local currency, closed trades
    closed_cost: float = 0.0  # cost basis of the shares sold


@dataclass
class Summary:
    label: str
    holdings: list[dict]
    by_market: list[dict]
    by_sector: list[dict]
    largest: dict | None
    not_covered: list[str]
    not_covered_pct: float  # share of open positions (not of money: their currency is unknown)
    realised_by_market: list[dict]
    notes: list[str] = field(default_factory=list)
    invested_usd: float = 0.0

    def event_payload(self) -> dict:
        """What the Chair and recordings see: percentages and words only."""
        return {
            "by_market": [{"name": m["market"], "pct": m["pct"]} for m in self.by_market],
            "by_sector": [{"name": s["sector"], "pct": s["pct"]} for s in self.by_sector],
            "largest": f"{self.largest['market']} {self.largest['sector']}" if self.largest else None,
            "largest_pct": self.largest["pct"] if self.largest else None,
            "not_covered_pct": self.not_covered_pct,
            "not_covered_count": len(self.not_covered),
            "realised_pct_by_market": [{"name": r["market"], "pct": r["pct"]} for r in self.realised_by_market],
            "label": self.label,
        }


def ticker_map() -> dict[str, tuple[str, str]]:
    """ticker -> (market code, sector id or "Broad index"), from the tickers we already fetch."""
    import library
    from data import fetch

    holdable = library.sector_ids() | {"idx"}
    out: dict[str, tuple[str, str]] = {}
    for code in library.markets():
        try:
            roles = fetch.tickers_for(code)
        except KeyError:  # a custom market without tickers
            continue
        for role, (ticker, _name) in roles.items():
            if role in holdable:
                out[ticker.upper()] = (code, ROLE_LABEL.get(role, role))
    return out


def usd_rates() -> dict[str, float | None]:
    """Market code -> local currency units per USD, from the cached DataPacks' FX series."""
    rates: dict[str, float | None] = {"US": 1.0}
    for folder in (orchestrator.CACHE_DIR,):  # real cached rates only, never the mock packs
        for path in folder.glob("*.json"):
            code = path.stem
            if code in rates:
                continue
            pack = DataPack.model_validate_json(path.read_text(encoding="utf-8"))
            fx = next((s for s in pack.series if s.id == f"{code}-fx"), None)
            rates[code] = fx.last if fx and fx.last > 0 else None
    return rates


def parse(text: str) -> list[dict]:
    lines = [ln for ln in text.lstrip("﻿").splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    rows = list(csv.DictReader(io.StringIO("\n".join(lines))))
    if not rows:
        raise PortfolioError("the CSV has no trades")
    need = {"date", "ticker", "side", "qty", "price"}
    have = {(k or "").strip().lower() for k in rows[0]}
    if not need <= have:
        raise PortfolioError(f"missing columns: {', '.join(sorted(need - have))} (need date,ticker,side,qty,price)")
    trades = []
    for i, raw in enumerate(rows, start=2):
        r = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
        if not any(r.values()):
            continue
        try:
            side = r["side"].lower()
            if side not in ("buy", "sell"):
                raise ValueError(f"side must be buy or sell, got {r['side']!r}")
            qty, price = float(r["qty"]), float(r["price"])
            if qty <= 0 or price <= 0:
                raise ValueError("qty and price must be positive")
            trades.append({"date": date.fromisoformat(r["date"]), "ticker": r["ticker"].upper(),
                           "side": side, "qty": qty, "price": price})
        except (ValueError, KeyError) as e:
            raise PortfolioError(f"line {i}: {e}") from e
    return sorted(trades, key=lambda t: t["date"])


def summarise(text: str, label: str = "Your portfolio") -> Summary:
    trades = parse(text)
    notes: list[str] = []
    book: dict[str, Holding] = {}
    for t in trades:
        h = book.setdefault(t["ticker"], Holding(t["ticker"]))
        if t["side"] == "buy":
            h.avg_cost = (h.avg_cost * h.qty + t["price"] * t["qty"]) / (h.qty + t["qty"])
            h.qty += t["qty"]
        else:
            sold = min(t["qty"], h.qty)
            if sold < t["qty"]:
                notes.append(f"{t['ticker']} on {t['date']}: sold {t['qty']:g} but held {h.qty:g}; "
                             "short selling is not supported, the extra was ignored")
            h.realised += (t["price"] - h.avg_cost) * sold
            h.closed_cost += h.avg_cost * sold
            h.qty -= sold

    mapping, rates = ticker_map(), usd_rates()

    def to_usd(ticker: str, amount: float) -> float | None:
        market = mapping[ticker][0]
        if ticker in USD_LISTED:
            return amount
        rate = rates.get(market)
        return amount / rate if rate else None

    holdings, not_covered = [], []
    for h in book.values():
        if h.qty <= 1e-9:
            continue
        cost = h.qty * h.avg_cost
        if h.ticker not in mapping:
            not_covered.append(h.ticker)
            holdings.append({"ticker": h.ticker, "qty": h.qty, "avg_cost": round(h.avg_cost, 4),
                             "market": None, "sector": None, "cost_usd": None})
            continue
        market, sector = mapping[h.ticker]
        usd = to_usd(h.ticker, cost)
        if usd is None:
            notes.append(f"{h.ticker}: no cached FX rate for {market}, left out of the percentages")
        holdings.append({"ticker": h.ticker, "qty": h.qty, "avg_cost": round(h.avg_cost, 4),
                         "market": market, "sector": sector, "cost_usd": round(usd, 2) if usd is not None else None})

    covered = [h for h in holdings if h["cost_usd"] is not None]
    invested = sum(h["cost_usd"] for h in covered)

    def pct(x: float) -> float:
        return round(100 * x / invested, 1) if invested else 0.0

    def group(key: str) -> list[dict]:
        totals: dict[str, float] = {}
        for h in covered:
            totals[h[key]] = totals.get(h[key], 0) + h["cost_usd"]
        return sorted(({key: k, "pct": pct(v)} for k, v in totals.items()), key=lambda g: -g["pct"])

    largest = max(covered, key=lambda h: h["cost_usd"], default=None)

    realised: dict[str, list[float]] = {}
    for h in book.values():
        if h.closed_cost and h.ticker in mapping:
            r, c = to_usd(h.ticker, h.realised), to_usd(h.ticker, h.closed_cost)
            if r is not None and c:
                acc = realised.setdefault(mapping[h.ticker][0], [0.0, 0.0])
                acc[0] += r
                acc[1] += c
    realised_by_market = sorted(
        ({"market": m, "usd": round(r, 2), "pct": round(100 * r / c, 1)} for m, (r, c) in realised.items()),
        key=lambda x: x["market"])

    open_positions = len(holdings)
    if not_covered:
        notes.append("Not covered: " + ", ".join(sorted(not_covered)) + ". We only map tickers the council already tracks.")
    return Summary(
        label=label,
        holdings=sorted(holdings, key=lambda h: -(h["cost_usd"] or 0)),
        by_market=group("market"),
        by_sector=group("sector"),
        largest={"ticker": largest["ticker"], "market": largest["market"], "sector": largest["sector"],
                 "pct": pct(largest["cost_usd"])} if largest else None,
        not_covered=sorted(not_covered),
        # Uncovered tickers have no known currency, so their share is by number of open positions.
        not_covered_pct=round(100 * len(not_covered) / open_positions, 1) if open_positions else 0.0,
        realised_by_market=realised_by_market,
        notes=notes,
        invested_usd=round(invested, 2),
    )


def chair_brief(payload: dict, names: dict[str, str]) -> str:
    """The exposure block for the Chair's prompt: aggregated percentages only."""
    if not payload or not payload.get("by_market"):
        return "The user has not shared a portfolio."
    mk = ", ".join(f"{names.get(m['name'], m['name'])} {m['pct']:g}%" for m in payload["by_market"])
    sec = ", ".join(f"{s['name']} {s['pct']:g}%" for s in payload["by_sector"])
    largest = payload.get("largest") or "none"
    for code, name in names.items():
        if largest.startswith(code + " "):
            largest = name + largest[len(code):]
    return (f"Share of invested money by market: {mk}. By sector: {sec}. Largest single position: {largest}."
            + (f" {payload['not_covered_count']} holding(s) are outside the council's coverage."
               if payload.get("not_covered_count") else ""))


# In memory only: uploads are never written to disk (this repo is public).
_CURRENT: Summary | None = None


def current() -> Summary | None:
    return _CURRENT


def set_current(summary: Summary | None) -> None:
    global _CURRENT
    _CURRENT = summary
