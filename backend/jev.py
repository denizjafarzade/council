"""Calibrated votes from TypeSafe's Jev (Stage 3A).

One System One request per seat: the seat's context is the state, and every matrix cell
is a Choice question over bearish / neutral / bullish. Jev returns a probability for each
option, so a vote's confidence is the probability of the view it picked, not a number the
model wrote. Any failure raises JevError and the orchestrator falls back to the LLM vote.

Needs TYPESAFE_API_KEY (api.typesafe.ai). OpenRouter's typesafe/jev-router is a chat
router, not the System One API, so it cannot return these probabilities.
"""

import asyncio
import logging
import os
import time

import httpx

import llm  # noqa: F401 - loads .env
from schemas import SECTORS, Vote, VoteCell

log = logging.getLogger("council.jev")

URL = "https://api.typesafe.ai/v1/systemone"
MODEL = os.getenv("JEV_MODEL", "jev-latest")
TIMEOUT_S = 5.0
VIEWS = ("bearish", "neutral", "bullish")


class JevError(Exception):
    """Jev is off, timed out, or answered something unusable. Use the LLM vote instead."""


def enabled() -> bool:
    return bool(os.getenv("TYPESAFE_API_KEY")) and os.getenv("JEV", "1") not in ("0", "false", "off")


def qid(market: str, sector: str) -> str:
    return f"{market}_{sector}"


def questions(market_names: dict[str, str]) -> dict:
    out = {}
    for code, name in market_names.items():
        for sector in SECTORS:
            where = f"{name} ({code}) {sector}"
            out[qid(code, sector)] = {
                "type": "choice",
                "instructions": (
                    f"Taking the perspective of `member` and using only `data` and `debate_notes`, "
                    f"how is `event` most likely to move {where} stocks over the next few weeks?"
                ),
                "criteria": {
                    "bearish": f"{where} stocks are likely to fall or underperform because of the event.",
                    "neutral": f"No clear direction for {where}: offsetting effects, little exposure, "
                               "or not enough evidence in the data.",
                    "bullish": f"{where} stocks are likely to rise or outperform because of the event.",
                },
            }
    return out


async def vote_with_jev(agent_context: dict, cells: list[tuple[str, str]], *, agent: str, rnd: str,
                        market_names: dict[str, str], previous: Vote | None = None,
                        reason: str = "") -> Vote:
    """Ask Jev for one seat's vote on every cell. Raises JevError on any problem.

    `previous` (the seat's blind vote) and `reason` fill `because` on cells whose view
    changed in the revote; Jev itself gives probabilities, not reasons.
    """
    key = os.getenv("TYPESAFE_API_KEY")
    if not key or not enabled():
        raise JevError("Jev is off (no TYPESAFE_API_KEY)")
    body = {"model": MODEL, "state": agent_context, "questions": questions(market_names)}
    start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
            r = await asyncio.wait_for(
                client.post(URL, json=body, headers={"Authorization": f"Bearer {key}"}), TIMEOUT_S)
    except (TimeoutError, httpx.TimeoutException) as e:
        raise JevError(f"timed out after {TIMEOUT_S:.0f}s") from e
    except httpx.HTTPError as e:
        raise JevError(f"connection error: {e}") from e
    if r.status_code != 200:
        raise JevError(f"HTTP {r.status_code}: {r.text[:160]}")

    data = r.json()
    answers = data.get("answers") or {}
    before = {(c.country, c.sector): c.view for c in previous.cells} if previous else {}
    out = []
    for market, sector in cells:
        a = answers.get(qid(market, sector)) or {}
        view, probs = a.get("choice"), a.get("probabilities") or {}
        if view not in VIEWS or view not in probs:
            raise JevError(f"no usable answer for {market}/{sector}: {a!r}"[:200])
        changed = rnd == "revote" and before.get((market, sector)) not in (None, view)
        out.append(VoteCell(country=market, sector=sector, view=view, confidence=round(float(probs[view]), 2),
                            because=(reason or "Changed after the debate (Jev revote)")[:160] if changed else None))
    usage = data.get("usage") or {}
    log.info("%-9s jev/%s in=%s out=%s %.1fs", agent, data.get("model", MODEL), usage.get("input_tokens"),
             usage.get("output_tokens"), time.monotonic() - start)
    return Vote(agent=agent, round=rnd, cells=out, source="jev")
