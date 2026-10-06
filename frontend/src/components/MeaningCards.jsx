import { useMemo, useState } from 'react'
import { DISCLAIMER } from '../lib/constants'
import { LEAN_WORDS, SECTOR_NAMES, bottomLine, buildCards, exposureLine, plain, when } from '../lib/cards'
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

const RISK_STYLE = { low: 'text-ok', moderate: 'text-[#8a5a00]', high: 'text-bear' }
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
    <article className="flex flex-col gap-2.5 rounded-md border border-line bg-desk px-4 py-3.5">
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

const OUTLOOK = {
  cautious: { label: 'Cautious', style: 'text-bear', border: 'border-bear' },
  mixed: { label: 'Mixed', style: 'text-[#8a5a00]', border: 'border-[#8a5a00]' },
  positive: { label: 'Positive', style: 'text-bull', border: 'border-bull' },
}
const LEAN_SHORT = { bearish: ['Negative', 'text-bear'], neutral: ['No clear lean', 'text-muted'], bullish: ['Positive', 'text-bull'] }

/** The answer first: outlook for the user's money, risk, one sentence why. */
function BottomLine({ line }) {
  const o = OUTLOOK[line.outlook]
  return (
    <section className={`flex flex-wrap items-center gap-5 rounded-md border-l-4 ${o.border} bg-desk px-5 py-4`}>
      <div className="flex min-w-[15rem] flex-1 flex-col gap-1.5">
        <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Bottom line</span>
        <span className={`text-[28px] font-semibold leading-none ${o.style}`}>{o.label} outlook</span>
        <p className="text-[17px] leading-snug text-ink">{line.why}</p>
        <p className="text-[13px] text-muted">{line.note}</p>
      </div>
      {line.risk && (
        <div className="flex w-36 flex-col items-center gap-0.5 text-center">
          <span className="text-[13px] text-muted">Risk</span>
          <span className={`font-mono text-[36px] font-semibold leading-none ${RISK_STYLE[line.risk.label]}`}>{line.risk.score}</span>
          <span className={`text-sm font-semibold ${RISK_STYLE[line.risk.label]}`}>
            <span className="capitalize">{line.risk.label}</span> · out of 100
          </span>
        </div>
      )}
    </section>
  )
}

/** One line per market; the full card opens on tap. */
function MarketRow({ card, portfolio, sources }) {
  const [lean, leanStyle] = LEAN_SHORT[card.councilLean] || ['Waiting', 'text-muted']
  return (
    <details className="group rounded-md border border-line bg-desk">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5">
        <Flag code={card.code} />
        <span className="flex-1 font-semibold text-ink">{card.name}</span>
        <span className="w-28 text-right text-sm text-muted">{card.exposure ? `${card.exposure}% of your money` : 'not held'}</span>
        <span className={`w-28 text-right text-sm font-semibold ${leanStyle}`}>{lean}</span>
        <span className={`w-20 text-right font-mono text-sm font-semibold ${card.risk ? RISK_STYLE[card.risk.label] : 'text-muted'}`}>
          {card.risk ? `risk ${card.risk.score}` : '-'}
        </span>
        <span className="text-muted group-open:rotate-180" aria-hidden="true">▾</span>
      </summary>
      <div className="px-3 pb-3"><Card card={card} portfolio={portfolio} sources={sources} /></div>
    </details>
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
    <div role="tablist" aria-label="Result language" className="inline-flex rounded-md border border-line bg-desk p-[3px]">
      {[['plain', 'Plain reading'], ['scientific', 'Full record']].map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => choose(id)}
          className={`min-h-9 rounded-[9px] px-3.5 text-sm font-medium ${tab === id ? 'bg-gold text-gold-ink' : 'text-ink-soft hover:text-ink'}`}>
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
  // Lines the compliance guardrail withheld are counted, not repeated as boilerplate.
  const isWithheld = (t) => t.startsWith('Withheld by')
  const questions = (brief?.questions_for_you || []).filter((q) => !isWithheld(q)).map((q) => plain(q, names, sectorNames))
  const withheldQuestions = (brief?.questions_for_you || []).filter(isWithheld).length
  const keyRisks = (brief?.key_risks || []).map((r) => plain(r, names, sectorNames))
  const started = state.mode !== 'idle'
  const plainText = useMemo(() => plainEnglish(brief, state.event, names), [brief, state.event, names])
  const line = useMemo(() => bottomLine(cards, portfolio, risk), [cards, portfolio, risk])

  return (
    <Panel ruled bodyClassName="px-5 py-4"
      title={<span className="flex items-center gap-3">
        <span aria-hidden="true" className="inline-flex size-9 items-center justify-center rounded-full bg-gold font-serif text-base font-bold normal-case tracking-normal text-gold-ink shadow-[0_0_0_2px_var(--color-panel),0_0_0_3px_var(--color-brass)]">V</span>
        Ruling of the Council
      </span>}
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
            {line ? <BottomLine line={line} /> : <p className="text-[18px] text-muted">The council is still working…</p>}
            <div className="flex flex-col gap-2">
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Your markets</h3>
              {[...held, ...rest].map((c) => <MarketRow key={c.code} card={c} portfolio={portfolio} sources={sources} />)}
              <p className="text-[13px] text-muted">Tap a market for what happened, the specialist's view and what to watch.</p>
            </div>
            {(questions.length > 0 || withheldQuestions > 0) && (
              <div className="flex flex-col gap-1.5">
                <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Ask yourself</h3>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-[15px] leading-snug marker:text-muted">
                  {questions.map((q, i) => <li key={i}>{q}</li>)}
                </ul>
                {withheldQuestions > 0 && (
                  <p className="text-[13px] text-muted">
                    {withheldQuestions} question{withheldQuestions > 1 ? 's were' : ' was'} withheld by the compliance guardrail.
                  </p>
                )}
              </div>
            )}
            {brief && (
              <details className="rounded-md border border-line px-4 py-2.5">
                <summary className="cursor-pointer text-sm font-medium text-ink">Why the council thinks this</summary>
                <div className="mt-3 flex flex-col gap-3">
                  <p className="text-[17px] font-semibold leading-snug">{plain(brief.headline, names, sectorNames)}</p>
                  {plainText && <p className="text-[15px] leading-relaxed">{plainText}</p>}
                  {keyRisks.filter((r) => !isWithheld(r)).length > 0 && (
                    <ol className="flex list-decimal flex-col gap-1 pl-5 text-[15px] leading-snug marker:text-muted">
                      {keyRisks.filter((r) => !isWithheld(r)).map((r, i) => <li key={i}>{r}</li>)}
                    </ol>
                  )}
                  <TrustNote brief={brief} votes={state.votes} />
                </div>
              </details>
            )}
          </>
        )}
        <p className="border-t border-line pt-2.5 text-[13px] font-semibold text-ink-soft">{brief?.disclaimer || DISCLAIMER}</p>
      </div>
    </Panel>
  )
}
