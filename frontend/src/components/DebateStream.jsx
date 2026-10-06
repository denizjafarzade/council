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

function Entry({ at, who, whoClass = 'text-ink', children }) {
  return (
    <li className="flex flex-col gap-1.5 border-b border-line py-3 last:border-b-0">
      <span className="flex items-baseline gap-2.5">
        <span className="font-mono text-xs text-muted">{minuteTime(at)}</span>
        <span className={`text-xs font-bold uppercase tracking-[0.1em] ${whoClass}`}>{who}</span>
      </span>
      {children}
    </li>
  )
}

function Withheld({ msg, names }) {
  const a = useAgent(msg.agent)
  return (
    <Entry at={msg.at} who="The Clerk" whoClass="text-oat">
      <p className="inline-flex items-start gap-1.5 font-serif text-[15px] italic leading-relaxed text-ink-soft">
        <ShieldIcon size={15} />
        A statement by {formalTitle(msg.agent, a, names).toLowerCase()} was struck from the record by the compliance guardrail
        ({msg.guardrail.reasons.join(', ').toLowerCase()}).
      </p>
    </Entry>
  )
}

/** One entry in the minutes: who spoke, everything they said, the exhibits they cited and whether they stood up. */
function Message({ msg, sources, names }) {
  const a = useAgent(msg.agent)
  const challenge = msg.text.match(/^Challenge to ([^:]+):\s*(.*)$/s)
  const target = useAgent(challenge?.[1])
  const problems = problemsOf(msg, sources)
  const cited = (msg.source_ids || []).length > 0
  const title = formalTitle(msg.agent, a, names)
  const chair = msg.agent === 'CHAIR'
  return (
    <Entry at={msg.at}
      who={challenge ? `On a point of order · ${title}, to ${formalTitle(challenge[1], target, names).replace(/^The /, 'the ')}` : title}
      whoClass={challenge ? 'text-bear' : chair ? 'text-oat' : 'text-ink'}>
      <p className={`whitespace-pre-line font-serif text-[15px] leading-relaxed text-ink ${chair ? 'italic' : ''}`}>
        {challenge ? challenge[2] : msg.text}
      </p>
      {(cited || problems.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {cited && <span className="text-muted">Exhibits</span>}
          {(msg.source_ids || []).map((id) => <SourceChip key={id} id={id} sources={sources} />)}
          {problems.length ? (
            <span className="font-bold text-bear" title={problems.join('; ')}>Objection sustained: {inEvidence(problems[0])}</span>
          ) : (
            <span className="font-bold text-ok">Admitted</span>
          )}
        </div>
      )}
    </Entry>
  )
}

function Ballots({ items, label }) {
  const jev = items.filter((v) => v.source === 'jev').length
  const fallback = items.filter((v) => v.fallback)
  return (
    <Entry at={items[items.length - 1].at} who={`Division · ${label}`} whoClass="text-oat">
      <span className="flex flex-wrap items-center gap-1.5">
        {items.map((v) => <Avatar key={v.id} agent={v.agent} size={26} />)}
        <span className="ml-1 text-sm text-muted">
          {items.length === 1 ? '1 vote cast' : `${items.length} votes cast`}{jev > 0 && ` · ${jev} by Jev`}
        </span>
        {fallback.length > 0 && (
          <span className="text-xs font-semibold text-bear" title={fallback.map((v) => `${v.agent}: ${v.fallback}`).join('\n')}>
            · {fallback.length} LLM fallback{fallback.length > 1 ? 's' : ''} (Jev failed)
          </span>
        )}
      </span>
    </Entry>
  )
}

function Skipped({ item, names }) {
  const a = useAgent(item.agent)
  const reason = item.message.replace(new RegExp(`^${item.agent} skipped in [^:]+: `), '')
  return (
    <Entry at={item.at} who="The Clerk" whoClass="text-oat">
      <p className="font-serif text-[15px] italic leading-relaxed text-ink-soft">
        {item.agent ? `${formalTitle(item.agent, a, names)} was absent: ${reason}` : reason}
      </p>
    </Entry>
  )
}

/** Consecutive vote arrivals collapse into one division. */
function group(feed) {
  const out = []
  let section = 'Secret ballot'
  for (const item of feed) {
    if (item.kind === 'divider') section = item.label
    const last = out[out.length - 1]
    if (item.kind === 'vote' && last?.kind === 'ballots') last.items.push(item)
    else out.push(item.kind === 'vote' ? { kind: 'ballots', id: item.id, items: [item], label: section.toLowerCase() } : item)
  }
  return out
}

export default function DebateStream({ state, sources }) {
  const end = useRef(null)
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [state.feed.length])
  const items = useMemo(() => group(state.feed), [state.feed])
  const names = useMemo(
    () => ({ ...COUNTRY_NAMES, ...Object.fromEntries((state.council?.markets || []).map((m) => [m.code, m.name])) }),
    [state.council],
  )
  const shifts = useShifts(state)
  const revoted = Object.keys(state.votes.revote).length > 0
  const messages = state.feed.filter((f) => f.kind === 'message')
  const flagged = messages.filter((m) => problemsOf(m, sources).length).length

  return (
    <Panel
      title="Minutes of the debate"
      right={<span className="text-sm text-muted">{messages.length} entries{flagged > 0 && ` · ${flagged} objections`}</span>}
      className="h-full"
      bodyClassName="px-5 py-1"
    >
      {!state.feed.length ? (
        <p className="py-3 font-serif italic text-muted">
          {state.status === 'running' ? 'The clerk is gathering the evidence…' : 'Members vote by secret ballot first, then the floor opens.'}
        </p>
      ) : (
        <ol className="flex flex-col">
          {items.map((item) =>
            item.kind === 'divider' ? (
              <li key={item.id} className="flex items-center gap-2.5 pb-1 pt-4 text-xs font-bold uppercase tracking-[0.18em] text-oat">
                {item.label}
                <span className="h-px flex-1 bg-brass/50" />
              </li>
            ) : item.kind === 'ballots' ? (
              <Ballots key={item.id} items={item.items} label={item.label} />
            ) : item.kind === 'message' && item.guardrail?.action === 'blocked' ? (
              <Withheld key={item.id} msg={item} names={names} />
            ) : item.kind === 'message' ? (
              <Message key={item.id} msg={item} sources={sources} names={names} />
            ) : (
              <Skipped key={item.id} item={item} names={names} />
            ),
          )}
          {revoted && (
            <>
              <li className="flex items-center gap-2.5 pb-2 pt-4 text-xs font-bold uppercase tracking-[0.18em] text-oat">
                Changed position · {shifts.length}
                <span className="h-px flex-1 bg-brass/50" />
              </li>
              {shifts.length ? (
                <ul className="flex flex-col gap-2 pb-3">{shifts.map((sh) => <Shift key={`${sh.agent}-${sh.cell}`} s={sh} />)}</ul>
              ) : (
                <li className="pb-3 font-serif text-sm italic text-muted">No member changed position in the second ballot.</li>
              )}
            </>
          )}
          <li ref={end} />
        </ol>
      )}
    </Panel>
  )
}
