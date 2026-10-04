"""The mock run and mock DataPacks must validate against the shared contracts."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

import orchestrator  # noqa: E402
from app import app  # noqa: E402
from schemas import AGENTS, COUNTRIES, SECTORS, DataPack, validate_event  # noqa: E402

RUN = json.loads((ROOT / "mocks" / "council_run.json").read_text(encoding="utf-8"))
PACKS = {c: DataPack.model_validate_json((ROOT / "mocks" / "datapacks" / f"{c}.json").read_text(encoding="utf-8"))
         for c in COUNTRIES}


def test_every_event_matches_its_contract():
    for e in RUN:
        validate_event(e["event"], e["data"])


def test_event_counts():
    count = lambda name: sum(e["event"] == name for e in RUN)  # noqa: E731
    assert count("vote") >= 7
    assert count("message") >= 10
    assert count("report") >= 4
    assert count("spillover") == 1
    assert count("brief") == 1


def test_each_round_has_all_agents_voting_all_16_cells():
    for rnd in ("blind", "revote"):
        votes = [e["data"] for e in RUN if e["event"] == "vote" and e["data"]["round"] == rnd]
        assert sorted(v["agent"] for v in votes) == sorted(AGENTS)
        for v in votes:
            assert {(c["country"], c["sector"]) for c in v["cells"]} == {(c, s) for c in COUNTRIES for s in SECTORS}


def test_cited_source_ids_exist_in_datapacks():
    known = set().union(*(p.source_ids() for p in PACKS.values()))
    for e in RUN:
        d = e["data"]
        ids = list(d.get("source_ids", []))
        ids += [i for c in d.get("claims", []) for i in c["source_ids"]]
        ids += [i for edge in d.get("edges", []) for i in edge["source_ids"]]
        assert set(ids) <= known, f"{e['event']}: unknown ids {set(ids) - known}"


def test_stream_endpoint_emits_the_mock_run(monkeypatch):
    monkeypatch.setenv("COUNCIL_MOCK", "1")
    monkeypatch.setattr(orchestrator, "MOCK_DELAY_S", 0)
    client = TestClient(app)
    run_id = client.post("/council/run", json={"event": "Fed cuts 50bp"}).json()["run_id"]
    with client.stream("GET", f"/council/stream/{run_id}") as r:
        body = "".join(r.iter_text())
    names = [line[len("event: "):] for line in body.splitlines() if line.startswith("event: ")]
    assert names[:-1] == [e["event"] for e in RUN]
    assert names[-1] == "end"
