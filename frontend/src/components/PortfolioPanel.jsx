import { useEffect, useState } from 'react'
import { SectionHeader } from '../builder/ui'
import { api } from '../lib/api'
import { SECTOR_NAMES } from '../lib/cards'

function Bar({ label, pct }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className="w-28 shrink-0 truncate text-ink">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
        <span className="block h-full rounded-full bg-gold" style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <span className="w-11 text-right font-mono text-[13px] text-muted">{pct}%</span>
    </li>
  )
}

function usePortfolio() {
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.portfolio().then(setSummary).catch(() => setSummary(null))
  }, [])

  async function act(fn) {
    setBusy(true)
    setError('')
    try {
      setSummary(await fn())
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return {
    summary, error, busy,
    upload: (file) => act(async () => api.uploadPortfolio(await file.text(), file.name.replace(/\.csv$/i, ''))),
    sample: () => act(api.samplePortfolio),
    clear: () => act(async () => { await api.clearPortfolio(); return null }),
  }
}

/** Upload trades (kept in the backend's memory only) or load the fictional sample. */
function PortfolioBody({ p, names, disabled }) {
  const off = disabled || p.busy
  const name = (code) => names[code] || code
  const s = p.summary
  function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) p.upload(file)
  }
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-2">
        <label className={`inline-flex min-h-10 cursor-pointer items-center rounded-md border border-line-strong px-3.5 text-sm text-ink hover:bg-raised ${off ? 'pointer-events-none opacity-40' : ''}`}>
          {s ? 'Replace CSV' : 'Upload CSV'}
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={pick} disabled={off} />
        </label>
        <button type="button" disabled={off} onClick={p.sample}
          className="min-h-10 rounded-md border border-dashed border-line-strong px-3.5 text-sm text-muted hover:bg-raised hover:text-ink disabled:opacity-40">
          Use sample
        </button>
      </div>
      {p.error && <p className="text-sm text-bear">{p.error}</p>}
      {!s ? (
        <p className="text-[13px] leading-snug text-muted">
          Optional. Columns: date, ticker, side, qty, price. Kept in memory; only percentages reach the council.
        </p>
      ) : (
        <>
          <p className="truncate text-sm font-semibold text-ink" title={s.label}>{s.label}</p>
          <ul className="flex flex-col gap-1">
            {s.by_market.slice(0, 4).map((m) => <Bar key={m.market} label={name(m.market)} pct={m.pct} />)}
          </ul>
          {s.by_market.length > 4 && <p className="text-[13px] text-muted">+ {s.by_market.length - 4} more markets</p>}
          {s.largest && (
            <p className="text-[13px] leading-snug text-muted" title="Costs converted to US dollars at the cached exchange rates.">
              Largest: <span className="text-ink">{s.largest.ticker}</span> ({name(s.largest.market)}{' '}
              {SECTOR_NAMES[s.largest.sector] || s.largest.sector}), {s.largest.pct}%
              {s.not_covered.length > 0 && ` · not covered: ${s.not_covered.join(', ')}`}
            </p>
          )}
        </>
      )}
    </div>
  )
}

/** Compact form for the builder's setup panel. */
export function PortfolioSection({ names, disabled }) {
  const p = usePortfolio()
  return (
    <div className="flex flex-col gap-2">
      <SectionHeader title="Your trading history">
        {p.summary && (
          <button type="button" disabled={disabled || p.busy} onClick={p.clear}
            className="text-sm text-muted hover:text-ink disabled:opacity-40">Clear</button>
        )}
      </SectionHeader>
      <PortfolioBody p={p} names={names} disabled={disabled} />
    </div>
  )
}
