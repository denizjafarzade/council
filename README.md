# Verdisk

Verdisk: an AI research council. Pick a market event, watch four country delegates (HK, CN, US, JP) debate it live, and get a spillover map plus a country × sector stance matrix.

**Demo flow:** event in → blind votes → debate → revote → spillover map + matrix + brief.

> Research and decision support only. Not investment advice.

## Layout

```
backend/
  app.py              # FastAPI: POST /council/run, GET /council/stream/{run_id}
  llm.py              # call_llm: OpenRouter (model per agent), Anthropic or Bedrock
  models.py           # model per agent per profile (premium / cheap / free)
  orchestrator.py     # stages: data -> blind vote -> debate -> revote -> spillover -> brief
  council_math.py     # Chair maths in Python: matrix, dissent, vote shifts
  schemas.py          # pydantic models mirroring the five shared contracts
  agents/prompts/     # one .md per agent (+ _shared.md rules, _revote.md)
  data/fetch.py       # builds DataPacks, writes data/cache/*.json
  tests/              # mock run validates against the contracts
frontend/             # Vite + React + Tailwind: EventPicker, DebateStream, Matrix, SpilloverGraph, Brief
mocks/
  council_run.json    # a full fake run (43 SSE events) so the UI can be built before the engine works
  datapacks/*.json    # fake DataPacks the mock run cites
  generate_mock.py    # regenerates both
```

## Run it

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r backend/requirements.txt   # macOS/Linux: .venv/bin/python
cd frontend && npm install
```

| What | Command (Makefile) | Plain command |
|---|---|---|
| Backend on :8000 | `make backend` | `cd backend && ../.venv/Scripts/python -m uvicorn app:app --reload --port 8000` |
| Frontend on :5173 | `make frontend` | `cd frontend && npm run dev` |
| Check API keys | `make keys` | `.venv/Scripts/python backend/check_keys.py` |
| Tests | `make test` | `.venv/Scripts/python -m pytest backend/tests -q` |
| Regenerate mocks | `make mocks` | `.venv/Scripts/python mocks/generate_mock.py` |
| Fetch real data into the cache | | `.venv/Scripts/python backend/data/fetch.py` |
| Validate the cache, no network | | `.venv/Scripts/python backend/data/fetch.py --offline` |
| Verify tickers | | `.venv/Scripts/python backend/data/fetch.py --check` |

Copy `.env.example` to `.env` and add the OpenRouter key. The Vite dev server proxies `/council` to the backend.

**Stage 0 behaviour:** `/council/stream/{run_id}` replays `mocks/council_run.json` with a 300 ms delay, so the UI can point at the real endpoint from the start. Stage 1A swaps in real agents behind the same stream.

## Real news and your trades

The council discusses **real, current headlines** and relates them to **your own trading history**.

- `GET /news/top?markets=HK,CN` lists cached headlines, newest first, with market, source and publish time. `POST /news/refresh` re-runs only `fetch_news` for those markets, updates the cache and stamps `news_fetched_at`. It is never called during a run, and is refused in offline mode.
- `POST /council/run` takes an optional `news_id` (e.g. `HK-n5`). The event becomes the headline with its source and publish time, and every seat may cite it as `[EVENT]`.
- `POST /portfolio` takes a CSV (`date,ticker,side,qty,price`; `#` lines are comments). `backend/portfolio.py` makes no model calls. It computes holdings at average cost, exposure by market and sector (costs converted to USD at the cached FX rates), the largest position and realised results per market. Tickers map only through the tickers we already fetch; anything else is listed as "not covered", never guessed.
- **Privacy:** uploads stay in memory only (never written to disk, and `uploads/` is gitignored, because this repo is public). Only aggregated percentages reach the model (the Chair) and recordings, never trades or tickers.
- `samples/sample_portfolio_FICTIONAL.csv` is a clearly labelled, made-up portfolio for the demo. `POST /portfolio/sample` loads it.
- Market seats vote only on their own market's four sectors; cross-market seats vote on all. Debate defaults to 1 round.
- The UI's **What this means for you** cards (one per market, sorted by your exposure) are worded in code from the portfolio, the index moves and each market seat's own report, plus the Chair's questions about your largest exposures.

```bash
python scripts/record_presets.py --news US-n4 HK-n1 --portfolio samples/sample_portfolio_FICTIONAL.csv
```

## Accurate data, configurable scope, trust and risk

**Data is real and dated, never generated.**
- Live runs never read `mocks/datapacks` (made-up numbers). A market with no cache is fetched for real; if that fails the run says so and that market's members argue from their brief only.
- Before a live run, any market whose cache predates its latest weekday close is refreshed (prices and rates, in parallel, 30 s timeout). Headlines are kept so the chosen headline keeps its id. A market checked in the last 6 hours isn't refetched, so holidays don't cause repeated fetches. Offline mode never fetches.
- If the index fetch fails, `as_of` is `"unknown"`, never "now". HK carries the HKMA 1M HIBOR and base rate; FRED supplies the Fed funds rate and the JGB 10Y (monthly, dated).
- Every run emits a `data` event with the exact DataPacks it used, so recordings resolve every cited id to what the members saw, even after the cache is refreshed. Older recordings were backfilled from the cache committed with them.

**Scope is configurable.**
- 14 markets in the library, and custom markets can be added from the builder (data is fetched automatically).
- 11 sectors in `backend/agents/sectors.json` (the GICS set), each with a verified proxy ticker in HK, CN, US and JP. Custom sectors are added from the builder or `POST /library/sectors` (a name plus optional proxies), with no code changes. Each council picks its sectors (default: the original four). A sector without a proxy in some market is judged there from the index and headlines; the seat's prompt says so and asks for lower confidence.

**Defences against made-up claims.**
- Every claim is checked: cited ids must exist in that member's data (sector tickers count), and numbers must match the cited values.
- **Quarantine:** claims that fail are marked `UNVERIFIED ... Do not rely on it` in the transcript every later turn sees (debate, revote, Chair), so a made-up number cannot spread.
- **Evidence-weighted matrix:** each seat's votes count `0.25 + 0.75 x` its share of verified claims. The weights ship in `brief.evidence_weights` and are shown on screen.
- **Jev:** a failed Jev vote is retried once; only then does the LLM vote, and that vote carries `fallback: "Jev unavailable (...)"`, shown in the UI.

**Quantitative risk score** (`backend/risk.py`, code only, 0-100): per market, volatility 30%, 1-month drawdown 20%, council view 30%, disagreement 10%, unverified claims 10%. Missing inputs are left out and the weights renormalised, never guessed. The portfolio score is the exposure-weighted market scores plus up to 10 points for concentration. Every component is shown on screen.

**Result first.** The session screen opens with the Chair's headline, the portfolio risk score, the key risks and one card per market (with its risk score). The debate, matrix and spillover sit below under "How the council got here", and debate messages are folded to one line each.

## Demo safety (Stage 4)

```bash
python scripts/record_presets.py   # record the 4 presets into runs/ (real LLM calls; ~$0.45 each on premium)
python scripts/demo.py             # backend OFFLINE + frontend, opens the browser; works with Wi-Fi off
python scripts/demo.py --live      # same, but runs call the LLMs
```

(`make record` and `make demo` do the same.)

- Every complete live run is saved to `runs/{event_slug}.json` with event timings, so the latest good run is always on disk. Incomplete runs never overwrite a recording.
- `GET /council/replay/{slug}?speed=1` streams a recording at real speed (pauses capped at 12 s); `GET /council/recordings` lists them.
- `COUNCIL_OFFLINE=1`: `POST /council/run` for a recorded event serves its recording; any other event gets a clear error. Data loading never fetches.
- The UI marks recorded presets with ●, has **▶ Replay recorded** with 1×/2×/4× speed (2× fits the 90-second slot), and labels the screen "Replay of recorded run". Recordings are also bundled into the frontend, so a replay still plays if the backend is down.

## Frontend

One dark screen sized for a projector. **Replay mock** plays `mocks/council_run.json` with no backend; **Convene council** POSTs `/council/run` and streams `/council/stream/{run_id}` over `EventSource`.

- `src/lib/council.js`: one reducer for every SSE event (mock, live or recorded), plus the Chair maths mirrored from `council_math.py`
- `src/hooks/useCouncil.js`: mock replay, live stream, error toasts; the stream closes on `end` instead of auto-reconnecting
- `src/lib/sources.js`: resolves cited ids (`HK-hibor`, `US-n3`) from `backend/data/cache` (live) or `mocks/datapacks` (mock)
- Panels: stage bar, `DebateStream`, `Matrix` (blind vs final, opacity = confidence, ↻ = changed, "split" = dissent ≥ 0.5), `SpilloverGraph` (numbered edges plus a mechanism list, ⤢ Expand for full screen), `Brief`, `WhoChanged`
- Trust UI (3B): hover a source chip for the value or headline (news chips link out), ⚠ unverified when a cited id is missing or the backend flags it, "votes by Jev" when `vote.source == "jev"`

## LLMs (OpenRouter)

Every LLM call goes through `call_llm(system, user, schema, agent=...)` in [`backend/llm.py`](backend/llm.py). With `LLM_PROVIDER=openrouter` it asks for JSON-schema output, falls through to backup models on API errors within the timeout, and logs tokens and USD cost per agent. Invalid JSON raises `LLMOutputError`, and the orchestrator retries once.

Each delegate runs on a model from a different lab, so mistakes are less correlated (see [`backend/models.py`](backend/models.py)). Switch profiles with `COUNCIL_PROFILE`:

| Agent | premium (demo) | cheap (dev) |
|---|---|---|
| CHAIR | Claude Opus 5.5 | Claude Sonnet 5.5 |
| HK | Claude Sonnet 5.5 | Gemini 3.8 Flash |
| CN | GPT-6.1 Sol | DeepSeek V4.1 Flash |
| US | Gemini Pro (latest) | GPT-6 Luna |
| JP | Grok 4.7 | Qwen 3.8 Flash |
| BEAR | Qwen 3.8 Max | GLM 5.3 Flash |
| SPILLOVER | GPT-6.1 Sol Pro | GPT-6 Luna Pro |

`free` uses free Qwen/Nemotron models (50 requests/day on a $0 balance). Stage 3 votes use `typesafe/jev-router` (Jev). Smoke test: `cd backend && ../.venv/Scripts/python smoke_llm.py HK`.

## Contracts

The five JSON contracts live in [`backend/schemas.py`](backend/schemas.py). Don't change a field without telling the other track.

SSE events: `stage` {name, status}, `vote` (Contract 2), `message` {agent, text, source_ids}, `report` (Contract 3), `spillover` (Contract 4), `brief` (Contract 5), `error` {message, agent?}, then a final `end`.

Two optional fields added on top of the build guide's contracts:
- `Vote.source`: `"jev"` or `"llm"`, for the Stage 3 Jev badge.
- `VoteCell.because`: revote only, the reason a view changed. The Chair builds `vote_shifts` from it.

Agent ids: `CHAIR`, `HK`, `CN`, `US`, `JP`, `BEAR`, `SPILLOVER`. Stage names: `data`, `blind_vote`, `debate`, `revote`, `spillover`, `brief`.

## Data notes

- Tickers (one per cell) are in `backend/data/fetch.py`. All 25 verified on 4 Oct with Friday 2 Oct closes.
- CN index is the Shanghai Composite (`000001.SS`): CSI 300 has only 1 day of history on yfinance.
- Mainland markets are closed for Golden Week (1 to 7 Oct), so CN data is as of 30 Sep.
- `backend/data/cache/*.json` is committed: real Friday-close DataPacks, so the engine runs without fetching.
- Rates: US 10Y from yfinance; Fed funds (DFF) and JGB 10Y (monthly) from FRED; 1M HIBOR from the HKMA API.
- The HKMA API was down (502) on 4 Oct, so HK has no `macro` yet. Gaps are filled from `backend/data/macro_manual.json` (hand-entered, with date and source), then from the previous cache. Values are never invented.
- News: 8 newest unique headlines per country from Google News RSS over the last 7 days, using market-focused queries (see `NEWS_QUERY`).
