"""Pydantic models mirroring the five shared JSON contracts (build guide, section 3).

Do not change a field here without telling the other track: the frontend and
mocks/council_run.json are built against these shapes.
"""

from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

# Markets and council members are configurable (see Council below), so these are
# plain strings. The defaults keep the original seven agents and four markets.
Country = str  # a market code, e.g. "HK" or "UK"
Sector = Literal["Tech", "Financials", "Property", "Energy"]
View = Literal["bearish", "neutral", "bullish"]
AgentId = str  # a council member id, e.g. "HK", "BEAR" or "US-TECHNICAL"

COUNTRIES: list[str] = ["HK", "CN", "US", "JP"]
SECTORS: list[str] = ["Tech", "Financials", "Property", "Energy"]
AGENTS: list[str] = ["CHAIR", "HK", "CN", "US", "JP", "BEAR", "SPILLOVER"]

MarketCode = Annotated[str, Field(pattern=r"^[A-Z]{2,4}$")]
MemberId = Annotated[str, Field(pattern=r"^[A-Z0-9][A-Z0-9-]{0,39}$")]
Slug = Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9-]{0,39}$")]
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
    # full = index, 4 sector proxies, FX, rates, news; partial = index, FX, news only.
    coverage: Optional[Literal["full", "partial", "none"]] = None

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
    # The same view for someone with no finance background: no jargon, no tickers. Empty in
    # runs recorded before it existed; the UI then words one from the matrix.
    plain_english: str = ""


# SSE events the frontend listens for

class StageEvent(Model):
    name: Literal["data", "blind_vote", "debate", "revote", "spillover", "brief"]
    status: Literal["started", "done", "failed", "skipped"]  # skipped: no seat for this stage


class Message(Model):
    agent: AgentId
    text: str
    source_ids: list[str]
    # Stage 3A trust checks: why this message is unverified (unknown ids, numbers that don't
    # match the cited data, no source). Empty = verified, or nothing to check.
    unverified: list[str] = Field(default_factory=list)


class ErrorEvent(Model):
    message: str
    agent: Optional[AgentId] = None


# Council configuration: who sits on the council and which markets it covers.

class Phases(Model):
    vote: bool = True     # blind vote
    debate: bool = True   # speaks in its stage (debate rounds, rebuttal, spillover map, brief)
    revote: bool = True


RoleStage = Literal["debate", "rebuttal", "spillover", "chair"]


class RoleDef(Model):
    """A seat type in the role library. Built-ins ship in agents/roles.json; users add more."""
    id: Slug
    name: str = Field(min_length=1, max_length=60)
    scope: Literal["market", "cross"]  # market = sees one market's data; cross = sees all
    stage: RoleStage = "debate"
    blurb: str = Field("", max_length=200)
    instructions: str = Field(min_length=1, max_length=4000)  # may use {MARKET_NAME}
    limited_data: bool = False
    required: bool = False
    builtin: bool = False


class MarketClose(Model):
    hour: int = Field(ge=0, le=23)
    minute: int = Field(0, ge=0, le=59)
    utc_offset: float = Field(ge=-12, le=14)


class MarketDef(Model):
    """A market the council can cover. Built-ins ship in agents/markets.json; users add more."""
    code: MarketCode
    name: str = Field(min_length=1, max_length=60)
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lon: Optional[float] = Field(None, ge=-180, le=180)
    coverage: Literal["full", "partial"] = "partial"
    brief: str = Field("", max_length=2000)
    # role -> [ticker, display name]; "idx" and "fx" for partial markets, plus sectors for full ones.
    tickers: dict[str, tuple[str, str]] = Field(default_factory=dict)
    close: Optional[MarketClose] = None
    news_query: str = ""
    builtin: bool = False


class Member(Model):
    """One seat on the council."""
    id: MemberId
    name: str = Field(min_length=1, max_length=60)
    role: Slug
    market: Optional[MarketCode] = None  # required for market-scope roles
    instructions: Optional[str] = Field(None, max_length=4000)  # overrides the role's
    brief: Optional[str] = Field(None, max_length=2000)  # overrides the market's local knowledge
    phases: Phases = Field(default_factory=Phases)
    model: Optional[str] = None  # explicit OpenRouter model id; None = profile default


class Council(Model):
    id: Optional[Slug] = None
    name: str = Field("Untitled council", min_length=1, max_length=80)
    markets: list[MarketCode] = Field(min_length=1, max_length=16)
    members: list[Member] = Field(min_length=1, max_length=40)
    debate_rounds: int = Field(2, ge=1, le=2)


class CouncilMarket(Model):
    code: str
    name: str
    coverage: str
    as_of: Optional[str] = None


class CouncilMember(Model):
    id: str
    name: str
    role: str
    role_name: str
    stage: RoleStage
    market: Optional[str] = None
    phases: Phases


class CouncilEvent(Model):
    """First SSE event of a run: who is seated and which markets are covered."""
    name: str
    markets: list[CouncilMarket]
    sectors: list[str]
    members: list[CouncilMember]
    debate_rounds: int


EVENT_MODELS: dict[str, type[Model]] = {
    "council": CouncilEvent,
    "stage": StageEvent,
    "vote": Vote,
    "message": Message,
    "report": DelegateReport,
    "spillover": Spillover,
    "brief": Brief,
    "error": ErrorEvent,
}

EventPayload = Union[CouncilEvent, StageEvent, Vote, Message, DelegateReport, Spillover, Brief, ErrorEvent]


class RunRequest(Model):
    event: str = Field(min_length=1, max_length=500)
    # Pass a council inline (the builder does), or the id of a saved one. Neither = the default council.
    council: Optional[Council] = None
    council_id: Optional[Slug] = None
    countries: list[Country] = Field(default_factory=lambda: list(COUNTRIES))  # default council's markets
    sectors: list[Sector] = Field(default_factory=lambda: list(SECTORS))


class RunResponse(Model):
    run_id: str


def validate_event(event: str, data: dict) -> Model:
    """Validate one SSE event against its contract. Raises on unknown type or bad shape."""
    if event not in EVENT_MODELS:
        raise ValueError(f"unknown SSE event type: {event}")
    return EVENT_MODELS[event].model_validate(data)
