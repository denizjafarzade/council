import { useMemo } from 'react'
import { DISCLAIMER } from '../lib/constants'
import { plainEnglish } from '../lib/plain'
import { Panel } from './bits'

function Section({ title, items, ordered, render = (x) => x }) {
  if (!items?.length) return null
  const List = ordered ? 'ol' : 'ul'
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">{title}</h3>
      <List className={`flex flex-col gap-1 pl-5 text-[15px] leading-snug ${ordered ? 'list-decimal' : 'list-disc'} marker:text-muted`}>
        {items.map((x, i) => <li key={i}>{render(x)}</li>)}
      </List>
    </div>
  )
}

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

export default function Brief({ state, asOf }) {
  const b = state.brief
  const split = b?.matrix?.length ? b.matrix.reduce((a, m) => (m.dissent > a.dissent ? m : a)) : null
  const names = marketNames(state)
  return (
    <Panel title="Chair’s brief" bodyClassName="px-5 py-4">
      <div className="flex flex-col gap-4">
        {!b ? (
          <p className="text-muted">The Chair writes the brief once the council has revoted.</p>
        ) : (
          <>
            <p className="text-[21px] font-semibold leading-snug text-ink">{b.headline}</p>
            {split && split.dissent > 0 && (
              <p className="rounded-xl bg-gold-soft px-3 py-2 text-sm text-gold-text">
                Most split: <b>{names[split.country] || split.country} {split.sector}</b> (dissent {Math.round(split.dissent * 100)}%)
              </p>
            )}
            <Section title="Key risks" items={b.key_risks} ordered />
            <Section
              title="What would change the view"
              items={b.triggers}
              render={(t) => <>If <b className="font-semibold text-ink">{t.condition}</b>: {t.would_change}</>}
            />
            <Section title="Ask yourself before acting" items={b.questions_for_you} />
          </>
        )}
        <footer className="border-t border-line pt-2.5 text-[13px] text-muted">
          <p className="font-semibold text-[#c4cbd5]">{b?.disclaimer || DISCLAIMER}</p>
          {asOf && Object.keys(asOf).length > 0 && (
            <p className="mt-0.5">
              Data as of {Object.entries(asOf).map(([c, t]) => `${c} ${t.slice(0, 10)}`).join(' · ')}
              {state.mode === 'mock' && ' (mock data)'}
            </p>
          )}
        </footer>
      </div>
    </Panel>
  )
}
