"""One entry point for every LLM call: call_llm(system, user, schema).

Provider is picked from .env: ANTHROPIC_API_KEY first, then Bedrock
(BEDROCK_MODEL_ID + AWS credentials). Swap or add providers here only.
"""

import asyncio
import logging
import os
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import TypeVar

import anthropic
from dotenv import load_dotenv
from pydantic import BaseModel, ValidationError

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

log = logging.getLogger("council.llm")

TIMEOUT_S = 25.0
MAX_TOKENS = 8000
# Low effort keeps 16-cell votes well inside the 25 s budget; raise if quality needs it.
EFFORT = os.getenv("CLAUDE_EFFORT", "low")
FALLBACK_BETA = "server-side-fallback-2026-07-01"

T = TypeVar("T", bound=BaseModel)


class LLMError(Exception):
    """The call failed: timeout, auth, network or API error. Not worth retrying in-stage."""


class LLMOutputError(LLMError):
    """The model answered but the output did not match the schema. Worth one retry."""


@dataclass
class Usage:
    input_tokens: int
    output_tokens: int
    seconds: float


@lru_cache(maxsize=1)
def _client() -> tuple[str, str, anthropic.AsyncAnthropic | anthropic.AsyncAnthropicBedrockMantle]:
    opts = {"timeout": TIMEOUT_S, "max_retries": 1}
    if os.getenv("ANTHROPIC_API_KEY"):
        return "anthropic", os.getenv("CLAUDE_MODEL", "claude-sonnet-5-5"), anthropic.AsyncAnthropic(**opts)
    if os.getenv("BEDROCK_MODEL_ID"):
        client = anthropic.AsyncAnthropicBedrockMantle(aws_region=os.getenv("AWS_REGION", "us-east-1"), **opts)
        return "bedrock", os.environ["BEDROCK_MODEL_ID"], client
    raise LLMError("no LLM credentials: set ANTHROPIC_API_KEY, or BEDROCK_MODEL_ID plus AWS credentials, in .env")


async def call_llm(system: str, user: str, schema: type[T], *, agent: str = "?") -> tuple[T, Usage]:
    """Ask the model for one `schema` object. Raises LLMOutputError or LLMError."""
    provider, model, client = _client()
    kwargs = dict(
        model=model,
        max_tokens=MAX_TOKENS,
        system=system,
        messages=[{"role": "user", "content": user}],
        output_config={"effort": EFFORT},
        output_format=schema,
    )
    start = time.monotonic()
    try:
        if provider == "anthropic":
            # Server-side fallback reroutes a refused request instead of failing it.
            call = client.beta.messages.parse(**kwargs, fallbacks="default", betas=[FALLBACK_BETA])
        else:
            call = client.messages.parse(**kwargs)
        resp = await asyncio.wait_for(call, TIMEOUT_S)
    except ValidationError as e:
        raise LLMOutputError(f"output did not match {schema.__name__}: {e}") from e
    except TimeoutError as e:
        raise LLMError(f"timed out after {TIMEOUT_S:.0f}s") from e
    except anthropic.APIStatusError as e:
        raise LLMError(f"HTTP {e.status_code}: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise LLMError(f"connection error: {e}") from e

    usage = Usage(resp.usage.input_tokens, resp.usage.output_tokens, time.monotonic() - start)
    log.info("%-9s %s/%s in=%d out=%d %.1fs stop=%s", agent, provider, model,
             usage.input_tokens, usage.output_tokens, usage.seconds, resp.stop_reason)

    if resp.stop_reason == "refusal":
        raise LLMError("model declined the request")
    if resp.parsed_output is None:
        raise LLMOutputError(f"no parsable {schema.__name__} (stop_reason={resp.stop_reason})")
    return resp.parsed_output, usage
