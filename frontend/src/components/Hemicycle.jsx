// The chamber: every member in the amphitheatre, coloured by how they voted on one market.
import { useState } from 'react'
import { useShifts } from '../hooks/useShifts'
import { marketColor, marketsOf, useRoster } from '../lib/roster'
import Amphitheatre, { seatLabel } from './Amphitheatre'
import { Caps } from './chamber'

const SCORE = { bearish: -1, neutral: 0, bullish: 1 }
const STANCE = {
  fall: { label: 'leans fall', fill: 'bg-bear', text: 'text-wood-ink' },
  rise: { label: 'leans rise', fill: 'bg-bull', text: 'text-wood-ink' },
  none: { label: 'no clear view', fill: 'bg-[#7a7264]', text: 'text-wood-ink' },
  absent: { label: 'not yet voted', fill: 'bg-panel border-2 border-dashed border-line-strong', text: 'text-muted' },
}
// The same stances as SVG paint for the seats.
const SEAT_PAINT = {
  fall: { fill: '#9a3f14', ink: '#ffffff', color: '#f8f2e4' },
  rise: { fill: '#24508f', ink: '#ffffff', color: '#f8f2e4' },
  none: { fill: '#7a7264', ink: '#ffffff', color: '#f8f2e4' },
  absent: { fill: '#f8f2e4', ink: '#5e5442', color: '#b5a47e', dashed: true },
}
const ROLE_SHORT = { 'Macro Strategist': 'Macro', 'Market Analyst': 'Market', 'Fundamentals Analyst': 'Fundam.',
  'News Analyst': 'News', 'Sentiment Analyst': 'Mood' }
const CROSS_CODE = { BULL: 'BULL', BEAR: 'BEAR', RISK: 'RISK', SPILLOVER: 'SPILL' }

/** A member's lean on one market: confidence-weighted average of their latest votes there. */
function stanceOf(vote, market) {
  const cells = (vote?.cells || []).filter((c) => c.country === market)
  if (!cells.length) return 'absent'
  const weight = cells.reduce((a, c) => a + c.confidence, 0) || 1
  const score = cells.reduce((a, c) => a + SCORE[c.view] * c.confidence, 0) / weight
  return score > 0.25 ? 'rise' : score < -0.25 ? 'fall' : 'none'
}

export default function Hemicycle({ state, names }) {
  const roster = useRoster()
  const markets = marketsOf(state)
  const shifts = useShifts(state)
  const [picked, setPicked] = useState(null)
  const market = markets.includes(picked) ? picked : markets[0]
  const second = Object.keys(state.votes.revote).length > 0

  const ids = (state.council ? state.council.members.map((m) => m.id) : Object.keys(roster)).filter((id) => id !== 'CHAIR')
  const roleOf = Object.fromEntries((state.council?.members || []).map((m) => [m.id, m.role]))
  // Market seats vote only on their own market, so on another market they show as "not voted".
  const seats = ids.map((id) => {
    const agent = roster[id] || { label: id }
    const stance = stanceOf(state.votes.revote[id] || state.votes.blind[id], market)
    const changed = shifts.some((s) => s.agent === id && s.cell.startsWith(`${market}/`))
    const place = names[agent.market] || agent.market
    // Grid delegates are named after their market, so show their role; custom members keep their name.
    const gridSeat = agent.market && (agent.label === place || agent.label?.startsWith(`${place} `))
    return {
      id, stance, changed, market: agent.market,
      role: (roleOf[id] || id).toLowerCase(),
      code: agent.market || CROSS_CODE[id] || (agent.label || id).slice(0, 4).toUpperCase(),
      label: gridSeat ? ROLE_SHORT[agent.role] || seatLabel(agent.role)
        : CROSS_CODE[id] ? (agent.label || id).split(' ')[0] : seatLabel(agent.label || id),
      title: `${agent.label}${agent.role && agent.label !== agent.role ? ` (${agent.role})` : ''}: ${STANCE[stance].label}${changed ? ', changed position' : ''}`,
      ...SEAT_PAINT[stance],
    }
  })
  const delegations = markets.map((code) => ({
    code, name: names[code] || code, color: marketColor(code, markets), seats: seats.filter((s) => s.market === code),
  }))
  const cross = seats.filter((s) => !s.market)

  const counts = ['fall', 'rise', 'none'].map((k) => [k, seats.filter((s) => s.stance === k).length]).filter(([, c]) => c)
  const changed = seats.filter((s) => s.changed)

  return (
    <section aria-label="The chamber" className="flex flex-col gap-3 rounded border border-line bg-panel px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Caps>The chamber · {second ? 'second ballot' : 'secret ballot'} on {names[market] || market || '—'}</Caps>
        {markets.length > 1 && (
          <div role="group" aria-label="Market" className="flex flex-wrap gap-1.5">
            {markets.map((m) => (
              <button key={m} type="button" aria-pressed={m === market} onClick={() => setPicked(m)}
                className={`min-h-9 rounded-md border px-3 font-mono text-sm font-semibold ${
                  m === market ? 'border-gold bg-gold text-gold-ink' : 'border-line-strong text-ink hover:bg-raised'}`}>
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      <Amphitheatre delegations={delegations} cross={cross} active={markets.length > 1 ? market : null}
        label={`Seating on ${names[market] || market || 'the matter'}: ${counts.map(([k, c]) => `${c} ${STANCE[k].label}`).join(', ') || 'no votes yet'}`} />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-[15px] text-ink-soft">
        <p>
          <b className="text-ink">Division:</b>{' '}
          {counts.length ? counts.map(([k, c]) => `${c} ${STANCE[k].label}`).join(' · ') : 'awaiting the secret ballot'}
          {changed.length > 0 && ` · ${changed.length} changed position`}
        </p>
        <span className="flex flex-wrap gap-3 text-[13px] text-muted">
          {['fall', 'rise', 'none'].map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5"><span className={`size-2.5 rounded-full ${STANCE[k].fill}`} />{STANCE[k].label}</span>
          ))}
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-brass" />changed position</span>
        </span>
      </div>
    </section>
  )
}
