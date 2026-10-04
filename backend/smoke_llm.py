"""One real blind vote through the configured provider, using the orchestrator's own path.

    cd backend && ../.venv/Scripts/python smoke_llm.py [AGENT]
"""

import asyncio
import logging
import sys
from collections import Counter

from models import model_for, profile
from orchestrator import ask_vote, load_data


async def main(agent: str = "HK") -> None:
    print(f"profile={profile()} model={model_for(agent)}")
    vote = await ask_vote(agent, "Fed cuts 50bp", load_data())
    print(f"{len(vote.cells)} cells:", dict(Counter(c.view for c in vote.cells)))
    for c in vote.cells:
        if c.country == agent or agent in ("CHAIR", "BEAR", "SPILLOVER"):
            print(f"  {c.country}/{c.sector}: {c.view} ({c.confidence})")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    asyncio.run(main(*sys.argv[1:]))
