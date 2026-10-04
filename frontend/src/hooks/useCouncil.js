import { useCallback, useEffect, useReducer, useRef } from 'react'
import mockRun from '../../../mocks/council_run.json'
import { councilReducer, initialState } from '../lib/council'

const SSE_EVENTS = ['stage', 'vote', 'message', 'report', 'spillover', 'brief', 'error']
const MOCK_DELAY_MS = 300

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

  /** Start a real council run and stream it over SSE. */
  const runLive = useCallback(
    async (event) => {
      stop()
      dispatch({ type: 'reset', mode: 'live', event })
      let runId
      try {
        const r = await fetch('/council/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event }),
        })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        runId = (await r.json()).run_id
      } catch (e) {
        dispatch({ type: 'toast', text: `Backend not reachable (${e.message}). Use "Replay mock" instead.` })
        dispatch({ type: 'status', status: 'error' })
        return
      }

      const es = new EventSource(`/council/stream/${runId}`)
      source.current = es
      for (const name of SSE_EVENTS) {
        es.addEventListener(name, (msg) => {
          try {
            dispatch({ type: 'sse', event: name, data: JSON.parse(msg.data) })
          } catch {
            dispatch({ type: 'toast', text: `Could not read a "${name}" event` })
          }
        })
      }
      es.addEventListener('end', () => {
        es.close()
        dispatch({ type: 'status', status: 'done' })
      })
      // EventSource reconnects by default, which would restart the run; stop instead.
      es.onerror = () => {
        if (source.current !== es) return
        es.close()
        source.current = null
        dispatch({ type: 'toast', text: 'Live stream lost. You can retry, or use "Replay mock".' })
        dispatch({ type: 'status', status: 'error' })
      }
    },
    [stop],
  )

  const dismiss = useCallback((id) => dispatch({ type: 'dismiss', id }), [])

  return { state, replayMock, runLive, dismiss }
}
