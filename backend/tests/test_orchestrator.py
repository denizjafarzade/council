"""Full council run with call_llm faked (no network, no keys)."""

import asyncio
import json
import sys
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


def full_vote(agent: str, cells: int = 16, view: str = "neutral") -> Vote:
    grid = [{"country": c, "sector": s, "view": view, "confidence": 0.5} for c in COUNTRIES for s in SECTORS]
    return Vote(agent=agent, round="blind", cells=grid[:cells])


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
                vote.cells[13] = vote.cells[13].model_copy(update={"view": "bearish", "because": "US: yen firms"})
            return vote, Usage(1, 1, 0)
        if schema is DelegateReport:
            return report(agent), Usage(1, 1, 0)
        if schema is Spillover:
            return SPILL, Usage(1, 1, 0)
        return schema(headline="Council view", key_risks=["r"] * 3,
                      triggers=[{"condition": "c", "would_change": "w"}] * 3, questions_for_you=["q"] * 3), Usage(1, 1, 0)


def run(monkeypatch, fake: FakeLLM, event: str = "Fed cuts 50bp") -> list[tuple[str, dict]]:
    monkeypatch.setattr(orchestrator, "call_llm", fake)

    async def collect():
        return [e async for e in orchestrator.run_council(RunRequest(event=event))]
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

    # 2 debate rounds x 4 delegates + the Bear; every report is pinned to its author.
    reports = [d for n, d in events if n == "report"]
    assert len(reports) == 2 * 4 + 1
    assert [r["agent"] for r in reports][-1] == "BEAR"
    assert {r["agent"] for r in reports} == set(COUNTRIES) | {"BEAR"}

    # Each report is preceded by its summary message, carrying the claim source ids.
    i = next(k for k, (n, d) in enumerate(events) if n == "report" and d["agent"] == "HK")
    summary = next(d for n, d in events[:i] if n == "message" and d["agent"] == "HK")
    assert summary == {"agent": "HK", "text": "HK impact summary", "source_ids": ["HK-idx"], "unverified": []}

    brief = next(d for n, d in events if n == "brief")
    assert brief["headline"] == "Council view"
    assert len(brief["matrix"]) == 16
    assert brief["vote_shifts"] == [{"agent": "JP", "cell": "JP/Financials", "from": "neutral", "to": "bearish",
                                     "because": "US: yen firms"}]
    spill = next(d for n, d in events if n == "spillover")
    assert spill["edges"][0]["from"] == "fed"


def test_agents_see_the_right_data_and_context(monkeypatch):
    fake = FakeLLM()
    run(monkeypatch, fake)
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


def test_load_data_prefers_cache_and_falls_back_to_mocks(tmp_path, monkeypatch):
    mock_hk = json.loads((orchestrator.MOCK_PACKS / "HK.json").read_text(encoding="utf-8"))
    (tmp_path / "HK.json").write_text(json.dumps({**mock_hk, "as_of": "cached"}), encoding="utf-8")
    monkeypatch.setattr(orchestrator, "CACHE_DIR", tmp_path)

    packs, problems = asyncio.run(orchestrator.load_data())
    assert problems == []
    assert packs["HK"].as_of == "cached"
    assert packs["US"].country == "US"


def test_every_seat_prompt_is_fully_filled():
    council = library.default_council()
    for seat in library.resolve(council):
        prompt = orchestrator.build_prompt(seat, council.markets, "TASK", "EVENT", "{}", None, Vote)
        assert "{" not in prompt.replace("{}", "").split("SCHEMA:")[0], prompt
        assert "Rules:" in prompt and seat.member.name in prompt
