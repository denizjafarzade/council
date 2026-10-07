import { useEffect, useMemo, useRef } from 'react'
import { useShifts } from '../hooks/useShifts'
import { COUNTRY_NAMES } from '../lib/constants'
import { formalTitle, minuteTime } from '../lib/formal'
import { useAgent } from '../lib/roster'
import { Avatar, Panel, SourceChip } from './bits'
import { ShieldIcon } from './GuardrailBadge'
import { Shift } from './WhoChanged'

// A claim is unverified if the backend flags it (Stage 3A) or a cited id is not in the data.
function problemsOf(msg, sources) {
  const flagged = Array.isArray(msg.unverified) ? msg.unverified : msg.unverified === true ? ['flagged by the backend'] : []
  const missing = (msg.source_ids || []).filter((id) => !sources[id]).map((id) => `${id} is not in the data`)
  return [...flagged, ...missing.filter((m) => !flagged.some((f) => f.startsWith(m.split(' ')[0])))]
}

/** "... is not in this member's data" -> "... is not in evidence": the courtroom wording for the same check. */
const inEvidence = (p) => p.replace(/not in this member's data|is not in the data/g, 'is not in evidence')
  .replace(/does not match any cited value/g, 'does not match the exhibits').replace(/has no cited data/g, 'has no exhibit')

const SCORE = { bearish: -1, neutral: 0, bullish: 1 }

/** Which side of the chamber a member speaks from: their secret-ballot lean across every cell they voted on. */
function sideOf(vote) {
  const cells = vote?.cells || []
  const weight = cells.reduce((a, c) => a + c.confidence, 0)
  if (!weight) return 'neutral'
  const score = cells.reduce((a, c) => a + SCORE[c.view] * c.confidence, 0) / weight
  return score > 0.2 ? 'rise' : score < -0.2 ? 'fall' : 'neutral'
}

// The Bull and Bear argue their side whatever their ballot says.
const ROLE_SIDE = { BULL: 'rise', BEAR: 'fall' }

const SIDE = {
  fall: { row: 'self-start', bubble: 'border-[#dcbfae] bg-bear-soft', first: 'rounded-tl-[3px]' },
  rise: { row: 'self-end flex-row-reverse', bubble: 'border-[#b9c6da] bg-bull-soft', first: 'rounded-tr-[3px]' },
  neutral: { row: 'self-start', bubble: 'border-line bg-raised', first: 'rounded-tl-[3px]' },
}

const parseChallenge = (text) => text.match(/^Challenge to ([^:]+):\s*(.*)$/s)

/** The tail of what someone said, for a quoted reply. */
function snippet(text) {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= 110) return t
  const tail = t.slice(-110)
  return `…${tail.slice(tail.indexOf(' ') + 1)}`
}

/** A line spoken from the middle of the chamber: the Chair, the Clerk, divisions. */
function Notice({ at, who, dark = false, children }) {
  return (
    <li className={`flex max-w-[92%] flex-col items-center gap-1 self-center rounded-[3px] px-4 py-2 text-center ${
      dark ? 'bg-wood text-wood-ink' : 'border border-dashed border-line-strong bg-desk text-ink-soft'}`}>
      <span className={`text-[11px] font-bold uppercase tracking-[0.14em] ${dark ? 'text-wood-muted' : 'text-oat'}`}>
        {who} · <span className="font-mono font-normal tracking-normal">{minuteTime(at)}</span>
      </span>
      <div className="font-serif text-[14px] leading-relaxed">{children}</div>
    </li>
  )
}

function Withheld({ msg, names }) {
  const a = useAgent(msg.agent)
  return (
    <Notice at={msg.at} who="The Clerk">
      <span className="inline-flex items-start gap-1.5 italic">
        <ShieldIcon size={15} />
        A statement by {formalTitle(msg.agent, a, names).toLowerCase()} was struck from the record by the compliance guardrail
        ({msg.guardrail.reasons.join(', ').toLowerCase()}).
      </span>
    </Notice>
  )
}

/** One point inside a speaker's run of bubbles: the quoted speech it answers, the full text, its exhibits. */
function Bubble({ msg, sources, names, side, first, quoted }) {
  const challenge = parseChallenge(msg.text)
  const target = useAgent(challenge?.[1])
  const problems = problemsOf(msg, sources)
  const cited = (msg.source_ids || []).length > 0
  const s = SIDE[side]
  return (
    <div className={`flex flex-col gap-2 rounded-xl border px-3.5 py-2.5 ${s.bubble} ${first ? s.first : ''}`}>
      {challenge && (
        <span className="text-[13px] font-bold text-bear">
          ↩ Challenges {formalTitle(challenge[1], target, names).replace(/^The /, 'the ')}
        </span>
      )}
      {quoted && (
        <blockquote className="-mt-1 rounded-md bg-panel/70 px-2.5 py-1.5 text-[13px] leading-snug text-ink-soft">
          “{snippet(quoted.text)}”
        </blockquote>
      )}
      <p className="whitespace-pre-line font-serif text-[15px] leading-relaxed text-ink">{challenge ? challenge[2] : msg.text}</p>
      {(cited || problems.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {(msg.source_ids || []).map((id) => <SourceChip key={id} id={id} sources={sources} />)}
          {problems.length ? (
            <span className="font-bold text-bear" title={problems.join('; ')}>Objection sustained: {inEvidence(problems[0])}</span>
          ) : (
            <span className="font-bold text-ok">Admitted</span>
          )}
        </div>
      )}
    </div>
  )
}

/** Consecutive speeches by one member: avatar and name once, then a bubble per point. */
function Run({ run, sources, names }) {
  const a = useAgent(run.agent)
  const s = SIDE[run.side]
  const rise = run.side === 'rise'
  return (
    <li className={`flex max-w-[88%] items-start gap-2.5 ${s.row}`}>
      <Avatar agent={run.agent} size={34} />
      <div className={`flex min-w-0 flex-col gap-1.5 ${rise ? 'items-end' : ''}`}>
        <span className={`text-xs text-muted ${rise ? 'text-right' : ''}`}>
          <b className="text-ink">{formalTitle(run.agent, a, names)}</b> · <span className="font-mono">{minuteTime(run.msgs[0].at)}</span>
        </span>
        {run.msgs.map((m, i) => (
          <Bubble key={m.id} msg={m} sources={sources} names={names} side={run.side} first={i === 0} quoted={run.quotes[m.id]} />
        ))}
      </div>
    </li>
  )
}

function HearHear({ item }) {
  const a = useAgent(item.agent)
  return (
    <li className="self-center font-serif text-[13px] italic text-ink-soft" title={`Cites the same evidence: ${item.shared.join(', ')}`}>
      Hear, hear. <span className="font-sans not-italic text-xs text-muted">· {a.label}</span>
    </li>
  )
}

function Ballots({ items, label }) {
  const jev = items.filter((v) => v.source === 'jev').length
  const fallback = items.filter((v) => v.fallback)
  return (
    <Notice at={items[items.length - 1].at} who={`Division · ${label}`}>
      <span className="flex flex-wrap items-center justify-center gap-1.5 font-sans">
        {items.map((v) => <Avatar key={v.id} agent={v.agent} size={24} />)}
        <span className="ml-1 text-sm text-muted">
          {items.length === 1 ? '1 vote cast' : `${items.length} votes cast`}{jev > 0 && ` · ${jev} by Jev`}
        </span>
        {fallback.length > 0 && (
          <span className="text-xs font-semibold text-bear" title={fallback.map((v) => `${v.agent}: ${v.fallback}`).join('\n')}>
            · {fallback.length} LLM fallback{fallback.length > 1 ? 's' : ''} (Jev failed)
          </span>
        )}
      </span>
    </Notice>
  )
}

function Skipped({ item, names }) {
  const a = useAgent(item.agent)
  const reason = item.message.replace(new RegExp(`^${item.agent} skipped in [^:]+: `), '')
  return (
    <Notice at={item.at} who="The Clerk">
      <span className="italic">{item.agent ? `${formalTitle(item.agent, a, names)} was absent: ${reason}` : reason}</span>
    </Notice>
  )
}

/**
 * Turn the feed into the conversation: votes collapse into divisions, a member's consecutive speeches
 * become one run of bubbles, a challenge quotes the speech it answers, and a member who backs the
 * previous speaker with the same evidence gets a "Hear, hear" first.
 */
function arrange(feed, blind) {
  const out = []
  const lastSaid = {} // agent -> their latest non-challenge speech, for quoted replies
  let section = 'Secret ballot'
  let prev = null // the previous speech, for "Hear, hear"
  for (const item of feed) {
    if (item.kind === 'divider') section = item.label
    const last = out[out.length - 1]
    if (item.kind === 'vote') {
      if (last?.kind === 'ballots') last.items.push(item)
      else out.push({ kind: 'ballots', id: item.id, items: [item], label: section.toLowerCase() })
      continue
    }
    const speech = item.kind === 'message' && item.agent !== 'CHAIR' && item.guardrail?.action !== 'blocked'
    if (!speech) {
      out.push(item)
      if (item.kind === 'divider') prev = null
      continue
    }
    const side = ROLE_SIDE[item.agent] || sideOf(blind[item.agent])
    const challenge = parseChallenge(item.text)
    const said = challenge && lastSaid[challenge[1]]
    const shared = prev && prev.agent !== item.agent && !challenge && side !== 'neutral' && (ROLE_SIDE[prev.agent] || sideOf(blind[prev.agent])) === side
      ? (item.source_ids || []).filter((id) => id !== 'EVENT' && (prev.source_ids || []).includes(id)) : []
    if (shared.length) out.push({ kind: 'hear', id: `hear-${item.id}`, agent: item.agent, shared })
    const run = out[out.length - 1]
    if (run?.kind === 'run' && run.agent === item.agent) run.msgs.push(item)
    else out.push({ kind: 'run', id: `run-${item.id}`, agent: item.agent, side, msgs: [item], quotes: {} })
    // Quote the answered speech once per run, not on every challenge to the same member.
    const quotes = out[out.length - 1].quotes
    if (said && !Object.values(quotes).includes(said)) quotes[item.id] = said
    if (!challenge) lastSaid[item.agent] = item
    prev = item
  }
  return out
}

export default function DebateStream({ state, sources }) {
  const end = useRef(null)
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [state.feed.length])
  const items = useMemo(() => arrange(state.feed, state.votes.blind), [state.feed, state.votes.blind])
  const names = useMemo(
    () => ({ ...COUNTRY_NAMES, ...Object.fromEntries((state.council?.markets || []).map((m) => [m.code, m.name])) }),
    [state.council],
  )
  const shifts = useShifts(state)
  const revoted = Object.keys(state.votes.revote).length > 0
  const messages = state.feed.filter((f) => f.kind === 'message')
  const flagged = messages.filter((m) => problemsOf(m, sources).length).length
  const speaking = state.status === 'running' && state.stages.debate === 'started'

  return (
    <Panel
      title="Minutes of the debate"
      right={
        <span className="flex flex-wrap items-center justify-end gap-x-3 text-sm text-muted">
          <span className="font-semibold"><span className="text-bear">◀ fall</span> · <span className="text-bull">rise ▶</span></span>
          <span>{messages.length} entries{flagged > 0 && ` · ${flagged} objections`}</span>
        </span>
      }
      className="h-full"
      bodyClassName="px-4 py-3"
    >
      {!state.feed.length ? (
        <p className="py-3 font-serif italic text-muted">
          {state.status === 'running' ? 'The clerk is gathering the evidence…' : 'Members vote by secret ballot first, then the floor opens.'}
        </p>
      ) : (
        <ol className="flex flex-col gap-3.5">
          {items.map((item) =>
            item.kind === 'divider' ? (
              <li key={item.id} className="flex items-center gap-2.5 pt-2 text-xs font-bold uppercase tracking-[0.18em] text-oat">
                <span className="h-px flex-1 bg-brass/50" />
                {item.label}
                <span className="h-px flex-1 bg-brass/50" />
              </li>
            ) : item.kind === 'ballots' ? (
              <Ballots key={item.id} items={item.items} label={item.label} />
            ) : item.kind === 'run' ? (
              <Run key={item.id} run={item} sources={sources} names={names} />
            ) : item.kind === 'hear' ? (
              <HearHear key={item.id} item={item} />
            ) : item.kind === 'message' && item.guardrail?.action === 'blocked' ? (
              <Withheld key={item.id} msg={item} names={names} />
            ) : item.kind === 'message' ? (
              <Notice key={item.id} at={item.at} who="The Chair" dark>{item.text}</Notice>
            ) : (
              <Skipped key={item.id} item={item} names={names} />
            ),
          )}
          {speaking && (
            <li className="flex items-center gap-2.5 border-t border-dashed border-line-strong pt-3 text-sm text-ink-soft">
              <span className="font-serif italic">Members rise to speak</span>
              <span className="flex gap-1" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-1.5 animate-pulse rounded-full bg-oat" style={{ animationDelay: `${i * 200}ms` }} />
                ))}
              </span>
            </li>
          )}
          {revoted && (
            <>
              <li className="flex items-center gap-2.5 pt-2 text-xs font-bold uppercase tracking-[0.18em] text-oat">
                <span className="h-px flex-1 bg-brass/50" />
                Crossed the floor · {shifts.length}
                <span className="h-px flex-1 bg-brass/50" />
              </li>
              {shifts.length ? (
                <ul className="flex flex-col gap-2">{shifts.map((sh) => <Shift key={`${sh.agent}-${sh.cell}`} s={sh} />)}</ul>
              ) : (
                <li className="self-center font-serif text-sm italic text-muted">No member changed position in the second ballot.</li>
              )}
            </>
          )}
          <li ref={end} />
        </ol>
      )}
    </Panel>
  )
}
