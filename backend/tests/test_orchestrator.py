"""Full council run with call_llm faked (no network, no keys)."""

import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import library  # noqa: E402
import orchestrator  # noqa: E402
from llm import LLMError, LLMOutputError, Usage  # noqa: E402
from schemas import (  # noqa: E402
    AGENTS, COUNTRIES, SECTORS, DelegateReport, RunRequest, Spillover, Vote, validate_event,
)

STAGES = ["data", "blind_vote", "debate", "revote", "spillover", "brief"]


def full_vote(agent: str, cells: int | None = None, view: str = "neutral") -> Vote:
    """A vote in the seat's scope: market seats vote their own market, cross-market seats every market."""
    markets = [agent] if agent in COUNTRIES else COUNTRIES
    grid = [{"country": c, "sector": s, "view": view, "confidence": 0.5} for c in markets for s in SECTORS]
    return Vote(agent=agent, round="blind", cells=grid if cells is None else grid[:cells])


def report(agent: str) -> DelegateReport:
    return DelegateReport(
        agent="CHAIR",  # wrong on purpose: the orchestrator pins it
        impact_summary=f"{agent} impact summary",
        claims=[{"text": f"{agent} claim", "source_ids": [f"{agent}-idx"]}],
        challenges=[{"to_agent": "US", "text": f"{agent} disagrees"}],
        triggers=[{"condition": "c", "would_change": "w"}],
    )


SPILL = Spillover.model_validate({
    "nodes": [{"id": "fed", "label": "Fed cut", "country": "US"}, {"id": "hibor", "label": "HIBOR", "country": "HK"}],
    "edges": [{"from": "fed", "to": "hibor", "mechanism": "peg", "sign": "-", "strength": 0.8, "source_ids": []}],
})


class FakeLLM:
    """Answers by schema. JP turns bearish on JP/Financials in the revote."""

    def __init__(self, fail: dict | None = None):
        self.calls: list[tuple[str, str, str]] = []  # (agent, schema, system)
        self.fail = fail or {}

    async def __call__(self, system, user, schema, *, agent, model=None):
        self.calls.append((agent, schema.__name__, system))
        key = (agent, schema.__name__)
        if key in self.fail:
            exc = self.fail[key]
            raise exc if isinstance(exc, Exception) else exc()
        if schema is Vote:
            vote = full_vote(agent)
            if agent == "JP" and "revote" in user:
                i = next(k for k, c in enumerate(vote.cells) if (c.country, c.sector) == ("JP", "Financials"))
                vote.cells[i] = vote.cells[i].model_copy(update={"view": "bearish", "because": "US: yen firms"})
            return vote, Usage(1, 1, 0)
        if schema is DelegateReport:
            return report(agent), Usage(1, 1, 0)
        if schema is Spillover:
            return SPILL, Usage(1, 1, 0)
        return schema(headline="Council view", key_risks=["r"] * 3,
                      triggers=[{"condition": "c", "would_change": "w"}] * 3, questions_for_you=["q"] * 3,
                      plain_english="Rates fall, so home prices in Hong Kong may rise."), Usage(1, 1, 0)


def run(monkeypatch, fake: FakeLLM, event: str = "Fed cuts 50bp", rounds: int | None = None) -> list[tuple[str, dict]]:
    monkeypatch.setattr(orchestrator, "call_llm", fake)
    council = library.default_council().model_copy(update={"debate_rounds": rounds}) if rounds else None

    async def collect():
        return [e async for e in orchestrator.run_council(RunRequest(event=event, council=council))]
    return asyncio.run(collect())


def stages(events):
    return [(d["name"], d["status"]) for n, d in events if n == "stage"]


def test_full_run_emits_every_stage_and_valid_contracts(monkeypatch):
    fake = FakeLLM()
    events = run(monkeypatch, fake)

    for name, data in events:
        validate_event(name, data)
    assert stages(events) == [(s, st) for s in STAGES for st in ("started", "done")]

    votes = [d for n, d in events if n == "vote"]
    assert sorted((v["agent"], v["round"]) for v in votes) == sorted(
        [(a, "blind") for a in AGENTS] + [(a, "revote") for a in AGENTS])

    # 1 debate round (the default) x 4 delegates + the Bear; every report is pinned to its author.
    reports = [d for n, d in events if n == "report"]
    assert len(reports) == 1 * 4 + 1
    assert [r["agent"] for r in reports][-1] == "BEAR"
    assert {r["agent"] for r in reports} == set(COUNTRIES) | {"BEAR"}

    # Each report is preceded by its summary message, carrying the claim source ids.
    i = next(k for k, (n, d) in enumerate(events) if n == "report" and d["agent"] == "HK")
    summary = next(d for n, d in events[:i] if n == "message" and d["agent"] == "HK")
    assert summary == {"agent": "HK", "text": "HK impact summary", "source_ids": ["HK-idx"], "unverified": []}

    brief = next(d for n, d in events if n == "brief")
    assert brief["headline"] == "Council view"
    assert brief["plain_english"] == "Rates fall, so home prices in Hong Kong may rise."
    assert len(brief["matrix"]) == 16
    assert brief["vote_shifts"] == [{"agent": "JP", "cell": "JP/Financials", "from": "neutral", "to": "bearish",
                                     "because": "US: yen firms"}]
    spill = next(d for n, d in events if n == "spillover")
    assert spill["edges"][0]["from"] == "fed"


def test_agents_see_the_right_data_and_context(monkeypatch):
    fake = FakeLLM()
    run(monkeypatch, fake, rounds=2)
    systems = {}
    for agent, schema, system in fake.calls:
        systems.setdefault((agent, schema), []).append(system)

    hk_blind = systems[("HK", "Vote")][0]
    assert '"country":"HK"' in hk_blind and '"country":"US"' not in hk_blind
    assert all(f'"country": "{c}"' in systems[("CHAIR", "Vote")][0] for c in COUNTRIES)

    round1, round2 = systems[("HK", "DelegateReport")]
    assert "BLIND VOTES:" in round1 and "Nothing yet." in round1
    assert "[CN] CN impact summary" in round2  # round 2 sees other delegates' round-1 reports
    bear = systems[("BEAR", "DelegateReport")][0]
    assert "STRONGEST CONSENSUS" in bear and "[JP] JP impact summary" in bear
    assert "YOUR BLIND VOTE WAS" in systems[("US", "Vote")][1]
    assert "FINAL MATRIX" in systems[("CHAIR", "ChairNotes")][0]


def test_matrix_and_shifts_are_computed_not_written_by_chair(monkeypatch):
    fake = FakeLLM()
    events = run(monkeypatch, fake)
    brief = next(d for n, d in events if n == "brief")
    jp_fin = next(c for c in brief["matrix"] if (c["country"], c["sector"]) == ("JP", "Financials"))
    assert jp_fin["view"] == "neutral" and jp_fin["dissent"] > 0  # 6 neutral vs 1 bearish


@pytest.mark.parametrize("failing", [
    ("SPILLOVER", "Spillover"), ("BEAR", "DelegateReport"), ("CHAIR", "ChairNotes"), ("HK", "DelegateReport"),
])
def test_one_failing_agent_never_kills_the_run(monkeypatch, failing):
    fake = FakeLLM(fail={failing: LLMError("timed out after 25s")})
    events = run(monkeypatch, fake)

    errors = [d for n, d in events if n == "error"]
    assert errors and all(e["agent"] == failing[0] for e in errors)
    assert any(n == "brief" for n, _ in events)
    assert stages(events)[-1] == ("brief", "done")
    if failing[0] == "CHAIR":
        brief = next(d for n, d in events if n == "brief")
        assert brief["headline"] == orchestrator.FALLBACK_HEADLINE and len(brief["matrix"]) == 16


def test_invalid_output_is_retried_once_then_skipped(monkeypatch):
    fake = FakeLLM(fail={("BEAR", "Vote"): LLMOutputError, ("SPILLOVER", "Vote"): LLMError("timeout")})
    events = run(monkeypatch, fake)
    blind_calls = lambda a: sum(1 for ag, s, sy in fake.calls if ag == a and s == "Vote" and "Blind vote" in sy)  # noqa: E731
    assert blind_calls("BEAR") == 2 and blind_calls("SPILLOVER") == 1
    blind_voters = {d["agent"] for n, d in events if n == "vote" and d["round"] == "blind"}
    assert blind_voters == set(AGENTS) - {"BEAR", "SPILLOVER"}


def test_dangling_spillover_edges_are_retried(monkeypatch):
    bad = Spillover.model_validate({"nodes": [{"id": "a", "label": "A"}], "edges": [
        {"from": "a", "to": "ghost", "mechanism": "m", "sign": "+", "strength": 0.5, "source_ids": []}]})
    with pytest.raises(LLMOutputError):
        orchestrator.check_spillover(bad)
    assert orchestrator.check_spillover(SPILL) is SPILL


def test_votes_are_emitted_as_they_arrive(monkeypatch):
    delays = {a: 0.05 * i for i, a in enumerate(reversed(AGENTS))}  # >15 ms Windows timer tick
    fake = FakeLLM()

    async def slow(system, user, schema, *, agent, model=None):
        if schema is Vote and "blind" in user:
            await asyncio.sleep(delays[agent])
        return await fake(system, user, schema, agent=agent)

    events = run(monkeypatch, slow)
    order = [d["agent"] for n, d in events if n == "vote" and d["round"] == "blind"]
    assert order == list(reversed(AGENTS))


def _cache_with(tmp_path, monkeypatch, **hk_updates):
    mock_hk = json.loads((orchestrator.MOCK_PACKS / "HK.json").read_text(encoding="utf-8"))
    (tmp_path / "HK.json").write_text(json.dumps({**mock_hk, **hk_updates}), encoding="utf-8")
    monkeypatch.setattr(orchestrator, "CACHE_DIR", tmp_path)
    monkeypatch.delenv("COUNCIL_OFFLINE", raising=False)


def test_live_runs_never_use_mock_data(tmp_path, monkeypatch):
    _cache_with(tmp_path, monkeypatch, prices_fetched_at=datetime.now(timezone.utc).isoformat())
    packs, problems = asyncio.run(orchestrator.load_data())
    assert packs["HK"].prices_fetched_at  # fresh cache used as is
    assert packs["US"].series == [] and packs["US"].news == []  # no cache, fetch failed: empty, not mock
    assert any("No market data for US" in p for p in problems)


def test_stale_cache_is_refreshed_before_the_run(tmp_path, monkeypatch):
    _cache_with(tmp_path, monkeypatch, as_of="2026-09-01T16:00:00+08:00")
    monkeypatch.setattr(orchestrator, "_is_stale", lambda pack: True)
    refreshed = []

    def refresh(pack):
        refreshed.append(pack.country)
        return pack.model_copy(update={"as_of": "2026-10-02T16:00:00+08:00"})

    monkeypatch.setattr(orchestrator, "_refresh_pack", refresh)
    packs, _ = asyncio.run(orchestrator.load_data(["HK"]))
    assert refreshed == ["HK"] and packs["HK"].as_of.startswith("2026-10-02")


def test_failed_refresh_keeps_the_dated_cache_and_says_so(tmp_path, monkeypatch):
    _cache_with(tmp_path, monkeypatch, as_of="2026-09-01T16:00:00+08:00")
    monkeypatch.setattr(orchestrator, "_is_stale", lambda pack: True)
    packs, problems = asyncio.run(orchestrator.load_data(["HK"]))
    assert packs["HK"].as_of.startswith("2026-09-01")
    assert problems == ["Could not refresh HK prices (network disabled in tests); using the cached close of 2026-09-01."]


def test_offline_never_fetches(tmp_path, monkeypatch):
    _cache_with(tmp_path, monkeypatch, as_of="2026-09-01T16:00:00+08:00")
    monkeypatch.setenv("COUNCIL_OFFLINE", "1")
    packs, problems = asyncio.run(orchestrator.load_data(["HK", "US"]))
    assert packs["HK"].as_of.startswith("2026-09-01")  # stale but offline: used, not refreshed
    assert packs["US"].series == [] and "Offline mode" in problems[0]


def test_latest_close_skips_weekends_and_waits_for_the_close():
    from data import fetch

    sunday = datetime(2026, 10, 4, 6, 0, tzinfo=timezone.utc)
    assert str(fetch.latest_close("HK", sunday)) == "2026-10-02"  # Friday
    tuesday_morning_hk = datetime(2026, 10, 6, 1, 0, tzinfo=timezone.utc)  # 09:00 HKT, before the close
    assert str(fetch.latest_close("HK", tuesday_morning_hk)) == "2026-10-05"


def test_recent_fetch_is_not_stale_even_on_a_holiday():
    from data import fetch
    from schemas import DataPack

    pack = DataPack(country="CN", as_of="2026-09-30T15:00:00+08:00", series=[], sectors=[], macro=[], news=[],
                    prices_fetched_at="2026-10-04T05:00:00+00:00")
    assert not fetch.is_stale(pack, datetime(2026, 10, 4, 6, 0, tzinfo=timezone.utc))  # checked an hour ago
    assert fetch.is_stale(pack, datetime(2026, 10, 4, 20, 0, tzinfo=timezone.utc))  # 15 h later: check again


def test_every_seat_prompt_is_fully_filled():
    council = library.default_council()
    for seat in library.resolve(council):
        prompt = orchestrator.build_prompt(seat, council.markets, "TASK", "EVENT", "{}", None, Vote)
        assert "{" not in prompt.replace("{}", "").split("SCHEMA:")[0], prompt
        assert "Rules:" in prompt and seat.member.name in prompt
