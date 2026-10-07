// Small shared pieces: seat avatars, agent names, source chips, panels.
import { useState } from 'react'
import { useAgent } from '../lib/roster'

/** A seat's badge: its market code (or ALL for cross-market seats) in a ring of its colour. */
export function Avatar({ agent, size = 34 }) {
  const a = useAgent(agent)
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full border-2 bg-desk font-mono font-semibold leading-none"
      style={{ width: size, height: size, borderColor: a.color, fontSize: Math.max(9, size * 0.32) }}
      aria-hidden="true"
    >
      {a.market || (agent === 'CHAIR' ? '★' : 'ALL')}
    </span>
  )
}

/** A market code badge, used on the market cards. */
export function Flag({ code, className = 'h-4 w-6' }) {
  return (
    <span className={`${className} inline-flex shrink-0 items-center justify-center rounded-[3px] bg-raised font-mono text-[9px] font-semibold leading-none text-ink`}
      aria-label={code}>
      {code}
    </span>
  )
}

/** A cited id; hover (or focus) shows the value or headline, news chips link out. */
export function SourceChip({ id, sources }) {
  // Fixed-position popover so scrolling panels never clip it.
  const [tip, setTip] = useState(null)
  const s = sources[id]
  const base = 'inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-xs'
  if (!s)
    return (
      <span className={`${base} border-bear/40 bg-bear-soft text-bear`} title="Not found in this run's data">
        {id} ?
      </span>
    )
  function show(e) {
    const r = e.currentTarget.getBoundingClientRect()
    const left = Math.min(r.left, window.innerWidth - 300)
    setTip(r.top > 160 ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 })
  }
  const chipClass = `${base} cursor-help border-line-strong bg-gold-soft text-gold-text hover:border-bull`
  return (
    <span className="inline-block">
      {s.url ? (
        <a href={s.url} target="_blank" rel="noreferrer" className={chipClass} onMouseEnter={show} onMouseLeave={() => setTip(null)}
          onFocus={show} onBlur={() => setTip(null)}>
          {id}
        </a>
      ) : (
        <span tabIndex={0} className={chipClass} onMouseEnter={show} onMouseLeave={() => setTip(null)} onFocus={show}
          onBlur={() => setTip(null)}>
          {id}
        </span>
      )}
      {tip && (
        <span style={tip} className="pointer-events-none fixed z-50 block w-72 rounded-md border border-line-strong bg-raised p-3 text-left text-sm shadow-xl">
          <span className="block text-muted">{s.label}</span>
          <span className="mt-0.5 block text-lg font-semibold text-ink">{s.value}</span>
          {s.detail && <span className="block text-xs text-muted">{s.detail}</span>}
          {s.asOf && <span className="block text-xs text-muted">as of {s.asOf.slice(0, 16).replace('T', ' ')}</span>}
          {s.url && <span className="block text-xs text-gold">Click to open the article</span>}
        </span>
      )}
    </span>
  )
}

/** A chamber panel: square-cornered parchment with a small-caps title. `ruled` = double brass frame (the ruling). */
export function Panel({ title, right, children, className = '', bodyClassName = 'p-4', ruled = false }) {
  return (
    <section className={`flex min-h-0 flex-col rounded bg-panel ${ruled ? 'border-[3px] border-double border-brass' : 'border border-line'} ${className}`}>
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.18em] text-ink">{title}</h2>
        {right}
      </header>
      <div className={`min-h-0 flex-1 overflow-auto ${bodyClassName}`}>{children}</div>
    </section>
  )
}
