import { useMemo } from 'react'
import { DISCLAIMER } from '../lib/constants'
import { LEAN_WORDS, bearishShareLine, buildCards, exposureLine, plain, when } from '../lib/cards'
import { Flag, Panel, SourceChip } from './bits'

function Line({ label, children }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2 text-[15px] leading-snug">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  )
}

const LEAN_STYLE = { bearish: 'text-bear', bullish: 'text-bull', neutral: 'text-muted' }

function Card({ card, portfolio, sources }) {
  return (
    <article className="flex flex-col gap-2.5 rounded-xl border border-line bg-desk px-4 py-3.5">
      <header className="flex items-center gap-2">
        <Flag code={card.code} />
        <h3 className="text-lg font-semibold text-ink">{card.name}</h3>
      </header>
      <dl className="flex flex-col gap-1.5">
        <Line label="Exposure">{exposureLine(card, portfolio)}</Line>
        <Line label="What happened">{card.happened}</Line>
        <Line label="Specialist view">
          {card.view ? (
            <>
              {card.view}{' '}
              {card.lean && <span className={`whitespace-nowrap font-semibold ${LEAN_STYLE[card.lean]}`}>({LEAN_WORDS[card.lean]})</span>}
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
      <footer className="text-[13px] text-muted">
        Prices as of {when(card.pricesAsOf, false, true)} · headlines fetched {when(card.headlinesAt, true)}
      </footer>
    </article>
  )
}

/** Plain, short, about the user's own money. Replaces the Chair's brief panel. */
export default function MeaningCards({ state, packs, names, sources }) {
  const cards = useMemo(() => buildCards(state, packs, names), [state, packs, names])
  const held = cards.filter((c) => c.exposure > 0)
  const rest = cards.filter((c) => !c.exposure)
  const portfolio = state.portfolio
  const questions = (state.brief?.questions_for_you || []).map((q) => plain(q, names))
  const started = state.mode !== 'idle'

  return (
    <Panel title="What this means for you" bodyClassName="px-5 py-4"
      right={portfolio?.label && <span className="text-xs text-muted">{portfolio.label}</span>}>
      <div className="flex flex-col gap-4">
        {!started ? (
          <p className="text-muted">Pick a headline and convene the council. Load your trades to see your own exposure.</p>
        ) : (
          <>
            <p className="text-[17px] font-semibold leading-snug text-ink">{bearishShareLine(cards, portfolio)}</p>
            {(held.length ? held : cards).map((c) => <Card key={c.code} card={c} portfolio={portfolio} sources={sources} />)}
            {held.length > 0 && rest.length > 0 && (
              <details className="rounded-xl border border-line px-4 py-2.5">
                <summary className="cursor-pointer text-sm text-muted">Markets you don't hold ({rest.map((c) => c.name).join(', ')})</summary>
                <div className="mt-3 flex flex-col gap-3">
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
        <p className="border-t border-line pt-2.5 text-[13px] font-semibold text-[#c4cbd5]">{state.brief?.disclaimer || DISCLAIMER}</p>
      </div>
    </Panel>
  )
}
