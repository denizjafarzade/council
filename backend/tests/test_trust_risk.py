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
    stressed = risk.market_risk(_pack(35, -10), _cells("bearish", dissent=1.0), 1.0)
    assert stressed["score"] == 100 and stressed["label"] == "high"
    mid = risk.market_risk(_pack(21.5, -5), _cells("neutral", dissent=0.5), 0.5)
    assert mid["components"] == {"volatility": 50, "drawdown": 50, "council_view": 50, "disagreement": 50,
                                 "uncertainty": 50} and mid["score"] == 50


def test_missing_parts_are_left_out_not_guessed():
    only_votes = risk.market_risk(None, _cells("bearish"), None)
    assert only_votes["components"]["volatility"] is None and only_votes["score"] == round((0.3 * 100 + 0.1 * 0) / 0.4)


def test_portfolio_risk_weights_exposure_and_adds_concentration():
    markets = {"HK": {"score": 80}, "US": {"score": 20}}
    even = risk.portfolio_risk(markets, {"by_market": [{"name": "HK", "pct": 50}, {"name": "US", "pct": 50}]})
    assert even["score"] == 50 and even["components"]["concentration"] == 0.0
    heavy = risk.portfolio_risk(markets, {"by_market": [{"name": "HK", "pct": 90}, {"name": "US", "pct": 10}]})
    assert heavy["components"]["weighted_markets"] == 74 and heavy["components"]["concentration"] > 5
    assert risk.portfolio_risk(markets, None) is None
