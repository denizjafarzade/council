"""Real news as the event, and the user's trading history. No network, no keys."""

import asyncio
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

import app as app_module  # noqa: E402
import news  # noqa: E402
import orchestrator  # noqa: E402
import portfolio  # noqa: E402
from schemas import RunRequest  # noqa: E402
from test_orchestrator import FakeLLM  # noqa: E402  (pytest puts this folder on sys.path)
from verify import check_claim  # noqa: E402

SAMPLE = (ROOT / "samples" / "sample_portfolio_FICTIONAL.csv").read_text(encoding="utf-8")


@pytest.fixture
def cache(tmp_path, monkeypatch):
    """A temp cache holding the mock DataPacks, with distinct publish times."""
    for code in ("HK", "US"):
        pack = json.loads((orchestrator.MOCK_PACKS / f"{code}.json").read_text(encoding="utf-8"))
        for i, n in enumerate(pack["news"]):
            n["published"] = f"2026-10-0{3 if code == 'HK' else 2}T0{i}:00+00:00"
        (tmp_path / f"{code}.json").write_text(json.dumps(pack), encoding="utf-8")
    monkeypatch.setattr(orchestrator, "CACHE_DIR", tmp_path)
    return tmp_path


@pytest.fixture(autouse=True)
def no_portfolio():
    portfolio.set_current(None)
    yield
    portfolio.set_current(None)


# --- news ---------------------------------------------------------------------------------------

def test_top_headlines_are_newest_first_with_market_and_source(cache):
    items = news.top(["HK", "US", "JP"])  # JP has no cache here: skipped, not an error
    assert [i["market"] for i in items[:4]] == ["HK"] * 4
    assert items == sorted(items, key=lambda i: i["published"], reverse=True)
    assert {"id", "title", "source", "published", "market", "fetched_at"} <= set(items[0])


def test_news_id_becomes_the_event_with_source_and_time(cache, monkeypatch):
    monkeypatch.delenv("COUNCIL_OFFLINE", raising=False)
    client = TestClient(app_module.app)
    run_id = client.post("/council/run", json={"event": "ignored", "news_id": "HK-n2"}).json()["run_id"]
    event = app_module.RUNS[run_id].event
    item = news.find("HK-n2")
    assert item["title"] in event and item["source"] in event and "published 03 Oct 2026" in event
    assert client.post("/council/run", json={"event": "x", "news_id": "HK-n99"}).status_code == 404


def test_refresh_rewrites_only_news_and_keeps_old_headlines_on_failure(cache, monkeypatch):
    from data import fetch

    before = json.loads((cache / "HK.json").read_text(encoding="utf-8"))
    fresh = [{"id": "HK-n1", "title": "New headline", "source": "Wire", "url": "u", "published": "2026-10-04T09:00+00:00"}]
    monkeypatch.setattr(fetch, "fetch_news", lambda code, report: fresh if code == "HK" else [])
    out = news.refresh(["HK", "US"])
    after = json.loads((cache / "HK.json").read_text(encoding="utf-8"))
    assert after["news"] == fresh and after["news_fetched_at"] == out["fetched_at"]
    assert after["series"] == before["series"]  # prices untouched
    assert "kept" in out["markets"]["US"]
    assert news.top(["US"])  # US headlines survived the failed fetch


def test_event_is_a_valid_citation_for_every_seat():
    event = news.event_text({"title": "Hang Seng falls 2.6%", "source": "Wire", "published": "2026-10-03T08:00+00:00"})
    assert check_claim("The index fell 2.6% on the news.", ["EVENT"], [], event) == []
    assert check_claim("The index fell 9% on the news.", ["EVENT"], [], event)  # numbers still checked


# --- portfolio -----------------------------------------------------------------------------------

def test_sample_portfolio_summary():
    s = portfolio.summarise(SAMPLE, "Sample")
    assert [m["market"] for m in s.by_market] == ["US", "HK", "JP", "CN"]
    assert round(sum(m["pct"] for m in s.by_market)) == 100
    assert s.largest["ticker"] == "XLK" and s.largest["sector"] == "Tech"
    assert s.not_covered == ["AAPL"]  # never guessed
    realised = {r["market"]: r["pct"] for r in s.realised_by_market}
    assert realised["HK"] == pytest.approx(-7.1) and realised["US"] == pytest.approx(8.0)


def test_average_cost_and_oversold_note():
    csv = "date,ticker,side,qty,price\n2026-01-01,XLK,buy,10,100\n2026-01-02,XLK,buy,10,200\n2026-01-03,XLK,sell,30,180\n"
    s = portfolio.summarise(csv)
    assert s.holdings == [] and s.realised_by_market == [{"market": "US", "usd": 600.0, "pct": 20.0}]
    assert any("short selling is not supported" in n for n in s.notes)


@pytest.mark.parametrize("csv, message", [
    ("date,ticker,qty,price\n2026-01-01,XLK,1,1\n", "missing columns: side"),
    ("date,ticker,side,qty,price\n2026-01-01,XLK,hold,1,1\n", "side must be buy or sell"),
    ("date,ticker,side,qty,price\n", "no trades"),
])
def test_bad_csv_is_rejected(csv, message):
    with pytest.raises(portfolio.PortfolioError, match=message):
        portfolio.summarise(csv)


def test_upload_is_kept_in_memory_only(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    client = TestClient(app_module.app)
    before = {p for p in ROOT.rglob("*") if ".git" not in p.parts and "node_modules" not in p.parts}
    r = client.post("/portfolio", content=SAMPLE.encode(), headers={"Content-Type": "text/csv"})
    assert r.status_code == 200 and r.json()["largest"]["ticker"] == "XLK"
    assert client.get("/portfolio").json()["not_covered"] == ["AAPL"]
    after = {p for p in ROOT.rglob("*") if ".git" not in p.parts and "node_modules" not in p.parts}
    assert after - before == set() and list(tmp_path.iterdir()) == []
    assert client.post("/portfolio", content=b"nonsense").status_code == 422
    assert client.delete("/portfolio").status_code == 204 and client.get("/portfolio").json() is None


def test_only_the_chair_sees_exposure_and_the_event_carries_no_trades(monkeypatch):
    portfolio.set_current(portfolio.summarise(SAMPLE, "Sample"))
    fake = FakeLLM()
    monkeypatch.setattr(orchestrator, "call_llm", fake)

    async def collect():
        return [e async for e in orchestrator.run_council(RunRequest(event="Headline"))]

    events = asyncio.run(collect())
    payload = next(d for n, d in events if n == "portfolio")
    text = json.dumps(payload)
    assert "XLK" not in text and "AAPL" not in text and "qty" not in text  # percentages only
    assert payload["largest"] == "US Tech" and payload["not_covered_count"] == 1

    chair = [s for a, schema, s in fake.calls if schema == "ChairNotes"][0]
    assert "Share of invested money by market: United States 36.8%" in chair
    assert "name one of the user's largest exposures in words" in chair
    others = [s for a, schema, s in fake.calls if schema != "ChairNotes"]
    assert not any("Share of invested money" in s for s in others)


def test_sector_tickers_are_valid_citations():
    from schemas import DataPack

    pack = DataPack.model_validate_json((orchestrator.MOCK_PACKS / "US.json").read_text(encoding="utf-8"))
    tech = next(s for s in pack.sectors if s.sector == "Tech")
    assert check_claim(f"Tech is up {tech.chg_1m_pct}% this month.", [tech.ticker], [pack]) == []
