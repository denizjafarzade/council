"""Keep tests offline: no real Jev or Bedrock guardrail calls, whatever .env holds.

Tests that exercise them set TYPESAFE_API_KEY / GUARDRAIL_ID themselves against fakes.
"""

import pytest


@pytest.fixture(autouse=True)
def no_real_jev(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    monkeypatch.delenv("GUARDRAIL_ID", raising=False)
