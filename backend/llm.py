"""One wrapper for every LLM call: call_llm(system, user, schema) via OpenRouter.

- Asks for JSON matching the pydantic schema, validates it, retries once on bad JSON.
- On timeout / API error / second bad answer, moves to the next fallback model.
- Logs tokens and USD cost per agent (OpenRouter returns the real cost).
"""

import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import TypeVar

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel, ValidationError

from models import fallbacks, model_for

load_dotenv()
log = logging.getLogger("council.llm")

URL = "https://openrouter.ai/api/v1/chat/completions"
TIMEOUT_S = float(os.getenv("LLM_TIMEOUT_S", "25"))
T = TypeVar("T", bound=BaseModel)


class LLMError(RuntimeError):
    pass


@dataclass
class Usage:
    agent: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    seconds: float = 0.0
    attempts: list[str] = field(default_factory=list)


# Running totals for the current process, keyed by agent.
USAGE: dict[str, list[Usage]] = {}


def _extract_json(text: str) -> str:
    """Models sometimes wrap JSON in ```json fences or add a sentence; keep the object."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    return text[start:end + 1] if start != -1 and end > start else text


async def _post(client: httpx.AsyncClient, model: str, messages: list[dict], schema: type[BaseModel]) -> dict:
    body = {
        "model": model,
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": 4000,
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": schema.__name__, "schema": schema.model_json_schema(by_alias=True)},
        },
        "reasoning": {"effort": "low"},  # speed matters more than depth on stage
        "usage": {"include": True},
    }
    r = await client.post(URL, json=body, timeout=TIMEOUT_S)
    if r.status_code == 402:
        raise LLMError(f"{model}: OpenRouter balance too low (402). Top up credits.")
    if r.status_code >= 400:
        raise LLMError(f"{model}: HTTP {r.status_code} {r.text[:200]}")
    data = r.json()
    if "error" in data:
        raise LLMError(f"{model}: {data['error']}")
    return data


async def call_llm(system: str, user: str, schema: type[T], agent: str, model: str | None = None) -> tuple[T, Usage]:
    key = os.getenv("OPENROUTER_API_KEY")
    if not key:
        raise LLMError("OPENROUTER_API_KEY is not set (see .env.example)")
    headers = {"Authorization": f"Bearer {key}", "X-Title": "AI Trading Council"}
    models = [model or model_for(agent)] + [m for m in fallbacks() if m != (model or model_for(agent))]
    usage = Usage(agent=agent, model=models[0])
    t0 = time.monotonic()
    errors = []

    async with httpx.AsyncClient(headers=headers) as client:
        for m in models:
            messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
            for attempt in (1, 2):  # second attempt = retry once on invalid JSON
                usage.attempts.append(m)
                try:
                    data = await _post(client, m, messages, schema)
                except (httpx.TimeoutException, httpx.TransportError) as e:
                    errors.append(f"{m}: {type(e).__name__}")
                    break  # network/timeout: go to the next model
                except LLMError as e:
                    errors.append(str(e))
                    break
                u = data.get("usage") or {}
                usage.prompt_tokens += u.get("prompt_tokens", 0)
                usage.completion_tokens += u.get("completion_tokens", 0)
                usage.cost_usd += float(u.get("cost") or 0)
                text = data["choices"][0]["message"].get("content") or ""
                try:
                    result = schema.model_validate_json(_extract_json(text))
                except (ValidationError, json.JSONDecodeError) as e:
                    errors.append(f"{m} attempt {attempt}: invalid JSON ({str(e)[:120]})")
                    messages += [{"role": "assistant", "content": text},
                                 {"role": "user", "content": f"That did not match the schema: {str(e)[:500]}. Reply with only the corrected JSON."}]
                    continue
                usage.model = m
                usage.seconds = round(time.monotonic() - t0, 2)
                USAGE.setdefault(agent, []).append(usage)
                log.info("%s via %s: %d in / %d out tokens, $%.4f, %.1fs",
                         agent, m, usage.prompt_tokens, usage.completion_tokens, usage.cost_usd, usage.seconds)
                return result, usage

    raise LLMError(f"{agent}: all models failed: " + " | ".join(errors))
