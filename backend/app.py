"""FastAPI: POST /council/run, GET /council/stream/{run_id} (Server-Sent Events)."""

import json
import uuid
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from orchestrator import run_council
from schemas import RunRequest, RunResponse

app = FastAPI(title="AI Trading Council")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# In-memory only: no database by design.
RUNS: dict[str, RunRequest] = {}


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/council/run", response_model=RunResponse)
def start_run(req: RunRequest) -> RunResponse:
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
