# AI Trading Council: Hackathon Build Plan

Oct 4, 2026 · @Rohan

## At a glance

We build one flow end to end: pick a market event, watch four country delegates debate it live, and get a spillover map plus a country × sector stance matrix. Code freeze is 17:30; move it once organisers confirm the judging time.

- **Demo flow:** event in → blind votes → debate → revote → spillover map + matrix + brief.
- **Agents (7):** Chair, delegates for Hong Kong, Mainland China, US and Japan, a Bear agent, a Spillover agent.
- **Rohan owns the council engine:** orchestration, agent prompts, LLM and Jev calls, the streaming API.
- **Teammate owns data and frontend:** market data fetchers with cache, the UI (event picker, live debate, matrix, spillover graph).
- **How we stay in sync:** both build against the shared JSON contracts in section 3 from minute one; the frontend runs on mock JSON until the engine is live.
- **Markets are closed today (Sunday):** demo on Friday's closing data and say so; it runs live at the final on Thursday.

## Timeline

&#91;embedded content: build day · 2 tracks, 3 gates\]

Read it top to bottom: each of us works our own track until a sync gate, where the two halves must connect before either moves on.

## Stack and shared contracts

Agree on these contracts in the first 30 minutes; after that neither of us changes a field without telling the other.

| Layer | Choice | Owner |
| --- | --- | --- |
| Backend | Python, FastAPI, asyncio for parallel agent calls, Server-Sent Events (SSE) for streaming | Rohan |
| LLM | A Claude model via AWS Bedrock (sponsor) or the Anthropic API | Rohan |
| Voting | Jev via OpenRouter; fallback = LLM structured JSON | Rohan |
| Market data | yfinance for indices, sector proxies, FX, yields; cached to JSON | Teammate |
| News | Google News RSS per country query; cached | Teammate |
| Frontend | React (Vite), Tailwind, a heatmap grid, a force or flow graph for spillover | Teammate |

**Scope:** 4 countries (HK, CN, US, JP) × 4 sectors (Tech, Financials, Property, Energy) = 16 matrix cells. Pick and verify one ticker per cell in Stage 0.

**Repo layout:**

```text
council/
  backend/
    app.py            # FastAPI: POST /council/run, GET /council/stream/{run_id}
    orchestrator.py   # stages: data -> blind vote -> debate -> revote -> spillover -> brief
    agents/prompts/   # one .md per agent (section 5)
    data/fetch.py     # builds DataPacks, writes data/cache/*.json
    schemas.py        # pydantic models mirroring the contracts below
  frontend/
    src/              # EventPicker, DebateStream, Matrix, SpilloverGraph, Brief
  mocks/
    council_run.json  # a full fake run so the UI can be built before the engine works
```

**Contract 1: DataPack (data layer → agents)**

```json
{
  "country": "HK",
  "as_of": "2026-10-02T16:00:00+08:00",
  "series": [
    {"id": "HK-idx", "name": "Hang Seng Index", "last": 0, "chg_1d_pct": 0, "chg_1m_pct": 0, "vol_20d_pct": 0}
  ],
  "sectors": [
    {"sector": "Tech", "ticker": "", "chg_1m_pct": 0, "vol_20d_pct": 0}
  ],
  "macro": [{"id": "HK-hibor", "name": "1M HIBOR", "value": 0}],
  "news": [{"id": "HK-n1", "title": "", "source": "", "url": "", "published": ""}]
}
```

**Contract 2: Vote (every agent, blind round and revote)**

```json
{"agent": "HK", "round": "blind", "cells": [{"country": "HK", "sector": "Property", "view": "bearish", "confidence": 0.72}]}
```

**Contract 3: DelegateReport (debate output)**

```json
{
  "agent": "HK",
  "impact_summary": "",
  "claims": [{"text": "", "source_ids": ["HK-hibor"]}],
  "challenges": [{"to_agent": "US", "text": ""}],
  "triggers": [{"condition": "", "would_change": ""}]
}
```

**Contract 4: Spillover**

```json
{
  "nodes": [{"id": "fed", "label": "Fed cuts 50bp", "country": "US"}],
  "edges": [{"from": "fed", "to": "hibor", "mechanism": "HKD peg transmits US rates", "sign": "-", "strength": 0.8, "source_ids": []}]
}
```

**Contract 5: Brief (chair output)**

```json
{
  "headline": "",
  "matrix": [{"country": "HK", "sector": "Property", "view": "bullish", "confidence": 0.64, "dissent": 0.3}],
  "vote_shifts": [{"agent": "JP", "cell": "JP/Financials", "from": "neutral", "to": "bearish", "because": ""}],
  "key_risks": [""],
  "triggers": [{"condition": "", "would_change": ""}],
  "questions_for_you": [""],
  "disclaimer": "Research and decision support only. Not investment advice."
}
```

**SSE events the frontend listens for:** `stage` (name, status), `vote` (Contract 2), `message` (agent, text, source\_ids), `report` (Contract 3), `spillover` (Contract 4), `brief` (Contract 5), `error`.

## Build prompts by stage

Paste each prompt into Claude or Claude Code, along with section 3 (the contracts). Each stage ends at a sync gate where both halves must talk to each other before moving on.

### Stage 0 · Setup · 10:00–10:30 · both

**Done when:** repo runs, both API keys work, mock run file exists.

```text
Scaffold a monorepo called council/ exactly matching the repo layout and the five JSON contracts below.
- backend/: FastAPI app with POST /council/run (body: {event: string, countries: ["HK","CN","US","JP"], sectors: ["Tech","Financials","Property","Energy"]}) returning {run_id}, and GET /council/stream/{run_id} as Server-Sent Events.
- backend/schemas.py: pydantic models for DataPack, Vote, DelegateReport, Spillover, Brief.
- frontend/: Vite + React + Tailwind app with empty components EventPicker, DebateStream, Matrix, SpilloverGraph, Brief.
- mocks/council_run.json: one complete fake run as an ordered list of SSE events (stage, vote x7, message x10, report x4, spillover, brief) using realistic but clearly fake values.
- A tiny test that validates the mock file against the pydantic models.
Keep it minimal. No auth, no database.
[PASTE SECTION 3 CONTRACTS HERE]
```

### Stage 1 · Core build · 10:30–12:30 · parallel

**1A · Rohan · council engine skeleton.** Done when: a run streams 7 blind votes over SSE using cached DataPacks.

```text
In backend/orchestrator.py, implement an async council run with these stages, emitting SSE events per the contracts:
1. load_data: read DataPacks from data/cache/{country}.json (fall back to mocks if missing).
2. blind_vote: call 7 agents in parallel with asyncio.gather. Each gets the event, ONLY its own DataPack (Chair, Bear and Spillover get all four), and its system prompt from agents/prompts/{agent}.md. Each must return a Vote JSON for all 16 cells. Validate with pydantic; on invalid JSON retry once, then emit an error event and continue.
3. Emit each vote as an SSE "vote" event the moment it arrives.
Wrap the LLM call in one function call_llm(system, user, schema) so we can swap providers. Add a 25-second timeout per call. Log token usage per agent.
```

**1B · Teammate · data layer.** Done when: data/cache/ has 4 valid DataPack files from real Friday-close data.

```text
Write backend/data/fetch.py that builds a DataPack (contract below) for HK, CN, US and JP and saves each to data/cache/{country}.json.
- Use yfinance. For each country: the main index, one sector proxy ticker per sector (Tech, Financials, Property, Energy), the USD exchange rate, and one rates series. Compute last, 1-day and 1-month % change, and 20-day volatility.
- Print a table of every ticker and whether it returned data, so we can swap any ticker that fails.
- Pull the 8 newest headlines per country from Google News RSS (query e.g. "Hong Kong economy", "China economy", "US Federal Reserve", "Bank of Japan") with title, source, url, published.
- Give every series and headline a stable id like HK-idx, HK-Tech, HK-n3 so agents can cite them.
- Never call the network during a demo: a --offline flag loads only from cache.
[PASTE CONTRACT 1]
```

**1C · Teammate · UI on mocks.** Done when: replaying mocks/council\_run.json animates the full screen.

```text
Build the frontend against mocks/council_run.json, replayed with a 300 ms delay between events (a "Replay mock" button).
- EventPicker: text box plus 4 preset events ("Fed cuts 50bp", "China announces major stimulus", "BoJ hikes rates", "Oil spikes 15%").
- DebateStream: chat-style feed; each agent has a colour and a country flag; source ids render as small chips.
- Matrix: 4 countries x 4 sectors grid; colour = view (bearish/neutral/bullish), opacity = confidence; show blind vote and final vote side by side.
- SpilloverGraph: directed graph from the spillover event; edge labels show mechanism; colour by sign.
- Brief: headline, risks, triggers, questions_for_you, disclaimer.
One screen, dark theme, readable from the back of a lecture hall.
```

**Sync gate 1 · 12:30:** point the UI at the real `/council/stream` and confirm blind votes render. Fix contract mismatches now, not later.

### Stage 2 · Full council · 13:00–15:00 · parallel

**2A · Rohan · debate, revote, spillover, brief.** Done when: one full run completes in under 3 minutes.

```text
Extend the orchestrator after blind_vote:
4. debate (2 rounds max): each delegate sees all blind votes plus other delegates' previous messages and returns a DelegateReport. Run delegates in parallel per round. Then the Bear agent attacks the strongest consensus cells. Stream every message as an SSE "message" event.
5. revote: every agent re-votes all 16 cells given the debate transcript.
6. spillover: the Spillover agent returns the Spillover JSON for the event across the 4 countries.
7. brief: the Chair computes the final matrix (confidence-weighted average of revotes), dissent per cell (spread of revote views), vote_shifts (cells where an agent changed view, with the reason from its report), and writes the Brief JSON.
Compute matrix, dissent and vote_shifts in Python, not with the LLM. The Chair LLM only writes headline, key_risks, triggers and questions_for_you.
```

**2B · Teammate · wire the real stream.** Done when: a live run animates every panel.

```text
Replace mock replay with EventSource on /council/stream/{run_id}. Handle every event type in the contract, show a stage progress bar (data, blind vote, debate, revote, spillover, brief), animate matrix cells that change between blind vote and revote, and show a clear error toast without crashing if an "error" event arrives. Keep the mock replay button as a fallback.
```

**Sync gate 2 · 15:00:** run all 4 preset events end to end. Note the slowest stage and any agent that returns bad JSON.

### Stage 3 · What makes us different · 15:00–16:30 · parallel

**3A · Rohan · Jev votes and citation checks.** Done when: votes come from Jev with a working fallback, and uncited claims are flagged.

```text
1. Add a vote_with_jev(agent_context, cells) path: send the agent's DataPack summary and debate notes as state, and ask one typed question per cell with choices [bearish, neutral, bullish]; read back the probabilities as view + confidence. If Jev fails or times out (5 s), fall back to the LLM vote. Mark each vote with source: "jev" or "llm".
2. Add a citation validator: every claim's source_ids must exist in that agent's DataPack. Claims with missing or invalid ids get flagged "unverified" in the message event.
3. Add a numbers check: any number in a claim must appear in a cited series value (allow rounding). Flag mismatches.
```

**3B · Teammate · trust UI.** Done when: a judge can click any claim and see its source.

```text
Add: hover on a source chip shows the series value or headline with link; "unverified" claims get a warning badge; a "Who changed their mind" panel listing vote_shifts with the reason; a dissent indicator on each matrix cell; a small "votes by Jev" badge when vote source is jev.
```

### Stage 4 · Harden · 16:30–17:30 · both

**Done when:** the demo works with Wi-Fi off.

```text
Add a demo safety layer:
1. Record mode: save every SSE event of a run to runs/{event_slug}.json.
2. Replay mode: GET /council/replay/{event_slug} streams a saved run at real speed. The UI shows a small "Replay of a recorded run" label in this mode.
3. Pre-record successful runs of all 4 preset events.
4. Make every stage time out gracefully and continue with the agents that answered.
5. One command, make demo, starts backend in --offline mode and the frontend.
```

**Code freeze · 17:30.** After this only fix bugs that break the demo path.

## Council agent prompts

Each agent file in `agents/prompts/` = the shared rules + its own role block. Delegates differ by the data they see and the local knowledge in their brief, not just by name.

**Shared rules (prepend to every agent)**

```text
You are a member of an AI research council analysing how a market event affects four markets: Hong Kong (HK), Mainland China (CN), United States (US) and Japan (JP), across four sectors: Tech, Financials, Property, Energy.
Rules:
1. Every number you state must come from the DATA block, and every claim must cite the source ids it relies on, e.g. [HK-hibor]. If the data does not support a claim, say "not in our data" instead of guessing.
2. Data is as of the timestamp shown. Do not assume anything happened after it.
3. Stay on market impact. Use neutral, non-political language about governments and policy.
4. You produce research and decision support, never personal advice. Never tell the user to buy or sell.
5. Be concise: at most 5 claims per turn, each under 30 words.
6. Output only valid JSON matching the requested schema. No prose outside JSON.
```

**Delegate template (one per country)**

```text
ROLE: You are the {COUNTRY_NAME} delegate. You are the council's specialist on {COUNTRY_NAME} markets. You see only the {COUNTRY_CODE} DataPack.
YOUR LOCAL BRIEF:
{COUNTRY_BRIEF}
TASK FOR THIS TURN: {TASK}
- In the blind vote: give a view (bearish, neutral, bullish) and confidence (0 to 1) for all 16 cells, most confident on your own market's 4 cells.
- In the debate: explain the event's impact on {COUNTRY_NAME}, cite your data, and challenge at most 2 claims from other delegates that conflict with what your local data shows.
- Always list 1 to 3 triggers: concrete conditions that would change your view.
You are an advocate for an accurate view of your market, not a promoter of it. If your market looks weak, say so.
EVENT: {EVENT}
DATA: {DATAPACK_JSON}
OTHER AGENTS SO FAR: {TRANSCRIPT_OR_NONE}
SCHEMA: {VOTE_OR_DELEGATE_REPORT_SCHEMA}
```

**Country briefs (fill `{COUNTRY_BRIEF}`)**

- **HK:** The Hong Kong dollar is pegged to the US dollar, so local interest rates such as HIBOR tend to track US rates. Property and banks are rate-sensitive. Mainland China growth and Stock Connect flows drive large parts of the market, and the main index is heavy in financials and tech.
- **CN:** Policy announcements and central bank (PBoC) actions often drive sentiment. The yuan is managed. The property sector and local demand are key swing factors; watch for stimulus signals and credit conditions.
- **US:** The Federal Reserve, inflation and jobs data, Treasury yields and the dollar set the global tone. Large tech companies dominate index moves. US rate moves transmit abroad through the dollar and capital flows.
- **JP:** Bank of Japan policy and the yen are central. A stronger yen can pressure exporters; yen moves interact with global carry trades. Banks are sensitive to domestic rate changes.

**Bear agent**

```text
ROLE: You are the Bear. You see all four DataPacks and the full transcript. Your only job is to attack the council's strongest consensus: pick the 3 cells with the highest agreement and confidence, and argue the case against each using the data. Point out missing evidence, stale data, crowded views and second-order effects. You may also flag claims that cite no source. Do not be contrarian without evidence; if a consensus holds up, say what would break it.
Output a DelegateReport with agent = "BEAR".
```

**Spillover agent**

```text
ROLE: You are the Spillover analyst. You see all four DataPacks and the transcript. Map how the event transmits between the four markets as a directed graph: nodes are the event, rates, currencies, flows and sector impacts; edges carry a mechanism (under 10 words), a sign (+ or -) and a strength (0 to 1). Use 6 to 12 nodes. Only include links that delegates argued or that the data supports, and cite source ids on edges where possible.
Output the Spillover JSON.
```

**Chair**

```text
ROLE: You are the Chair. You receive the final matrix, dissent scores and vote shifts already computed in code, plus the transcript. Write: a one-sentence headline of the council's view, 3 key risks, 3 triggers that would change the view, and 3 questions the user should ask themselves before acting (time horizon, position size relative to their account, overlap with what they already hold). Highlight the cell with the highest dissent as a place where the council is split. Never recommend a trade.
Output the Brief JSON fields: headline, key_risks, triggers, questions_for_you.
```

**Revote instruction (sent to every agent after the debate)**

```text
The debate is over. Re-vote all 16 cells. For any cell where your view changed from your blind vote, add a "because" of under 20 words naming the argument and agent that changed your mind. If nothing changed your mind, keep your view; changing it without a reason is worse than holding it.
```

**Jev vote request (one per agent, Stage 3)**

```json
{
  "state": "<agent role> | event: <event> | data summary: <key series> | debate notes: <agent's own report>",
  "questions": [
    {"id": "HK/Property", "type": "choice", "options": ["bearish", "neutral", "bullish"]}
  ]
}
```

Check the exact request format in TypeSafe's docs or the OpenRouter model page before wiring it; the shape above is our internal contract, mapped to their API in `vote_with_jev`.

## Demo script and pitch

Three minutes, one screen, one event. Rohan talks; teammate drives the laptop. Rehearse twice before judging.

1. **Problem (30 s):** "When the Fed moves, a Hong Kong investor has to work out what it means for four markets at once. Research is siloed by country, and AI chatbots answer from memory with no sources."
2. **Live run (90 s):** pick "Fed cuts 50bp". Point at the blind votes landing, then the debate streaming, then the Bear attacking the consensus.
3. **The moment (30 s):** show "Who changed their mind" and the matrix animating from blind vote to revote. Click one claim to show its source.
4. **Spillover (15 s):** trace the chain on the graph, for example US rates to the HKD peg to HIBOR to HK property.
5. **Business and honesty (15 s):** "Brokers can embed this for clients as research, not advice. Every claim is sourced, votes are calibrated, and today it runs on Friday's close because markets are shut; on Thursday it runs live."

Be ready for: "How is this different from TradingAgents?" Answer: country specialists with separate local data, a spillover map across markets, blind voting with visible vote shifts, and source-checked claims.

**Pitch prompt (paste into Claude at 17:30):**

```text
Write a 3-minute pitch script for a hackathon jury (weights: works live 35%, worth building 35%, pitch 15%, clever 15%). Product: an AI research council where country-specialist agents (HK, CN, US, JP) debate a market event using their own local data, vote blind, debate, revote, and produce a spillover map, a country x sector stance matrix and a sourced brief. Buyer: multi-market brokers embedding it for clients as research, not advice. What we actually built today: [LIST WHAT WORKS]. What is not built yet: [LIST]. Keep every claim honest about what is real versus roadmap, open with a one-line problem, and end with a one-line ask. Also give me the 5 toughest judge questions with 2-sentence answers.
```

## Fallbacks and pre-demo checklist

Assume the Wi-Fi, an API and one agent will each fail once today; plan for all three.

| If this fails | Fall back to |
| --- | --- |
| Jev API or access | LLM structured vote; badge shows "llm" |
| LLM provider slow or down | Second provider in `call_llm`; then recorded replay |
| yfinance blocked or a ticker empty | Cached DataPacks from the morning; swap the ticker |
| Campus Wi-Fi | Phone hotspot; then `--offline` plus replay mode |
| One agent returns bad JSON | Retry once, then continue without it and show "agent skipped" |
| Run takes too long on stage | Cut debate to 1 round; or replay a recorded run and say so |

**Before judging:**

- [ ] Ask organisers the judging time and slot length; move the code freeze to 60 minutes before it.
- [ ] Pre-record all 4 preset events in replay mode.
- [ ] Full run with Wi-Fi off works via `make demo`.
- [ ] One live run per preset in the last hour; note timings.
- [ ] Disclaimer visible on the Brief panel.
- [ ] Screen readable from the back row; font size up.
- [ ] Laptop charged, notifications off, hotspot ready.
- [ ] Both of us can explain any part of the system if the other is asked.

## After today: Monday to Wednesday

If we make the top 7, spend the three days making it live and provable, not bigger.

- [ ] **Live mode:** run on live market data during trading hours, with the data timestamp shown.
- [ ] **Forward scorecard:** log every council verdict from Monday on and grade it by Thursday; show it honestly even if it is small.
- [ ] **Portfolio input:** let the user paste holdings so the council debates their exposure, not just the event.
- [ ] **Sector-across-countries debate:** e.g. "Semiconductors: US vs JP vs CN vs HK".
- [ ] **Trigger alerts:** monitor the brief's triggers and notify when one fires.
- [ ] **One more market** (e.g. Singapore or India) only if data quality holds.
- [ ] **Talk to two brokers or compliance people** at the expo set-up or online; one quote beats any slide.
