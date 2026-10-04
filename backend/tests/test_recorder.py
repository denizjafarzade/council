"""Stage 4: record live runs, replay them, serve them offline. No network, no keys."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

import app as app_module  # noqa: E402
import recorder  # noqa: E402

BRIEF = {"headline": "h", "matrix": [], "vote_shifts": [], "key_risks": [], "triggers": [], "questions_for_you": []}


def fake_run(events):
    async def run_council(req):
        for e in events:
            yield e
    return run_council


def stream_names(client, url):
    with client.stream("GET", url) as r:
        assert r.status_code == 200
        body = "".join(r.iter_text())
    return [line[len("event: "):] for line in body.splitlines() if line.startswith("event: ")]


def start(client, event):
    return client.post("/council/run", json={"event": event}).json()["run_id"]


def setup(monkeypatch, tmp_path, events):
    monkeypatch.setattr(recorder, "RUNS_DIR", tmp_path)
    monkeypatch.setattr(app_module, "run_council", fake_run(events))
    monkeypatch.delenv("COUNCIL_OFFLINE", raising=False)
    monkeypatch.delenv("COUNCIL_MOCK", raising=False)
    return TestClient(app_module.app)


def test_complete_live_run_is_recorded_and_replayed(monkeypatch, tmp_path):
    events = [("stage", {"name": "data", "status": "started"}), ("brief", BRIEF), ("stage", {"name": "brief", "status": "done"})]
    client = setup(monkeypatch, tmp_path, events)
    assert stream_names(client, f"/council/stream/{start(client, 'Fed cuts 50bp')}") == ["stage", "brief", "stage", "end"]

    saved = recorder.load("fed-cuts-50bp")
    assert saved["event"] == "Fed cuts 50bp" and [e["event"] for e in saved["events"]] == ["stage", "brief", "stage"]
    assert [r["slug"] for r in client.get("/council/recordings").json()] == ["fed-cuts-50bp"]
    assert stream_names(client, "/council/replay/fed-cuts-50bp?speed=100") == ["replay", "stage", "brief", "stage", "end"]


def test_incomplete_run_does_not_overwrite_a_recording(monkeypatch, tmp_path):
    client = setup(monkeypatch, tmp_path, [("stage", {"name": "data", "status": "started"})])
    stream_names(client, f"/council/stream/{start(client, 'Oil spikes 15%')}")
    assert recorder.load("oil-spikes-15") is None
    assert client.get("/council/replay/oil-spikes-15").status_code == 404


def test_offline_serves_recordings_and_never_runs_the_council(monkeypatch, tmp_path):
    client = setup(monkeypatch, tmp_path, [("brief", BRIEF)])
    stream_names(client, f"/council/stream/{start(client, 'BoJ hikes rates')}")  # record it

    async def must_not_run(req):
        raise AssertionError("offline mode called the council")
        yield  # pragma: no cover

    monkeypatch.setattr(app_module, "run_council", must_not_run)
    monkeypatch.setenv("COUNCIL_OFFLINE", "1")
    monkeypatch.setattr(recorder, "MAX_GAP_S", 0)
    assert stream_names(client, f"/council/stream/{start(client, 'BoJ hikes rates')}") == ["replay", "brief", "end"]
    assert stream_names(client, f"/council/stream/{start(client, 'Something new')}") == ["error", "end"]
