"""Pre-record full council runs for the demo presets into runs/{slug}.json (Stage 4).

Runs the real council in-process (no server needed) with the COUNCIL_PROFILE from .env and
prints the OpenRouter spend. Only complete runs are saved; existing recordings are kept
unless --force.

    python scripts/record_presets.py                 # all 4 presets
    python scripts/record_presets.py "Fed cuts 50bp" # just one
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


async def record(event: str) -> bool:
    rec = recorder.Recorder(event, None)
    start = time.monotonic()
    async for name, data in run_council(RunRequest(event=event)):
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
    args = p.parse_args()

    before = credits_used()
    print(f"profile={profile()}  OpenRouter usage so far: ${before if before is not None else '?'}")
    ok = 0
    for event in args.events:
        if recorder.load(recorder.slug_for(event)) and not args.force:
            print(f"\n{event}: already recorded (use --force to redo)")
            ok += 1
            continue
        print(f"\n{event}")
        ok += await record(event)
    after = credits_used()
    if before is not None and after is not None:
        print(f"\nSpent ${after - before:.2f} (OpenRouter usage can lag a minute behind)")
    print(f"{ok}/{len(args.events)} recorded")


if __name__ == "__main__":
    asyncio.run(main())
