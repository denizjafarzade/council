"""Council run: data -> blind vote -> debate -> revote -> spillover -> brief.

Stage 1A: load_data + blind_vote stream real agent votes. COUNCIL_MOCK=1 replays
mocks/council_run.json instead (no API keys needed, used by the UI and tests).
"""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import AsyncIterator

from llm import LLMError, LLMOutputError, call_llm
from schemas import AGENTS, COUNTRIES, SECTORS, DataPack, RunRequest, Vote

log = logging.getLogger("council")

ROOT = Path(__file__).resolve().parent.parent
MOCK_RUN = ROOT / "mocks" / "council_run.json"
MOCK_PACKS = ROOT / "mocks" / "datapacks"
CACHE_DIR = ROOT / "backend" / "data" / "cache"
PROMPTS = ROOT / "backend" / "agents" / "prompts"
MOCK_DELAY_S = 0.3

# Chair, Bear and Spillover see every market; delegates see only their own.
SEES_ALL = {"CHAIR", "BEAR", "SPILLOVER"}

BLIND_TASK = (
    "Blind vote. You have not seen any other agent's view. Give a view (bearish, neutral, bullish) and a "
    "confidence (0 to 1) for each of the 16 cells: every country in HK, CN, US, JP crossed with every "
    "sector in Tech, Financials, Property, Energy, each exactly once. Set agent to \"{agent}\", round to "
    "\"blind\", and leave because and source empty."
)

Event = tuple[str, dict]


def mock_mode() -> bool:
    return os.getenv("COUNCIL_MOCK", "") not in ("", "0", "false")


async def run_council(req: RunRequest) -> AsyncIterator[Event]:
    """Yield (event_name, payload) pairs matching the SSE contract."""
    if mock_mode():
        async for e in replay_mock():
            yield e
        return

    yield stage("data", "started")
    packs = load_data(req.countries)
    yield stage("data", "done")

    yield stage("blind_vote", "started")
    votes: dict[str, Vote] = {}
    async for name, data in blind_vote(req.event, packs):
        if name == "vote":
            votes[data["agent"]] = Vote.model_validate(data)
        yield name, data
    yield stage("blind_vote", "done" if votes else "failed")
    # Stage 2A continues here: debate -> revote -> spillover -> brief.


async def replay_mock() -> AsyncIterator[Event]:
    for e in json.loads(MOCK_RUN.read_text(encoding="utf-8")):
        await asyncio.sleep(MOCK_DELAY_S)
        yield e["event"], e["data"]


def stage(name: str, status: str) -> Event:
    return "stage", {"name": name, "status": status}


# --- 1. load_data -------------------------------------------------------------

def load_data(countries: list[str] = COUNTRIES) -> dict[str, DataPack]:
    """DataPacks from data/cache/{country}.json, falling back to mocks/datapacks/."""
    packs = {}
    for c in countries:
        path = CACHE_DIR / f"{c}.json"
        if not path.exists():
            log.warning("no cached DataPack for %s, using mock", c)
            path = MOCK_PACKS / f"{c}.json"
        packs[c] = DataPack.model_validate_json(path.read_text(encoding="utf-8"))
    return packs


def data_for(agent: str, packs: dict[str, DataPack]) -> str:
    if agent in SEES_ALL:
        return json.dumps({c: p.model_dump(mode="json") for c, p in packs.items()})
    return packs[agent].model_dump_json()


# --- prompts -------------------------------------------------------------------

def build_prompt(agent: str, task: str, event: str, data: str, transcript: str | None, schema: type) -> str:
    """System prompt = shared rules + the agent's role file with its placeholders filled."""
    shared = (PROMPTS / "_shared.md").read_text(encoding="utf-8")
    role = (PROMPTS / f"{agent}.md").read_text(encoding="utf-8")
    fills = {
        "{TASK}": task,
        "{EVENT}": event,
        "{DATAPACK_JSON}": data,
        "{TRANSCRIPT_OR_NONE}": transcript or "None yet.",
        "{SCHEMA}": json.dumps(schema.model_json_schema()),
    }
    for key, value in fills.items():
        role = role.replace(key, value)
    return f"{shared}\n\n{role}"


# --- 2/3. blind_vote ------------------------------------------------------------

def check_vote(vote: Vote, agent: str, rnd: str) -> Vote:
    """Pin identity fields and require each of the 16 cells exactly once."""
    vote = vote.model_copy(update={"agent": agent, "round": rnd, "source": "llm"})
    cells = [(c.country, c.sector) for c in vote.cells]
    expected = {(c, s) for c in COUNTRIES for s in SECTORS}
    if len(cells) != len(expected) or set(cells) != expected:
        missing = sorted(f"{c}/{s}" for c, s in expected - set(cells))
        raise LLMOutputError(f"vote must cover all 16 cells once; got {len(cells)}, missing {missing}")
    return vote


async def ask_vote(agent: str, event: str, packs: dict[str, DataPack]) -> Vote:
    """One agent's blind vote. Retries once on invalid output; raises LLMError if it still fails."""
    system = build_prompt(agent, BLIND_TASK.format(agent=agent), event, data_for(agent, packs), None, Vote)
    user = f"EVENT: {event}\nReturn your blind vote as JSON."
    for attempt in (1, 2):
        try:
            vote, _usage = await call_llm(system, user, Vote, agent=agent)
            return check_vote(vote, agent, "blind")
        except LLMOutputError as e:
            if attempt == 2:
                raise
            log.warning("%s gave invalid vote, retrying: %s", agent, e)
    raise AssertionError("unreachable")


async def blind_vote(event: str, packs: dict[str, DataPack]) -> AsyncIterator[Event]:
    """Run all 7 agents in parallel; yield each vote the moment it lands."""

    async def one(agent: str) -> tuple[str, Vote | LLMError]:
        try:
            return agent, await ask_vote(agent, event, packs)
        except LLMError as e:
            return agent, e

    for next_done in asyncio.as_completed([one(a) for a in AGENTS]):
        agent, result = await next_done
        if isinstance(result, Vote):
            yield "vote", result.model_dump(mode="json", exclude_none=True)
        else:
            log.error("%s skipped in blind vote: %s", agent, result)
            yield "error", {"message": f"{agent} skipped in blind vote: {result}", "agent": agent}
