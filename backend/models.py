"""Which OpenRouter model each agent uses. Pick a profile with COUNCIL_PROFILE.

A different lab per delegate is deliberate: models from different providers make
less correlated mistakes, so the debate and the blind vote carry more signal.
Prices are USD per 1M tokens (input/output), checked on OpenRouter 4 Oct 2026.
"""

import os

PROFILES: dict[str, dict[str, str]] = {
    # Demo / judging. Roughly $1 per full council run.
    "premium": {
        "CHAIR": "anthropic/claude-opus-5.5",        # $4 / $20  - best writer for the brief
        "HK": "anthropic/claude-sonnet-5.5",         # $2 / $10
        "CN": "openai/gpt-6.1-sol",                  # $2 / $10
        "US": "~google/gemini-pro-latest",           # $2 / $12
        "JP": "x-ai/grok-4.7",                       # $2 / $6
        "BEAR": "qwen/qwen3.8-max-0902",             # $2 / $6
        "SPILLOVER": "openai/gpt-6.1-sol-pro",       # $2 / $10 - graph reasoning
    },
    # Development. A few cents per run; same diversity, smaller models.
    "cheap": {
        "CHAIR": "anthropic/claude-sonnet-5.5",      # $2 / $10 (1-3 calls per run)
        "HK": "google/gemini-3.8-flash",             # $0.75 / $3.75
        "CN": "deepseek/deepseek-v4.1-flash",        # $0 / $2.40
        "US": "openai/gpt-6-luna",                   # $0.10 / $0.50
        "JP": "qwen/qwen3.8-flash",                  # $0.15 / $0.47
        "BEAR": "z-ai/glm-5.3-flash",                # $0.15 / $0.50
        "SPILLOVER": "openai/gpt-6-luna-pro",        # $0.10 / $0.50
    },
    # $0 balance. Free models are capped at 50 requests/day (about 2 runs).
    "free": {a: "qwen/qwen3.8-27b:free" for a in ["CHAIR", "HK", "CN", "US", "JP", "BEAR"]}
    | {"SPILLOVER": "nvidia/nemotron-3-super-120b-a12b:free"},
}

# Tried in order when an agent's model fails, times out or returns bad JSON twice.
FALLBACKS: dict[str, list[str]] = {
    "premium": ["openai/gpt-6-luna-pro", "deepseek/deepseek-v4.1-flash"],
    "cheap": ["deepseek/deepseek-v4.1-flash", "qwen/qwen3.8-27b:free"],
    "free": ["nvidia/nemotron-3-super-120b-a12b:free"],
}

def profile() -> str:
    name = os.getenv("COUNCIL_PROFILE", "cheap")
    if name not in PROFILES:
        raise ValueError(f"COUNCIL_PROFILE must be one of {list(PROFILES)}, got {name!r}")
    return name


def model_for(agent: str, *, explicit: str | None = None, like: str | None = None) -> str:
    """The model for one council member.

    Order: MODEL_<ID> env override, the member's own model, the profile's entry for this id,
    then the profile entry of the seat it is `like` (custom members have no entry of their own).
    """
    table = PROFILES[profile()]
    return (os.getenv(f"MODEL_{agent.replace('-', '_')}") or explicit or table.get(agent)
            or table.get(like or "") or table["BEAR"])


def all_models() -> list[str]:
    """Every model named in any profile, for the member editor's model picker."""
    return sorted({m for table in PROFILES.values() for m in table.values()})


def fallbacks() -> list[str]:
    return FALLBACKS[profile()]
