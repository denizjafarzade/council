import { useMemo } from 'react'
import { plainEnglish } from '../lib/plain'
import { Panel } from './bits'

function marketNames(state) {
  return Object.fromEntries((state.council?.markets || []).map((m) => [m.code, m.name]))
}

/** The Chair's view, retold without jargon for someone with no finance background. */
export function PlainEnglish({ state }) {
  const b = state.brief
  const text = useMemo(() => plainEnglish(b, state.event, marketNames(state)), [b, state])
  return (
    <Panel title="In plain English" right={b && !b.plain_english && <span className="text-xs text-muted">worded from the results</span>}
      bodyClassName="px-5 py-4">
      {text ? (
        <p className="text-[17px] leading-relaxed text-ink">{text}</p>
      ) : (
        <p className="text-muted">Once the council has finished, you'll get its conclusion here in everyday language.</p>
      )}
    </Panel>
  )
}
