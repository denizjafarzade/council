import { useAgent } from '../lib/roster'
import Matrix from './Matrix'
import SpilloverGraph from './SpilloverGraph'

// The same result in technical terms: exact numbers, source ids, every risk component, each
// AI's own risk score next to the council's combined one, evidence weights and data provenance.

const RISK_STYLE = { low: 'text-ok', moderate: 'text-gold-text', high: 'text-bear' }
const COMPONENTS = ['volatility', 'drawdown', 'council_view', 'disagreement', 'uncertainty']
const LABEL = { volatility: 'Vol', drawdown: 'Drawdown', council_view: 'View', disagreement: 'Dissent', uncertainty: 'Unverified' }

function H({ children }) {
  return <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">{children}</h3>
}

function Score({ r }) {
  if (!r) return <span className="text-muted">n/a</span>
  return <span className={`font-mono font-semibold ${RISK_STYLE[r.label] || ''}`}>{r.score}</span>
}

function SeatRow({ id, r, members, markets }) {
  const a = useAgent(id)
  const model = members.find((m) => m.id === id)?.model
  return (
    <tr className="border-t border-line">
      <td className="py-1.5 pr-3"><span className="font-semibold">{a.label}</span>{a.role && <span className="text-muted"> · {a.role}</span>}</td>
      <td className="py-1.5 pr-3 font-mono text-[13px] text-muted">{model || '-'}</td>
      <td className="py-1.5 pr-3 text-right"><Score r={r} /></td>
      {markets.map((c) => <td key={c} className="py-1.5 pr-3 text-right font-mono">{r.markets?.[c] ?? <span className="text-muted">-</span>}</td>)}
    </tr>
  )
}

export default function Scientific({ state, sources, names }) {
  const b = state.brief
  const risk = b?.risk
  const members = state.council?.members || []
  const markets = state.council?.markets?.map((m) => m.code) || Object.keys(risk?.markets || {})
  const packs = state.packs || {}
  const weights = b?.evidence_weights || {}

  return (
    <div className="flex flex-col gap-5">
      {b && (
        <section className="flex flex-col gap-2">
          <H>Chair's brief (as written, with source ids)</H>
          <p className="text-[17px] font-semibold leading-snug">{b.headline}</p>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-[15px] leading-snug">
            {b.key_risks.map((k, i) => <li key={i}>{k}</li>)}
          </ol>
          {b.triggers?.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-[14px] text-muted">
              {b.triggers.map((t, i) => <li key={i}>If {t.condition} → {t.would_change}</li>)}
            </ul>
          )}
        </section>
      )}

      {risk && (
        <section className="flex flex-col gap-2">
          <H>Risk score by AI, alone and together (0-100)</H>
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="text-left text-[13px] text-muted">
                  <th className="pb-1 pr-3 font-medium">Seat</th>
                  <th className="pb-1 pr-3 font-medium">Model</th>
                  <th className="pb-1 pr-3 text-right font-medium">Overall</th>
                  {markets.map((c) => <th key={c} className="pb-1 pr-3 text-right font-medium">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {Object.entries(risk.by_seat || {}).map(([id, r]) => (
                  <SeatRow key={id} id={id} r={r} members={members} markets={markets} />
                ))}
                <tr className="border-t-2 border-line-strong font-semibold">
                  <td className="py-1.5 pr-3">Council together</td>
                  <td className="py-1.5 pr-3 text-[13px] font-normal text-muted">evidence-weighted matrix</td>
                  <td className="py-1.5 pr-3 text-right"><Score r={risk.together || risk.portfolio} /></td>
                  {markets.map((c) => <td key={c} className="py-1.5 pr-3 text-right"><Score r={risk.markets?.[c]} /></td>)}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[13px] text-muted">
            Each AI is scored on its own final votes and its own unverified-claim share (no disagreement term: one voter
            cannot disagree with itself). Market specialists cover only their market. Overall ={' '}
            {(risk.together?.basis || 'your exposure')}. Method: {risk.method}.
          </p>
        </section>
      )}

      {risk && (
        <section className="flex flex-col gap-2">
          <H>Council risk components per market</H>
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="text-left text-[13px] text-muted">
                  <th className="pb-1 pr-3 font-medium">Market</th>
                  <th className="pb-1 pr-3 text-right font-medium">Score</th>
                  {COMPONENTS.map((k) => <th key={k} className="pb-1 pr-3 text-right font-medium">{LABEL[k]}</th>)}
                  <th className="pb-1 pr-3 text-right font-medium">20d vol %</th>
                  <th className="pb-1 text-right font-medium">1m %</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(risk.markets || {}).map(([c, r]) => (
                  <tr key={c} className="border-t border-line font-mono">
                    <td className="py-1.5 pr-3 font-sans">{names[c] || c}</td>
                    <td className="py-1.5 pr-3 text-right"><Score r={r} /></td>
                    {COMPONENTS.map((k) => <td key={k} className="py-1.5 pr-3 text-right">{r.components[k] ?? '-'}</td>)}
                    <td className="py-1.5 pr-3 text-right">{r.inputs.vol_20d_pct ?? '-'}</td>
                    <td className="py-1.5 text-right">{r.inputs.chg_1m_pct ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {risk.portfolio && (
            <p className="text-[13px] text-muted">
              Portfolio: {risk.portfolio.score} = exposure-weighted markets {risk.portfolio.components.weighted_markets} +
              concentration {risk.portfolio.components.concentration} (covers {risk.portfolio.covered_pct}% of invested money).
            </p>
          )}
        </section>
      )}

      {Object.keys(weights).length > 0 && (
        <section className="flex flex-col gap-1.5">
          <H>Evidence weights in the matrix</H>
          <p className="font-mono text-[14px]">
            {Object.entries(weights).map(([a, w]) => `${a} ${w.toFixed(2)}`).join(' · ')}
          </p>
          <p className="text-[13px] text-muted">0.25 + 0.75 × share of the seat's claims that passed the citation and number checks.</p>
        </section>
      )}

      {Object.keys(packs).length > 0 && (
        <section className="flex flex-col gap-1.5">
          <H>Data used in this run</H>
          <ul className="flex flex-col gap-0.5 font-mono text-[13px] text-muted">
            {Object.values(packs).map((p) => (
              <li key={p.country}>
                {p.country}: close {p.as_of?.slice(0, 16)} · prices fetched {p.prices_fetched_at?.slice(0, 16) || '-'} · headlines{' '}
                {p.news_fetched_at?.slice(0, 16) || '-'} · {p.sectors.length} sector proxies · macro {p.macro.map((m) => m.id).join(', ') || 'none'}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Matrix state={state} />
      <div className="h-[26rem]">
        <SpilloverGraph state={state} sources={sources} />
      </div>
    </div>
  )
}
