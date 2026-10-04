"""Configurable councils: custom seats and markets, validation, and the library/council API."""

import asyncio
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

import library  # noqa: E402
import orchestrator  # noqa: E402
from app import app  # noqa: E402
from library import CouncilError  # noqa: E402
from llm import Usage  # noqa: E402
from schemas import SECTORS, Council, DelegateReport, Member, Phases, RunRequest, Spillover, Vote, validate_event  # noqa: E402

MARKETS = ["US", "UK"]


def custom_council(**overrides) -> Council:
    members = [
        Member(id="US", name="US Macro Strategist", role="macro", market="US"),
        Member(id="US-TECHNICAL", name="US Market Analyst", role="technical", market="US"),
        Member(id="SEMIS", name="Semis Specialist", role="technical", market="US",
               instructions="Focus on semiconductors inside the Tech cell."),
        Member(id="UK", name="UK Macro Strategist", role="macro", market="UK"),
        Member(id="BULL", name="Bull Researcher", role="bull"),
        Member(id="QUIET", name="Silent Observer", role="risk", phases=Phases(vote=False, debate=False, revote=True)),
        Member(id="CHAIR", name="Chair", role="chair"),
    ]
    return Council(**{"name": "Test desk", "markets": MARKETS, "members": members, "debate_rounds": 1, **overrides})


class GridLLM:
    """Answers for whatever markets the council covers; records every call."""

    def __init__(self):
        self.calls: list[tuple[str, str, str, str]] = []  # (agent, schema, system, model)

    async def __call__(self, system, user, schema, *, agent, model=None):
        self.calls.append((agent, schema.__name__, system, model))
        if schema is Vote:
            cells = [{"country": c, "sector": s, "view": "neutral", "confidence": 0.5} for c in MARKETS for s in SECTORS]
            return Vote(agent=agent, round="blind", cells=cells), Usage(1, 1, 0)
        if schema is DelegateReport:
            return DelegateReport(agent=agent, impact_summary=f"{agent} view", claims=[], challenges=[],
                                  triggers=[]), Usage(1, 1, 0)
        if schema is Spillover:
            raise AssertionError("this council has no Spillover seat")
        return schema(headline="h", key_risks=[], triggers=[], questions_for_you=[]), Usage(1, 1, 0)


def run(monkeypatch, council: Council, fake) -> list[tuple[str, dict]]:
    monkeypatch.setattr(orchestrator, "call_llm", fake)

    async def collect():
        return [e async for e in orchestrator.run_council(RunRequest(event="Fed cuts 50bp", council=council))]
    return asyncio.run(collect())


def test_custom_council_runs_end_to_end(monkeypatch):
    fake = GridLLM()
    events = run(monkeypatch, custom_council(), fake)
    for name, data in events:
        validate_event(name, data)

    council = next(d for n, d in events if n == "council")
    assert [m["code"] for m in council["markets"]] == MARKETS
    assert next(m for m in council["markets"] if m["code"] == "UK")["coverage"] == "partial"
    assert {m["id"] for m in council["members"]} == {"US", "US-TECHNICAL", "SEMIS", "UK", "BULL", "QUIET", "CHAIR"}

    blind = {d["agent"] for n, d in events if n == "vote" and d["round"] == "blind"}
    revote = {d["agent"] for n, d in events if n == "vote" and d["round"] == "revote"}
    assert "QUIET" not in blind and "QUIET" in revote  # phases are respected
    assert all(len(d["cells"]) == 8 for n, d in events if n == "vote")

    reports = [d["agent"] for n, d in events if n == "report"]
    assert sorted(reports[:-1]) == ["SEMIS", "UK", "US", "US-TECHNICAL"] and reports[-1] == "BULL"
    assert ("stage", {"name": "spillover", "status": "skipped"}) in events
    brief = next(d for n, d in events if n == "brief")
    assert {(c["country"], c["sector"]) for c in brief["matrix"]} == {(c, s) for c in MARKETS for s in SECTORS}


def test_each_seat_gets_its_role_market_and_data(monkeypatch):
    fake = GridLLM()
    run(monkeypatch, custom_council(), fake)
    first = {}
    for agent, schema, system, model in fake.calls:
        first.setdefault((agent, schema), (system, model))

    semis, _ = first[("SEMIS", "DelegateReport")]
    assert "Market Analyst for United States (US)" in semis and "Focus on semiconductors" in semis
    assert '"country":"US"' in semis and '"country":"UK"' not in semis

    uk, _ = first[("UK", "Vote")]
    assert "DATA COVERAGE" in uk and '"country":"UK"' in uk  # partial-data market gets the caveat
    assert "Bank of England" in uk  # local knowledge from the market library

    bull, _ = first[("BULL", "DelegateReport")]
    assert "MOST BEARISH OR SPLIT" in bull and '"country": "US"' in bull and '"country": "UK"' in bull


def test_models_follow_the_profile_with_member_overrides(monkeypatch):
    council = custom_council()
    council.members[2] = council.members[2].model_copy(update={"model": "some/explicit-model"})
    fake = GridLLM()
    run(monkeypatch, council, fake)
    models = {agent: model for agent, _, _, model in fake.calls}
    assert models["SEMIS"] == "some/explicit-model"
    assert models["US"] == models["US-TECHNICAL"]  # a US seat borrows the US delegate's model
    assert models["UK"] and models["BULL"] and models["CHAIR"]


@pytest.mark.parametrize("change, message", [
    (lambda c: c.members.pop(), "exactly one Chair"),
    (lambda c: c.members.append(Member(id="CHAIR2", name="Chair 2", role="chair")), "exactly one Chair"),
    (lambda c: c.members.append(Member(id="X", name="X", role="macro")), "needs a market"),
    (lambda c: c.members.append(Member(id="JPX", name="JP", role="macro", market="JP")), "needs a market"),
    (lambda c: c.members.append(Member(id="US", name="dup", role="bull")), "unique"),
    (lambda c: c.members.append(Member(id="Z", name="Z", role="nope")), "unknown role"),
    (lambda c: c.markets.append("ZZ"), "unknown markets"),
])
def test_invalid_councils_are_rejected(change, message):
    council = custom_council()
    change(council)
    with pytest.raises(CouncilError, match=message):
        library.resolve(council)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(library, "CUSTOM_ROLES", tmp_path / "roles")
    monkeypatch.setattr(library, "CUSTOM_MARKETS", tmp_path / "markets")
    monkeypatch.setattr(library, "COUNCILS", tmp_path / "councils")
    return TestClient(app)


def test_library_lists_builtin_markets_and_roles(client):
    lib = client.get("/library").json()
    markets = {m["code"]: m for m in lib["markets"]}
    assert {"HK", "CN", "US", "JP", "UK", "IN", "SG"} <= set(markets)
    assert markets["HK"]["coverage"] == "full" and markets["UK"]["coverage"] == "partial"
    assert markets["HK"]["data"]["source"] in ("cache", "mock")
    roles = {r["id"]: r for r in lib["roles"]}
    assert {"macro", "technical", "fundamentals", "news", "sentiment", "bull", "bear", "risk", "spillover", "chair"} <= set(roles)
    assert roles["chair"]["required"] and roles["bear"]["stage"] == "rebuttal"
    assert lib["models"]


def test_custom_role_can_be_added_used_and_deleted(client):
    role = {"id": "semis", "name": "Semis Specialist", "scope": "market", "stage": "debate",
            "instructions": "Chips in {MARKET_NAME}."}
    assert client.post("/library/roles", json=role).status_code == 201
    assert client.post("/library/roles", json={**role, "id": "bear"}).status_code == 422  # built-in id

    council = custom_council().model_dump()
    council["members"].append({"id": "US-SEMIS", "name": "Semis", "role": "semis", "market": "US"})
    assert client.post("/council/run", json={"event": "x", "council": council}).status_code == 200

    assert client.delete("/library/roles/semis").status_code == 204
    assert client.post("/council/run", json={"event": "x", "council": council}).status_code == 422


def test_councils_can_be_saved_listed_and_run_by_id(client):
    saved = client.put("/councils", json=custom_council(name="Asia Rates Desk").model_dump()).json()
    assert saved["id"] == "asia-rates-desk"
    ids = [c["id"] for c in client.get("/councils").json()]
    assert ids == ["default", "asia-rates-desk"]
    assert client.get("/councils/asia-rates-desk").json()["markets"] == MARKETS
    assert client.post("/council/run", json={"event": "x", "council_id": "asia-rates-desk"}).status_code == 200
    assert client.post("/council/run", json={"event": "x", "council_id": "nope"}).status_code == 404
    assert client.delete("/councils/asia-rates-desk").status_code == 204


def test_invalid_council_is_a_422_not_a_broken_stream(client):
    bad = custom_council().model_dump()
    bad["members"] = [m for m in bad["members"] if m["role"] != "chair"]
    r = client.post("/council/run", json={"event": "x", "council": bad})
    assert r.status_code == 422 and "Chair" in r.json()["detail"]
