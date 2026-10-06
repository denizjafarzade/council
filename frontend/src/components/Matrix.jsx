import { useMemo, useState } from 'react'
import { VIEW_STYLE } from '../lib/constants'
import { briefMatrix, computeMatrix, sectorsOf } from '../lib/council'
import { marketColor, marketsOf, votersOf } from '../lib/roster'
import { Panel } from './bits'

const MODES = [
  ['blind', 'Blind vote'],
  ['final', 'Final'],
  ['changed', 'What changed'],
]
const SPLIT = 0.5 // dissent at or above this marks the council as split on a cell

function Cell({ cell, before, mode }) {
  if (!cell) return <div className="h-16 rounded-md bg-raised/60" aria-label="No votes yet" />
  const changed = !!(before && before.view !== cell.view)
  const v = VIEW_STYLE[cell.view]
  const dim = mode === 'changed' && !changed
  const alpha = dim ? 0.08 : 0.14 + 0.5 * cell.confidence // stronger colour = higher confidence
  const sub = mode === 'changed'
    ? changed ? `was ${before.view}` : 'no change'
    : `${Math.round(cell.confidence * 100)}%`
  return (
    <div
      className="relative flex h-16 flex-col items-center justify-center gap-0.5 rounded-md transition-all duration-700"
      style={{ backgroundColor: `rgba(${v.rgb}, ${alpha})`, boxShadow: mode !== 'blind' && changed ? 'inset 0 0 0 2px #e8b04a' : 'none' }}
      title={`${v.label}, confidence ${Math.round(cell.confidence * 100)}%, dissent ${Math.round(cell.dissent * 100)}%${changed ? ` (was ${before.view})` : ''}`}
    >
      <span className={`text-[15px] font-semibold ${dim ? 'text-muted' : 'text-ink'}`}>{v.arrow} {v.label}</span>
      <span className={`font-mono text-[13px] ${dim ? 'text-muted' : 'text-ink-soft'}`}>{sub}</span>
      {mode !== 'blind' && cell.dissent >= SPLIT && (
        <span className="absolute right-1.5 top-1 rounded bg-desk/75 px-1 text-[10px] font-bold tracking-wide text-gold-text" title="The council is split on this cell">
          SPLIT
        </span>
      )}
    </div>
  )
}

export default function Matrix({ state }) {
  const markets = useMemo(() => marketsOf(state), [state])
  const blindVoters = votersOf(state, 'blind')
  const revoters = votersOf(state, 'revote')
  const sectors = useMemo(() => sectorsOf(state), [state])
  const ids = useMemo(() => sectors.map((x) => x.id), [sectors])
  const blind = useMemo(() => computeMatrix(state.votes.blind, markets, ids), [state.votes.blind, markets, ids])
  const final = useMemo(
    () => (state.brief ? briefMatrix(state.brief, revoters) : computeMatrix(state.votes.revote, markets, ids)),
    [state.brief, state.votes.revote, markets, revoters, ids],
  )
  const nBlind = Object.keys(state.votes.blind).length
  const nRevote = Object.keys(state.votes.revote).length
  const allVotes = [...Object.values(state.votes.blind), ...Object.values(state.votes.revote)]
  const jev = allVotes.filter((v) => v.source === 'jev').length

  // Follow the run (blind until revotes land) unless the viewer picked a view for this run.
  const runKey = `${state.mode}|${state.event}`
  const [picked, setPicked] = useState(null)
  const auto = nRevote || state.brief ? 'final' : 'blind'
  const mode = picked?.runKey === runKey ? picked.mode : auto
  const shown = mode === 'blind' ? blind : final
  const names = Object.fromEntries((state.council?.markets || []).map((m) => [m.code, m.name]))

  return (
    <Panel
      title="Stance matrix"
      right={
        <div role="group" aria-label="Matrix view" className="inline-flex rounded-md border border-line bg-desk p-[3px]">
          {MODES.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={mode === id} onClick={() => setPicked({ runKey, mode: id })}
              disabled={id !== 'blind' && !nRevote && !state.brief}
              className={`min-h-10 rounded-[9px] px-3.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                mode === id ? 'bg-gold text-gold-ink' : 'text-ink-soft hover:text-ink'
              }`}>
              {label}
            </button>
          ))}
        </div>
      }
      bodyClassName="px-5 py-4"
    >
      <div className="overflow-x-auto">
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `9.5rem repeat(${sectors.length}, minmax(4.5rem, 1fr))` }}>
        <span />
        {sectors.map((s) => <span key={s.id} className="truncate text-center text-[13px] font-medium text-muted" title={s.name}>{s.name}</span>)}
        {markets.map((c) => (
          <div key={c} className="contents">
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: marketColor(c, markets) }} />
              <span className="font-mono text-[15px] font-semibold">{c}</span>
              <span className="truncate text-[13px] text-muted">{names[c] || ''}</span>
            </span>
            {ids.map((s) => (
              <Cell key={s} cell={shown[`${c}/${s}`]} before={mode === 'blind' ? null : blind[`${c}/${s}`]} mode={mode} />
            ))}
          </div>
        ))}
      </div>
      </div>
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted">
        <span className="flex flex-wrap gap-4">
          <span className="font-semibold text-bull">▲ Bullish</span>
          <span className="font-semibold text-ink-soft">● Neutral</span>
          <span className="font-semibold text-bear">▼ Bearish</span>
          <span>Stronger colour = higher confidence{mode !== 'blind' && ' · gold ring = changed after the debate'}</span>
        </span>
        <span>
          {mode === 'blind' ? `${nBlind} of ${blindVoters} voted blind` : `${nRevote} of ${revoters} revoted`}
          {jev > 0 && ` · ${jev} votes by Jev`}
        </span>
      </div>
    </Panel>
  )
}
