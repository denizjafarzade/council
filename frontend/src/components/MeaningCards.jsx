import { useMemo, useState } from 'react'
import { DISCLAIMER } from '../lib/constants'
import { LEAN_WORDS, SECTOR_NAMES, bearishShareLine, buildCards, exposureLine, plain, when } from '../lib/cards'
import { plainEnglish } from '../lib/plain'
import { useAgent } from '../lib/roster'
import { Flag, Panel, SourceChip } from './bits'
import Scientific from './Scientific'

const TAB_KEY = 'verdisk-result-tab'

function savedTab() {
  try {
    return localStorage.getItem(TAB_KEY) === 'scientific' ? 'scientific' : 'plain'
  } catch {
    return 'plain' // storage can be blocked (private window); plain English is the default
  }
}

const RISK_STYLE = { low: 'text-ok', moderate: 'text-gold-text', high: 'text-bear' }
const COMPONENT_LABELS = {
  volatility: 'Volatility (20-day)', drawdown: 'Fall over 1 month', council_view: 'Council view',
  disagreement: 'Disagreement', uncertainty: 'Unverified claims',
}
const LEAN_STYLE = { bearish: 'text-bear', bullish: 'text-bull', neutral: 'text-muted' }

function Line({ label, children }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-[15px] leading-snug">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  )
}

function RiskBreakdown({ risk }) {
  return (
    <details className="text-[13px] text-muted">
      <summary className="cursor-pointer">How this is calculated</summary>
      <ul className="mt-1 flex flex-col gap-0.5">
        {Object.entries(risk.components).map(([k, v]) => (
          <li key={k} className="flex justify-between gap-3">
            <span>{COMPONENT_LABELS[k] || k.replace(/_/g, ' ')}</span>
            <span className="font-mono">{v === null || v === undefined ? 'n/a' : `${v}/100`}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function Card({ card, portfolio, sources }) {
  return (
    <article className="flex flex-col gap-2.5 rounded-xl border border-line bg-desk px-4 py-3.5">
      <header className="flex items-center gap-2">
        <Flag code={card.code} />
        <h3 className="flex-1 text-lg font-semibold text-ink">{card.name}</h3>
        {card.risk && (
          <span className={`font-mono text-sm font-semibold ${RISK_STYLE[card.risk.label]}`} title="Quantitative risk score, 0-100">
            Risk {card.risk.score}/100
          </span>
        )}
      </header>
      <dl className="flex flex-col gap-1.5">
        <Line label="Exposure">{exposureLine(card, portfolio)}</Line>
        <Line label="What happened">{card.happened}</Line>
        <Line label="Specialist view">
          {card.view ? (
            <>
              {card.view}{' '}
              {card.lean && <span className={`whitespace-nowrap font-semibold ${LEAN_STYLE[card.lean]}`}>({LEAN_WORDS[card.lean]})</span>}
              {card.evidence !== undefined && card.evidence < 1 && (
                <span className="block text-[13px] text-bear">
                  Some of this specialist's claims failed the data checks; its votes counted {Math.round(card.evidence * 100)}%.
                </span>
              )}
              {card.chips.length > 0 && (
                <span className="mt-1 flex flex-wrap gap-1">
                  {card.chips.map((id) => <SourceChip key={id} id={id} sources={sources} />)}
                </span>
              )}
            </>
          ) : <span className="text-muted">Waiting for the specialist.</span>}
        </Line>
        <Line label="Council">
          {card.council ? (card.council === 'split' ? 'Split: members disagree here.' : 'Agree.') : <span className="text-muted">After the revote.</span>}
        </Line>
        <Line label="Watch">{card.watch || <span className="text-muted">No trigger given.</span>}</Line>
      </dl>
      {card.risk && <RiskBreakdown risk={card.risk} />}
      <footer className="text-[13px] text-muted">
        Prices as of {when(card.pricesAsOf, false, true)} · headlines fetched {when(card.headlinesAt, true)}
      </footer>
    </article>
  )
}

function TrustNote({ brief, votes }) {
  const weights = Object.entries(brief?.evidence_weights || {}).filter(([, w]) => w < 1)
  const fallbacks = Object.values(votes.revote).concat(Object.values(votes.blind)).filter((v) => v.fallback)
  if (!weights.length && !fallbacks.length) return null
  return (
    <p className="rounded-lg bg-raised px-3 py-2 text-[13px] text-muted">
      {weights.length > 0 && (
        <>Votes counted less where claims failed the data checks: {weights.map(([a, w], i) => (
          <span key={a}>{i > 0 && ', '}<WeightName id={a} /> {Math.round(w * 100)}%</span>
        ))}. </>
      )}
      {fallbacks.length > 0 && <>{fallbacks.length} vote(s) fell back to an LLM because Jev failed.</>}
    </p>
  )
}

function WeightName({ id }) {
  const a = useAgent(id)
  return <span className="font-semibold text-ink">{a.label}</span>
}

/** The result first: the Chair's brief, a quantitative risk score, and one card per market. */
function Tabs({ tab, setTab }) {
  const choose = (t) => {
    setTab(t)
    try {
      localStorage.setItem(TAB_KEY, t)
    } catch {
      // not remembered across reloads; fine
    }
  }
  return (
    <div role="tablist" aria-label="Result language" className="inline-flex rounded-xl border border-line bg-desk p-[3px]">
      {[['plain', 'Plain English'], ['scientific', 'Scientific']].map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => choose(id)}
          className={`min-h-9 rounded-[9px] px-3.5 text-sm font-medium ${tab === id ? 'bg-gold text-gold-ink' : 'text-[#c4cbd5] hover:text-ink'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

export default function MeaningCards({ state, packs, names, sources }) {
  const [tab, setTab] = useState(savedTab)
  const sectorNames = useMemo(() => ({ ...SECTOR_NAMES, ...(state.council?.sector_names || {}) }), [state.council])
  const cards = useMemo(() => buildCards(state, packs, names, sectorNames), [state, packs, names, sectorNames])
  const held = cards.filter((c) => c.exposure > 0)
  const rest = cards.filter((c) => !c.exposure)
  const portfolio = state.portfolio
  const brief = state.brief
  const risk = brief?.risk
  const questions = (brief?.questions_for_you || []).map((q) => plain(q, names, sectorNames))
  const keyRisks = (brief?.key_risks || []).map((r) => plain(r, names, sectorNames))
  const started = state.mode !== 'idle'
  const plainText = useMemo(() => plainEnglish(brief, state.event, names), [brief, state.event, names])

  return (
    <Panel title="Result" bodyClassName="px-5 py-4"
      right={<span className="flex flex-wrap items-center gap-3">
        {portfolio?.label && <span className="text-xs text-muted">{portfolio.label}</span>}
        <Tabs tab={tab} setTab={setTab} />
      </span>}>
      <div className="flex flex-col gap-4">
        {started && tab === 'scientific' ? (
          <Scientific state={state} sources={sources} names={names} />
        ) : !started ? (
          <p className="text-muted">Pick a headline and convene the council. Load your trades first to see your own exposure and risk.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-start gap-5">
              <div className="flex min-w-[16rem] flex-1 flex-col gap-2">
                <p className="text-[22px] font-semibold leading-snug text-ink">
                  {brief ? plain(brief.headline, names, sectorNames) : 'The council is still working…'}
                </p>
                <p className="text-[16px] leading-snug text-ink">{bearishShareLine(cards, portfolio)}</p>
              </div>
              {risk?.portfolio ? (
                <div className="flex w-56 flex-col gap-1 rounded-xl border border-line bg-desk px-4 py-3">
                  <span className="text-[13px] text-muted">Your portfolio risk</span>
                  <span className={`font-mono text-[34px] font-semibold leading-none ${RISK_STYLE[risk.portfolio.label]}`}>
                    {risk.portfolio.score}<span className="text-base text-muted">/100</span>
                  </span>
                  <span className={`text-sm font-semibold capitalize ${RISK_STYLE[risk.portfolio.label]}`}>{risk.portfolio.label}</span>
                  <details className="text-[13px] text-muted">
                    <summary className="cursor-pointer">How this is calculated</summary>
                    <p className="mt-1">Markets weighted by your exposure: {risk.portfolio.components.weighted_markets}/100, plus {risk.portfolio.components.concentration} for concentration.</p>
                    <p className="mt-1">Each market: {risk.method}.</p>
                  </details>
                </div>
              ) : risk && portfolio === null && (
                <p className="w-56 text-[13px] text-muted">Load your trades to get a portfolio risk score. Market scores are on each card.</p>
              )}
            </div>
            {plainText && <p className="text-[17px] leading-relaxed text-ink">{plainText}</p>}
            {keyRisks.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Key risks</h3>
                <ol className="flex list-decimal flex-col gap-1 pl-5 text-[15px] leading-snug marker:text-muted">
                  {keyRisks.map((r, i) => <li key={i}>{r}</li>)}
                </ol>
              </div>
            )}
            <TrustNote brief={brief} votes={state.votes} />
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">What this means for you</h3>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {(held.length ? held : cards).map((c) => <Card key={c.code} card={c} portfolio={portfolio} sources={sources} />)}
            </div>
            {held.length > 0 && rest.length > 0 && (
              <details className="rounded-xl border border-line px-4 py-2.5">
                <summary className="cursor-pointer text-sm text-muted">Markets you don't hold ({rest.map((c) => c.name).join(', ')})</summary>
                <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {rest.map((c) => <Card key={c.code} card={c} portfolio={portfolio} sources={sources} />)}
                </div>
              </details>
            )}
            {questions.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Ask yourself</h3>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-[15px] leading-snug marker:text-muted">
                  {questions.map((q, i) => <li key={i}>{q}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
        <p className="border-t border-line pt-2.5 text-[13px] font-semibold text-[#c4cbd5]">{brief?.disclaimer || DISCLAIMER}</p>
      </div>
    </Panel>
  )
}
