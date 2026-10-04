import { useCallback, useEffect, useReducer, useRef } from 'react'
import mockRun from '../../../mocks/council_run.json'
import { councilReducer, initialState } from '../lib/council'

const SSE_EVENTS = ['council', 'portfolio', 'replay', 'stage', 'vote', 'message', 'report', 'spillover', 'brief', 'error']
const MOCK_DELAY_MS = 300
// Recorded runs ship with the frontend too (loaded on demand), so a replay works even if the backend is down.
const LOCAL_RUNS = Object.fromEntries(
  Object.entries(import.meta.glob('../../../runs/*.json', { import: 'default' })).map(([path, load]) => [
    path.split('/').pop().replace(/\.json$/, ''),
    load,
  ]),
)
const MAX_GAP_S = 12 // same cap as backend/recorder.py

export function useCouncil() {
  const [state, dispatch] = useReducer(councilReducer, initialState)
  const timers = useRef([])
  const source = useRef(null)

  const stop = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    source.current?.close()
    source.current = null
  }, [])

  useEffect(() => stop, [stop])

  /** Wire an EventSource into the reducer. onLost(gotAny) runs if it drops before "end". */
  const listen = useCallback((es, onLost) => {
    source.current = es
    let gotAny = false
    for (const name of SSE_EVENTS) {
      es.addEventListener(name, (msg) => {
        gotAny = true
        try {
          dispatch({ type: 'sse', event: name, data: JSON.parse(msg.data) })
        } catch {
          dispatch({ type: 'toast', text: `Could not read a "${name}" event` })
        }
      })
    }
    es.addEventListener('end', () => {
      es.close()
      source.current = null
      dispatch({ type: 'status', status: 'done' })
    })
    // EventSource reconnects by default, which would restart the run; stop instead.
    es.onerror = () => {
      if (source.current !== es) return
      es.close()
      source.current = null
      onLost(gotAny)
    }
  }, [])

  /** Replay mocks/council_run.json, one event every 300 ms. */
  const replayMock = useCallback(
    (event = 'Fed cuts 50bp') => {
      stop()
      dispatch({ type: 'reset', mode: 'mock', event })
      mockRun.forEach((e, i) => {
        timers.current.push(setTimeout(() => dispatch({ type: 'sse', event: e.event, data: e.data }), (i + 1) * MOCK_DELAY_MS))
      })
      timers.current.push(setTimeout(() => dispatch({ type: 'status', status: 'done' }), (mockRun.length + 1) * MOCK_DELAY_MS))
    },
    [stop],
  )

  /** Start a real council run and stream it over SSE. `council` is the builder's config, `newsId` a cached
   * headline the event is about (both optional). */
  const runLive = useCallback(
    async (event, council, newsId, guardrail) => {
      stop()
      dispatch({ type: 'reset', mode: 'live', event })
      let runId
      try {
        const r = await fetch('/council/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event,
            ...(council && { council }),
            ...(newsId && { news_id: newsId }),
            ...(typeof guardrail === 'boolean' && { guardrail }),
          }),
        })
        if (r.status === 422) {
          const detail = (await r.json().catch(() => ({}))).detail
          dispatch({ type: 'toast', text: `The council can't run: ${typeof detail === 'string' ? detail : 'invalid configuration'}` })
          dispatch({ type: 'status', status: 'error' })
          return
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        runId = (await r.json()).run_id
      } catch (e) {
        dispatch({ type: 'toast', text: `Backend not reachable (${e.message}). Use "Replay mock" instead.` })
        dispatch({ type: 'status', status: 'error' })
        return
      }

      listen(new EventSource(`/council/stream/${runId}`), () => {
        dispatch({ type: 'toast', text: 'Live stream lost. You can retry, or use "Replay mock".' })
        dispatch({ type: 'status', status: 'error' })
      })
    },
    [stop, listen],
  )

  /** Play a recorded run in the browser with its original timing (no backend needed). */
  const playLocal = useCallback((run, speed = 1) => {
    dispatch({ type: 'sse', event: 'replay', data: { ...run, events: undefined } })
    let at = 0
    let last = 0
    for (const e of run.events) {
      at += (Math.min(Math.max(e.t - last, 0), MAX_GAP_S) * 1000) / speed
      last = e.t
      timers.current.push(setTimeout(() => dispatch({ type: 'sse', event: e.event, data: e.data }), at))
    }
    timers.current.push(setTimeout(() => dispatch({ type: 'status', status: 'done' }), at + 100))
  }, [])

  /** Replay a recorded run from the backend; fall back to the bundled copy if it is unreachable. */
  const replayRecorded = useCallback(
    (slug, event, speed = 1) => {
      stop()
      const loadLocal = LOCAL_RUNS[slug]
      dispatch({ type: 'reset', mode: 'replay', event: event || slug, recording: { slug } })
      listen(new EventSource(`/council/replay/${slug}?speed=${speed}`), (gotAny) => {
        if (!gotAny && loadLocal) {
          loadLocal().then((run) => playLocal(run, speed)) // backend down: same run, played in the browser
        } else {
          dispatch({ type: 'toast', text: 'Replay stream lost.' })
          dispatch({ type: 'status', status: 'error' })
        }
      })
    },
    [stop, listen, playLocal],
  )

  const dismiss = useCallback((id) => dispatch({ type: 'dismiss', id }), [])

  const recordings = Object.keys(LOCAL_RUNS).map((slug) => ({ slug }))

  return { state, replayMock, runLive, replayRecorded, recordings, dismiss }
}
