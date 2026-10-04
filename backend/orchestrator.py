"""Council run: data -> blind vote -> debate -> revote -> spillover -> brief.

The council is configurable (library.py): any markets, any number of seats per market,
any cross-market seats. Each seat's stage decides when it speaks:
  debate    argues in the debate rounds (market specialists, custom thematic seats)
  rebuttal  speaks once after the rounds, against or for the consensus (Bear, Bull, Risk)
  spillover draws the spillover graph
  chair     writes the brief (exactly one)

Every stage degrades instead of failing: a seat that times out or returns bad JSON twice
is skipped with an "error" event and the run continues without it.
COUNCIL_MOCK=1 replays mocks/council_run.json instead (no API keys needed).
"""

import asyncio
import json
import logging
import os
import zlib
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel

import guardrail
import jev
import library
from council_math import compute_matrix, compute_vote_shifts
from library import Seat
from llm import LLMError, LLMOutputError, call_llm
from models import model_for
from verify import check_claim
from schemas import (
    COUNTRIES, DISCLAIMER, SECTORS, Brief, Council, DataPack, DelegateReport, MatrixCell, RunRequest, Spillover,
    Trigger, Vote,
)

log = logging.getLogger("council")

ROOT = Path(__file__).resolve().parent.parent
MOCK_RUN = ROOT / "mocks" / "council_run.json"
MOCK_PACKS = ROOT / "mocks" / "datapacks"
CACHE_DIR = ROOT / "backend" / "data" / "cache"
PROMPTS = ROOT / "backend" / "agents" / "prompts"
MOCK_DELAY_S = 0.3
FETCH_TIMEOUT_S = 30.0
# Profile seats whose models a market seat can borrow, for model diversity (models.py).
DELEGATE_MODEL_KEYS = ["HK", "CN", "US", "JP"]
STAGE_MODEL_KEY = {"rebuttal": "BEAR", "spillover": "SPILLOVER", "chair": "CHAIR", "debate": "BEAR"}

BLIND_TASK = (
    "Blind vote. You have not seen any other member's view. Give a view (bearish, neutral, bullish) and a "
    "confidence (0 to 1) for each of the {n} cells: {scope} crossed with every sector in "
    "Tech, Financials, Property, Energy, each exactly once. Set agent to \"{agent}\", round to \"blind\", "
    "and leave because and source empty."
)
DEBATE_TASK = (
    "Debate round {n} of {total}. Using the blind votes and the debate so far (under OTHER MEMBERS SO FAR), "
    "write a DelegateReport from your focus: impact_summary is ONE plain sentence under 25 words saying what the "
    "EVENT means from here for your focus, with market and sector names written out and no source ids, numbers "
    "or jargon; then up to 5 claims each citing source ids from your DATA (or [EVENT] for the news item itself), "
    "at most 2 challenges to other members whose claims conflict with your data, "
    "and 1 to 3 triggers. Set agent to \"{agent}\"."
)
REBUTTAL_TASK = (
    "The debate rounds are over. Computed from the blind votes:\n"
    "STRONGEST CONSENSUS (highest agreement, then confidence):\n{consensus}\n"
    "MOST BEARISH OR SPLIT:\n{contested}\n"
    "Respond from your focus, using whichever of these lists it calls for. Write a DelegateReport with agent "
    "set to \"{agent}\", one challenge per cell you address, aimed at the member whose market it is."
)
REVOTE_TASK = (
    "{revote}\nYOUR BLIND VOTE WAS:\n{blind}\nSet agent to \"{agent}\", round to \"revote\", leave source "
    "empty, and fill because only on cells whose view changed."
)
SPILLOVER_TASK = (
    "The debate is over. Return the Spillover graph for this event across {markets}: 6 to 12 nodes (give each "
    "node the market code it sits in), and edges whose from and to are node ids. Cite only source ids that "
    "appear in DATA."
)
QUESTIONS_WITH_PORTFOLIO = (
    "Each of the 3 questions_for_you must name one of the user's largest exposures in words (for example "
    "\"your Hong Kong banks\" or \"your US technology holdings\") and ask how this news changes the case for it. "
    "Do not restate any percentage or number from USER EXPOSURE."
)
QUESTIONS_NO_PORTFOLIO = (
    "questions_for_you cover time horizon, position size relative to the user's account, and overlap with what "
    "they already hold."
)
CHAIR_TASK = (
    "Computed in code from the revotes (do not recompute or contradict):\n"
    "FINAL MATRIX:\n{matrix}\nMOST SPLIT CELL: {split}\nVOTE SHIFTS:\n{shifts}\n"
    "USER EXPOSURE (aggregated; use it only for questions_for_you):\n{exposure}\n"
    "Write headline (one sentence), exactly 3 key_risks, 3 triggers and 3 questions_for_you. Name the most "
    "split cell in a key risk. {questions_rule}\n"
    "Also write plain_english: the council's view retold for someone with no finance background, in 3 to 5 "
    "short sentences. No jargon, tickers, source ids, percentages or abbreviations (say \"interest rates\", "
    "not \"bp\" or \"HIBOR\"; \"likely to rise\", not \"bullish\"). Say what happened, which markets "
    "and industries the council expects to do better or worse and why in everyday terms, where it disagrees, "
    "and that this is research, not advice to buy or sell."
)
COVERAGE_NOTE = (
    "\nDATA COVERAGE: your market's DATA has the index, FX and headlines but no sector proxies. Judge its "
    "sector cells from the index and news, keep confidence lower there, and say \"not in our data\" where needed."
)

T = TypeVar("T", bound=BaseModel)
Event = tuple[str, dict]


class ChairNotes(BaseModel):
    """The only part of the Brief the Chair LLM writes; the rest is computed."""

    headline: str
    key_risks: list[str]
    triggers: list[Trigger]
    questions_for_you: list[str]
    plain_english: str = ""  # asked for in CHAIR_TASK; a model that omits it still yields a brief


def mock_mode() -> bool:
    return os.getenv("COUNCIL_MOCK", "") not in ("", "0", "false")


def council_for(req: RunRequest) -> Council:
    if req.council:
        return req.council
    if req.council_id:
        return library.get_council(req.council_id)
    return library.default_council(req.countries)


async def run_council(req: RunRequest) -> AsyncIterator[Event]:
    """Yield (event_name, payload) pairs matching the SSE contract."""
    if mock_mode():
        async for e in replay_mock():
            yield e
        return
    event = req.event
    council = council_for(req)
    seats = library.resolve(council)  # app.py already rejected invalid councils with a 422
    run = Run(council, seats, guard=guardrail.enabled() and req.guardrail is not False)

    yield stage("data", "started")
    packs, problems = await load_data(council.markets)
    yield "council", council_event(council, seats, packs, run.guard)
    import portfolio  # lazily: portfolio imports this module for its data paths

    held = portfolio.current()
    run.exposure = held.event_payload() if held else None
    if run.exposure:
        yield "portfolio", run.exposure
    for message in problems:
        yield "error", {"message": message}
    yield stage("data", "done")

    # 2-3. Blind vote
    yield stage("blind_vote", "started")
    blinds: dict[str, Vote] = {}
    async for name, data in run.votes("blind", event, packs, blinds, None):
        if name == "vote":
            blinds[data["agent"]] = Vote.model_validate(data)
        yield name, data
    yield stage("blind_vote", "done" if blinds else "failed")

    # 4. Debate rounds, then the rebuttal seats (Bear, Bull, Risk, ...)
    yield stage("debate", "started")
    yield "message", {"agent": run.chair.id, "text": f"Council convened on: {event}. Blind votes are in; "
                      "members, make your case.", "source_ids": []}
    reports: list[DelegateReport] = []
    for n in range(1, council.debate_rounds + 1):
        async for e in run.debate_round(n, event, packs, blinds, reports):
            yield e
    async for e in run.rebuttals(event, packs, blinds, reports):
        yield e
    yield stage("debate", "done" if reports else "failed")

    # 5-6. Revote, with spillover mapped in parallel (both only need the transcript).
    transcript = render_transcript(reports)
    spiller = run.spillover_seat()
    spill_task = asyncio.create_task(run.ask(
        spiller, Spillover, SPILLOVER_TASK.format(markets=", ".join(council.markets)), event, packs, transcript,
        "Return the Spillover JSON.", check=check_spillover,
    )) if spiller else None
    yield stage("revote", "started")
    revotes: dict[str, Vote] = {}
    async for name, data in run.votes("revote", event, packs, blinds, transcript, reports):
        if name == "vote":
            revotes[data["agent"]] = Vote.model_validate(data)
        yield name, data
    yield stage("revote", "done" if revotes else "failed")

    yield stage("spillover", "started")
    if spill_task is None:
        yield stage("spillover", "skipped")
    else:
        try:
            spill = await spill_task
            yield "spillover", spill.model_dump(mode="json", by_alias=True)
            yield stage("spillover", "done")
        except LLMError as e:
            yield skipped(spiller.id, "spillover", e)
            yield stage("spillover", "failed")

    # 7. Brief
    yield stage("brief", "started")
    brief, chair_err = await run.write_brief(event, packs, blinds, revotes, transcript)
    if chair_err:
        yield skipped(run.chair.id, "brief", chair_err)
    if brief is None:
        yield stage("brief", "failed")
        return
    yield "brief", brief.model_dump(mode="json", by_alias=True)
    yield stage("brief", "done")


async def replay_mock() -> AsyncIterator[Event]:
    council = library.default_council()
    yield "council", council_event(council, library.resolve(council), {})
    for e in json.loads(MOCK_RUN.read_text(encoding="utf-8")):
        await asyncio.sleep(MOCK_DELAY_S)
        yield e["event"], e["data"]


def stage(name: str, status: str) -> Event:
    return "stage", {"name": name, "status": status}


def skipped(agent: str, stage_name: str, err: Exception) -> Event:
    log.error("%s skipped in %s: %s", agent, stage_name, err)
    return "error", {"message": f"{agent} skipped in {stage_name}: {err}", "agent": agent}


def council_event(council: Council, seats: list[Seat], packs: dict[str, DataPack], guard: bool = False) -> dict:
    lib = library.markets()
    return {
        "name": council.name,
        "markets": [{"code": c, "name": lib[c].name,
                     "coverage": packs[c].coverage or lib[c].coverage if c in packs else lib[c].coverage,
                     "as_of": packs[c].as_of if c in packs else None} for c in council.markets],
        "sectors": list(SECTORS),
        "members": [{"id": s.id, "name": s.member.name, "role": s.role.id, "role_name": s.role.name,
                     "stage": s.stage, "market": s.market.code if s.market else None,
                     "phases": s.member.phases.model_dump()} for s in seats],
        "debate_rounds": council.debate_rounds,
        "guardrail": guardrail.label() if guard else None,
    }


# --- 1. load_data -------------------------------------------------------------------

def _read_pack(code: str) -> DataPack | None:
    for folder in (CACHE_DIR, MOCK_PACKS):
        path = folder / f"{code}.json"
        if path.exists():
            if folder is MOCK_PACKS:
                log.warning("no cached DataPack for %s, using mock", code)
            return DataPack.model_validate_json(path.read_text(encoding="utf-8"))
    return None


def _fetch_pack(code: str) -> DataPack:
    from data import fetch  # imported lazily: pulls in yfinance

    pack = fetch.build(code, [])
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    (CACHE_DIR / f"{code}.json").write_text(pack.model_dump_json(indent=2), encoding="utf-8")
    return pack


def _empty_pack(code: str) -> DataPack:
    return DataPack(country=code, as_of="unknown", series=[], sectors=[], macro=[], news=[], coverage="none")


async def load_data(markets: list[str] = COUNTRIES) -> tuple[dict[str, DataPack], list[str]]:
    """DataPacks from data/cache, then mocks/datapacks, then a live fetch; never fails the run."""
    packs, problems = {}, []
    for code in markets:
        pack = _read_pack(code)
        if pack is None and os.getenv("COUNCIL_OFFLINE", "") not in ("", "0", "false"):
            problems.append(f"Offline mode: no cached data for {code}; its members argue from their brief only.")
            pack = _empty_pack(code)
        if pack is None:
            try:
                pack = await asyncio.wait_for(asyncio.to_thread(_fetch_pack, code), FETCH_TIMEOUT_S)
            except Exception as e:  # noqa: BLE001 - any data failure leaves that market without data
                log.error("no data for %s: %s", code, e)
                problems.append(f"No market data for {code} ({e}); its members argue from their brief only.")
                pack = _empty_pack(code)
        packs[code] = pack
    return packs, problems


# --- prompts ------------------------------------------------------------------------------

def data_for(seat: Seat, packs: dict[str, DataPack]) -> str:
    if seat.sees_all:
        return json.dumps({c: p.model_dump(mode="json", exclude_none=True) for c, p in packs.items()})
    return packs[seat.market.code].model_dump_json(exclude_none=True)


def build_prompt(seat: Seat, markets: list[str], task: str, event: str, data: str, transcript: str | None,
                 schema: type) -> str:
    """System prompt = shared rules + the seat template filled from the member, its role and market."""
    lib = library.markets()
    shared = (PROMPTS / "_shared.md").read_text(encoding="utf-8").replace(
        "{MARKETS}", ", ".join(f"{lib[c].name} ({c})" if c in lib else c for c in markets))
    market = seat.market
    partial = market is not None and market.coverage == "partial"
    fills = {
        "{NAME}": seat.member.name,
        "{ROLE_NAME}": seat.role.name,
        "{FOR_MARKET}": f" for {market.name} ({market.code})" if market else "",
        "{SEES}": (f"You see only the {market.code} DataPack." if market
                   else "You see every market's DataPack and the full transcript."),
        "{INSTRUCTIONS}": seat.instructions,
        "{LOCAL_KNOWLEDGE}": f"LOCAL KNOWLEDGE:\n{seat.brief}\n" if seat.brief else "",
        "{COVERAGE_NOTE}": COVERAGE_NOTE if partial else "",
        "{TASK}": task,
        "{EVENT}": event,
        "{DATAPACK_JSON}": data,
        "{TRANSCRIPT_OR_NONE}": transcript or "None yet.",
        "{SCHEMA}": json.dumps(schema.model_json_schema()),
    }
    role = (PROMPTS / "_seat.md").read_text(encoding="utf-8")
    for key, value in fills.items():
        role = role.replace(key, value)
    return f"{shared}\n\n{role}"


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


def report_events(report: DelegateReport, visible: list[DataPack], all_packs: list[DataPack],
                  event: str) -> list[Event]:
    """A report streams as chat messages, then the report itself: the summary, each claim with
    its sources (checked against the author's data), then each challenge."""
    ids = list(dict.fromkeys(i for c in report.claims for i in c.source_ids))
    # The summary rides on its claims' citations, so only its ids and numbers are checked.
    summary_problems = [p for p in check_claim(report.impact_summary, ids, visible, event, all_packs)
                        if p != "cites no source"]
    events: list[Event] = [("message", {"agent": report.agent, "text": report.impact_summary, "source_ids": ids,
                                        "unverified": summary_problems})]
    events += [("message", {"agent": report.agent, "text": c.text, "source_ids": c.source_ids,
                            "unverified": check_claim(c.text, c.source_ids, visible, event, all_packs)})
               for c in report.claims]
    events += [("message", {"agent": report.agent, "text": f"Challenge to {c.to_agent}: {c.text}", "source_ids": []})
               for c in report.challenges]
    events.append(("report", report.model_dump(mode="json")))
    return events


async def guard_messages(events: list[Event], on: bool = True) -> list[Event]:
    """Run every message through the compliance guardrail before it is streamed."""
    if not (on and guardrail.enabled()):
        return events
    messages = [d for name, d in events if name == "message"]
    for data, checked in zip(messages, await guardrail.check_all([d["text"] for d in messages])):
        note = checked.note()
        if note is None:
            continue
        data["guardrail"] = note
        if checked.blocked:
            # The replacement text cites nothing, so its sources and checks no longer apply.
            data.update(text=checked.text, source_ids=[], unverified=[])
    return events


async def guard_brief(brief: Brief, on: bool = True) -> Brief:
    """Run every line of the Chair's brief through the guardrail; blocked lines are replaced."""
    if not (on and guardrail.enabled()):
        return brief
    d = brief.model_dump(mode="json", by_alias=True)
    lines: list[tuple[str, list | dict, int | str]] = [("headline", d, "headline"), ("plain_english", d, "plain_english")]
    lines += [(f"key_risks[{i}]", d["key_risks"], i) for i in range(len(d["key_risks"]))]
    lines += [(f"questions_for_you[{i}]", d["questions_for_you"], i) for i in range(len(d["questions_for_you"]))]
    for i, t in enumerate(d["triggers"]):
        lines += [(f"triggers[{i}].condition", t, "condition"), (f"triggers[{i}].would_change", t, "would_change")]
    lines += [(f"vote_shifts[{i}].because", s, "because") for i, s in enumerate(d["vote_shifts"])]
    checked = await guardrail.check_all([holder[key] for _, holder, key in lines])
    notes = []
    for (path, holder, key), c in zip(lines, checked):
        note = c.note()
        if note:
            holder[key] = c.text
            notes.append({**note, "field": path})
    d["guardrail"] = notes
    return Brief.model_validate(d)


def check_vote(vote: Vote, agent: str, rnd: str, markets: list[str], source: str = "llm") -> Vote:
    """Pin identity fields and require each cell exactly once."""
    vote = vote.model_copy(update={"agent": agent, "round": rnd, "source": source})
    if rnd == "blind":
        vote = vote.model_copy(update={"cells": [c.model_copy(update={"because": None}) for c in vote.cells]})
    cells = [(c.country, c.sector) for c in vote.cells]
    expected = {(c, s) for c in markets for s in SECTORS}
    if len(cells) != len(expected) or set(cells) != expected:
        missing = sorted(f"{c}/{s}" for c, s in expected - set(cells))
        raise LLMOutputError(f"vote must cover all {len(expected)} cells once; got {len(cells)}, missing {missing}")
    return vote


def check_spillover(s: Spillover) -> Spillover:
    nodes = {n.id for n in s.nodes}
    dangling = [f"{e.from_}->{e.to}" for e in s.edges if e.from_ not in nodes or e.to not in nodes]
    if dangling:
        raise LLMOutputError(f"edges reference unknown nodes: {dangling}")
    if not s.edges:
        raise LLMOutputError("spillover graph has no edges")
    return s


def pin_agent(agent: str) -> Callable[[DelegateReport], DelegateReport]:
    return lambda r: r.model_copy(update={"agent": agent})


async def in_parallel(calls: dict[str, Awaitable[T]]) -> AsyncIterator[tuple[str, T | LLMError]]:
    """Run seat calls concurrently; yield (seat id, result or error) as each one lands."""

    async def one(agent: str, call: Awaitable[T]) -> tuple[str, T | LLMError]:
        try:
            return agent, await call
        except LLMError as e:
            return agent, e

    for next_done in asyncio.as_completed([one(a, c) for a, c in calls.items()]):
        yield await next_done


FALLBACK_HEADLINE = "Council matrix computed; the Chair's summary is unavailable for this run."


class Run:
    """One council run: the seats plus every stage that calls them."""

    def __init__(self, council: Council, seats: list[Seat], guard: bool = False):
        self.guard = guard  # run messages and the brief through the compliance guardrail
        self.council = council
        self.markets = council.markets
        self.seats = seats
        self.chair = next(s for s in seats if s.stage == "chair")
        self.exposure: dict | None = None  # aggregated portfolio percentages, for the Chair only

    def vote_markets(self, seat: Seat) -> list[str]:
        """Market seats vote on their own market's four cells; cross-market seats on every market."""
        return self.markets if seat.sees_all else [seat.market.code]

    def visible(self, seat: Seat, packs: dict[str, DataPack]) -> list[DataPack]:
        return list(packs.values()) if seat.sees_all else [packs[seat.market.code]]

    async def report_events(self, report: DelegateReport, packs: dict[str, DataPack], event: str) -> list[Event]:
        seat = next(s for s in self.seats if s.id == report.agent)
        return await guard_messages(report_events(report, self.visible(seat, packs), list(packs.values()), event),
                                    self.guard)

    def agent_context(self, seat: Seat, event: str, packs: dict[str, DataPack], reports: list[DelegateReport],
                      transcript: str | None) -> dict:
        """Jev's state for one seat: who it is, what it can see, and what it argued."""
        own = [r for r in reports if r.agent == seat.id]
        return {
            "member": {"name": seat.member.name, "role": seat.role.name, "focus": seat.instructions,
                       "market": f"{seat.market.name} ({seat.market.code})" if seat.market else "all markets",
                       "local_knowledge": seat.brief},
            "event": event,
            "data": {p.country: data_lines(p) for p in self.visible(seat, packs)},
            "debate_notes": render_transcript(own) or (
                "Blind vote: no debate yet." if transcript is None else "This member did not speak in the debate."),
            "council_debate": (transcript or "")[-6000:],
        }

    def model(self, seat: Seat) -> str:
        if seat.market:
            like = seat.market.code if seat.market.code in DELEGATE_MODEL_KEYS else \
                DELEGATE_MODEL_KEYS[zlib.crc32(seat.id.encode()) % len(DELEGATE_MODEL_KEYS)]
        else:
            like = STAGE_MODEL_KEY[seat.stage]
        return model_for(seat.id, explicit=seat.member.model, like=like)

    async def ask(self, seat: Seat, schema: type[T], task: str, event: str, packs: dict[str, DataPack],
                  transcript: str | None, user: str, check: Callable[[T], T] = lambda x: x) -> T:
        """One seat call. Retries once on invalid output; raises LLMError if it still fails."""
        system = build_prompt(seat, self.markets, task, event, data_for(seat, packs), transcript, schema)
        for attempt in (1, 2):
            try:
                out, _usage = await call_llm(system, f"EVENT: {event}\n{user}", schema, agent=seat.id,
                                             model=self.model(seat))
                return check(out)
            except LLMOutputError as e:
                if attempt == 2:
                    raise
                log.warning("%s gave invalid %s, retrying: %s", seat.id, schema.__name__, e)
        raise AssertionError("unreachable")

    async def ask_vote(self, seat: Seat, rnd: str, event: str, packs: dict[str, DataPack],
                       blinds: dict[str, Vote], transcript: str | None,
                       reports: list[DelegateReport] = ()) -> Vote:
        """Jev's calibrated vote when it is configured; the LLM's vote if Jev is off or fails."""
        if jev.enabled():
            own = [r for r in reports if r.agent == seat.id]
            try:
                vote = await jev.vote_with_jev(
                    self.agent_context(seat, event, packs, list(reports), transcript),
                    [(c, s) for c in self.vote_markets(seat) for s in SECTORS], agent=seat.id, rnd=rnd,
                    market_names={c: library.markets()[c].name for c in self.vote_markets(seat)},
                    previous=blinds.get(seat.id),
                    reason=" ".join(own[-1].impact_summary.split()[:20]) if own else "")
                return check_vote(vote, seat.id, rnd, self.vote_markets(seat), source="jev")
            except (jev.JevError, LLMOutputError) as e:
                log.warning("%s: Jev %s vote failed, using the LLM: %s", seat.id, rnd, e)
        return await self.llm_vote(seat, rnd, event, packs, blinds, transcript)

    def llm_vote(self, seat: Seat, rnd: str, event: str, packs: dict[str, DataPack],
                 blinds: dict[str, Vote], transcript: str | None) -> Awaitable[Vote]:
        markets = self.vote_markets(seat)
        if rnd == "blind":
            scope = (f"every market in {', '.join(markets)}" if seat.sees_all
                     else f"your own market {markets[0]} only (other markets are voted by their own specialists)")
            task = BLIND_TASK.format(n=len(markets) * len(SECTORS), scope=scope, agent=seat.id)
            user = "Return your blind vote as JSON."
        else:
            rules = (PROMPTS / "_revote.md").read_text(encoding="utf-8").strip()
            # A seat that missed the blind vote still revotes; it just has nothing to compare against.
            blind = render_votes({seat.id: blinds[seat.id]}) if seat.id in blinds else \
                "You did not vote in the blind round."
            task = REVOTE_TASK.format(revote=rules, blind=blind, agent=seat.id)
            user = "Return your revote as JSON."
        return self.ask(seat, Vote, task, event, packs, transcript, user,
                        check=lambda v: check_vote(v, seat.id, rnd, markets))

    async def votes(self, rnd: str, event: str, packs: dict[str, DataPack], blinds: dict[str, Vote],
                    transcript: str | None, reports: list[DelegateReport] = ()) -> AsyncIterator[Event]:
        """Every voting seat in parallel; each vote is emitted the moment it lands."""
        phase = "vote" if rnd == "blind" else "revote"
        voters = [s for s in self.seats if getattr(s.member.phases, phase)]
        calls = {s.id: self.ask_vote(s, rnd, event, packs, blinds, transcript, reports) for s in voters}
        async for agent, result in in_parallel(calls):
            if isinstance(result, LLMError):
                yield skipped(agent, "blind vote" if rnd == "blind" else "revote", result)
            else:
                yield "vote", result.model_dump(mode="json", exclude_none=True)

    async def debate_round(self, n: int, event: str, packs: dict[str, DataPack], blinds: dict[str, Vote],
                           reports: list[DelegateReport]) -> AsyncIterator[Event]:
        """Debating seats argue in parallel, each seeing all blind votes and every earlier report."""
        context = f"BLIND VOTES:\n{render_votes(blinds)}\n\nDEBATE SO FAR:\n{render_transcript(reports) or 'Nothing yet.'}"
        debaters = [s for s in self.seats if s.stage == "debate" and s.member.phases.debate]
        calls = {
            s.id: self.ask(s, DelegateReport, DEBATE_TASK.format(n=n, total=self.council.debate_rounds, agent=s.id),
                           event, packs, context, "Return your DelegateReport as JSON.", check=pin_agent(s.id))
            for s in debaters
        }
        new: list[DelegateReport] = []
        async for agent, result in in_parallel(calls):
            if isinstance(result, LLMError):
                yield skipped(agent, f"debate round {n}", result)
                continue
            new.append(result)
            for e in await self.report_events(result, packs, event):
                yield e
        # Later rounds see this round's reports only once the whole round is in.
        reports.extend(new)

    async def rebuttals(self, event: str, packs: dict[str, DataPack], blinds: dict[str, Vote],
                        reports: list[DelegateReport]) -> AsyncIterator[Event]:
        seats = [s for s in self.seats if s.stage == "rebuttal" and s.member.phases.debate]
        if not seats:
            return
        cells = compute_matrix(list(blinds.values()), self.markets)
        consensus = sorted(cells, key=lambda c: (c.dissent, -c.confidence))[:3]
        contested = sorted(cells, key=lambda c: (c.view != "bearish", -c.dissent))[:3]
        task_for = lambda s: REBUTTAL_TASK.format(  # noqa: E731
            consensus=render_cells(consensus), contested=render_cells(contested), agent=s.id)
        context = f"BLIND VOTES:\n{render_votes(blinds)}\n\nDEBATE:\n{render_transcript(reports)}"
        calls = {s.id: self.ask(s, DelegateReport, task_for(s), event, packs, context,
                                "Return your DelegateReport as JSON.", check=pin_agent(s.id)) for s in seats}
        new: list[DelegateReport] = []
        async for agent, result in in_parallel(calls):
            if isinstance(result, LLMError):
                yield skipped(agent, "debate", result)
                continue
            new.append(result)
            for e in await self.report_events(result, packs, event):
                yield e
        reports.extend(new)

    def spillover_seat(self) -> Seat | None:
        return next((s for s in self.seats if s.stage == "spillover" and s.member.phases.debate), None)

    async def write_brief(self, event: str, packs: dict[str, DataPack], blinds: dict[str, Vote],
                          revotes: dict[str, Vote], transcript: str) -> tuple[Brief | None, LLMError | None]:
        """Matrix, dissent and shifts in Python; the Chair LLM only writes the prose fields.

        If the Chair fails, the brief still ships with the computed matrix and shifts.
        """
        final_votes = list(revotes.values()) or list(blinds.values())
        if not final_votes:
            return None, None
        matrix = compute_matrix(final_votes, self.markets)
        shifts = compute_vote_shifts(list(blinds.values()), list(revotes.values()))
        split = max(matrix, key=lambda c: c.dissent)

        notes = ChairNotes(headline=FALLBACK_HEADLINE, key_risks=[], triggers=[], questions_for_you=[],
                           plain_english="")
        err = None
        if self.chair.member.phases.debate:
            task = CHAIR_TASK.format(
                matrix=render_cells(matrix),
                split=f"{split.country}/{split.sector} (dissent {split.dissent})",
                shifts="\n".join(f"{s.agent} {s.cell}: {s.from_} -> {s.to} because {s.because}"
                                 for s in shifts) or "None.",
                exposure=portfolio_brief(self.exposure),
                questions_rule=QUESTIONS_WITH_PORTFOLIO if self.exposure else QUESTIONS_NO_PORTFOLIO,
            )
            try:
                notes = await self.ask(self.chair, ChairNotes, task, event, packs, transcript,
                                       "Return the Chair's notes as JSON.")
            except LLMError as e:
                err = e
        brief = Brief(**notes.model_dump(), matrix=matrix, vote_shifts=shifts, disclaimer=DISCLAIMER)
        return await guard_brief(brief, self.guard), err


def portfolio_brief(exposure: dict | None) -> str:
    import portfolio

    return portfolio.chair_brief(exposure or {}, {c: m.name for c, m in library.markets().items()})


def data_lines(pack: DataPack) -> list[str]:
    """A DataPack as short text lines with their source ids (Jev takes text state)."""
    lines = [f"{s.id} {s.name}: last {s.last}, 1d {s.chg_1d_pct}%, 1m {s.chg_1m_pct}%, 20d vol {s.vol_20d_pct}%"
             for s in pack.series]
    lines += [f"{pack.country}-{s.sector} ({s.ticker}): 1m {s.chg_1m_pct}%, 20d vol {s.vol_20d_pct}%"
              for s in pack.sectors]
    lines += [f"{m.id} {m.name}: {m.value}" for m in pack.macro]
    lines += [f"{n.id} {n.title} ({n.source}, {n.published[:10]})" for n in pack.news]
    return lines or [f"No market data for {pack.country}."]


def render_cells(cells: list[MatrixCell]) -> str:
    return "\n".join(f"- {c.country}/{c.sector}: {c.view}, confidence {c.confidence}, dissent {c.dissent}"
                     for c in cells)
