// The chamber: every member on a hemicycle, coloured by how they voted on one market.
import { useState } from 'react'
import { useShifts } from '../hooks/useShifts'
import { marketsOf, useRoster } from '../lib/roster'
import { Caps } from './chamber'

const SCORE = { bearish: -1, neutral: 0, bullish: 1 }
const STANCE = {
  fall: { label: 'leans fall', fill: 'bg-bear', text: 'text-wood-ink' },
  rise: { label: 'leans rise', fill: 'bg-bull', text: 'text-wood-ink' },
  none: { label: 'no clear view', fill: 'bg-[#7a7264]', text: 'text-wood-ink' },
  absent: { label: 'not yet voted', fill: 'bg-panel border-2 border-dashed border-line-strong', text: 'text-muted' },
}

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

  const ids = state.council ? state.council.members.map((m) => m.id) : Object.keys(roster)
  // Market seats vote only on their own market, so on another market they show as "not voted".
  const seats = ids.filter((id) => id !== 'CHAIR').map((id) => ({
    id,
    agent: roster[id] || { label: id },
    stance: stanceOf(state.votes.revote[id] || state.votes.blind[id], market),
    changed: shifts.some((s) => s.agent === id && s.cell.startsWith(`${market}/`)),
  }))

  const n = seats.length
  const size = n > 14 ? 40 : n > 9 ? 46 : 54
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

      <div className="relative h-[270px]" role="img"
        aria-label={`Seating: ${counts.map(([k, c]) => `${c} ${STANCE[k].label}`).join(', ') || 'no votes yet'}`}>
        {seats.map((s, i) => {
          const a = n === 1 ? Math.PI / 2 : Math.PI - (i * Math.PI) / (n - 1)
          const st = STANCE[s.stance]
          return (
            <div key={s.id} className="absolute flex w-[118px] -translate-x-1/2 flex-col items-center gap-1 text-center"
              style={{ left: `${50 + 41 * Math.cos(a)}%`, top: `${150 - 140 * Math.sin(a)}px` }}
              title={`${s.agent.label}: ${st.label}${s.changed ? ' (changed position)' : ''}`}>
              <span className={`inline-flex items-center justify-center rounded-full font-mono text-[13px] font-semibold ${st.fill} ${st.text}`}
                style={{ width: size, height: size, boxShadow: s.changed ? '0 0 0 3px var(--color-panel), 0 0 0 6px var(--color-brass)' : 'none' }}>
                {s.agent.market || 'ALL'}
              </span>
              <span className="line-clamp-2 text-xs font-semibold leading-tight">{s.agent.label}</span>
            </div>
          )
        })}
        <div className="absolute bottom-0 left-1/2 flex w-56 -translate-x-1/2 flex-col items-center gap-1">
          <span className="rounded border-b-[3px] border-brass bg-wood px-4 py-1.5 text-[13px] font-bold tracking-[0.16em] text-wood-ink">THE CHAIR</span>
          <span className="text-xs text-muted">presides and delivers the ruling</span>
        </div>
      </div>

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
