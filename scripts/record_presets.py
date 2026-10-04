"""Pre-record full council runs for the demo presets into runs/{slug}.json (Stage 4).

Runs the real council in-process (no server needed) with the COUNCIL_PROFILE from .env and
prints the OpenRouter spend. Only complete runs are saved; existing recordings are kept
unless --force.

    python scripts/record_presets.py                 # all 4 presets
    python scripts/record_presets.py "Fed cuts 50bp" # just one
    python scripts/record_presets.py --news HK-n1 US-n2 --portfolio samples/sample_portfolio_FICTIONAL.csv
                                                     # real cached headlines, with a portfolio
"""

import argparse
import asyncio
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
os.environ["COUNCIL_MOCK"] = "0"
os.environ["COUNCIL_OFFLINE"] = "0"

import httpx  # noqa: E402

import news  # noqa: E402
import portfolio  # noqa: E402
import recorder  # noqa: E402
from models import profile  # noqa: E402
from orchestrator import run_council  # noqa: E402
from schemas import RunRequest  # noqa: E402

PRESETS = ["Fed cuts 50bp", "China announces major stimulus", "BoJ hikes rates", "Oil spikes 15%"]


def credits_used() -> float | None:
    key = os.getenv("OPENROUTER_API_KEY")
    if not key:
        return None
    try:
        r = httpx.get("https://openrouter.ai/api/v1/credits", headers={"Authorization": f"Bearer {key}"}, timeout=15)
        return float(r.json()["data"]["total_usage"])
    except Exception:  # noqa: BLE001 - spend reporting is best effort
        return None


async def record(event: str, news_id: str | None = None) -> bool:
    rec = recorder.Recorder(event, None)
    start = time.monotonic()
    async for name, data in run_council(RunRequest(event=event, news_id=news_id)):
        rec.add(name, data)
        if name == "stage":
            print(f"  {time.monotonic() - start:6.1f}s  {data['name']:<11} {data['status']}")
        elif name == "error":
            print(f"  {time.monotonic() - start:6.1f}s  ! {data['message'][:110]}")
    path = rec.save(profile())
    counts = {}
    for e in rec.events:
        counts[e["event"]] = counts.get(e["event"], 0) + 1
    print(f"  {'saved ' + path.name if path else 'NOT saved (no brief)'} in {time.monotonic() - start:.0f}s: {counts}")
    return path is not None


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("events", nargs="*", default=PRESETS)
    p.add_argument("--force", action="store_true", help="re-record even if a recording exists")
    p.add_argument("--news", nargs="+", metavar="ID", help="cached headline ids (e.g. HK-n1) instead of events")
    p.add_argument("--portfolio", help="trades CSV to load first (kept in memory, as in the app)")
    args = p.parse_args()
    if args.portfolio:
        path = Path(args.portfolio)
        label = "Sample portfolio (fictional trades)" if "sample" in path.name.lower() else path.stem
        portfolio.set_current(portfolio.summarise(path.read_text(encoding="utf-8"), label))
        print(f"portfolio: {portfolio.current().event_payload()}")
    jobs = []  # (event text, news id)
    for nid in args.news or []:
        item = news.find(nid)
        if item is None:
            raise SystemExit(f"unknown headline {nid}; refresh the news first")
        jobs.append((news.event_text(item), nid))
    if not args.news:
        jobs = [(e, None) for e in args.events]

    before = credits_used()
    print(f"profile={profile()}  OpenRouter usage so far: ${before if before is not None else '?'}")
    ok = 0
    for event, nid in jobs:
        if recorder.load(recorder.slug_for(event)) and not args.force:
            print(f"\n{event}: already recorded (use --force to redo)")
            ok += 1
            continue
        print(f"\n{event}")
        ok += await record(event, nid)
    after = credits_used()
    if before is not None and after is not None:
        print(f"\nSpent ${after - before:.2f} (OpenRouter usage can lag a minute behind)")
    print(f"{ok}/{len(jobs)} recorded")


if __name__ == "__main__":
    asyncio.run(main())
