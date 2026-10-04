import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { SECTOR_NAMES } from '../lib/cards'
import { Panel } from './bits'

function Bar({ label, pct }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className="w-32 shrink-0 truncate text-ink">{label}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
        <span className="block h-full rounded-full bg-gold" style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <span className="w-12 text-right font-mono text-muted">{pct}%</span>
    </li>
  )
}

/** Upload trades (kept in the backend's memory only) or load the fictional sample. */
export default function PortfolioPanel({ names, disabled }) {
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

  async function upload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) act(async () => api.uploadPortfolio(await file.text(), file.name.replace(/\.csv$/i, '')))
  }

  const name = (code) => names[code] || code
  return (
    <Panel title="Your trades" bodyClassName="px-5 py-4"
      right={summary && <button type="button" disabled={disabled || busy} onClick={() => act(async () => { await api.clearPortfolio(); return null })}
        className="text-sm text-muted hover:text-ink disabled:opacity-40">Clear</button>}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <label className={`inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-line-strong px-3.5 text-sm text-ink hover:bg-raised ${disabled || busy ? 'pointer-events-none opacity-40' : ''}`}>
            Upload CSV
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={upload} disabled={disabled || busy} />
          </label>
          <button type="button" disabled={disabled || busy} onClick={() => act(api.samplePortfolio)}
            className="min-h-10 rounded-xl border border-dashed border-line-strong px-3.5 text-sm text-muted hover:bg-raised hover:text-ink disabled:opacity-40">
            Use sample portfolio
          </button>
        </div>
        <p className="text-[13px] text-muted">Columns: date, ticker, side, qty, price. Kept in memory only; only percentages reach the council.</p>
        {error && <p className="text-sm text-bear">{error}</p>}
        {summary && (
          <>
            <p className="font-semibold text-ink">{summary.label}</p>
            <ul className="flex flex-col gap-1.5">
              {summary.by_market.map((m) => <Bar key={m.market} label={name(m.market)} pct={m.pct} />)}
            </ul>
            {summary.largest && (
              <p className="text-sm text-ink">
                Largest position: <b>{summary.largest.ticker}</b> ({name(summary.largest.market)}, {SECTOR_NAMES[summary.largest.sector] || summary.largest.sector}), {summary.largest.pct}% of invested money.
              </p>
            )}
            {summary.realised_by_market.length > 0 && (
              <p className="text-sm text-muted">
                Closed trades: {summary.realised_by_market.map((r) => `${name(r.market)} ${r.pct > 0 ? '+' : ''}${r.pct}%`).join(' · ')}
              </p>
            )}
            {summary.not_covered.length > 0 && (
              <p className="rounded-lg bg-raised px-3 py-2 text-sm text-ink">
                Not covered: {summary.not_covered.join(', ')}. The council only maps tickers it already tracks.
              </p>
            )}
            <p className="text-[13px] text-muted">Costs converted to US dollars at the cached exchange rates.</p>
          </>
        )}
      </div>
    </Panel>
  )
}
