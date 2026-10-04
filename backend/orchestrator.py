"""Council run: data -> blind vote -> debate -> revote -> spillover -> brief.

Stage 0: replays mocks/council_run.json so the frontend can wire up the real
/council/stream endpoint from minute one. Stage 1A replaces this with real agents.
"""

import asyncio
import json
from pathlib import Path
from typing import AsyncIterator

from schemas import RunRequest

ROOT = Path(__file__).resolve().parent.parent
MOCK_RUN = ROOT / "mocks" / "council_run.json"
MOCK_DELAY_S = 0.3


async def run_council(req: RunRequest) -> AsyncIterator[tuple[str, dict]]:
    """Yield (event_name, payload) pairs matching the SSE contract."""
    events = json.loads(MOCK_RUN.read_text(encoding="utf-8"))
    for e in events:
        await asyncio.sleep(MOCK_DELAY_S)
        yield e["event"], e["data"]
