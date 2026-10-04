"""Demo safety layer (Stage 4): record every live run, replay it at real speed.

    runs/{event_slug}.json = {"event", "slug", "recorded_at", "duration_s", "profile", "council",
                              "events": [{"t": seconds_since_start, "event": ..., "data": ...}]}

Only complete runs (a brief arrived) are saved, so a failed rehearsal never overwrites a
good recording. COUNCIL_OFFLINE=1 serves recordings instead of calling the network.
"""

import asyncio
import json
import os
import time
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path

import library

RUNS_DIR = Path(__file__).resolve().parent.parent / "runs"
# Longest pause replayed between two events, so a slow LLM call doesn't stall the demo.
MAX_GAP_S = 12.0


def offline_mode() -> bool:
    return os.getenv("COUNCIL_OFFLINE", "") not in ("", "0", "false")


def slug_for(event: str) -> str:
    return library.slugify(event)


class Recorder:
    def __init__(self, event: str, council_id: str | None):
        self.event = event
        self.council_id = council_id
        self.start = time.monotonic()
        self.events: list[dict] = []

    def add(self, event: str, data: dict) -> None:
        self.events.append({"t": round(time.monotonic() - self.start, 2), "event": event, "data": data})

    def complete(self) -> bool:
        return any(e["event"] == "brief" for e in self.events)

    def save(self, profile: str) -> Path | None:
        if not self.complete():
            return None
        RUNS_DIR.mkdir(exist_ok=True)
        slug = slug_for(self.event)
        path = RUNS_DIR / f"{slug}.json"
        path.write_text(json.dumps({
            "event": self.event,
            "slug": slug,
            "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "duration_s": self.events[-1]["t"] if self.events else 0,
            "profile": profile,
            "council": self.council_id,
            "events": self.events,
        }, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        return path


def load(slug: str) -> dict | None:
    path = RUNS_DIR / f"{slug}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def list_recordings() -> list[dict]:
    out = []
    for path in sorted(RUNS_DIR.glob("*.json")) if RUNS_DIR.exists() else []:
        try:
            run = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        out.append({k: run.get(k) for k in ("slug", "event", "recorded_at", "duration_s", "profile", "council")})
    return out


async def replay(run: dict, speed: float = 1.0) -> AsyncIterator[tuple[str, dict]]:
    """Yield a recorded run's events with their original spacing (divided by `speed`)."""
    yield "replay", {k: run.get(k) for k in ("slug", "event", "recorded_at", "duration_s", "profile")}
    last = 0.0
    for e in run["events"]:
        await asyncio.sleep(min(max(e["t"] - last, 0.0), MAX_GAP_S) / max(speed, 0.1))
        last = e["t"]
        yield e["event"], e["data"]
