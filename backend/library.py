"""Role library, market library and saved councils.

Built-in roles and markets ship in agents/*.json. Anything a user adds (custom roles,
custom markets, saved councils) is one JSON file under data/library/ or data/councils/.
resolve() turns a Council config into the seats the orchestrator runs.
"""

import json
import re
from dataclasses import dataclass
from pathlib import Path

from schemas import COUNTRIES, Council, MarketDef, Member, RoleDef

BACKEND = Path(__file__).resolve().parent
BUILTIN_ROLES = BACKEND / "agents" / "roles.json"
BUILTIN_MARKETS = BACKEND / "agents" / "markets.json"
DATA = BACKEND / "data"
CUSTOM_ROLES = DATA / "library" / "roles"
CUSTOM_MARKETS = DATA / "library" / "markets"
COUNCILS = DATA / "councils"

# Built-in cross-market seats keep the original agent ids (mocks, model profiles use them).
CROSS_IDS = {"bear": "BEAR", "spillover": "SPILLOVER", "chair": "CHAIR", "bull": "BULL", "risk": "RISK"}


class CouncilError(ValueError):
    """The council config cannot run as given."""


# --- library -------------------------------------------------------------------------

def _read_dir(folder: Path) -> list[dict]:
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(folder.glob("*.json"))] if folder.exists() else []


def roles() -> dict[str, RoleDef]:
    out = {r["id"]: RoleDef(**r, builtin=True) for r in json.loads(BUILTIN_ROLES.read_text(encoding="utf-8"))}
    for r in _read_dir(CUSTOM_ROLES):
        out.setdefault(r["id"], RoleDef(**{**r, "builtin": False}))
    return out


def markets() -> dict[str, MarketDef]:
    out = {m["code"]: MarketDef(**m, builtin=True) for m in json.loads(BUILTIN_MARKETS.read_text(encoding="utf-8"))}
    for m in _read_dir(CUSTOM_MARKETS):
        out.setdefault(m["code"], MarketDef(**{**m, "builtin": False}))
    return out


def save_role(role: RoleDef) -> RoleDef:
    if role.id in roles() and roles()[role.id].builtin:
        raise CouncilError(f"'{role.id}' is a built-in role; pick another id")
    if role.stage == "chair":
        raise CouncilError("the council has exactly one Chair; custom roles cannot be chairs")
    role = role.model_copy(update={"builtin": False})
    CUSTOM_ROLES.mkdir(parents=True, exist_ok=True)
    (CUSTOM_ROLES / f"{role.id}.json").write_text(role.model_dump_json(indent=2), encoding="utf-8")
    return role


def delete_role(role_id: str) -> None:
    path = CUSTOM_ROLES / f"{role_id}.json"
    if not path.exists():
        raise KeyError(role_id)
    path.unlink()


def save_market(market: MarketDef) -> MarketDef:
    if market.code in markets() and markets()[market.code].builtin:
        raise CouncilError(f"'{market.code}' is a built-in market")
    if "idx" not in market.tickers:
        raise CouncilError("a custom market needs at least an index ticker (tickers.idx)")
    market = market.model_copy(update={"builtin": False, "coverage": "partial"})
    CUSTOM_MARKETS.mkdir(parents=True, exist_ok=True)
    (CUSTOM_MARKETS / f"{market.code}.json").write_text(market.model_dump_json(indent=2), encoding="utf-8")
    return market


def delete_market(code: str) -> None:
    path = CUSTOM_MARKETS / f"{code}.json"
    if not path.exists():
        raise KeyError(code)
    path.unlink()


# --- saved councils --------------------------------------------------------------------

def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "council"


def list_councils() -> list[Council]:
    return [Council(**c) for c in _read_dir(COUNCILS)]


def get_council(council_id: str) -> Council:
    path = COUNCILS / f"{council_id}.json"
    if not path.exists():
        raise KeyError(council_id)
    return Council.model_validate_json(path.read_text(encoding="utf-8"))


def save_council(council: Council) -> Council:
    resolve(council)  # refuse to save something that cannot run
    council = council.model_copy(update={"id": council.id or slugify(council.name)})
    COUNCILS.mkdir(parents=True, exist_ok=True)
    (COUNCILS / f"{council.id}.json").write_text(council.model_dump_json(indent=2), encoding="utf-8")
    return council


def delete_council(council_id: str) -> None:
    path = COUNCILS / f"{council_id}.json"
    if not path.exists():
        raise KeyError(council_id)
    path.unlink()


def default_council(market_codes: list[str] | None = None) -> Council:
    """The original council: one Macro Strategist per market, plus Bear, Spillover and Chair."""
    lib = markets()
    codes = market_codes or list(COUNTRIES)
    members = [Member(id=c, name=f"{lib[c].name} Macro Strategist" if c in lib else c, role="macro", market=c)
               for c in codes]
    members += [Member(id=CROSS_IDS[r], name=n, role=r)
                for r, n in (("bear", "Bear Researcher"), ("spillover", "Spillover Analyst"), ("chair", "Chair"))]
    return Council(id="default", name="Default council", markets=codes, members=members)


# --- resolve -----------------------------------------------------------------------------

@dataclass
class Seat:
    """A member with its role and market looked up, ready to prompt."""
    member: Member
    role: RoleDef
    market: MarketDef | None
    instructions: str
    brief: str

    @property
    def id(self) -> str:
        return self.member.id

    @property
    def stage(self) -> str:
        return self.role.stage

    @property
    def sees_all(self) -> bool:
        return self.role.scope == "cross"


def resolve(council: Council) -> list[Seat]:
    """Check a council can run and look up every seat's role and market. Raises CouncilError."""
    role_lib, market_lib = roles(), markets()
    unknown = [c for c in council.markets if c not in market_lib]
    if unknown:
        raise CouncilError(f"unknown markets: {unknown}")
    if len(set(council.markets)) != len(council.markets):
        raise CouncilError("a market is listed twice")
    ids = [m.id for m in council.members]
    if len(set(ids)) != len(ids):
        raise CouncilError(f"member ids must be unique: {sorted({i for i in ids if ids.count(i) > 1})}")

    seats = []
    for m in council.members:
        role = role_lib.get(m.role)
        if role is None:
            raise CouncilError(f"{m.id}: unknown role '{m.role}'")
        market = None
        if role.scope == "market":
            if m.market not in council.markets:
                raise CouncilError(f"{m.id}: a {role.name} needs a market from this council, got {m.market!r}")
            market = market_lib[m.market]
        instructions = (m.instructions or role.instructions).replace("{MARKET_NAME}", market.name if market else "")
        brief = m.brief if m.brief is not None else (market.brief if market else "")
        seats.append(Seat(m, role, market, instructions, brief))

    chairs = [s for s in seats if s.stage == "chair"]
    if len(chairs) != 1:
        raise CouncilError(f"a council needs exactly one Chair, got {len(chairs)}")
    if len([s for s in seats if s.stage == "spillover"]) > 1:
        raise CouncilError("at most one Spillover Analyst")
    if not any(s.member.phases.vote or s.member.phases.revote for s in seats):
        raise CouncilError("nobody on this council votes")
    return seats
