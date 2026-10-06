// Who is on the council for the current run. The backend's first SSE event ("council")
// lists the seats; before it arrives (or in mock replay) the original seven are assumed.
import { createContext, useContext } from 'react'
import { AGENTS, COUNTRIES } from './constants'

// One colour per market, in seating order. Kept clear of the green/red used for views.
const MARKET_PALETTE = ['#b83a77', '#b85a12', '#1f6fa3', '#6a4fc0', '#8a6d00', '#0f766e', '#8e44ad', '#b03a48',
  '#2f5fa8', '#8a5a00', '#0e7490', '#a3379a', '#a14d12', '#4a50b0', '#4d7c0f', '#55606e']
const ORIGINAL_MARKET_COLOR = { HK: '#b83a77', CN: '#b85a12', US: '#1f6fa3', JP: '#6a4fc0' }
const CROSS_STYLE = {
  BEAR: AGENTS.BEAR, SPILLOVER: AGENTS.SPILLOVER, CHAIR: AGENTS.CHAIR,
  BULL: { color: '#1e7a4c', icon: '🐂' }, RISK: { color: '#9a6b00', icon: '🛡️' },
}

const DEFAULT_ROLES = { BEAR: 'Bear Researcher', SPILLOVER: 'Spillover Analyst', CHAIR: 'Chair' }

/** The original seven seats, used before the council event arrives and in mock replays. */
export const DEFAULT_ROSTER = Object.fromEntries(
  Object.entries(AGENTS).map(([id, a]) => [
    id,
    { ...a, market: COUNTRIES.includes(id) ? id : null, role: DEFAULT_ROLES[id] || 'Macro Strategist' },
  ]),
)

export function marketColor(code, markets = COUNTRIES) {
  if (ORIGINAL_MARKET_COLOR[code]) return ORIGINAL_MARKET_COLOR[code]
  const i = markets.indexOf(code)
  return MARKET_PALETTE[(i < 0 ? 0 : i + 4) % MARKET_PALETTE.length]
}

/** id -> {label, color, flag?, icon?, market, role} for every seat. */
export function buildRoster(council) {
  if (!council) return DEFAULT_ROSTER
  const codes = council.markets.map((m) => m.code)
  const roster = {}
  for (const m of council.members) {
    if (m.market) {
      // The original delegates keep their short labels (market name) and flags.
      const original = AGENTS[m.id] && m.role === 'macro'
      roster[m.id] = {
        label: original ? AGENTS[m.id].label : m.name,
        color: marketColor(m.market, codes),
        flag: m.market,
        market: m.market,
        role: m.role_name,
      }
    } else {
      const style = CROSS_STYLE[m.id] || { color: '#55606e', icon: '◆' }
      roster[m.id] = { label: AGENTS[m.id]?.label || m.name, ...style, market: null, role: m.role_name }
    }
  }
  return roster
}

export const RosterContext = createContext(DEFAULT_ROSTER)

export function useRoster() {
  return useContext(RosterContext)
}

export function useAgent(id) {
  return useContext(RosterContext)[id] || { label: id, color: '#6b7280' }
}

/** Market codes covered by this run (the original four until the council event arrives). */
export function marketsOf(state) {
  return state.council ? state.council.markets.map((m) => m.code) : COUNTRIES
}

/** How many seats vote in a round, for "4/7 voted" style counters. */
export function votersOf(state, round) {
  if (!state.council) return 7
  const phase = round === 'blind' ? 'vote' : 'revote'
  return state.council.members.filter((m) => m.phases[phase]).length
}
