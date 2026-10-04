"""Generate mocks/council_run.json and mocks/datapacks/*.json.

A deterministic, clearly fake council run for "Fed cuts 50bp", so the UI can be
built before the engine works. Every value is validated against backend/schemas.py.

    python mocks/generate_mock.py
"""

import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from council_math import compute_matrix, compute_vote_shifts  # noqa: E402
from schemas import (  # noqa: E402
    COUNTRIES, SECTORS, Brief, DataPack, DelegateReport, Message, Spillover, StageEvent, Vote,
    validate_event,
)

EVENT = "Fed cuts 50bp"
AS_OF = {
    "HK": "2026-10-02T16:00:00+08:00",
    "CN": "2026-10-02T15:00:00+08:00",
    "US": "2026-10-02T16:00:00-04:00",
    "JP": "2026-10-02T15:00:00+09:00",
}

# Round, obviously fake numbers. Headlines are tagged [MOCK].
PACKS = {
    "HK": dict(
        series=[("HK-idx", "Hang Seng Index", 25000.0, 0.8, 3.1, 18.0), ("HK-fx", "USD/HKD", 7.80, 0.0, -0.1, 0.5)],
        sectors=[("Tech", "3033.HK", 4.5, 28.0), ("Financials", "0005.HK", 2.0, 15.0),
                 ("Property", "0016.HK", 6.0, 24.0), ("Energy", "0883.HK", -1.5, 20.0)],
        macro=[("HK-hibor", "1M HIBOR", 3.50), ("HK-base", "HKMA base rate", 4.75)],
        news=["HKMA follows Fed with matching base rate cut", "Developers rally as mortgage rates seen easing",
              "Southbound Stock Connect inflows hit monthly high", "Hang Seng tech names extend gains"],
    ),
    "CN": dict(
        series=[("CN-idx", "Shanghai Composite", 3500.0, 0.4, 1.5, 16.0), ("CN-fx", "USD/CNY", 7.10, -0.2, -0.6, 3.0)],
        sectors=[("Tech", "688981.SS", 3.0, 35.0), ("Financials", "601398.SS", 0.5, 12.0),
                 ("Property", "000002.SZ", -4.0, 40.0), ("Energy", "601857.SS", -0.5, 18.0)],
        macro=[("CN-lpr", "1Y Loan Prime Rate", 3.00), ("CN-rrr", "Reserve requirement ratio", 9.5)],
        news=["PBoC signals room for further easing", "Yuan firms against weaker dollar",
              "Property sales remain soft in tier-2 cities", "Chip makers gain on policy support hopes"],
    ),
    "US": dict(
        series=[("US-idx", "S&P 500", 6000.0, 1.2, 2.5, 14.0), ("US-fx", "US Dollar Index", 100.0, -0.6, -1.8, 7.0),
                ("US-10y", "US 10Y Treasury yield", 4.00, -2.5, -5.0, 22.0)],
        sectors=[("Tech", "XLK", 3.5, 20.0), ("Financials", "XLF", 0.8, 16.0),
                 ("Property", "XLRE", 4.0, 18.0), ("Energy", "XLE", -2.0, 22.0)],
        macro=[("US-ffr", "Fed funds upper bound", 4.50), ("US-cpi", "CPI YoY", 2.9)],
        news=["Fed delivers 50bp cut, cites cooling labour market", "Treasury yields fall across the curve",
              "Bank margins in focus as rates drop", "Mega-cap tech leads index higher"],
    ),
    "JP": dict(
        series=[("JP-idx", "Nikkei 225", 40000.0, -0.5, 1.0, 19.0), ("JP-fx", "USD/JPY", 145.0, -1.2, -3.0, 10.0)],
        sectors=[("Tech", "8035.T", -1.0, 32.0), ("Financials", "8306.T", -2.5, 22.0),
                 ("Property", "8801.T", 1.5, 18.0), ("Energy", "5020.T", -0.5, 17.0)],
        macro=[("JP-boj", "BoJ policy rate", 0.50), ("JP-10y", "JGB 10Y yield", 1.20)],
        news=["Yen jumps as US-Japan rate gap narrows", "Exporters slip on stronger yen",
              "Megabanks fall as yield spread compresses", "BoJ seen holding steady this month"],
    ),
}


def build_datapacks() -> dict[str, DataPack]:
    packs = {}
    for c, p in PACKS.items():
        packs[c] = DataPack.model_validate({
            "country": c,
            "as_of": AS_OF[c],
            "series": [dict(id=i, name=n, last=l, chg_1d_pct=d, chg_1m_pct=m, vol_20d_pct=v) for i, n, l, d, m, v in p["series"]],
            "sectors": [dict(sector=s, ticker=t, chg_1m_pct=m, vol_20d_pct=v) for s, t, m, v in p["sectors"]],
            "macro": [dict(id=i, name=n, value=v) for i, n, v in p["macro"]],
            "news": [dict(id=f"{c}-n{k + 1}", title=f"[MOCK] {t}", source="Mock Wire",
                          url=f"https://example.com/mock/{c.lower()}-n{k + 1}", published=AS_OF[c])
                     for k, t in enumerate(p["news"])],
        })
    return packs


# Underlying "truth" the mock council converges towards (score -1..1).
BASE = {
    ("HK", "Tech"): 0.6, ("HK", "Financials"): 0.2, ("HK", "Property"): 0.7, ("HK", "Energy"): -0.1,
    ("CN", "Tech"): 0.4, ("CN", "Financials"): 0.1, ("CN", "Property"): -0.5, ("CN", "Energy"): 0.0,
    ("US", "Tech"): 0.7, ("US", "Financials"): -0.2, ("US", "Property"): 0.6, ("US", "Energy"): -0.3,
    ("JP", "Tech"): -0.4, ("JP", "Financials"): -0.6, ("JP", "Property"): 0.3, ("JP", "Energy"): 0.0,
}

# (agent, cell) -> (blind view, revote view, because). Scripted so the demo has visible shifts.
SCRIPTED_SHIFTS = {
    ("JP", ("JP", "Financials")): ("neutral", "bearish", "US delegate: falling US yields compress the spread megabanks rely on [US-10y]"),
    ("US", ("US", "Property")): ("neutral", "bullish", "HK delegate: lower US rates feed straight into mortgage costs [US-10y]"),
    ("CN", ("CN", "Property")): ("neutral", "bearish", "Bear: sales data stays weak despite easing [CN-n3]"),
    ("HK", ("HK", "Financials")): ("bullish", "neutral", "US delegate: bank margins pressured as rates drop [US-n3]"),
    ("BEAR", ("US", "Tech")): ("bullish", "neutral", "Own view: consensus is crowded; cut already priced [US-idx]"),
    ("SPILLOVER", ("JP", "Tech")): ("neutral", "bearish", "JP delegate: stronger yen hits exporters [JP-fx]"),
}


def _view(score: float) -> str:
    return "bullish" if score > 0.25 else "bearish" if score < -0.25 else "neutral"


def build_votes(rnd: random.Random) -> tuple[list[Vote], list[Vote]]:
    agents = ["CHAIR", "HK", "CN", "US", "JP", "BEAR", "SPILLOVER"]
    blind, revote = [], []
    for a in agents:
        bcells, rcells = [], []
        # Market delegates vote on their own market only; cross-market seats vote on all.
        for c in ([a] if a in COUNTRIES else COUNTRIES):
            for s in SECTORS:
                bias = -0.35 if a == "BEAR" else 0.0
                score = BASE[(c, s)] + bias + rnd.uniform(-0.3, 0.3)
                home = a == c
                conf = round(rnd.uniform(0.6, 0.85) if home else rnd.uniform(0.35, 0.6), 2)
                bview = rview = _view(score)
                because = None
                scripted = SCRIPTED_SHIFTS.get((a, (c, s)))
                if scripted:
                    bview, rview, because = scripted
                rconf = round(min(1.0, conf + rnd.uniform(0.0, 0.1)), 2)
                bcells.append(dict(country=c, sector=s, view=bview, confidence=conf))
                rcell = dict(country=c, sector=s, view=rview, confidence=rconf)
                if because:
                    rcell["because"] = because
                rcells.append(rcell)
        blind.append(Vote(agent=a, round="blind", cells=bcells, source="llm"))
        revote.append(Vote(agent=a, round="revote", cells=rcells, source="llm"))
    return blind, revote


MESSAGES = [
    ("CHAIR", "Council convened on: Fed cuts 50bp. Blind votes are in; delegates, make your case.", []),
    ("HK", "The HKD peg means HIBOR follows US rates down. 1M HIBOR at 3.50 should ease, a direct tailwind for HK Property.", ["HK-hibor", "HK-fx"]),
    ("CN", "PBoC gets room to ease as the yuan firms. Tech benefits, but property sales stay soft; the cut does not fix demand.", ["CN-fx", "CN-n1", "CN-n3"]),
    ("US", "10Y yield down 5% on the month to 4.00. Tech and REITs gain; bank margins are the loser here.", ["US-10y", "US-n3"]),
    ("JP", "USD/JPY down 3.0% on the month to 145. A stronger yen pressures exporters like Tokyo Electron.", ["JP-fx", "JP-n2"]),
    ("HK", "Challenge to US: HK banks are not US banks. HIBOR falling with a stable spread is neutral for HSBC, not negative.", ["HK-hibor"]),
    ("CN", "Challenge to HK: Stock Connect inflows are real, but CN Property is down 4.0% this month. Spillover to HK developers is limited.", ["CN-n3", "HK-n3"]),
    ("US", "Agree with HK on Property: lower US rates pass through the peg. Revising HK Property up.", ["HK-hibor", "US-10y"]),
    ("JP", "Megabanks fall as the US-JP rate gap shrinks. JP Financials is the clearest bearish cell on the board.", ["JP-n3", "JP-boj"]),
    ("BEAR", "Strongest consensus: US Tech, HK Property, HK Tech. US Tech is crowded and the cut was priced; HK Property relies on HIBOR actually falling.", ["US-idx", "HK-hibor"]),
]

REPORTS = [
    dict(agent="HK", impact_summary="Peg transmits the cut into HIBOR; property and tech benefit, energy flat.",
         claims=[dict(text="1M HIBOR at 3.50 tracks US rates via the peg.", source_ids=["HK-hibor", "HK-fx"]),
                 dict(text="Southbound inflows at a monthly high support tech.", source_ids=["HK-n3"])],
         challenges=[dict(to_agent="US", text="HK bank margins differ from US banks; HIBOR spread is stable.")],
         triggers=[dict(condition="HIBOR fails to fall within 2 weeks", would_change="HK Property to neutral")]),
    dict(agent="CN", impact_summary="Easing room for PBoC; tech up, property still weak on demand.",
         claims=[dict(text="Yuan firms as the dollar weakens.", source_ids=["CN-fx", "CN-n2"]),
                 dict(text="Property down 4.0% on the month despite easing.", source_ids=["CN-Property"])],
         challenges=[dict(to_agent="HK", text="Mainland property weakness limits spillover to HK developers.")],
         triggers=[dict(condition="PBoC cuts the LPR", would_change="CN Property to neutral")]),
    dict(agent="US", impact_summary="Lower yields lift tech and REITs; bank margins compress.",
         claims=[dict(text="10Y yield at 4.00, down 5% on the month.", source_ids=["US-10y"]),
                 dict(text="Bank margins in focus as rates drop.", source_ids=["US-n3"])],
         challenges=[dict(to_agent="JP", text="Yen strength may be short-lived if US data rebounds.")],
         triggers=[dict(condition="CPI re-accelerates above 3%", would_change="US Tech to neutral")]),
    dict(agent="JP", impact_summary="Stronger yen hurts exporters and megabanks; property mildly positive.",
         claims=[dict(text="USD/JPY at 145, down 3.0% on the month.", source_ids=["JP-fx"]),
                 dict(text="Megabanks fall as yield spread compresses.", source_ids=["JP-n3"])],
         challenges=[dict(to_agent="US", text="Spillover to Japanese tech is negative, not neutral.")],
         triggers=[dict(condition="BoJ signals a hike", would_change="JP Financials to neutral")]),
    dict(agent="BEAR", impact_summary="The consensus on US Tech and HK Property is crowded and partly priced.",
         claims=[dict(text="S&P 500 up 2.5% on the month into the decision.", source_ids=["US-idx"]),
                 dict(text="HK Property bull case depends on HIBOR moving, not yet in our data.", source_ids=["HK-hibor"])],
         challenges=[dict(to_agent="HK", text="Show HIBOR actually falling before calling Property bullish.")],
         triggers=[dict(condition="Fed signals a pause", would_change="US Tech to bearish")]),
]

SPILLOVER = {
    "nodes": [
        {"id": "fed", "label": "Fed cuts 50bp", "country": "US"},
        {"id": "ust", "label": "US yields fall", "country": "US"},
        {"id": "usd", "label": "Dollar weakens", "country": "US"},
        {"id": "hibor", "label": "HIBOR eases", "country": "HK"},
        {"id": "hkprop", "label": "HK Property", "country": "HK"},
        {"id": "jpy", "label": "Yen strengthens", "country": "JP"},
        {"id": "jpexp", "label": "JP exporters / Tech", "country": "JP"},
        {"id": "jpbank", "label": "JP megabanks", "country": "JP"},
        {"id": "cny", "label": "Yuan firms", "country": "CN"},
        {"id": "pboc", "label": "PBoC easing room", "country": "CN"},
    ],
    "edges": [
        {"from": "fed", "to": "ust", "mechanism": "policy rate cut lowers yields", "sign": "-", "strength": 0.9, "source_ids": ["US-10y"]},
        {"from": "fed", "to": "usd", "mechanism": "narrower rate differential", "sign": "-", "strength": 0.7, "source_ids": ["US-fx"]},
        {"from": "fed", "to": "hibor", "mechanism": "HKD peg transmits US rates", "sign": "-", "strength": 0.8, "source_ids": ["HK-hibor", "HK-fx"]},
        {"from": "hibor", "to": "hkprop", "mechanism": "cheaper mortgages", "sign": "+", "strength": 0.6, "source_ids": ["HK-n2"]},
        {"from": "usd", "to": "jpy", "mechanism": "US-JP rate gap narrows", "sign": "+", "strength": 0.7, "source_ids": ["JP-fx", "JP-n1"]},
        {"from": "jpy", "to": "jpexp", "mechanism": "stronger yen cuts export earnings", "sign": "-", "strength": 0.6, "source_ids": ["JP-n2"]},
        {"from": "ust", "to": "jpbank", "mechanism": "yield spread compresses", "sign": "-", "strength": 0.5, "source_ids": ["JP-n3"]},
        {"from": "usd", "to": "cny", "mechanism": "weaker dollar lifts yuan", "sign": "+", "strength": 0.5, "source_ids": ["CN-fx"]},
        {"from": "cny", "to": "pboc", "mechanism": "firmer yuan frees PBoC", "sign": "+", "strength": 0.4, "source_ids": ["CN-n1"]},
    ],
}


def ev(event: str, model) -> dict:
    data = model.model_dump(by_alias=True, exclude_none=True)
    validate_event(event, data)
    return {"event": event, "data": data}


def stage(name: str, status: str) -> dict:
    return ev("stage", StageEvent(name=name, status=status))


def build_run() -> list[dict]:
    rnd = random.Random(42)
    blind, revote = build_votes(rnd)
    events = [stage("data", "started"), stage("data", "done"), stage("blind_vote", "started")]
    events += [ev("vote", v) for v in blind]
    events += [stage("blind_vote", "done"), stage("debate", "started")]

    reports = {r["agent"]: DelegateReport.model_validate(r) for r in REPORTS}
    msgs = [Message(agent=a, text=t, source_ids=s) for a, t, s in MESSAGES]
    # Opening + round 1 (with reports), round 2, then the Bear.
    events.append(ev("message", msgs[0]))
    for m in msgs[1:5]:
        events += [ev("message", m), ev("report", reports[m.agent])]
    events += [ev("message", m) for m in msgs[5:9]]
    events += [ev("message", msgs[9]), ev("report", reports["BEAR"])]
    events.append(stage("debate", "done"))

    events.append(stage("revote", "started"))
    events += [ev("vote", v) for v in revote]
    events += [stage("revote", "done"), stage("spillover", "started"),
               ev("spillover", Spillover.model_validate(SPILLOVER)), stage("spillover", "done")]

    matrix = compute_matrix(revote)
    split = max(matrix, key=lambda m: m.dissent)
    brief = Brief(
        headline=f"[MOCK] Council sees the Fed cut lifting HK Property and US Tech, hurting JP banks; most split on {split.country} {split.sector}.",
        matrix=matrix,
        vote_shifts=compute_vote_shifts(blind, revote),
        key_risks=["Cut already priced into US Tech", "HIBOR lags the Fed move", "Yen strength reverses on US data"],
        triggers=[dict(condition="Fed signals a pause", would_change="US Tech to neutral"),
                  dict(condition="HIBOR fails to fall", would_change="HK Property to neutral"),
                  dict(condition="BoJ signals a hike", would_change="JP Financials to neutral")],
        questions_for_you=["What is your time horizon for this view?",
                           "How large would a position be relative to your account?",
                           "How much do you already hold in rate-sensitive sectors?"],
    )
    events += [stage("brief", "started"), ev("brief", brief), stage("brief", "done")]
    return events


def main() -> None:
    out = ROOT / "mocks"
    (out / "datapacks").mkdir(parents=True, exist_ok=True)
    for c, pack in build_datapacks().items():
        (out / "datapacks" / f"{c}.json").write_text(json.dumps(pack.model_dump(exclude_none=True), indent=2) + "\n", encoding="utf-8")
    run = build_run()
    (out / "council_run.json").write_text(json.dumps(run, indent=2) + "\n", encoding="utf-8")
    counts = {}
    for e in run:
        counts[e["event"]] = counts.get(e["event"], 0) + 1
    print(f"wrote {len(run)} events: {counts}")


if __name__ == "__main__":
    main()
