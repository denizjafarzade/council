"""One real blind vote through OpenRouter to prove the LLM path works.

    COUNCIL_PROFILE=free python smoke_llm.py [AGENT]
"""

import asyncio
import logging
import sys
from collections import Counter
from pathlib import Path

from llm import call_llm
from models import model_for, profile
from prompts import build_prompt
from schemas import DataPack, Vote

ROOT = Path(__file__).resolve().parent.parent


async def main(agent: str = "HK") -> None:
    pack = DataPack.model_validate_json((ROOT / "mocks" / "datapacks" / f"{agent}.json").read_text(encoding="utf-8"))
    system, user = build_prompt(
        agent, task="Blind vote: give a view and confidence for all 16 cells. Set agent to "
                    f"\"{agent}\" and round to \"blind\".",
        event="Fed cuts 50bp", data=pack, transcript=None, schema=Vote)
    print(f"profile={profile()} model={model_for(agent)}")
    vote, usage = await call_llm(system, user, Vote, agent=agent)
    print(f"answered by {usage.model} in {usage.seconds}s, {usage.prompt_tokens} in / "
          f"{usage.completion_tokens} out tokens, ${usage.cost_usd:.4f}, attempts={usage.attempts}")
    print(f"{len(vote.cells)} cells:", dict(Counter(c.view for c in vote.cells)))
    for c in vote.cells:
        if c.country == agent:
            print(f"  {c.country}/{c.sector}: {c.view} ({c.confidence})")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    asyncio.run(main(*sys.argv[1:]))
