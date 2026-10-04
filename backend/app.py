"""FastAPI: the council run (POST /council/run, GET /council/stream/{run_id} as Server-Sent Events),
plus the role and market library and saved councils that the council builder edits."""

import asyncio
import json
import logging
import uuid
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

import library
import orchestrator
from library import CouncilError
from models import all_models, profile
from orchestrator import run_council
from schemas import SECTORS, Council, DataPack, MarketDef, RoleDef, RunRequest, RunResponse

# Per-agent token usage and skipped agents show up in the uvicorn console.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

app = FastAPI(title="AI Trading Council")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# In-memory only: no database by design.
RUNS: dict[str, RunRequest] = {}


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/council/run", response_model=RunResponse)
def start_run(req: RunRequest) -> RunResponse:
    try:
        library.resolve(orchestrator.council_for(req))
    except KeyError:
        raise HTTPException(404, f"unknown council {req.council_id}")
    except CouncilError as e:
        raise HTTPException(422, str(e))
    run_id = uuid.uuid4().hex[:12]
    RUNS[run_id] = req
    return RunResponse(run_id=run_id)


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def _stream(req: RunRequest) -> AsyncIterator[str]:
    async for event, data in run_council(req):
        yield sse(event, data)
    yield sse("end", {})


@app.get("/council/stream/{run_id}")
async def stream(run_id: str) -> StreamingResponse:
    req = RUNS.get(run_id)
    if req is None:
        raise HTTPException(404, f"unknown run_id {run_id}")
    return StreamingResponse(
        _stream(req),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# --- library: roles and markets --------------------------------------------------------

def _data_status(code: str) -> dict:
    """What data a market has on disk right now (never touches the network)."""
    for folder, source in ((orchestrator.CACHE_DIR, "cache"), (orchestrator.MOCK_PACKS, "mock")):
        path = folder / f"{code}.json"
        if path.exists():
            pack = DataPack.model_validate_json(path.read_text(encoding="utf-8"))
            return {"source": source, "as_of": pack.as_of, "series": len(pack.series),
                    "sectors": len(pack.sectors), "news": len(pack.news)}
    return {"source": None}


@app.get("/library")
def get_library() -> dict:
    return {
        "markets": [{**m.model_dump(), "data": _data_status(m.code)} for m in library.markets().values()],
        "roles": [r.model_dump() for r in library.roles().values()],
        "sectors": SECTORS,
        "models": all_models(),
        "profile": profile(),
    }


@app.post("/library/roles", status_code=201)
def add_role(role: RoleDef) -> RoleDef:
    try:
        return library.save_role(role)
    except CouncilError as e:
        raise HTTPException(422, str(e))


@app.delete("/library/roles/{role_id}", status_code=204)
def remove_role(role_id: str) -> Response:
    try:
        library.delete_role(role_id)
    except KeyError:
        raise HTTPException(404, f"no custom role {role_id}")
    return Response(status_code=204)


@app.post("/library/markets", status_code=201)
async def add_market(market: MarketDef) -> dict:
    """Save a custom market, then try to fetch its data (index, FX, news) so it is ready to run."""
    try:
        market = library.save_market(market)
    except CouncilError as e:
        raise HTTPException(422, str(e))
    error = None
    try:
        await asyncio.wait_for(asyncio.to_thread(orchestrator._fetch_pack, market.code), orchestrator.FETCH_TIMEOUT_S)
    except Exception as e:  # noqa: BLE001 - saved anyway; the run retries the fetch
        error = str(e)[:200]
    return {**market.model_dump(), "data": _data_status(market.code), "fetch_error": error}


@app.delete("/library/markets/{code}", status_code=204)
def remove_market(code: str) -> Response:
    try:
        library.delete_market(code)
    except KeyError:
        raise HTTPException(404, f"no custom market {code}")
    return Response(status_code=204)


# --- saved councils --------------------------------------------------------------------------

@app.get("/councils")
def get_councils() -> list[Council]:
    return [library.default_council(), *library.list_councils()]


@app.get("/councils/{council_id}")
def get_council(council_id: str) -> Council:
    if council_id == "default":
        return library.default_council()
    try:
        return library.get_council(council_id)
    except KeyError:
        raise HTTPException(404, f"unknown council {council_id}")


@app.put("/councils")
def put_council(council: Council) -> Council:
    if council.id == "default":
        council = council.model_copy(update={"id": None})
    try:
        return library.save_council(council)
    except CouncilError as e:
        raise HTTPException(422, str(e))


@app.delete("/councils/{council_id}", status_code=204)
def remove_council(council_id: str) -> Response:
    try:
        library.delete_council(council_id)
    except KeyError:
        raise HTTPException(404, f"unknown council {council_id}")
    return Response(status_code=204)
