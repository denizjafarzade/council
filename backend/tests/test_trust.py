"""Stage 3A: Jev votes with LLM fallback, citation checks and number checks."""

import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import jev  # noqa: E402
import orchestrator  # noqa: E402
from llm import Usage  # noqa: E402
from schemas import AGENTS, COUNTRIES, SECTORS, DataPack, DelegateReport, RunRequest, Vote, VoteCell  # noqa: E402
from verify import check_claim  # noqa: E402

PACK = DataPack.model_validate({
    "country": "HK", "as_of": "2026-10-02T16:00:00+08:00", "coverage": "full",
    "series": [{"id": "HK-idx", "name": "Hang Seng Index", "last": 23972.29, "chg_1d_pct": -2.6,
                "chg_1m_pct": -5.29, "vol_20d_pct": 15.27}],
    "sectors": [{"sector": "Tech", "ticker": "3033.HK", "chg_1m_pct": -8.26, "vol_20d_pct": 19.84}],
    "macro": [{"id": "HK-hibor", "name": "1M HIBOR", "value": 3.9}],
    "news": [{"id": "HK-n1", "title": "Banks cut prime rate by 25 basis points", "source": "Wire", "url": "",
              "published": "2026-10-02"}],
})
US = DataPack.model_validate({"country": "US", "as_of": "x", "series": [
    {"id": "US-idx", "name": "S&P 500", "last": 7722.7, "chg_1d_pct": 0.4, "chg_1m_pct": 1.1, "vol_20d_pct": 12}],
    "sectors": [], "macro": [], "news": []})


# --- citations and numbers -----------------------------------------------------------

@pytest.mark.parametrize("text, ids, problems", [
    ("Hang Seng fell 5.29% this month.", ["HK-idx"], []),
    ("Hang Seng is down about 5% on the month.", ["HK-idx"], []),  # rounding
    ("The index sits near 23,972, or roughly 24k.", ["HK-idx"], []),  # thousands separator and k
    ("HIBOR at 3.9 eases with the 50bp Fed cut.", ["HK-hibor"], []),  # event numbers are fine
    ("Banks cut prime by 25 basis points over 1 month.", ["HK-n1"], []),  # headline numbers, periods ignored
    ("Tech fell 8.3% while the S&P 500 held up.", ["HK-Tech"], []),  # index names are labels
    ("Tech fell 12% this month.", ["HK-Tech"], ["12 does not match any cited value"]),
    ("HIBOR fell 3.9 points.", ["HK-hibor", "HK-made-up"], ["HK-made-up not in this member's data"]),
    ("Property looks cheap at 3.5x book.", [], ["cites no source", "3.5 has no cited data"]),
    ("US yields matter here.", ["US-10y"], ["US-10y not in this member's data"]),  # not visible to HK
])
def test_check_claim(text, ids, problems):
    assert check_claim(text, ids, [PACK], event="Fed cuts 50bp", all_packs=[PACK, US]) == problems


# --- Jev ------------------------------------------------------------------------------------

def jev_transport(monkeypatch, handler):
    real = httpx.AsyncClient
    monkeypatch.setattr(jev.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")


def answers_for(request, pick=lambda qid: "bullish", p=0.7):
    body = json.loads(request.content)
    out = {}
    for q in body["questions"]:
        view = pick(q)
        rest = (1 - p) / 2
        out[q] = {"type": "choice", "choice": view, "confidence": 0.5,
                  "probabilities": {v: (p if v == view else rest) for v in jev.VIEWS}}
    return httpx.Response(200, json={"model": "jev-1.13.0", "answers": out, "usage": {"input_tokens": 1, "output_tokens": 1}})


CELLS = [(c, s) for c in ["HK", "US"] for s in SECTORS]
NAMES = {"HK": "Hong Kong", "US": "United States"}


def test_jev_vote_reads_probabilities_as_view_and_confidence(monkeypatch):
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        seen["auth"] = request.headers["authorization"]
        return answers_for(request, pick=lambda q: "bearish" if q == "HK_Property" else "neutral", p=0.82)

    jev_transport(monkeypatch, handler)
    vote = asyncio.run(jev.vote_with_jev({"event": "Fed cuts 50bp"}, CELLS, agent="HK", rnd="blind", market_names=NAMES))
    assert vote.source == "jev" and len(vote.cells) == 8
    hk_prop = next(c for c in vote.cells if (c.country, c.sector) == ("HK", "Property"))
    assert hk_prop.view == "bearish" and hk_prop.confidence == 0.82
    q = seen["body"]["questions"]["HK_Property"]
    assert q["type"] == "choice" and set(q["criteria"]) == {"bearish", "neutral", "bullish"}
    assert "Hong Kong (HK) Property" in q["instructions"]
    assert seen["body"]["model"] == jev.MODEL and seen["auth"] == "Bearer test-key"


def test_jev_revote_explains_changed_cells(monkeypatch):
    jev_transport(monkeypatch, lambda r: answers_for(r, pick=lambda q: "bearish" if q == "US_Tech" else "neutral"))
    blind = Vote(agent="US", round="blind", cells=[VoteCell(country=c, sector=s, view="neutral", confidence=0.5) for c, s in CELLS])
    vote = asyncio.run(jev.vote_with_jev({}, CELLS, agent="US", rnd="revote", market_names=NAMES, previous=blind,
                                         reason="Chip demand already priced in"))
    changed = [c for c in vote.cells if c.because]
    assert [(c.country, c.sector, c.because) for c in changed] == [("US", "Tech", "Chip demand already priced in")]


@pytest.mark.parametrize("handler, message", [
    (lambda r: httpx.Response(500, text="boom"), "HTTP 500"),
    (lambda r: httpx.Response(200, json={"answers": {}}), "no usable answer"),
    (lambda r: answers_for(r, pick=lambda q: "sideways"), "no usable answer"),
])
def test_jev_failures_raise(monkeypatch, handler, message):
    jev_transport(monkeypatch, handler)
    with pytest.raises(jev.JevError, match=message):
        asyncio.run(jev.vote_with_jev({}, CELLS, agent="HK", rnd="blind", market_names=NAMES))


def test_jev_times_out(monkeypatch):
    async def slow(request):
        await asyncio.sleep(1)
        return answers_for(request)

    jev_transport(monkeypatch, slow)
    monkeypatch.setattr(jev, "TIMEOUT_S", 0.05)
    with pytest.raises(jev.JevError, match="timed out"):
        asyncio.run(jev.vote_with_jev({}, CELLS, agent="HK", rnd="blind", market_names=NAMES))


def test_jev_is_off_without_a_key(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    assert not jev.enabled()
    with pytest.raises(jev.JevError, match="off"):
        asyncio.run(jev.vote_with_jev({}, CELLS, agent="HK", rnd="blind", market_names=NAMES))


# --- in a full run ---------------------------------------------------------------------------

def llm_vote(agent):
    cells = [{"country": c, "sector": s, "view": "neutral", "confidence": 0.5} for c in COUNTRIES for s in SECTORS]
    return Vote(agent=agent, round="blind", cells=cells)


class FakeLLM:
    def __init__(self):
        self.vote_calls = []

    async def __call__(self, system, user, schema, *, agent, model=None):
        if schema is Vote:
            self.vote_calls.append(agent)
            return llm_vote(agent), Usage(1, 1, 0)
        if schema is DelegateReport:
            return DelegateReport(agent=agent, impact_summary="HK index down 5% [HK-idx]",
                                  claims=[{"text": "Index down 5.3% in a month.", "source_ids": ["HK-idx"]},
                                          {"text": "HIBOR at 9.9.", "source_ids": ["HK-nope"]}],
                                  challenges=[], triggers=[]), Usage(1, 1, 0)
        if schema.__name__ == "Spillover":
            raise orchestrator.LLMError("skip")
        return schema(headline="h", key_risks=[], triggers=[], questions_for_you=[]), Usage(1, 1, 0)


def run(monkeypatch, fake):
    monkeypatch.setattr(orchestrator, "call_llm", fake)
    monkeypatch.setattr(orchestrator, "_read_pack", lambda code: PACK.model_copy(update={"country": code}))

    async def collect():
        return [e async for e in orchestrator.run_council(RunRequest(event="Fed cuts 50bp"))]
    return asyncio.run(collect())


def test_votes_come_from_jev_when_it_answers(monkeypatch):
    jev_transport(monkeypatch, lambda r: answers_for(r))
    fake = FakeLLM()
    events = run(monkeypatch, fake)
    votes = [d for n, d in events if n == "vote"]
    assert len(votes) == 2 * len(AGENTS) and all(v["source"] == "jev" for v in votes)
    assert fake.vote_calls == []


def test_jev_failure_falls_back_to_the_llm_vote(monkeypatch):
    jev_transport(monkeypatch, lambda r: httpx.Response(503, text="down"))
    fake = FakeLLM()
    events = run(monkeypatch, fake)
    votes = [d for n, d in events if n == "vote"]
    assert len(votes) == 2 * len(AGENTS) and all(v["source"] == "llm" for v in votes)
    assert sorted(set(fake.vote_calls)) == sorted(AGENTS)


def test_debate_messages_carry_verification(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    events = run(monkeypatch, FakeLLM())
    hk = [d for n, d in events if n == "message" and d["agent"] == "HK"][:3]
    assert hk[0]["text"].startswith("HK index down") and hk[0]["unverified"] == ["HK-nope not in this member's data"]
    assert hk[1] == {"agent": "HK", "text": "Index down 5.3% in a month.", "source_ids": ["HK-idx"], "unverified": []}
    assert hk[2]["unverified"] == ["HK-nope not in this member's data", "9.9 has no cited data"]
