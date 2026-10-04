"""Keep tests offline: no real Jev calls even when .env has a TypeSafe key, and no real
market-data fetches (a stale cache would otherwise trigger a refresh from Yahoo).

Tests that exercise Jev set TYPESAFE_API_KEY themselves against a mock transport; tests that
exercise data refresh patch orchestrator._fetch_pack / _refresh_pack themselves.
"""

import sys
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def no_real_jev(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)


@pytest.fixture(autouse=True)
def no_real_fetch(monkeypatch):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import orchestrator

    def blocked(*_args):
        raise RuntimeError("network disabled in tests")

    monkeypatch.setattr(orchestrator, "_fetch_pack", blocked)
    monkeypatch.setattr(orchestrator, "_refresh_pack", blocked)
    # Cached data counts as fresh, so results don't depend on today's date (staleness tests opt in).
    monkeypatch.setattr(orchestrator, "_is_stale", lambda pack: False)
