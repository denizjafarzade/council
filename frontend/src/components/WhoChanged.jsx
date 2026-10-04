import { useMemo } from 'react'
import { VIEW_STYLE } from '../lib/constants'
import { computeShifts } from '../lib/council'
import { useAgent } from '../lib/roster'
import { Avatar, Panel } from './bits'

function ViewTag({ view }) {
  const v = VIEW_STYLE[view]
  return <span className={`font-semibold ${v.text}`}>{v.arrow} {view}</span>
}

function Shift({ s }) {
  const a = useAgent(s.agent)
  return (
    <li className="flex flex-col gap-1.5 rounded-xl bg-raised px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Avatar agent={s.agent} size={24} />
        <span className="font-semibold">{a.label}</span>
        <span className="font-mono text-muted">{s.cell}</span>
        <span className="flex items-center gap-1.5"><ViewTag view={s.from} /><span className="text-muted">→</span><ViewTag view={s.to} /></span>
      </div>
      {s.because && <p className="text-sm leading-snug text-[#c4cbd5]">“{s.because}”</p>}
    </li>
  )
}

export default function WhoChanged({ state }) {
  const shifts = useMemo(
    () => state.brief?.vote_shifts ?? computeShifts(state.votes.blind, state.votes.revote),
    [state.brief, state.votes],
  )
  return (
    <Panel title="Who changed their mind" right={<span className="font-mono text-gold">{shifts.length}</span>} bodyClassName="px-4 py-3">
      {!shifts.length ? (
        <p className="text-muted">
          {Object.keys(state.votes.revote).length ? 'Nobody changed their view in the revote.' : 'Shows after the revote.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shifts.map((s) => <Shift key={`${s.agent}-${s.cell}`} s={s} />)}
        </ul>
      )}
    </Panel>
  )
}
