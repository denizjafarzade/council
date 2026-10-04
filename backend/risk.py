"""Quantitative risk score, computed in code (no model calls), 0 = low risk, 100 = high.

Per market, from measured data and the council's computed results. Ranges match where major
equity indices actually trade, so ordinary markets spread out instead of bunching in the middle:
  volatility    index 20-day annualised volatility, 8% -> 0 ... 25% -> 100
  drawdown      index 1-month change, 0% or up -> 0 ... -6% or worse -> 100
  council view  final matrix, confidence-weighted: only negative views add risk (bearish at full
                confidence -> 100), neutral adds nothing, positive views subtract half as much
  disagreement  mean dissent across the market's sectors, x100
  uncertainty   share of the market seat's claims that failed the citation/number checks, x100

Portfolio = exposure-weighted market scores, plus up to 10 points for concentration in few
markets (Herfindahl index of market weights). Every component is returned so the screen can
show how the number was made.
"""

from schemas import DataPack, MatrixCell

WEIGHTS = {"volatility": 0.25, "drawdown": 0.20, "council_view": 0.35, "disagreement": 0.10, "uncertainty": 0.10}
VOL_LOW, VOL_HIGH = 8.0, 25.0
DRAWDOWN_FULL = -6.0
CONCENTRATION_POINTS = 10.0
SCORE = {"bearish": -1, "neutral": 0, "bullish": 1}


def _clamp(x: float) -> float:
    return max(0.0, min(100.0, x))


def label(score: float) -> str:
    return "low" if score < 30 else "moderate" if score < 55 else "high"


def _view_risk(cells: list[MatrixCell]) -> float:
    """Negative views add risk in proportion to confidence; neutral adds none; positive views
    take off half as much (a positive call is weaker evidence of safety than a negative one is of risk)."""
    per_cell = [c.confidence if c.view == "bearish" else -0.5 * c.confidence if c.view == "bullish" else 0.0
                for c in cells]
    return _clamp(100 * sum(per_cell) / len(per_cell))


def market_risk(pack: DataPack | None, cells: list[MatrixCell], unverified_share: float | None,
                with_disagreement: bool = True) -> dict | None:
    """with_disagreement=False for a single AI's view: one voter cannot disagree with itself."""
    idx = next((s for s in pack.series if s.id == f"{pack.country}-idx"), None) if pack else None
    if idx is None and not cells:
        return None
    parts: dict[str, float | None] = {
        "volatility": _clamp((idx.vol_20d_pct - VOL_LOW) / (VOL_HIGH - VOL_LOW) * 100) if idx else None,
        "drawdown": _clamp(idx.chg_1m_pct / DRAWDOWN_FULL * 100) if idx else None,
        "council_view": _view_risk(cells) if cells else None,
        "disagreement": (_clamp(100 * sum(c.dissent for c in cells) / len(cells))
                         if cells and with_disagreement else None),
        "uncertainty": _clamp(100 * unverified_share) if unverified_share is not None else None,
    }
    # Missing parts (no index data, nobody voted) are left out and the weights renormalised.
    have = {k: v for k, v in parts.items() if v is not None}
    total_w = sum(WEIGHTS[k] for k in have)
    score = sum(WEIGHTS[k] * v for k, v in have.items()) / total_w
    return {
        "score": round(score), "label": label(score),
        "components": {k: (round(v) if v is not None else None) for k, v in parts.items()},
        "inputs": {"vol_20d_pct": idx.vol_20d_pct if idx else None, "chg_1m_pct": idx.chg_1m_pct if idx else None},
    }


def portfolio_risk(markets: dict[str, dict], exposure: dict | None) -> dict | None:
    """Exposure-weighted market risk plus a concentration add-on. None without a portfolio."""
    if not exposure or not exposure.get("by_market"):
        return None
    weights = {m["name"]: m["pct"] / 100 for m in exposure["by_market"]}
    scored = {c: w for c, w in weights.items() if c in markets and markets[c]}
    if not scored:
        return None
    total = sum(scored.values())
    base = sum(w * markets[c]["score"] for c, w in scored.items()) / total
    n = len(weights)
    hhi = sum((w / sum(weights.values())) ** 2 for w in weights.values())
    concentration = CONCENTRATION_POINTS * ((hhi - 1 / n) / (1 - 1 / n)) if n > 1 else CONCENTRATION_POINTS
    score = _clamp(base + concentration)
    return {
        "score": round(score), "label": label(score),
        "components": {"weighted_markets": round(base), "concentration": round(concentration, 1)},
        "covered_pct": round(100 * total, 1),
    }


def overall(markets: dict[str, dict], exposure: dict | None) -> dict | None:
    """One number for a set of market scores: exposure-weighted with a portfolio, else the plain mean."""
    scored = {c: r for c, r in markets.items() if r}
    if not scored:
        return None
    with_portfolio = portfolio_risk(scored, exposure)
    if with_portfolio:
        return {**with_portfolio, "basis": "your exposure"}
    mean = sum(r["score"] for r in scored.values()) / len(scored)
    return {"score": round(mean), "label": label(mean), "basis": "average of markets"}


def seat_risk(votes: list, packs: dict[str, DataPack], unverified_share: float | None,
              exposure: dict | None) -> dict | None:
    """One AI on its own: its final votes (no disagreement term), its own unverified-claim share."""
    by_market: dict[str, list[MatrixCell]] = {}
    for cell in votes:
        by_market.setdefault(cell.country, []).append(
            MatrixCell(country=cell.country, sector=cell.sector, view=cell.view, confidence=cell.confidence, dissent=0))
    markets = {c: market_risk(packs.get(c), cells, unverified_share, with_disagreement=False)
               for c, cells in by_market.items()}
    total = overall(markets, exposure)
    if total is None:
        return None
    return {**total, "markets": {c: r["score"] for c, r in markets.items() if r}}


def compute(packs: dict[str, DataPack], matrix: list[MatrixCell], markets: list[str],
            unverified_share: dict[str, float], exposure: dict | None,
            seat_votes: dict[str, list] | None = None, seat_unverified: dict[str, float] | None = None) -> dict:
    """Council (together) per market and overall, plus each AI scored on its own votes (by_seat)."""
    per_market = {c: market_risk(packs.get(c), [x for x in matrix if x.country == c], unverified_share.get(c))
                  for c in markets}
    seat_unverified = seat_unverified or {}
    by_seat = {a: seat_risk(cells, packs, seat_unverified.get(a), exposure) for a, cells in (seat_votes or {}).items()}
    return {"markets": {c: r for c, r in per_market.items() if r},
            "portfolio": portfolio_risk(per_market, exposure),
            "together": overall(per_market, exposure),
            "by_seat": {a: r for a, r in by_seat.items() if r},
            "method": "council view 35% (negative views only), volatility 25% (8-25%), 1-month drawdown 20% "
                      "(0 to -6%), disagreement 10%, unverified claims 10%; portfolio adds up to 10 points "
                      "for market concentration"}
