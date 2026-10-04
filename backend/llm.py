"""One entry point for every LLM call: call_llm(system, user, schema).

Provider is picked from .env: LLM_PROVIDER (openrouter | anthropic | bedrock) if set,
otherwise ANTHROPIC_API_KEY first, then Bedrock (BEDROCK_MODEL_ID + AWS credentials),
then OpenRouter. Swap or add providers here only.

OpenRouter runs each agent on its own model (see models.py) and falls through to
backup models on API errors while time remains.
"""

import asyncio
import json
import logging
import os
import re
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import TypeVar

import anthropic
import httpx
from dotenv import load_dotenv
from pydantic import BaseModel, ValidationError

from models import fallbacks, model_for

# override=True: the project .env wins over stale keys set in the Windows/shell environment.
load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)

log = logging.getLogger("council.llm")

TIMEOUT_S = float(os.getenv("LLM_TIMEOUT_S", "25"))
MAX_TOKENS = 8000
# Low effort keeps 16-cell votes well inside the 25 s budget; raise if quality needs it.
EFFORT = os.getenv("CLAUDE_EFFORT", "low")
FALLBACK_BETA = "server-side-fallback-2026-07-01"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
# Don't start a backup model with less time than this left in the budget.
MIN_FALLBACK_S = 5.0

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
    cost_usd: float = 0.0  # OpenRouter reports real cost; 0 for other providers
    model: str = ""


def provider() -> str:
    chosen = os.getenv("LLM_PROVIDER", "").lower()
    if chosen:
        return chosen
    if os.getenv("ANTHROPIC_API_KEY"):
        return "anthropic"
    if os.getenv("BEDROCK_MODEL_ID"):
        return "bedrock"
    if os.getenv("OPENROUTER_API_KEY"):
        return "openrouter"
    raise LLMError("no LLM credentials: set OPENROUTER_API_KEY, ANTHROPIC_API_KEY, or BEDROCK_MODEL_ID plus AWS credentials, in .env")


@lru_cache(maxsize=1)
def _client() -> tuple[str, str, anthropic.AsyncAnthropic | anthropic.AsyncAnthropicBedrockMantle]:
    opts = {"timeout": TIMEOUT_S, "max_retries": 1}
    if provider() == "anthropic":
        return "anthropic", os.getenv("CLAUDE_MODEL", "claude-sonnet-5-5"), anthropic.AsyncAnthropic(**opts)
    if provider() == "bedrock":
        client = anthropic.AsyncAnthropicBedrockMantle(aws_region=os.getenv("AWS_REGION", "us-east-1"), **opts)
        return "bedrock", os.environ["BEDROCK_MODEL_ID"], client
    raise LLMError(f"unknown LLM_PROVIDER {provider()!r}")


async def call_llm(system: str, user: str, schema: type[T], *, agent: str = "?",
                   model: str | None = None) -> tuple[T, Usage]:
    """Ask the model for one `schema` object. Raises LLMOutputError or LLMError.

    `model` (OpenRouter only) overrides the per-agent profile choice in models.py.
    """
    if provider() == "openrouter":
        return await _call_openrouter(system, user, schema, agent, model)

    provider_name, model, client = _client()
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
        if provider_name == "anthropic":
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

    usage = Usage(resp.usage.input_tokens, resp.usage.output_tokens, time.monotonic() - start, model=model)
    log.info("%-9s %s/%s in=%d out=%d %.1fs stop=%s", agent, provider_name, model,
             usage.input_tokens, usage.output_tokens, usage.seconds, resp.stop_reason)

    if resp.stop_reason == "refusal":
        raise LLMError("model declined the request")
    if resp.parsed_output is None:
        raise LLMOutputError(f"no parsable {schema.__name__} (stop_reason={resp.stop_reason})")
    return resp.parsed_output, usage


# --- OpenRouter -------------------------------------------------------------------

def _extract_json(text: str) -> str:
    """Some models wrap JSON in ```json fences or add a sentence; keep the object."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    return text[start:end + 1] if start != -1 and end > start else text


async def _call_openrouter(system: str, user: str, schema: type[T], agent: str,
                           model: str | None = None) -> tuple[T, Usage]:
    key = os.getenv("OPENROUTER_API_KEY")
    if not key:
        raise LLMError("OPENROUTER_API_KEY is not set")
    primary = model or model_for(agent)
    models = [primary] + [m for m in fallbacks() if m != primary]
    body = {
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "max_tokens": MAX_TOKENS,
        "temperature": 0.4,
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": schema.__name__, "schema": schema.model_json_schema(by_alias=True)},
        },
        "reasoning": {"effort": EFFORT},
        "usage": {"include": True},
    }
    headers = {"Authorization": f"Bearer {key}", "X-Title": "AI Trading Council"}
    start = time.monotonic()
    errors = []

    async with httpx.AsyncClient(headers=headers) as client:
        for model in models:
            left = TIMEOUT_S - (time.monotonic() - start)
            if model != primary and left < MIN_FALLBACK_S:
                break
            try:
                r = await client.post(OPENROUTER_URL, json={**body, "model": model}, timeout=left)
            except httpx.TimeoutException:
                errors.append(f"{model}: timed out")
                continue
            except httpx.TransportError as e:
                errors.append(f"{model}: connection error {e}")
                continue
            if r.status_code == 402:
                raise LLMError("OpenRouter balance too low (HTTP 402): top up credits")
            data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            if r.status_code >= 400 or "error" in data:
                errors.append(f"{model}: HTTP {r.status_code} {str(data.get('error', r.text))[:160]}")
                continue

            u = data.get("usage") or {}
            usage = Usage(u.get("prompt_tokens", 0), u.get("completion_tokens", 0),
                          time.monotonic() - start, float(u.get("cost") or 0), model)
            choice = data["choices"][0]
            log.info("%-9s openrouter/%s in=%d out=%d $%.4f %.1fs stop=%s", agent, model,
                     usage.input_tokens, usage.output_tokens, usage.cost_usd, usage.seconds,
                     choice.get("finish_reason"))
            text = choice["message"].get("content") or ""
            try:
                return schema.model_validate_json(_extract_json(text)), usage
            except (ValidationError, json.JSONDecodeError) as e:
                # The caller retries once on LLMOutputError, as with the other providers.
                raise LLMOutputError(f"{model} output did not match {schema.__name__}: {str(e)[:300]}") from e

    raise LLMError("all OpenRouter models failed: " + " | ".join(errors))
