import { useMemo } from 'react'
import { SECTORS, VIEW_STYLE } from '../lib/constants'
import { briefMatrix, computeMatrix } from '../lib/council'
import { marketsOf, votersOf } from '../lib/roster'
import { Flag, Panel } from './bits'

const SHORT = { Tech: 'Tech', Financials: 'Fin', Property: 'Prop', Energy: 'Energy' }

function Cell({ cell, changed, from }) {
  if (!cell) return <div className="h-12 rounded-md bg-slate-800/40" />
  const v = VIEW_STYLE[cell.view]
  const alpha = 0.18 + 0.72 * cell.confidence // opacity = confidence
  const split = cell.dissent >= 0.5
  return (
    <div
      className={`relative flex h-12 flex-col items-center justify-center rounded-md transition-all duration-700 ${
        changed ? 'ring-2 ring-amber-300' : ''
      }`}
      style={{ backgroundColor: `rgba(${v.rgb}, ${alpha})` }}
      title={`${cell.view}, confidence ${Math.round(cell.confidence * 100)}%, dissent ${Math.round(cell.dissent * 100)}%${
        changed ? ` (was ${from})` : ''
      }`}
    >
      <span className="text-lg font-bold leading-none text-white">{v.arrow}</span>
      <span className="text-xs text-white/85">{Math.round(cell.confidence * 100)}%</span>
      {split && (
        <span className="absolute right-1 top-1 rounded bg-slate-950/70 px-1 text-[10px] font-semibold text-amber-300" title="Council is split">
          split
        </span>
      )}
      {changed && <span className="absolute left-1 top-0.5 text-xs text-amber-300">↻</span>}
    </div>
  )
}

function Grid({ title, matrix, compare, markets }) {
  return (
    <div className="min-w-0 flex-1">
      <h3 className="mb-2 text-sm font-semibold text-slate-300">{title}</h3>
      <div className="grid grid-cols-[2.25rem_repeat(4,minmax(0,1fr))] gap-1">
        <span />
        {SECTORS.map((s) => (
          <span key={s} className="text-center text-xs text-slate-400" title={s}>
            {SHORT[s]}
          </span>
        ))}
        {markets.map((c) => (
          <div key={c} className="contents">
            <span className="flex items-center gap-1 text-xs font-semibold text-slate-300">
              <Flag code={c} className="h-3 w-[18px]" />
            </span>
            {SECTORS.map((s) => {
              const key = `${c}/${s}`
              const cell = matrix[key]
              const before = compare?.[key]
              const changed = !!(cell && before && before.view !== cell.view)
              return <Cell key={key} cell={cell} changed={changed} from={before?.view} />
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Matrix({ state }) {
  const markets = useMemo(() => marketsOf(state), [state])
  const blindVoters = votersOf(state, 'blind')
  const revoters = votersOf(state, 'revote')
  const blind = useMemo(() => computeMatrix(state.votes.blind, markets), [state.votes.blind, markets])
  const final = useMemo(
    () => (state.brief ? briefMatrix(state.brief, revoters) : computeMatrix(state.votes.revote, markets)),
    [state.brief, state.votes.revote, markets, revoters],
  )
  const nBlind = Object.keys(state.votes.blind).length
  const nRevote = Object.keys(state.votes.revote).length

  return (
    <Panel
      title="Stance matrix"
      right={
        <span className="flex items-center gap-3 text-xs text-slate-400">
          <span className="text-emerald-300">▲ bullish</span>
          <span>● neutral</span>
          <span className="text-rose-300">▼ bearish</span>
          <span>opacity = confidence</span>
        </span>
      }
    >
      <div className="flex gap-4">
        <Grid title={`Blind vote${nBlind ? ` (${nBlind}/${blindVoters})` : ''}`} matrix={blind} markets={markets} />
        <Grid
          title={state.brief ? 'Final (Chair)' : `After debate${nRevote ? ` (${nRevote}/${revoters})` : ''}`}
          matrix={final}
          compare={blind}
          markets={markets}
        />
      </div>
    </Panel>
  )
}
