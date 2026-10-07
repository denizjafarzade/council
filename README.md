# Verdisk

**A council of AI analysts that debates market news before it reaches your portfolio.**

Pick a headline. A council you configure (market delegates, a Bull, a Bear, a Risk Officer, a Spillover Analyst and a Chair) votes in secret, debates on the record, votes again, maps how the shock spreads between markets, and delivers a ruling: a stance matrix, a 0–100 risk score, and a plain-English reading of what it means for your own holdings.

> Research and decision support only. Not investment advice. Verdisk never says buy, sell or hold.

---

## How a sitting works

The session follows a parliamentary order of proceedings.

| | Stage | What happens |
|---|---|---|
| I | **Evidence** | Real, dated market data (indices, sector proxies, rates, FX, headlines) is loaded for every seated market. |
| II | **Secret ballot** | Each member votes bearish / neutral / bullish with a confidence on every market × sector cell, without seeing anyone else's vote. Votes come from **TypeSafe Jev** as calibrated probabilities, with an LLM fallback. |
| III | **Debate** | Members argue on the record, citing evidence by id. Bull and Bear challenge the strongest consensus cells. Every claim is checked against the data. |
| IV | **Second ballot** | Members vote again and give a reason for every change of position. |
| V | **Spillover inquiry** | The Spillover Analyst maps how the shock travels between markets. |
| VI | **Ruling** | The Chair writes the brief; code computes the matrix, dissent, vote shifts and risk scores. |

Market members vote only on their own market; cross-market members vote on all of them.

## What makes it trustworthy

- **Real data, never generated.** Live runs read cached or freshly fetched market data (yfinance, FRED, HKMA, Google News RSS), each value dated. Missing data is reported as missing, never filled in.
- **Every claim is checked.** Cited ids must exist in that member's data, and numbers must match the cited values. Failed claims are **quarantined**: marked `UNVERIFIED` in every later turn, so a made-up number can't spread. In the minutes they show as *Objection sustained: … is not in evidence*.
- **Evidence-weighted votes.** Each seat's votes count `0.25 + 0.75 ×` its share of verified claims.
- **Calibrated confidence.** Jev returns a probability per view, so confidence is measured, not a number the model wrote. A failed Jev call is retried once before the LLM votes, and the fallback is labelled in the UI.
- **Different labs per seat.** Delegates run on models from different providers so their mistakes are less correlated.
- **Compliance guardrail.** An optional Amazon Bedrock Guardrail screens every message and brief line for personalised investment advice and political commentary. Struck passages are recorded by the Clerk. It can be switched off per run.
- **Quantitative risk score** (`backend/risk.py`, code only, 0–100). Per market: council view 35%, volatility 25%, 1-month drawdown 20%, disagreement 10%, unverified claims 10%. Missing inputs are dropped and the weights renormalised. The portfolio score is exposure-weighted plus up to 10 points for concentration. Labels: low < 30, moderate < 55, high otherwise.

## The app

**Seat the council** (builder, three steps):
1. **Markets:** choose markets on a world map (14 in the library, custom markets can be added and are fetched automatically), choose sectors (11 GICS sectors plus custom ones), and optionally upload your trading history as CSV.
2. **Roles:** choose which roles sit for each market and across markets, or add custom members with their own brief and model.
3. **Review & convene:** the council drawn as an amphitheatre (the Chair on the stage, cross-market members in the front row, one wedge per market delegation). Pick a live headline or type an event, choose 1 or 2 debate rounds, toggle the guardrail, save the council, and convene.

**The session** (Westminster chamber theme):
- **Order of proceedings** I–VI, live.
- **Key numbers:** risk to the matter, the two riskiest markets, and how much of your money this council covers.
- **Ruling of the Council:** *Plain reading* (bottom line, risk, one card per market, in plain words) or *Full record* (the Chair's exact text with sources, risk components, evidence weights, data provenance, stance matrix and spillover map).
- **The chamber:** every member in the amphitheatre, coloured by how they voted on the selected market, with a brass ring for anyone who changed position.
- **Minutes of the debate:** a two-sided conversation. Members leaning fall speak from the left, members leaning rise from the right; challenges quote the speech they answer; "Hear, hear" marks a member backing the previous speaker with the same evidence; divisions, Clerk notes and floor-crossings sit in the middle.

**Your portfolio.** Upload `date,ticker,side,qty,price` CSV. `backend/portfolio.py` computes holdings, exposure by market and sector (USD at cached FX rates) and the largest position with no model calls. Uploads stay in memory only; only aggregated percentages reach the Chair and the recordings. Two clearly fictional samples are in `samples/`.

---

## Quick start

Requires Python 3 (developed on 3.14) and Node 20.19 or newer.

```bash
make install            # or: python -m venv .venv && .venv/Scripts/python -m pip install -r backend/requirements.txt && (cd frontend && npm install)
cp .env.example .env    # add OPENROUTER_API_KEY (and optionally TYPESAFE_API_KEY, AWS keys for the guardrail)
make keys               # check every configured key works
make backend            # FastAPI on :8000
make frontend           # Vite on :5173 (proxies the API to :8000)
```

On macOS/Linux use `.venv/bin/python` in place of `.venv/Scripts/python`.

### Demo without the internet

```bash
make demo               # backend in offline mode + frontend, opens the browser; Wi-Fi can be off
make record             # (before the demo) record preset events into runs/ with real LLM calls
```

Every complete live run is saved to `runs/{event-slug}.json`. Offline mode serves recorded events and never touches the network. Recordings are also bundled into the frontend, so **Replay recorded** (1×/2×/4×) works even with the backend down. **Replay mock** plays `mocks/council_run.json` with no backend at all.

### Commands

| What | Command |
|---|---|
| Install everything | `make install` |
| Backend / frontend | `make backend` / `make frontend` |
| Offline demo / record presets | `make demo` / `make record` |
| Tests (90) | `make test` |
| Frontend lint (oxlint) | `make lint` |
| Check API keys | `make keys` |
| Create the Bedrock guardrail | `make guardrail` |
| Regenerate mocks | `make mocks` |
| Fetch real data into the cache | `.venv/Scripts/python backend/data/fetch.py` (`--offline` validates, `--check` verifies tickers) |
| Re-score recordings after a risk change | `.venv/Scripts/python scripts/rescore_recordings.py` |

## Configuration

All settings live in `.env` (see `.env.example`).

| Variable | Purpose |
|---|---|
| `LLM_PROVIDER` | `openrouter` (default in the example), `anthropic` or `bedrock` |
| `OPENROUTER_API_KEY` | Agent calls through OpenRouter |
| `COUNCIL_PROFILE` | `premium` (demo, about $1 a run), `cheap` (development, a few cents), `free` (50 requests/day) |
| `MODEL_<AGENT>` | Override one seat's model, e.g. `MODEL_BEAR=anthropic/claude-opus-5.5` |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CLAUDE_EFFORT` | Direct Anthropic provider |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `BEDROCK_MODEL_ID` | Bedrock provider and guardrail |
| `LLM_TIMEOUT_S` | Seconds per LLM call, shared with backup models |
| `TYPESAFE_API_KEY` | Jev votes; empty or `JEV=0` uses LLM votes |
| `GUARDRAIL_ID`, `GUARDRAIL_VERSION` | Bedrock guardrail; `GUARDRAIL=0` turns it off globally |
| `COUNCIL_OFFLINE` | `1` serves recordings only, no network |
| `COUNCIL_MOCK` | `1` makes the stream replay the mock run, no keys needed |

`.env` wins over variables already set in the shell, so a stale key in your environment can't shadow it.

---

## Architecture

```
backend/                 FastAPI + asyncio
  app.py                 HTTP API and the SSE stream
  orchestrator.py        the six stages; market seats vote on their own market, debate rounds per council
  llm.py                 call_llm(system, user, schema, agent=...): OpenRouter, Anthropic or Bedrock, JSON-schema output
  models.py              model per seat per profile, with fallbacks
  jev.py                 TypeSafe Jev calibrated votes
  verify.py              citation and number checks, quarantine
  council_math.py        stance matrix, dissent, vote shifts
  risk.py                0–100 risk scores
  guardrail.py           Bedrock ApplyGuardrail, throttled with retries
  portfolio.py           CSV trades to exposure, no model calls
  news.py                headline cache and refresh
  library.py             markets, sectors, roles and saved councils
  recorder.py            saves complete runs to runs/
  schemas.py             Pydantic contracts for every event
  agents/                roles.json, markets.json, sectors.json and the shared prompts
  data/                  fetch.py, cached DataPacks, hand-entered macro gaps, saved councils
  tests/                 90 tests: contracts, orchestrator, trust, risk, recorder, guardrail, portfolio
frontend/                React 19 + Vite + Tailwind v4
  src/App.jsx            the session screen
  src/builder/           the three-step council builder
  src/components/        Amphitheatre, ChamberPanel, DebateStream, MeaningCards, KeyNumbers, Scientific,
                         Matrix, SpilloverGraph, EventPicker (and the order of proceedings), NewsPicker, ...
  src/lib/council.js     one reducer for every SSE event (live, recorded or mock) + the Chair maths
  src/hooks/useCouncil.js  live stream, recorded and mock replay
mocks/                   a full fake run and fake DataPacks (never used by live runs)
runs/                    recorded runs for replay and the offline demo
samples/                 fictional portfolios for the demo
scripts/                 demo, recording, guardrail setup, re-scoring
```

### API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/council/run` | Start a run: event or `news_id`, council, guardrail flag. Returns a `run_id`. |
| `GET` | `/council/stream/{run_id}` | Server-sent events for that run |
| `GET` | `/council/recordings`, `/council/replay/{slug}?speed=1` | List and replay recordings |
| `GET` / `POST` | `/news/top?markets=HK,CN`, `/news/refresh` | Cached headlines; refresh (refused offline) |
| `GET` / `POST` / `DELETE` | `/portfolio`, `/portfolio/sample` | Upload, load the sample, clear |
| `GET` | `/library` | Markets, sectors and roles |
| `POST` / `DELETE` | `/library/markets`, `/library/sectors`, `/library/roles` | Add or remove custom entries |
| `GET` / `PUT` / `DELETE` | `/councils`, `/councils/{id}` | Saved councils |
| `GET` | `/health` | Liveness |

### Event stream

Every stage is wrapped in `stage` {name, status} events. During `data` the stream sends `council` (markets and seats), `data` (the exact DataPacks used) and `portfolio` (exposure percentages, if trades were loaded); the later stages send `vote`, `message` {agent, text, source_ids, unverified, guardrail?}, `report`, `spillover` and `brief`, plus `error` {message, agent?} at any point, and a final `end`. The contracts are in [`backend/schemas.py`](backend/schemas.py); the frontend reducer in [`frontend/src/lib/council.js`](frontend/src/lib/council.js) handles every one of them the same way whether the run is live, recorded or mocked.

Stage names: `data`, `blind_vote`, `debate`, `revote`, `spillover`, `brief`.

### Models

Each delegate in the default council runs on a different lab's model (see [`backend/models.py`](backend/models.py)); a custom member uses the model picked for it in the builder, otherwise the model of the seat it is modelled on.

| Seat | premium | cheap |
|---|---|---|
| Chair | Claude Opus 5.5 | Claude Sonnet 5.5 |
| Hong Kong | Claude Sonnet 5.5 | Gemini 3.8 Flash |
| Mainland China | GPT-6.1 Sol | DeepSeek V4.1 Flash |
| United States | Gemini Pro (latest) | GPT-6 Luna |
| Japan | Grok 4.7 | Qwen 3.8 Flash |
| Bear | Qwen 3.8 Max | GLM 5.3 Flash |
| Spillover | GPT-6.1 Sol Pro | GPT-6 Luna Pro |

## Data notes

- Each market has an index, one proxy ticker per sector where one exists, rates and FX. A sector without a proxy in a market is judged from the index and headlines, and the member is told to lower its confidence.
- Before a live run, any market whose cache predates its latest weekday close is refreshed (30 s timeout); a market checked in the last 6 hours isn't refetched.
- HK carries the HKMA 1M HIBOR and base rate; FRED supplies the Fed funds rate and the JGB 10Y. Gaps are filled only from `backend/data/macro_manual.json` (hand-entered, dated, sourced) or the previous cache.
- The mainland index is the Shanghai Composite (`000001.SS`), because CSI 300 has too little history on yfinance.
- News: the 8 newest unique headlines per market from Google News RSS over the last 7 days.
- `backend/data/cache/*.json` is committed so the engine runs without fetching.

---

Built for the iFX Hackathon.
