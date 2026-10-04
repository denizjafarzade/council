"""Stage 0 gate: confirm the LLM and OpenRouter (Jev) credentials work.

Run from the repo root:  make keys   (or: .venv/Scripts/python backend/check_keys.py)
Uses ANTHROPIC_API_KEY if set, otherwise Bedrock (AWS credentials + BEDROCK_MODEL_ID),
matching the order call_llm will try them.
"""

import os
import sys
from pathlib import Path

import anthropic
import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def check_llm() -> bool:
    if os.getenv("ANTHROPIC_API_KEY"):
        provider, model = "anthropic", os.getenv("CLAUDE_MODEL", "claude-sonnet-5-5")
        client = anthropic.Anthropic()
    elif os.getenv("BEDROCK_MODEL_ID"):
        provider, model = "bedrock", os.environ["BEDROCK_MODEL_ID"]
        client = anthropic.AnthropicBedrockMantle(aws_region=os.getenv("AWS_REGION", "us-east-1"))
    else:
        print("LLM: FAIL - set ANTHROPIC_API_KEY, or BEDROCK_MODEL_ID plus AWS credentials, in .env")
        return False
    try:
        resp = client.messages.create(
            model=model,
            max_tokens=256,
            output_config={"effort": "low"},
            messages=[{"role": "user", "content": "Reply with the single word: ready"}],
        )
    except anthropic.AuthenticationError:
        print(f"LLM ({provider}): FAIL - credentials rejected")
        return False
    except anthropic.APIStatusError as e:
        print(f"LLM ({provider}): FAIL - HTTP {e.status_code}: {e.message}")
        return False
    except anthropic.APIConnectionError as e:
        print(f"LLM ({provider}): FAIL - connection error: {e}")
        return False
    text = "".join(b.text for b in resp.content if b.type == "text").strip()
    print(f"LLM ({provider}, {model}): OK - replied {text!r}, {resp.usage.input_tokens}+{resp.usage.output_tokens} tokens")
    return True


def check_openrouter() -> bool:
    key = os.getenv("OPENROUTER_API_KEY")
    if not key:
        print("OpenRouter: FAIL - OPENROUTER_API_KEY not set")
        return False
    try:
        r = httpx.get("https://openrouter.ai/api/v1/key", headers={"Authorization": f"Bearer {key}"}, timeout=15)
    except httpx.HTTPError as e:
        print(f"OpenRouter: FAIL - {e}")
        return False
    if r.status_code != 200:
        print(f"OpenRouter: FAIL - HTTP {r.status_code}")
        return False
    data = r.json().get("data", {})
    print(f"OpenRouter: OK - key valid, usage {data.get('usage')}, limit {data.get('limit')}")
    return True


if __name__ == "__main__":
    results = [check_llm(), check_openrouter()]
    sys.exit(0 if all(results) else 1)
