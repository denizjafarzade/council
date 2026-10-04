"""Hallucination defences (quarantine, evidence weights, Jev retry) and the risk score."""

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import jev  # noqa: E402
import orchestrator  # noqa: E402
import risk  # noqa: E402
from schemas import DataPack, MatrixCell, RunRequest, Vote  # noqa: E402
from test_orchestrator import FakeLLM, full_vote  # noqa: E402


def run(monkeypatch, fake):
    monkeypatch.setattr(orchestrator, "call_llm", fake)

    async def collect():
        return [e async for e in orchestrator.run_council(RunRequest(event="Headline"))]
    return asyncio.run(collect())


def test_unverified_claims_are_quarantined_and_down_weighted(monkeypatch):
    # The fake Bear cites "BEAR-idx", which is in nobody's data: its claims fail the checks.
    fake = FakeLLM()
    events = run(monkeypatch, fake)
    brief = next(d for n, d in events if n == "brief")
    assert brief["evidence_weights"]["BEAR"] == 0.25  # all its claims unverified -> floor weight
    assert brief["evidence_weights"]["HK"] == 1.0  # HK cites HK-idx: verified
    chair = [s for a, k, s in fake.calls if k == "ChairNotes"][0]
    assert "BEAR claim [BEAR-idx]  (UNVERIFIED" in chair and "Do not rely on it" in chair
    revote = [s for a, k, s in fake.calls if k == "Vote" and "YOUR BLIND VOTE WAS" in s][0]
    assert "(UNVERIFIED" in revote  # other members see the warning before they revote


def test_jev_is_retried_once_then_the_fallback_is_labelled(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test")
    monkeypatch.setattr(orchestrator, "JEV_RETRY_S", 0)
    tries = {}

    async def flaky(ctx, cells, *, agent, rnd, **kw):
        tries[agent] = tries.get(agent, 0) + 1
        if agent == "HK" or tries[agent] == 1:  # HK always fails; everyone else succeeds on the retry
            raise jev.JevError("timed out after 5s")
        return full_vote(agent).model_copy(update={"round": rnd, "source": "jev"})

    monkeypatch.setattr(jev, "vote_with_jev", flaky)
    events = run(monkeypatch, FakeLLM())
    blind = {d["agent"]: d for n, d in events if n == "vote" and d["round"] == "blind"}
    assert blind["US"]["source"] == "jev" and "fallback" not in blind["US"]
    assert blind["HK"]["source"] == "llm" and blind["HK"]["fallback"] == "Jev unavailable (timed out after 5s)"
    assert tries["US"] >= 2 and tries["HK"] >= 2


def _pack(vol, chg_1m):
    return DataPack.model_validate({"country": "HK", "as_of": "2026-10-02", "sectors": [], "macro": [], "news": [],
                                    "series": [{"id": "HK-idx", "name": "Hang Seng", "last": 1, "chg_1d_pct": 0,
                                                "chg_1m_pct": chg_1m, "vol_20d_pct": vol}]})


def _cells(view, conf=1.0, dissent=0.0):
    return [MatrixCell(country="HK", sector=s, view=view, confidence=conf, dissent=dissent) for s in ("Tech", "Energy")]


def test_market_risk_components():
    calm = risk.market_risk(_pack(8, 2), _cells("bullish"), 0.0)
    assert calm["score"] == 0 and calm["label"] == "low"
    stressed = risk.market_risk(_pack(25, -6), _cells("bearish", dissent=1.0), 1.0)
    assert stressed["score"] == 100 and stressed["label"] == "high"
    mid = risk.market_risk(_pack(16.5, -3), _cells("bearish", conf=0.5, dissent=0.5), 0.5)
    assert mid["components"] == {"volatility": 50, "drawdown": 50, "council_view": 50, "disagreement": 50,
                                 "uncertainty": 50} and mid["score"] == 50 and mid["label"] == "moderate"


def test_a_neutral_council_adds_no_risk_and_positive_views_take_some_off():
    assert risk.market_risk(_pack(8, 0), _cells("neutral"), 0.0)["components"]["council_view"] == 0
    mixed = [MatrixCell(country="HK", sector="Tech", view="bearish", confidence=0.8, dissent=0),
             MatrixCell(country="HK", sector="Energy", view="bullish", confidence=0.8, dissent=0)]
    assert risk.market_risk(_pack(8, 0), mixed, 0.0)["components"]["council_view"] == 20  # (0.8 - 0.4) / 2


def test_missing_parts_are_left_out_not_guessed():
    only_votes = risk.market_risk(None, _cells("bearish"), None)
    assert only_votes["components"]["volatility"] is None and only_votes["score"] == round((0.35 * 100 + 0.1 * 0) / 0.45)


def test_portfolio_risk_weights_exposure_and_adds_concentration():
    markets = {"HK": {"score": 80}, "US": {"score": 20}}
    even = risk.portfolio_risk(markets, {"by_market": [{"name": "HK", "pct": 50}, {"name": "US", "pct": 50}]})
    assert even["score"] == 50 and even["components"]["concentration"] == 0.0
    heavy = risk.portfolio_risk(markets, {"by_market": [{"name": "HK", "pct": 90}, {"name": "US", "pct": 10}]})
    assert heavy["components"]["weighted_markets"] == 74 and heavy["components"]["concentration"] > 5
    assert risk.portfolio_risk(markets, None) is None


def test_each_ai_is_scored_on_its_own_votes_and_together(monkeypatch):
    events = run(monkeypatch, FakeLLM())
    info = next(d for n, d in events if n == "council")
    assert all(m["model"] for m in info["members"])  # which AI sits in each seat
    r = next(d for n, d in events if n == "brief")["risk"]
    assert set(r["by_seat"]) == {"CHAIR", "HK", "CN", "US", "JP", "BEAR", "SPILLOVER"}
    assert set(r["by_seat"]["HK"]["markets"]) == {"HK"}  # a market seat covers its own market
    assert set(r["by_seat"]["BEAR"]["markets"]) == {"HK", "CN", "US", "JP"}
    assert r["together"]["basis"] == "average of markets" and 0 <= r["together"]["score"] <= 100


def test_single_ai_risk_leaves_out_disagreement():
    from schemas import VoteCell

    cells = [VoteCell(country="HK", sector=s, view="bearish", confidence=1.0) for s in ("Tech", "Energy")]
    seat = risk.seat_risk(cells, {"HK": _pack(25, -6)}, 0.0, None)
    assert seat["markets"] == {"HK": round((0.25 * 100 + 0.2 * 100 + 0.35 * 100 + 0.1 * 0) / 0.9)}
    held = risk.seat_risk(cells, {"HK": _pack(25, -6)}, 0.0, {"by_market": [{"name": "HK", "pct": 100}]})
    assert held["basis"] == "your exposure"
