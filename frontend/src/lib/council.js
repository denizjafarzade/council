// Council run state. One reducer handles SSE events from any source
// (mock replay, live EventSource, recorded replay) so every panel behaves the same.
import { COUNTRIES, SECTORS, STAGES } from './constants'

export const initialState = {
  mode: 'idle', // idle | mock | live
  status: 'idle', // idle | running | done | error
  event: '',
  council: null, // the backend's "council" event: markets and seats for this run
  stages: Object.fromEntries(STAGES.map((s) => [s.id, 'pending'])),
  votes: { blind: {}, revote: {} },
  feed: [], // messages, vote arrivals and errors, in arrival order
  reports: {},
  spillover: null,
  brief: null,
  toasts: [],
}

let seq = 0

export function councilReducer(state, action) {
  switch (action.type) {
    case 'reset':
      return { ...initialState, mode: action.mode, event: action.event, status: 'running' }
    case 'status':
      return { ...state, status: action.status }
    case 'toast':
      return { ...state, toasts: [...state.toasts, { id: ++seq, text: action.text }] }
    case 'dismiss':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) }
    case 'sse':
      return applyEvent(state, action.event, action.data)
    default:
      return state
  }
}

function applyEvent(state, event, data) {
  const id = ++seq
  switch (event) {
    case 'council':
      return { ...state, council: data }
    case 'stage':
      return { ...state, stages: { ...state.stages, [data.name]: data.status } }
    case 'vote':
      return {
        ...state,
        votes: { ...state.votes, [data.round]: { ...state.votes[data.round], [data.agent]: data } },
        feed: [...state.feed, { id, kind: 'vote', agent: data.agent, round: data.round, source: data.source }],
      }
    case 'message':
      return { ...state, feed: [...state.feed, { id, kind: 'message', ...data }] }
    case 'report':
      return { ...state, reports: { ...state.reports, [data.agent]: data } }
    case 'spillover':
      return { ...state, spillover: data }
    case 'brief':
      return { ...state, brief: data }
    case 'error':
      return {
        ...state,
        feed: [...state.feed, { id, kind: 'error', ...data }],
        toasts: [...state.toasts, { id, text: data.message }],
      }
    default:
      return state // unknown events are ignored, never crash the screen
  }
}

// --- Chair maths, mirrored from backend/council_math.py --------------------------

const SCORE = { bearish: -1, neutral: 0, bullish: 1 }

function viewOf(score) {
  if (score > 0.33) return 'bullish'
  if (score < -0.33) return 'bearish'
  return 'neutral'
}

/** Confidence-weighted matrix from a set of votes: { "HK/Tech": {view, confidence, dissent, n} } */
export function computeMatrix(votes, markets = COUNTRIES) {
  const out = {}
  const list = Object.values(votes)
  for (const c of markets) {
    for (const s of SECTORS) {
      const cells = list.flatMap((v) => v.cells.filter((x) => x.country === c && x.sector === s))
      if (!cells.length) continue
      const weight = cells.reduce((a, x) => a + x.confidence, 0) || 1
      const score = cells.reduce((a, x) => a + SCORE[x.view] * x.confidence, 0) / weight
      const view = viewOf(score)
      const agreeing = cells.filter((x) => x.view === view)
      const confidence = agreeing.reduce((a, x) => a + x.confidence, 0) / cells.length
      const mean = cells.reduce((a, x) => a + SCORE[x.view], 0) / cells.length
      const dissent = Math.sqrt(cells.reduce((a, x) => a + (SCORE[x.view] - mean) ** 2, 0) / cells.length)
      out[`${c}/${s}`] = { view, confidence, dissent: Math.min(dissent, 1), n: cells.length }
    }
  }
  return out
}

export function briefMatrix(brief, voters = 7) {
  return Object.fromEntries(brief.matrix.map((m) => [`${m.country}/${m.sector}`, { ...m, n: voters }]))
}

/** Cells where an agent changed view between blind and revote (used before the brief lands). */
export function computeShifts(blind, revote) {
  const shifts = []
  for (const [agent, v] of Object.entries(revote)) {
    const before = blind[agent]
    if (!before) continue
    for (const x of v.cells) {
      const prev = before.cells.find((b) => b.country === x.country && b.sector === x.sector)
      if (prev && prev.view !== x.view) {
        shifts.push({ agent, cell: `${x.country}/${x.sector}`, from: prev.view, to: x.view, because: x.because || '' })
      }
    }
  }
  return shifts
}
