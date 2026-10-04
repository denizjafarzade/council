"""One real blind vote through the configured provider, using the orchestrator's own path.

    cd backend && ../.venv/Scripts/python smoke_llm.py [AGENT]
"""

import asyncio
import logging
import sys
from collections import Counter

import library
from models import profile
from orchestrator import Run, load_data


async def main(agent: str = "HK") -> None:
    council = library.default_council()
    run = Run(council, library.resolve(council))
    seat = next(s for s in run.seats if s.id == agent)
    print(f"profile={profile()} model={run.model(seat)}")
    packs, _ = await load_data(council.markets)
    vote = await run.ask_vote(seat, "blind", "Fed cuts 50bp", packs, {}, None)
    print(f"{len(vote.cells)} cells:", dict(Counter(c.view for c in vote.cells)))
    for c in vote.cells:
        if c.country == agent or agent in ("CHAIR", "BEAR", "SPILLOVER"):
            print(f"  {c.country}/{c.sector}: {c.view} ({c.confidence})")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    asyncio.run(main(*sys.argv[1:]))
