"""Pydantic models mirroring the five shared JSON contracts (build guide, section 3).

Do not change a field here without telling the other track: the frontend and
mocks/council_run.json are built against these shapes.
"""

from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

Country = Literal["HK", "CN", "US", "JP"]
Sector = Literal["Tech", "Financials", "Property", "Energy"]
View = Literal["bearish", "neutral", "bullish"]
AgentId = Literal["CHAIR", "HK", "CN", "US", "JP", "BEAR", "SPILLOVER"]

COUNTRIES: list[str] = ["HK", "CN", "US", "JP"]
SECTORS: list[str] = ["Tech", "Financials", "Property", "Energy"]
AGENTS: list[str] = ["CHAIR", "HK", "CN", "US", "JP", "BEAR", "SPILLOVER"]
DISCLAIMER = "Research and decision support only. Not investment advice."


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# Contract 1: DataPack (data layer -> agents)

class Series(Model):
    id: str
    name: str
    last: float
    chg_1d_pct: float
    chg_1m_pct: float
    vol_20d_pct: float


class SectorProxy(Model):
    sector: Sector
    ticker: str
    chg_1m_pct: float
    vol_20d_pct: float


class Macro(Model):
    id: str
    name: str
    value: float


class News(Model):
    id: str
    title: str
    source: str
    url: str
    published: str


class DataPack(Model):
    country: Country
    as_of: str
    series: list[Series]
    sectors: list[SectorProxy]
    macro: list[Macro]
    news: list[News]

    def source_ids(self) -> set[str]:
        ids = {s.id for s in self.series} | {m.id for m in self.macro} | {n.id for n in self.news}
        return ids | {f"{self.country}-{s.sector}" for s in self.sectors}


# Contract 2: Vote (every agent, blind round and revote)

class VoteCell(Model):
    country: Country
    sector: Sector
    view: View
    confidence: float = Field(ge=0, le=1)
    # Revote only: under 20 words naming the argument/agent that changed this view.
    because: Optional[str] = None


class Vote(Model):
    agent: AgentId
    round: Literal["blind", "revote"]
    cells: list[VoteCell]
    # Stage 3 (Jev): which engine produced the vote. Optional so Stage 0-2 votes stay valid.
    source: Optional[Literal["jev", "llm"]] = None


# Contract 3: DelegateReport (debate output)

class Claim(Model):
    text: str
    source_ids: list[str]


class Challenge(Model):
    to_agent: str
    text: str


class Trigger(Model):
    condition: str
    would_change: str


class DelegateReport(Model):
    agent: AgentId
    impact_summary: str
    claims: list[Claim]
    challenges: list[Challenge]
    triggers: list[Trigger]


# Contract 4: Spillover

class SpilloverNode(Model):
    id: str
    label: str
    country: Optional[Country] = None


class SpilloverEdge(Model):
    from_: str = Field(alias="from")
    to: str
    mechanism: str
    sign: Literal["+", "-"]
    strength: float = Field(ge=0, le=1)
    source_ids: list[str]


class Spillover(Model):
    nodes: list[SpilloverNode]
    edges: list[SpilloverEdge]


# Contract 5: Brief (chair output)

class MatrixCell(Model):
    country: Country
    sector: Sector
    view: View
    confidence: float = Field(ge=0, le=1)
    dissent: float = Field(ge=0, le=1)


class VoteShift(Model):
    agent: AgentId
    cell: str  # "JP/Financials"
    from_: View = Field(alias="from")
    to: View
    because: str


class Brief(Model):
    headline: str
    matrix: list[MatrixCell]
    vote_shifts: list[VoteShift]
    key_risks: list[str]
    triggers: list[Trigger]
    questions_for_you: list[str]
    disclaimer: str = DISCLAIMER


# SSE events the frontend listens for

class StageEvent(Model):
    name: Literal["data", "blind_vote", "debate", "revote", "spillover", "brief"]
    status: Literal["started", "done", "failed"]


class Message(Model):
    agent: AgentId
    text: str
    source_ids: list[str]


class ErrorEvent(Model):
    message: str
    agent: Optional[AgentId] = None


EVENT_MODELS: dict[str, type[Model]] = {
    "stage": StageEvent,
    "vote": Vote,
    "message": Message,
    "report": DelegateReport,
    "spillover": Spillover,
    "brief": Brief,
    "error": ErrorEvent,
}

EventPayload = Union[StageEvent, Vote, Message, DelegateReport, Spillover, Brief, ErrorEvent]


class RunRequest(Model):
    event: str
    countries: list[Country] = Field(default_factory=lambda: list(COUNTRIES))
    sectors: list[Sector] = Field(default_factory=lambda: list(SECTORS))


class RunResponse(Model):
    run_id: str


def validate_event(event: str, data: dict) -> Model:
    """Validate one SSE event against its contract. Raises on unknown type or bad shape."""
    if event not in EVENT_MODELS:
        raise ValueError(f"unknown SSE event type: {event}")
    return EVENT_MODELS[event].model_validate(data)
