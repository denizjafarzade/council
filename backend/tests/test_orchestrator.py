"""Stage 1A: load_data + blind_vote, with call_llm faked (no network, no keys)."""

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import orchestrator  # noqa: E402
from llm import LLMError, LLMOutputError, Usage  # noqa: E402
from schemas import AGENTS, COUNTRIES, SECTORS, RunRequest, Vote, validate_event  # noqa: E402


def full_vote(agent: str, cells: int = 16) -> Vote:
    grid = [{"country": c, "sector": s, "view": "neutral", "confidence": 0.5} for c in COUNTRIES for s in SECTORS]
    return Vote(agent=agent, round="blind", cells=grid[:cells])


def run(req: RunRequest) -> list[tuple[str, dict]]:
    async def collect():
        return [e async for e in orchestrator.run_council(req)]
    return asyncio.run(collect())


def test_blind_vote_streams_one_valid_vote_per_agent(monkeypatch):
    seen_data: dict[str, str] = {}

    async def fake_llm(system, user, schema, *, agent):
        seen_data[agent] = system
        # The model may get agent/round wrong; the orchestrator pins them.
        return full_vote("CHAIR").model_copy(update={"round": "revote"}), Usage(10, 20, 0.1)

    monkeypatch.setattr(orchestrator, "call_llm", fake_llm)
    events = run(RunRequest(event="Fed cuts 50bp"))

    for name, data in events:
        validate_event(name, data)
    votes = [d for n, d in events if n == "vote"]
    assert sorted(v["agent"] for v in votes) == sorted(AGENTS)
    assert all(v["round"] == "blind" and v["source"] == "llm" for v in votes)
    assert events[0] == ("stage", {"name": "data", "status": "started"})
    assert events[-1] == ("stage", {"name": "blind_vote", "status": "done"})

    # Delegates see only their own DataPack; Chair/Bear/Spillover see all four.
    assert '"country":"HK"' in seen_data["HK"] and '"country":"US"' not in seen_data["HK"]
    assert all(f'"country": "{c}"' in seen_data["CHAIR"] for c in COUNTRIES)


def test_invalid_output_is_retried_once_then_skipped(monkeypatch):
    calls: dict[str, int] = {}

    async def fake_llm(system, user, schema, *, agent):
        calls[agent] = calls.get(agent, 0) + 1
        if agent == "JP" and calls[agent] == 1:
            return full_vote(agent, cells=15), Usage(1, 1, 0)  # missing a cell -> retry
        if agent == "BEAR":
            raise LLMOutputError("not JSON")  # fails twice -> skipped
        if agent == "SPILLOVER":
            raise LLMError("timed out after 25s")  # call failure -> skipped, no retry
        return full_vote(agent), Usage(1, 1, 0)

    monkeypatch.setattr(orchestrator, "call_llm", fake_llm)
    events = run(RunRequest(event="BoJ hikes rates"))

    assert calls["JP"] == 2 and calls["BEAR"] == 2 and calls["SPILLOVER"] == 1
    voted = {d["agent"] for n, d in events if n == "vote"}
    errored = {d["agent"] for n, d in events if n == "error"}
    assert voted == set(AGENTS) - {"BEAR", "SPILLOVER"}
    assert errored == {"BEAR", "SPILLOVER"}
    assert events[-1] == ("stage", {"name": "blind_vote", "status": "done"})


def test_votes_are_emitted_as_they_arrive(monkeypatch):
    delays = {a: 0.01 * i for i, a in enumerate(reversed(AGENTS))}

    async def fake_llm(system, user, schema, *, agent):
        await asyncio.sleep(delays[agent])
        return full_vote(agent), Usage(1, 1, 0)

    monkeypatch.setattr(orchestrator, "call_llm", fake_llm)
    order = [d["agent"] for n, d in run(RunRequest(event="Oil spikes 15%")) if n == "vote"]
    assert order == list(reversed(AGENTS))


def test_load_data_prefers_cache_and_falls_back_to_mocks(tmp_path, monkeypatch):
    mock_hk = json.loads((orchestrator.MOCK_PACKS / "HK.json").read_text(encoding="utf-8"))
    (tmp_path / "HK.json").write_text(json.dumps({**mock_hk, "as_of": "cached"}), encoding="utf-8")
    monkeypatch.setattr(orchestrator, "CACHE_DIR", tmp_path)

    packs = orchestrator.load_data()
    assert packs["HK"].as_of == "cached"
    assert packs["US"].country == "US"


def test_every_agent_has_a_prompt_file():
    for a in AGENTS:
        prompt = orchestrator.build_prompt(a, "TASK", "EVENT", "{}", None, Vote)
        assert "{" + "TASK}" not in prompt and "Rules:" in prompt
