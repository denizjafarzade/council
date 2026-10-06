// The four numbers a judge or client reads first (direction B): overall risk, the two riskiest
// markets, and how much of the user's money this council actually covered.

const RISK_TEXT = { low: 'text-ok', moderate: 'text-[#8a5a00]', high: 'text-bear' }
const RISK_BAR = { low: 'bg-ok', moderate: 'bg-[#8a5a00]', high: 'bg-bear' }

function Tile({ label, value, word, level, bar, note }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-line bg-panel px-4 py-3.5">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">{label}</span>
      <span className="flex items-baseline gap-2.5">
        <span className="font-mono text-[32px] font-semibold leading-none text-ink">{value}</span>
        {word && <span className={`truncate text-[15px] font-semibold ${RISK_TEXT[level] || 'text-ink-soft'}`}>{word}</span>}
      </span>
      <span className="h-1 overflow-hidden rounded-full bg-line">
        {bar != null && <span className={`block h-full rounded-full ${RISK_BAR[level] || 'bg-oat'}`}
          style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} />}
      </span>
      <span className="truncate text-[13px] text-muted" title={note}>{note}</span>
    </div>
  )
}

const pct = (n) => `${n > 0 ? '+' : ''}${Math.round(n * 10) / 10}%`

export default function KeyNumbers({ state, names }) {
  const risk = state.brief?.risk
  const name = (code) => names[code] || code
  const overall = risk?.portfolio || risk?.together
  const markets = Object.entries(risk?.markets || {})
    .filter(([, m]) => m && m.score != null)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 2)
  const councilCodes = (state.council?.markets || []).map((m) => m.code)
  const held = state.portfolio?.by_market || []
  const covered = held.filter((m) => councilCodes.includes(m.name))
  const coveredPct = covered.reduce((a, m) => a + m.pct, 0)
  const outside = held.filter((m) => !councilCodes.includes(m.name)).map((m) => name(m.name))
  const waiting = state.mode !== 'idle' ? 'After the brief' : 'Convene a council'

  return (
    <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {overall ? (
        <Tile label="Risk to the matter" value={overall.score} word={overall.label} level={overall.label} bar={overall.score}
          note={risk.portfolio ? 'Weighted by your portfolio' : 'Average of the council’s markets'} />
      ) : (
        <Tile label="Risk to the matter" value="—" note={waiting} />
      )}
      {[0, 1].map((i) => {
        const m = markets[i]
        if (!m) return <Tile key={i} label={i === 0 ? 'Riskiest market' : 'Next market'} value="—" note={waiting} />
        const [code, r] = m
        const inputs = r.inputs || {}
        return (
          <Tile key={code} label={name(code)} value={r.score} word={r.label} level={r.label} bar={r.score}
            note={[inputs.chg_1m_pct != null && `${pct(inputs.chg_1m_pct)} in a month`,
              inputs.vol_20d_pct != null && `volatility ${Math.round(inputs.vol_20d_pct)}%`].filter(Boolean).join(' · ') || 'Risk score, 0 to 100'} />
        )
      })}
      {held.length ? (
        <Tile label="Your money covered" value={`${Math.round(coveredPct)}%`}
          word={covered.slice(0, 2).map((m) => `${m.name} ${Math.round(m.pct)}`).join(' · ')} bar={coveredPct}
          note={outside.length ? `Not on this council: ${outside.join(', ')}` : 'Every market you hold is on the council'} />
      ) : (
        <Tile label="Council" value={(state.council?.members || []).length || '—'} word="seats"
          note={councilCodes.length ? `${councilCodes.length} markets · load trades to see your exposure` : waiting} />
      )}
    </section>
  )
}
