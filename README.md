# council

AI Trading Council: pick a market event, watch four country delegates (HK, CN, US, JP) debate it live, and get a spillover map plus a country × sector stance matrix.

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
