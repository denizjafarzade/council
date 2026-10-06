import { VIEW_STYLE } from '../lib/constants'
import { useAgent } from '../lib/roster'
import { Avatar } from './bits'

function ViewTag({ view }) {
  const v = VIEW_STYLE[view]
  return <span className={`font-semibold ${v.text}`}>{v.arrow} {view}</span>
}

/** One member's change of view between the blind vote and the revote, with its reason. */
export function Shift({ s }) {
  const a = useAgent(s.agent)
  return (
    <li className="flex flex-col gap-1.5 rounded-md bg-raised px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Avatar agent={s.agent} size={24} />
        <span className="font-semibold">{a.label}</span>
        <span className="font-mono text-muted">{s.cell}</span>
        <span className="flex items-center gap-1.5"><ViewTag view={s.from} /><span className="text-muted">→</span><ViewTag view={s.to} /></span>
      </div>
      {s.because && <p className="text-sm leading-snug text-ink-soft">“{s.because}”</p>}
    </li>
  )
}
