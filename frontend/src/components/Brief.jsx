import { DISCLAIMER } from '../lib/constants'
import { Panel } from './bits'

function List({ title, items, render = (x) => x }) {
  if (!items?.length) return null
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <ul className="flex flex-col gap-1">
        {items.map((x, i) => (
          <li key={i} className="flex gap-2 leading-snug">
            <span className="text-slate-500">•</span>
            <span>{render(x)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Brief({ state, asOf }) {
  const b = state.brief
  const split = b?.matrix?.length ? b.matrix.reduce((a, m) => (m.dissent > a.dissent ? m : a)) : null
  return (
    <Panel className="h-full" title="Chair’s brief">
      <div className="flex h-full flex-col gap-4">
        {!b ? (
          <p className="text-slate-500">The Chair writes the brief once the council has revoted.</p>
        ) : (
          <>
            <p className="text-xl font-semibold leading-snug text-white">{b.headline}</p>
            {split && split.dissent > 0 && (
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-200 ring-1 ring-amber-500/30">
                Most split: <b>{split.country} {split.sector}</b> (dissent {Math.round(split.dissent * 100)}%)
              </p>
            )}
            <List title="Key risks" items={b.key_risks} />
            <List
              title="What would change the view"
              items={b.triggers}
              render={(t) => (
                <>
                  If <b className="text-slate-100">{t.condition}</b> → {t.would_change}
                </>
              )}
            />
            <List title="Ask yourself before acting" items={b.questions_for_you} />
          </>
        )}
        <footer className="mt-auto border-t border-slate-800 pt-2 text-xs text-slate-400">
          <p className="font-semibold text-slate-300">{b?.disclaimer || DISCLAIMER}</p>
          {asOf && (
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
