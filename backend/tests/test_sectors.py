"""Configurable sectors: a council picks from the sector library, custom sectors need no code."""

import asyncio
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

import app as app_module  # noqa: E402
import library  # noqa: E402
import orchestrator  # noqa: E402
from library import CouncilError  # noqa: E402
from schemas import RunRequest, SectorDef, Vote  # noqa: E402
from test_orchestrator import FakeLLM  # noqa: E402


@pytest.fixture
def custom_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(library, "CUSTOM_SECTORS", tmp_path / "sectors")
    return tmp_path


def test_library_has_eleven_sectors_with_proxies_in_the_four_markets():
    lib = library.sectors()
    assert len(lib) == 11 and {"Tech", "Health", "Utilities", "Communication"} <= set(lib)
    assert all(set(x.proxies) == {"HK", "CN", "US", "JP"} for x in lib.values())


def test_council_votes_on_its_own_sectors(monkeypatch):
    fake = FakeLLM()

    async def vote_in_scope(system, user, schema, *, agent, model=None):
        if schema is Vote:  # answer on exactly the cells the task asks for
            markets = ["HK", "CN", "US", "JP"] if agent in ("CHAIR", "BEAR", "SPILLOVER") else [agent]
            cells = [{"country": c, "sector": s, "view": "neutral", "confidence": 0.5}
                     for c in markets for s in ("Tech", "Health")]
            fake.calls.append((agent, "Vote", system))
            return Vote(agent=agent, round="blind", cells=cells), None
        return await fake(system, user, schema, agent=agent, model=model)

    monkeypatch.setattr(orchestrator, "call_llm", vote_in_scope)
    council = library.default_council().model_copy(update={"sectors": ["Tech", "Health"]})
    events = asyncio.run(_collect(RunRequest(event="Headline", council=council)))
    brief = next(d for n, d in events if n == "brief")
    assert {c["sector"] for c in brief["matrix"]} == {"Tech", "Health"}
    hk_prompt = next(s for a, k, s in fake.calls if a == "HK" and k == "Vote")
    assert "Health Care (Health)" in hk_prompt and "Energy" not in hk_prompt.split("SCHEMA:")[0]
    info = next(d for n, d in events if n == "council")
    assert info["sectors"] == ["Tech", "Health"] and info["sector_names"]["Health"] == "Health Care"


def test_sector_without_a_proxy_is_flagged_in_the_prompt(custom_dir):
    library.save_sector(SectorDef(id="Shipping", name="Shipping", proxies={"US": ("ZIM", "ZIM Integrated")}))
    seat = next(s for s in library.resolve(library.default_council()) if s.id == "HK")
    pack = orchestrator._read_pack("HK")
    prompt = orchestrator.build_prompt(seat, ["HK"], "T", "E", "{}", None, Vote, ["Tech", "Shipping"], pack)
    assert "no sector proxy for Shipping" in prompt


def test_unknown_sector_is_rejected_and_custom_sectors_round_trip(custom_dir):
    with pytest.raises(CouncilError, match="unknown sectors"):
        library.resolve(library.default_council().model_copy(update={"sectors": ["Crypto"]}))
    client = TestClient(app_module.app)
    r = client.post("/library/sectors", json={"id": "Crypto", "name": "Crypto miners", "proxies": {"US": ["MARA", "MARA"]}})
    assert r.status_code == 201
    assert "Crypto" in {x["id"] for x in client.get("/library").json()["sectors"]}
    library.resolve(library.default_council().model_copy(update={"sectors": ["Crypto"]}))  # now valid
    assert client.post("/library/sectors", json={"id": "Tech", "name": "x"}).status_code == 422  # built-in
    assert client.delete("/library/sectors/Crypto").status_code == 204


async def _collect(req):
    return [e async for e in orchestrator.run_council(req)]
