"""Builds each agent's system prompt: _shared.md + {AGENT}.md with placeholders filled."""

import json
from pathlib import Path

from pydantic import BaseModel

PROMPTS = Path(__file__).resolve().parent / "agents" / "prompts"


def _read(name: str) -> str:
    return (PROMPTS / f"{name}.md").read_text(encoding="utf-8").strip()


def build_prompt(agent: str, *, task: str, event: str, data: object, transcript: str | None,
                 schema: type[BaseModel]) -> tuple[str, str]:
    """Return (system, user) for one agent turn. `data` is a DataPack or list of them."""
    if isinstance(data, list):
        data_json = json.dumps([d.model_dump() if isinstance(d, BaseModel) else d for d in data])
    else:
        data_json = json.dumps(data.model_dump() if isinstance(data, BaseModel) else data)
    role = (_read(agent)
            .replace("{TASK}", task)
            .replace("{EVENT}", event)
            .replace("{DATAPACK_JSON}", data_json)
            .replace("{TRANSCRIPT_OR_NONE}", transcript or "none yet")
            .replace("{SCHEMA}", json.dumps(schema.model_json_schema(by_alias=True))))
    system = _read("_shared") + "\n\n" + role
    user = f"{task}\nReply with only the JSON object."
    return system, user


def revote_task() -> str:
    return _read("_revote")
