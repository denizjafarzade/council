import { useMemo } from 'react'
import { VIEW_STYLE } from '../lib/constants'
import { computeShifts } from '../lib/council'
import { AgentName, Panel } from './bits'

function ViewTag({ view }) {
  const v = VIEW_STYLE[view]
  return (
    <span className={`font-semibold ${v.text}`}>
      {v.arrow} {view}
    </span>
  )
}

export default function WhoChanged({ state }) {
  const shifts = useMemo(
    () => state.brief?.vote_shifts ?? computeShifts(state.votes.blind, state.votes.revote),
    [state.brief, state.votes],
  )
  return (
    <Panel className="h-full" title="Who changed their mind" right={<span className="text-sm text-slate-500">{shifts.length}</span>}>
      {!shifts.length ? (
        <p className="text-slate-500">
          {Object.keys(state.votes.revote).length ? 'Nobody changed their view in the revote.' : 'Shows after the revote.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shifts.map((s) => (
            <li key={`${s.agent}-${s.cell}`} className="rounded-lg bg-slate-800/60 px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-2 text-sm">
                <AgentName agent={s.agent} />
                <span className="font-mono text-slate-300">{s.cell}</span>
                <ViewTag view={s.from} />
                <span className="text-slate-500">→</span>
                <ViewTag view={s.to} />
              </div>
              {s.because && <p className="mt-0.5 text-sm text-slate-300">“{s.because}”</p>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
