// Small shared pieces: flags, agent badges, source chips.
import { useState } from 'react'
import { AGENTS } from '../lib/constants'

// Simplified SVG flags: Windows does not render flag emoji.
export function Flag({ code, className = 'h-4 w-6' }) {
  const common = { className: `${className} inline-block shrink-0 rounded-[2px]`, viewBox: '0 0 30 20', 'aria-label': code }
  if (code === 'JP')
    return (
      <svg {...common}>
        <rect width="30" height="20" fill="#fff" />
        <circle cx="15" cy="10" r="6" fill="#bc002d" />
      </svg>
    )
  if (code === 'CN')
    return (
      <svg {...common}>
        <rect width="30" height="20" fill="#de2910" />
        <polygon points="5,2.5 6.2,6 9.8,6 6.9,8.1 8,11.5 5,9.4 2,11.5 3.1,8.1 0.2,6 3.8,6" fill="#ffde00" />
        {[[11, 2], [13, 4.5], [13, 7.5], [11, 10]].map(([x, y]) => (
          <circle key={`${x}${y}`} cx={x} cy={y} r="0.9" fill="#ffde00" />
        ))}
      </svg>
    )
  if (code === 'HK')
    return (
      <svg {...common}>
        <rect width="30" height="20" fill="#de2910" />
        {[0, 72, 144, 216, 288].map((a) => (
          <ellipse key={a} cx="15" cy="6.3" rx="1.8" ry="3.6" fill="#fff" transform={`rotate(${a} 15 10)`} />
        ))}
      </svg>
    )
  if (code === 'US')
    return (
      <svg {...common}>
        <rect width="30" height="20" fill="#fff" />
        {[0, 2, 4, 6, 8, 10, 12].map((i) => (
          <rect key={i} y={i * (20 / 13)} width="30" height={20 / 13} fill="#b22234" />
        ))}
        <rect width="12" height={(20 / 13) * 7} fill="#3c3b6e" />
      </svg>
    )
  return null
}

export function AgentIcon({ agent, className }) {
  const a = AGENTS[agent]
  if (!a) return null
  return a.flag ? <Flag code={a.flag} className={className} /> : <span className="text-base leading-none">{a.icon}</span>
}

export function AgentName({ agent }) {
  const a = AGENTS[agent] || { label: agent, color: '#cbd5e1' }
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: a.color }}>
      <AgentIcon agent={agent} />
      {a.label}
    </span>
  )
}

/** A cited id; hover shows the value or headline, news chips link out. */
export function SourceChip({ id, sources }) {
  // Fixed-position popover so scrolling panels never clip it.
  const [tip, setTip] = useState(null)
  const s = sources[id]
  const base = 'inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-xs'
  if (!s)
    return (
      <span className={`${base} bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/40`} title="Not found in this run's data">
        {id} ?
      </span>
    )
  function show(e) {
    const r = e.currentTarget.getBoundingClientRect()
    const left = Math.min(r.left, window.innerWidth - 300)
    setTip(r.top > 160 ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 })
  }
  const chip = (
    <span
      onMouseEnter={show}
      onMouseLeave={() => setTip(null)}
      className={`${base} cursor-help bg-slate-700/70 text-sky-200 ring-1 ring-slate-600 hover:bg-sky-900/60`}
    >
      {id}
    </span>
  )
  return (
    <span className="inline-block">
      {s.url ? (
        <a href={s.url} target="_blank" rel="noreferrer">
          {chip}
        </a>
      ) : (
        chip
      )}
      {tip && (
        <span
          style={tip}
          className="pointer-events-none fixed z-50 block w-72 rounded-lg border border-slate-600 bg-slate-800 p-2.5 text-left text-sm shadow-xl"
        >
          <span className="block text-slate-300">{s.label}</span>
          <span className="mt-0.5 block text-lg font-semibold text-white">{s.value}</span>
          {s.detail && <span className="block text-xs text-slate-400">{s.detail}</span>}
          {s.asOf && <span className="block text-xs text-slate-500">as of {s.asOf.slice(0, 16).replace('T', ' ')}</span>}
          {s.url && <span className="block text-xs text-sky-400">Click to open the article</span>}
        </span>
      )}
    </span>
  )
}

export function Panel({ title, right, children, className = '' }) {
  return (
    <section className={`flex min-h-0 flex-col rounded-xl border border-slate-800 bg-slate-900/80 ${className}`}>
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">{title}</h2>
        {right}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
    </section>
  )
}
