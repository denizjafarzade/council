"""Keep tests offline: no real Jev calls even when .env has a TypeSafe key.

Tests that exercise Jev set TYPESAFE_API_KEY themselves against a mock transport.
"""

import pytest


@pytest.fixture(autouse=True)
def no_real_jev(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
