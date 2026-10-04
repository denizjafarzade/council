"""Recompute brief.risk in saved runs with the current risk.py, from each run's own recorded data:
its DataPacks ("data" event), final matrix, final votes, claim checks and portfolio. No model calls.

    python scripts/rescore_recordings.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

import risk  # noqa: E402
from schemas import DataPack, MatrixCell, VoteCell  # noqa: E402


def rescore(run: dict) -> dict | None:
    ev = run["events"]
    brief = next((e["data"] for e in ev if e["event"] == "brief"), None)
    data = next((e["data"] for e in ev if e["event"] == "data"), None)
    if brief is None or data is None:
        return None
    council = next((e["data"] for e in ev if e["event"] == "council"), {})
    markets = [m["code"] for m in council.get("markets", [])] or sorted({c["country"] for c in brief["matrix"]})
    packs = {c: DataPack.model_validate(p) for c, p in data["packs"].items()}
    matrix = [MatrixCell.model_validate(c) for c in brief["matrix"]]
    exposure = next((e["data"] for e in ev if e["event"] == "portfolio"), None)

    final: dict[str, list] = {}
    for e in ev:  # revotes come after blind votes, so they win
        if e["event"] == "vote":
            final[e["data"]["agent"]] = [VoteCell.model_validate(c) for c in e["data"]["cells"]]

    # Claim checks, as the orchestrator counted them: each report claim and its message's verdict.
    verdict = {(e["data"]["agent"], e["data"]["text"]): bool(e["data"].get("unverified"))
               for e in ev if e["event"] == "message"}
    stats: dict[str, list[int]] = {}
    for e in ev:
        if e["event"] == "report":
            s = stats.setdefault(e["data"]["agent"], [0, 0])
            for c in e["data"]["claims"]:
                s[1] += 1
                s[0] += 0 if verdict.get((e["data"]["agent"], c["text"]), False) else 1
    seat_unverified = {a: (n - ok) / n for a, (ok, n) in stats.items() if n}
    members = council.get("members", [])
    market_seat = {}
    for code in markets:
        seat = next((m["id"] for m in members if m.get("market") == code and m.get("role") == "macro"), None) \
            or next((m["id"] for m in members if m.get("market") == code), code)
        market_seat[code] = seat
    unverified_share = {c: seat_unverified[s] for c, s in market_seat.items() if s in seat_unverified}

    return risk.compute(packs, matrix, markets, unverified_share, exposure, final, seat_unverified)


def main() -> None:
    for path in sorted((ROOT / "runs").glob("*.json")):
        run = json.loads(path.read_text(encoding="utf-8"))
        new = rescore(run)
        if new is None:
            print(f"skip  {path.name} (no brief or no data event)")
            continue
        brief = next(e["data"] for e in run["events"] if e["event"] == "brief")
        old = (brief.get("risk") or {}).get("portfolio") or (brief.get("risk") or {}).get("together")
        brief["risk"] = new
        path.write_text(json.dumps(run, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        now = new.get("portfolio") or new.get("together")
        markets = ", ".join(f"{c} {r['score']}" for c, r in new["markets"].items())
        print(f"{path.name[:44]:44} {old['score'] if old else '-':>4} -> {now['score'] if now else '-':>4}   {markets}")


if __name__ == "__main__":
    main()
