"""Bedrock compliance guardrail, with a fake bedrock-runtime client (no AWS calls)."""

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import guardrail  # noqa: E402
import orchestrator  # noqa: E402
from llm import Usage  # noqa: E402
from schemas import COUNTRIES, SECTORS, DelegateReport, RunRequest, Vote, validate_event  # noqa: E402

BLOCKED = "Withheld by Verdisk's compliance guardrail."


class FakeBedrock:
    """Intervenes on advice-like or political text, like the real denied topics would."""

    def __init__(self, fail=False):
        self.calls = []
        self.fail = fail

    def apply_guardrail(self, **kw):
        self.calls.append(kw)
        if self.fail:
            raise ConnectionError("no route to AWS")
        assert kw["source"] == "OUTPUT" and kw["guardrailIdentifier"] == "gr-test"
        text = kw["content"][0]["text"]["text"]
        topic = "Personalised investment advice" if "you should buy" in text.lower() else \
            "Political commentary" if "corrupt" in text.lower() else None
        if not topic:
            return {"action": "NONE", "outputs": [], "assessments": []}
        return {"action": "GUARDRAIL_INTERVENED", "outputs": [{"text": BLOCKED}],
                "assessments": [{"topicPolicy": {"topics": [{"name": topic, "type": "DENY", "action": "BLOCKED"}]}}]}


def use_fake(monkeypatch, fake):
    monkeypatch.setenv("GUARDRAIL_ID", "gr-test")
    monkeypatch.setenv("GUARDRAIL_VERSION", "1")
    guardrail._client.cache_clear()
    monkeypatch.setattr(guardrail, "_client", lambda: fake)


def test_off_without_a_guardrail_id():
    assert not guardrail.enabled() and guardrail.label() is None
    checked = asyncio.run(guardrail.check("You should buy HSBC now."))
    assert not checked.blocked and checked.note() is None


def test_blocked_text_is_replaced_with_the_reason(monkeypatch):
    use_fake(monkeypatch, FakeBedrock())
    ok, advice, politics = asyncio.run(guardrail.check_all(
        ["HIBOR tracks US rates.", "You should buy HSBC now.", "That government is corrupt."]))
    assert ok.note() is None and ok.text == "HIBOR tracks US rates."
    assert advice.text == BLOCKED and advice.note() == {"action": "blocked", "reasons": ["Personalised investment advice"]}
    assert politics.note()["reasons"] == ["Political commentary"]
    assert guardrail.label() == "Bedrock guardrail gr-test v1"


def test_aws_failure_passes_text_through_marked_unchecked(monkeypatch):
    use_fake(monkeypatch, FakeBedrock(fail=True))
    checked = asyncio.run(guardrail.check("HIBOR tracks US rates."))
    assert checked.text == "HIBOR tracks US rates." and not checked.blocked
    assert checked.note() == {"action": "unchecked", "reasons": ["guardrail unavailable (ConnectionError)"]}


class CouncilLLM:
    """HK's report gives personal advice in one claim; the Chair slips advice into a key risk."""

    async def __call__(self, system, user, schema, *, agent, model=None):
        if schema is Vote:
            markets = [agent] if agent in COUNTRIES else COUNTRIES  # market seats vote their own market only
            cells = [{"country": c, "sector": s, "view": "neutral", "confidence": 0.5} for c in markets for s in SECTORS]
            return Vote(agent=agent, round="blind", cells=cells), Usage(1, 1, 0)
        if schema is DelegateReport:
            claims = [{"text": "Index down 5% in a month.", "source_ids": [f"{agent}-idx"]}]
            if agent == "HK":
                claims.append({"text": "You should buy HSBC before Friday.", "source_ids": ["HK-idx"]})
            return DelegateReport(agent=agent, impact_summary=f"{agent} view", claims=claims, challenges=[],
                                  triggers=[]), Usage(1, 1, 0)
        if schema.__name__ == "Spillover":
            raise orchestrator.LLMError("skip")
        return schema(headline="Rates fall across Asia.", key_risks=["Crowded trade.", "You should buy the dip now."],
                      triggers=[], questions_for_you=["Your horizon?"], plain_english="Rates are falling."), Usage(1, 1, 0)


def test_full_run_streams_only_guarded_text(monkeypatch):
    fake = FakeBedrock()
    use_fake(monkeypatch, fake)
    monkeypatch.setattr(orchestrator, "call_llm", CouncilLLM())

    async def collect():
        return [e async for e in orchestrator.run_council(RunRequest(event="Fed cuts 50bp"))]
    events = asyncio.run(collect())
    for name, data in events:
        validate_event(name, data)

    assert next(d for n, d in events if n == "council")["guardrail"] == "Bedrock guardrail gr-test v1"
    messages = [d for n, d in events if n == "message"]
    blocked = [m for m in messages if m.get("guardrail")]
    assert blocked  # HK's advice claim, once per debate round
    assert all(m["agent"] == "HK" and m["text"] == BLOCKED and m["source_ids"] == [] for m in blocked)
    assert not any("You should buy" in m["text"] for m in messages)

    brief = next(d for n, d in events if n == "brief")
    assert brief["key_risks"] == ["Crowded trade.", BLOCKED]
    assert brief["guardrail"] == [{"action": "blocked", "reasons": ["Personalised investment advice"], "field": "key_risks[1]"}]
    assert brief["headline"] == "Rates fall across Asia." and brief["plain_english"] == "Rates are falling."


def test_toggle_off_skips_the_guardrail_for_that_run(monkeypatch):
    fake = FakeBedrock()
    use_fake(monkeypatch, fake)
    monkeypatch.setattr(orchestrator, "call_llm", CouncilLLM())

    async def collect():
        req = RunRequest(event="Fed cuts 50bp", guardrail=False)
        return [e async for e in orchestrator.run_council(req)]
    events = asyncio.run(collect())
    assert fake.calls == []
    assert next(d for n, d in events if n == "council")["guardrail"] is None
    assert any(d["text"] == "You should buy HSBC before Friday." for n, d in events if n == "message")
    assert next(d for n, d in events if n == "brief")["guardrail"] == []


def test_health_says_whether_the_guardrail_is_set_up(monkeypatch):
    from fastapi.testclient import TestClient
    from app import app

    client = TestClient(app)
    assert client.get("/health").json() == {"ok": True, "guardrail": None}
    monkeypatch.setenv("GUARDRAIL_ID", "gr-test")
    monkeypatch.setenv("GUARDRAIL_VERSION", "1")
    assert client.get("/health").json()["guardrail"] == "Bedrock guardrail gr-test v1"
