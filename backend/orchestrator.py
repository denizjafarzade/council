"""Council run: data -> blind vote -> debate -> revote -> spillover -> brief.

Every stage degrades instead of failing: an agent that times out or returns bad
JSON twice is skipped with an "error" event and the run continues without it.
COUNCIL_MOCK=1 replays mocks/council_run.json instead (no API keys needed).
"""

import asyncio
import json
import logging
import os
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel

from council_math import compute_matrix, compute_vote_shifts
from llm import LLMError, LLMOutputError, call_llm
from schemas import (
    AGENTS, COUNTRIES, DISCLAIMER, SECTORS, Brief, DataPack, DelegateReport, MatrixCell, RunRequest, Spillover,
    Trigger, Vote,
)

log = logging.getLogger("council")

ROOT = Path(__file__).resolve().parent.parent
MOCK_RUN = ROOT / "mocks" / "council_run.json"
MOCK_PACKS = ROOT / "mocks" / "datapacks"
CACHE_DIR = ROOT / "backend" / "data" / "cache"
PROMPTS = ROOT / "backend" / "agents" / "prompts"
MOCK_DELAY_S = 0.3
DEBATE_ROUNDS = int(os.getenv("DEBATE_ROUNDS", "2"))  # guide: 2 max; 1 if runs are too slow

DELEGATES = list(COUNTRIES)
# Chair, Bear and Spillover see every market; delegates see only their own.
SEES_ALL = {"CHAIR", "BEAR", "SPILLOVER"}

BLIND_TASK = (
    "Blind vote. You have not seen any other agent's view. Give a view (bearish, neutral, bullish) and a "
    "confidence (0 to 1) for each of the 16 cells: every country in HK, CN, US, JP crossed with every "
    "sector in Tech, Financials, Property, Energy, each exactly once. Set agent to \"{agent}\", round to "
    "\"blind\", and leave because and source empty."
)
DEBATE_TASK = (
    "Debate round {n} of {total}. Using the blind votes and the debate so far (under OTHER AGENTS SO FAR), "
    "write a DelegateReport: impact_summary in one or two sentences on {market}, up to 5 claims each citing "
    "source ids from your DATA, at most 2 challenges to other delegates whose claims conflict with your data, "
    "and 1 to 3 triggers. Set agent to \"{agent}\"."
)
BEAR_TASK = (
    "The delegates have finished debating. Computed from the blind votes, the strongest consensus cells "
    "(highest agreement, then confidence) are:\n{cells}\nArgue the case against each using the data, and flag "
    "any delegate claim with no source. Write a DelegateReport with agent set to \"BEAR\", one challenge per "
    "cell addressed to the delegate whose market it is."
)
REVOTE_TASK = (
    "{revote}\nYOUR BLIND VOTE WAS:\n{blind}\nSet agent to \"{agent}\", round to \"revote\", leave source "
    "empty, and fill because only on cells whose view changed."
)
SPILLOVER_TASK = (
    "The debate is over. Return the Spillover graph for this event across HK, CN, US and JP: 6 to 12 nodes "
    "(give each node the country it sits in), and edges whose from and to are node ids. Cite only source ids "
    "that appear in DATA."
)
CHAIR_TASK = (
    "Computed in code from the revotes (do not recompute or contradict):\n"
    "FINAL MATRIX:\n{matrix}\nMOST SPLIT CELL: {split}\nVOTE SHIFTS:\n{shifts}\n"
    "Write headline (one sentence), exactly 3 key_risks, 3 triggers and 3 questions_for_you. Name the most "
    "split cell in a key risk."
)

T = TypeVar("T", bound=BaseModel)
Event = tuple[str, dict]


class ChairNotes(BaseModel):
    """The only part of the Brief the Chair LLM writes; the rest is computed."""

    headline: str
    key_risks: list[str]
    triggers: list[Trigger]
    questions_for_you: list[str]


def mock_mode() -> bool:
    return os.getenv("COUNCIL_MOCK", "") not in ("", "0", "false")


async def run_council(req: RunRequest) -> AsyncIterator[Event]:
    """Yield (event_name, payload) pairs matching the SSE contract."""
    if mock_mode():
        async for e in replay_mock():
            yield e
        return
    event = req.event

    yield stage("data", "started")
    packs = load_data(req.countries)
    yield stage("data", "done")

    # 2-3. Blind vote
    yield stage("blind_vote", "started")
    blinds: dict[str, Vote] = {}
    async for name, data in blind_vote(event, packs):
        if name == "vote":
            blinds[data["agent"]] = Vote.model_validate(data)
        yield name, data
    yield stage("blind_vote", "done" if blinds else "failed")

    # 4. Debate
    yield stage("debate", "started")
    yield "message", {"agent": "CHAIR", "text": f"Council convened on: {event}. Blind votes are in; "
                      "delegates, make your case.", "source_ids": []}
    reports: list[DelegateReport] = []
    for n in range(1, DEBATE_ROUNDS + 1):
        async for name, data in debate_round(n, event, packs, blinds, reports):
            yield name, data
    async for name, data in bear_attack(event, packs, blinds, reports):
        yield name, data
    yield stage("debate", "done" if reports else "failed")

    # 5-6. Revote, with spillover mapped in parallel (both only need the transcript).
    transcript = render_transcript(reports)
    spill_task = asyncio.create_task(ask(
        "SPILLOVER", Spillover, SPILLOVER_TASK, event, data_for("SPILLOVER", packs), transcript,
        "Return the Spillover JSON.", check=check_spillover,
    ))
    yield stage("revote", "started")
    revotes: dict[str, Vote] = {}
    async for name, data in revote(event, packs, blinds, transcript):
        if name == "vote":
            revotes[data["agent"]] = Vote.model_validate(data)
        yield name, data
    yield stage("revote", "done" if revotes else "failed")

    yield stage("spillover", "started")
    try:
        spill = await spill_task
        yield "spillover", spill.model_dump(mode="json", by_alias=True)
        yield stage("spillover", "done")
    except LLMError as e:
        yield skipped("SPILLOVER", "spillover", e)
        yield stage("spillover", "failed")

    # 7. Brief
    yield stage("brief", "started")
    brief, chair_err = await write_brief(event, packs, blinds, revotes, transcript)
    if chair_err:
        yield skipped("CHAIR", "brief", chair_err)
    if brief is None:
        yield stage("brief", "failed")
        return
    yield "brief", brief.model_dump(mode="json", by_alias=True)
    yield stage("brief", "done")


async def replay_mock() -> AsyncIterator[Event]:
    for e in json.loads(MOCK_RUN.read_text(encoding="utf-8")):
        await asyncio.sleep(MOCK_DELAY_S)
        yield e["event"], e["data"]


def stage(name: str, status: str) -> Event:
    return "stage", {"name": name, "status": status}


def skipped(agent: str, stage_name: str, err: Exception) -> Event:
    log.error("%s skipped in %s: %s", agent, stage_name, err)
    return "error", {"message": f"{agent} skipped in {stage_name}: {err}", "agent": agent}


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


# --- prompts and the one agent-call helper --------------------------------------

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


async def ask(agent: str, schema: type[T], task: str, event: str, data: str, transcript: str | None,
              user: str, check: Callable[[T], T] = lambda x: x) -> T:
    """One agent call. Retries once on invalid output; raises LLMError if it still fails."""
    system = build_prompt(agent, task, event, data, transcript, schema)
    for attempt in (1, 2):
        try:
            out, _usage = await call_llm(system, f"EVENT: {event}\n{user}", schema, agent=agent)
            return check(out)
        except LLMOutputError as e:
            if attempt == 2:
                raise
            log.warning("%s gave invalid %s, retrying: %s", agent, schema.__name__, e)
    raise AssertionError("unreachable")


async def in_parallel(calls: dict[str, Awaitable[T]]) -> AsyncIterator[tuple[str, T | LLMError]]:
    """Run agent calls concurrently; yield (agent, result or error) as each one lands."""

    async def one(agent: str, call: Awaitable[T]) -> tuple[str, T | LLMError]:
        try:
            return agent, await call
        except LLMError as e:
            return agent, e

    for next_done in asyncio.as_completed([one(a, c) for a, c in calls.items()]):
        yield await next_done


# --- 2-3. blind_vote --------------------------------------------------------------

def check_vote(vote: Vote, agent: str, rnd: str) -> Vote:
    """Pin identity fields and require each of the 16 cells exactly once."""
    vote = vote.model_copy(update={"agent": agent, "round": rnd, "source": "llm"})
    if rnd == "blind":
        vote = vote.model_copy(update={"cells": [c.model_copy(update={"because": None}) for c in vote.cells]})
    cells = [(c.country, c.sector) for c in vote.cells]
    expected = {(c, s) for c in COUNTRIES for s in SECTORS}
    if len(cells) != len(expected) or set(cells) != expected:
        missing = sorted(f"{c}/{s}" for c, s in expected - set(cells))
        raise LLMOutputError(f"vote must cover all 16 cells once; got {len(cells)}, missing {missing}")
    return vote


def ask_vote(agent: str, event: str, packs: dict[str, DataPack]) -> Awaitable[Vote]:
    """One agent's blind vote (also used by smoke_llm.py)."""
    return ask(agent, Vote, BLIND_TASK.format(agent=agent), event, data_for(agent, packs), None,
               "Return your blind vote as JSON.", check=lambda v: check_vote(v, agent, "blind"))


async def blind_vote(event: str, packs: dict[str, DataPack]) -> AsyncIterator[Event]:
    """All 7 agents in parallel; each vote is emitted the moment it lands."""
    calls = {a: ask_vote(a, event, packs) for a in AGENTS}
    async for agent, result in in_parallel(calls):
        if isinstance(result, LLMError):
            yield skipped(agent, "blind vote", result)
        else:
            yield "vote", result.model_dump(mode="json", exclude_none=True)


# --- 4. debate ---------------------------------------------------------------------

def render_votes(votes: dict[str, Vote]) -> str:
    return "\n".join(
        f"{a}: " + ", ".join(f"{c.country}/{c.sector} {c.view} {c.confidence:.2f}" for c in v.cells)
        for a, v in votes.items()
    )


def render_transcript(reports: list[DelegateReport]) -> str:
    lines = []
    for r in reports:
        lines.append(f"[{r.agent}] {r.impact_summary}")
        lines += [f"  claim: {c.text} [{', '.join(c.source_ids)}]" for c in r.claims]
        lines += [f"  challenge to {c.to_agent}: {c.text}" for c in r.challenges]
        lines += [f"  trigger: if {t.condition} -> {t.would_change}" for t in r.triggers]
    return "\n".join(lines)


def report_events(report: DelegateReport) -> list[Event]:
    """A report streams as chat messages (summary, then each challenge) followed by the report itself."""
    ids = list(dict.fromkeys(i for c in report.claims for i in c.source_ids))
    events: list[Event] = [("message", {"agent": report.agent, "text": report.impact_summary, "source_ids": ids})]
    events += [("message", {"agent": report.agent, "text": f"Challenge to {c.to_agent}: {c.text}", "source_ids": []})
               for c in report.challenges]
    events.append(("report", report.model_dump(mode="json")))
    return events


def pin_agent(agent: str) -> Callable[[DelegateReport], DelegateReport]:
    return lambda r: r.model_copy(update={"agent": agent})


async def debate_round(n: int, event: str, packs: dict[str, DataPack], blinds: dict[str, Vote],
                       reports: list[DelegateReport]) -> AsyncIterator[Event]:
    """Delegates argue in parallel, each seeing all blind votes and every earlier report."""
    context = f"BLIND VOTES:\n{render_votes(blinds)}\n\nDEBATE SO FAR:\n{render_transcript(reports) or 'Nothing yet.'}"
    calls = {
        d: ask(d, DelegateReport, DEBATE_TASK.format(n=n, total=DEBATE_ROUNDS, market=d, agent=d), event,
               data_for(d, packs), context, "Return your DelegateReport as JSON.", check=pin_agent(d))
        for d in DELEGATES if d in packs
    }
    new: list[DelegateReport] = []
    async for agent, result in in_parallel(calls):
        if isinstance(result, LLMError):
            yield skipped(agent, f"debate round {n}", result)
            continue
        new.append(result)
        for e in report_events(result):
            yield e
    # Later rounds see this round's reports only once the whole round is in.
    reports.extend(new)


def strongest_consensus(blinds: dict[str, Vote], k: int = 3) -> list[MatrixCell]:
    cells = compute_matrix(list(blinds.values()))
    return sorted(cells, key=lambda c: (c.dissent, -c.confidence))[:k]


async def bear_attack(event: str, packs: dict[str, DataPack], blinds: dict[str, Vote],
                      reports: list[DelegateReport]) -> AsyncIterator[Event]:
    targets = "\n".join(f"- {c.country}/{c.sector}: {c.view}, confidence {c.confidence}, dissent {c.dissent}"
                        for c in strongest_consensus(blinds))
    context = f"BLIND VOTES:\n{render_votes(blinds)}\n\nDEBATE:\n{render_transcript(reports)}"
    try:
        report = await ask("BEAR", DelegateReport, BEAR_TASK.format(cells=targets), event, data_for("BEAR", packs),
                           context, "Return your DelegateReport as JSON.", check=pin_agent("BEAR"))
    except LLMError as e:
        yield skipped("BEAR", "debate", e)
        return
    reports.append(report)
    for e in report_events(report):
        yield e


# --- 5. revote -------------------------------------------------------------------------

async def revote(event: str, packs: dict[str, DataPack], blinds: dict[str, Vote],
                 transcript: str) -> AsyncIterator[Event]:
    revote_rules = (PROMPTS / "_revote.md").read_text(encoding="utf-8").strip()
    calls = {}
    for a in AGENTS:
        # An agent that missed the blind vote still revotes; it just has nothing to compare against.
        blind = render_votes({a: blinds[a]}) if a in blinds else "You did not vote in the blind round."
        task = REVOTE_TASK.format(revote=revote_rules, blind=blind, agent=a)
        calls[a] = ask(a, Vote, task, event, data_for(a, packs), transcript, "Return your revote as JSON.",
                       check=lambda v, a=a: check_vote(v, a, "revote"))
    async for agent, result in in_parallel(calls):
        if isinstance(result, LLMError):
            yield skipped(agent, "revote", result)
        else:
            yield "vote", result.model_dump(mode="json", exclude_none=True)


# --- 6. spillover ------------------------------------------------------------------------

def check_spillover(s: Spillover) -> Spillover:
    nodes = {n.id for n in s.nodes}
    dangling = [f"{e.from_}->{e.to}" for e in s.edges if e.from_ not in nodes or e.to not in nodes]
    if dangling:
        raise LLMOutputError(f"edges reference unknown nodes: {dangling}")
    if not s.edges:
        raise LLMOutputError("spillover graph has no edges")
    return s


# --- 7. brief ----------------------------------------------------------------------------

FALLBACK_HEADLINE = "Council matrix computed; the Chair's summary is unavailable for this run."


async def write_brief(event: str, packs: dict[str, DataPack], blinds: dict[str, Vote], revotes: dict[str, Vote],
                      transcript: str) -> tuple[Brief | None, LLMError | None]:
    """Matrix, dissent and shifts in Python; the Chair LLM only writes the prose fields.

    If the Chair fails, the brief still ships with the computed matrix and shifts.
    """
    final_votes = list(revotes.values()) or list(blinds.values())
    if not final_votes:
        return None, None
    matrix = compute_matrix(final_votes)
    shifts = compute_vote_shifts(list(blinds.values()), list(revotes.values()))
    split = max(matrix, key=lambda c: c.dissent)

    task = CHAIR_TASK.format(
        matrix="\n".join(f"{c.country}/{c.sector}: {c.view} conf {c.confidence} dissent {c.dissent}" for c in matrix),
        split=f"{split.country}/{split.sector} (dissent {split.dissent})",
        shifts="\n".join(f"{s.agent} {s.cell}: {s.from_} -> {s.to} because {s.because}" for s in shifts) or "None.",
    )
    err = None
    try:
        notes = await ask("CHAIR", ChairNotes, task, event, data_for("CHAIR", packs), transcript,
                          "Return the Chair's notes as JSON.")
    except LLMError as e:
        err = e
        notes = ChairNotes(headline=FALLBACK_HEADLINE, key_risks=[], triggers=[], questions_for_you=[])
    return Brief(**notes.model_dump(), matrix=matrix, vote_shifts=shifts, disclaimer=DISCLAIMER), err
