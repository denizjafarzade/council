"""Real news as the council's event.

Headlines come from the cached DataPacks (data/cache/{market}.json). refresh() re-runs only
fetch_news for the given markets and rewrites their cache; it is never called during a run.
"""

from datetime import datetime, timezone

from schemas import DataPack

import orchestrator  # CACHE_DIR, so tests can point it at a temp folder


def _pack_path(code: str):
    return orchestrator.CACHE_DIR / f"{code}.json"


def _load(code: str) -> DataPack | None:
    path = _pack_path(code)
    if not path.exists():
        return None
    return DataPack.model_validate_json(path.read_text(encoding="utf-8"))


def top(markets: list[str], limit: int = 24) -> list[dict]:
    """Headlines from the cached packs of these markets, newest first."""
    items = []
    for code in markets:
        pack = _load(code)
        if pack is None:
            continue
        for n in pack.news:
            items.append({**n.model_dump(), "market": code,
                          "fetched_at": pack.news_fetched_at or pack.as_of})
    items.sort(key=lambda n: n["published"], reverse=True)
    return items[:limit]


def find(news_id: str) -> dict | None:
    """A cached headline by id ("HK-n5"); the market is the id's prefix."""
    code = news_id.split("-", 1)[0]
    pack = _load(code)
    if pack is None:
        return None
    for n in pack.news:
        if n.id == news_id:
            return {**n.model_dump(), "market": code}
    return None


def event_text(item: dict) -> str:
    """The run's EVENT: the headline with its source and publish time."""
    try:
        when = datetime.fromisoformat(item["published"]).astimezone(timezone.utc).strftime("%d %b %Y %H:%M UTC")
    except ValueError:
        when = item["published"]
    return f"\"{item['title']}\" ({item['source'] or 'unknown source'}, published {when})"


def refresh(markets: list[str]) -> dict:
    """Re-fetch only the headlines for these markets and update their cache. Network call."""
    from data import fetch  # lazily: pulls in yfinance

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    result = {}
    for code in markets:
        pack = _load(code)
        if pack is None:
            result[code] = "no cached data; build it first with data/fetch.py"
            continue
        report: list = []
        fresh = fetch.fetch_news(code, report)
        if not fresh:  # keep the old headlines rather than wiping them on a failed fetch
            result[code] = f"fetch failed, kept {len(pack.news)} cached headlines"
            continue
        pack = DataPack.model_validate({**pack.model_dump(), "news": fresh, "news_fetched_at": now})
        _pack_path(code).write_text(pack.model_dump_json(indent=2, exclude_none=True), encoding="utf-8")
        result[code] = f"{len(fresh)} headlines"
    return {"fetched_at": now, "markets": result}
