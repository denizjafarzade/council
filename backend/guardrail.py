"""Compliance layer: every debate message and every line of the Chair's brief goes through a
Bedrock guardrail (ApplyGuardrail) before it is streamed. Enforced by infrastructure, not prompts.

The guardrail (scripts/create_guardrail.py) denies personalised buy/sell advice and political
commentary, and filters hate, insults, violence and misconduct. When it intervenes, the text is
replaced by the guardrail's blocked message and the reason is attached for the UI.

Off unless GUARDRAIL_ID is set. If AWS errors or is slow, the text passes unchecked and the
note says so: a demo should never hang on the compliance call.
"""

import asyncio
import logging
import os
from dataclasses import dataclass, field
from functools import lru_cache

import llm  # noqa: F401 - loads .env

log = logging.getLogger("council.guardrail")

TIMEOUT_S = 5.0
# Bedrock throttles bursts: a run sends 20-40 texts at once, so cap the calls in flight.
MAX_IN_FLIGHT = 4
_slots: dict[int, asyncio.Semaphore] = {}  # one per event loop (each asyncio.run gets its own)


def _semaphore() -> asyncio.Semaphore:
    key = id(asyncio.get_running_loop())
    if key not in _slots:
        _slots[key] = asyncio.Semaphore(MAX_IN_FLIGHT)
    return _slots[key]


@dataclass
class Checked:
    text: str  # what may be shown: the original, or the guardrail's blocked message
    blocked: bool = False
    reasons: list[str] = field(default_factory=list)  # e.g. ["Personalised investment advice"]
    error: str | None = None  # set when the check itself failed; text is the original

    def note(self) -> dict | None:
        """The `guardrail` field for SSE payloads, or None when nothing happened."""
        if self.blocked:
            return {"action": "blocked", "reasons": self.reasons}
        if self.error:
            return {"action": "unchecked", "reasons": [self.error]}
        return None


def enabled() -> bool:
    return bool(os.getenv("GUARDRAIL_ID")) and os.getenv("GUARDRAIL", "1") not in ("0", "false", "off")


def label() -> str | None:
    """Shown in the council event so the UI can say the guardrail is on."""
    if not enabled():
        return None
    return f"Bedrock guardrail {os.getenv('GUARDRAIL_ID')} v{os.getenv('GUARDRAIL_VERSION', 'DRAFT')}"


@lru_cache(maxsize=1)
def _client():
    import boto3  # imported lazily: only needed when the guardrail is on
    from botocore.config import Config

    return boto3.client("bedrock-runtime", region_name=os.getenv("AWS_REGION", "us-east-1"),
                        config=Config(connect_timeout=3, read_timeout=TIMEOUT_S,
                                      retries={"max_attempts": 3, "mode": "adaptive"},  # backs off when throttled
                                      max_pool_connections=MAX_IN_FLIGHT))


def _reasons(response: dict) -> list[str]:
    out = []
    for a in response.get("assessments", []):
        out += [t["name"] for t in a.get("topicPolicy", {}).get("topics", []) if t.get("action") == "BLOCKED"]
        out += [f"{f['type'].title()} filter" for f in a.get("contentPolicy", {}).get("filters", [])
                if f.get("action") == "BLOCKED"]
        out += [f"Blocked word: {w['match']}" for w in a.get("wordPolicy", {}).get("customWords", [])
                if w.get("action") == "BLOCKED"]
    return list(dict.fromkeys(out)) or ["Guardrail policy"]


def _apply(text: str) -> Checked:
    response = _client().apply_guardrail(
        guardrailIdentifier=os.environ["GUARDRAIL_ID"],
        guardrailVersion=os.getenv("GUARDRAIL_VERSION", "DRAFT"),
        source="OUTPUT",  # model output shown to the user
        content=[{"text": {"text": text}}],
    )
    if response.get("action") != "GUARDRAIL_INTERVENED":
        return Checked(text)
    replaced = " ".join(o.get("text", "") for o in response.get("outputs", [])).strip()
    reasons = _reasons(response)
    log.warning("guardrail blocked: %s | %s", reasons, text[:120])
    return Checked(replaced or "Withheld by the compliance guardrail.", blocked=True, reasons=reasons)


async def check(text: str) -> Checked:
    if not enabled() or not text.strip():
        return Checked(text)
    try:
        async with _semaphore():
            return await asyncio.wait_for(asyncio.to_thread(_apply, text), 3 * TIMEOUT_S)
    except Exception as e:  # noqa: BLE001 - fail open: never block the run on the compliance call
        log.error("guardrail check failed, passing text unchecked: %s: %s", type(e).__name__, e)
        return Checked(text, error=f"guardrail unavailable ({type(e).__name__})")


async def check_all(texts: list[str]) -> list[Checked]:
    """Check many texts in parallel. One call each: a guardrail verdict covers its whole input."""
    return list(await asyncio.gather(*(check(t) for t in texts)))
