import { useEffect, useMemo, useRef, useState } from 'react'
import { useAgent } from '../lib/roster'
import { Avatar, Panel, SourceChip } from './bits'
import { ShieldIcon } from './GuardrailBadge'
import { useShifts } from '../hooks/useShifts'
import { Shift } from './WhoChanged'

// A claim is unverified if the backend flags it (Stage 3A) or a cited id is not in the data.
function problemsOf(msg, sources) {
  const flagged = Array.isArray(msg.unverified) ? msg.unverified : msg.unverified === true ? ['flagged by the backend'] : []
  const missing = (msg.source_ids || []).filter((id) => !sources[id]).map((id) => `${id} is not in the data`)
  return [...flagged, ...missing.filter((m) => !flagged.some((f) => f.startsWith(m.split(' ')[0])))]
}

function Withheld({ msg }) {
  const a = useAgent(msg.agent)
  return (
    <li className="flex flex-col gap-1.5 rounded-xl border border-[#2f3d57] bg-[#141b26] px-3.5 py-3">
      <div className="flex items-center gap-2.5">
        <Avatar agent={msg.agent} />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate font-semibold">{a.label}</span>
          <span className="inline-flex items-center gap-1.5 text-[13px] text-[#b9d3f2]">
            <ShieldIcon size={14} />Blocked by the compliance guardrail · {msg.guardrail.reasons.join(', ')}
          </span>
        </span>
      </div>
      <p className="text-sm italic leading-snug text-muted">{msg.text}</p>
    </li>
  )
}

/** A message, open by default; its header folds it away (who spoke and the trust check stay visible). */
function Message({ msg, sources }) {
  const [open, setOpen] = useState(true)
  const a = useAgent(msg.agent)
  const challenge = msg.text.match(/^Challenge to ([^:]+):\s*(.*)$/s)
  const target = useAgent(challenge?.[1])
  const problems = problemsOf(msg, sources)
  const cited = (msg.source_ids || []).length > 0
  return (
    <li className="rounded-xl bg-raised">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left">
        <Avatar agent={msg.agent} size={28} />
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-semibold">{a.label}</span>
          <span className="text-muted"> · {challenge ? `challenges ${target.label}` : 'message'}</span>
        </span>
        {problems.length > 0 ? (
          <span className="shrink-0 text-xs font-semibold text-bear" title={problems.join('; ')}>⚠ unverified</span>
        ) : cited ? (
          <span className="shrink-0 text-xs text-ok" title="Checked against the data">✓</span>
        ) : null}
        <span className="shrink-0 text-muted" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-3.5 pb-3">
          <p className="text-base leading-snug text-[#e3e7ec]">{challenge ? challenge[2] : msg.text}</p>
          {(cited || problems.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {(msg.source_ids || []).map((id) => <SourceChip key={id} id={id} sources={sources} />)}
              {problems.length ? (
                <span className="text-xs font-semibold text-bear">⚠ {problems.join('; ')}</span>
              ) : (
                <span className="text-xs text-ok">✓ checked against the data</span>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function Ballots({ items }) {
  const jev = items.filter((v) => v.source === 'jev').length
  const fallback = items.filter((v) => v.fallback)
  return (
    <li className="flex flex-wrap items-center gap-1.5 px-1">
      {items.map((v) => <Avatar key={v.id} agent={v.agent} size={26} />)}
      <span className="ml-1 text-sm text-muted">
        {items.length === 1 ? 'voted' : `${items.length} votes in`}{jev > 0 && ` · ${jev} by Jev`}
      </span>
      {fallback.length > 0 && (
        <span className="text-xs font-semibold text-bear" title={fallback.map((v) => `${v.agent}: ${v.fallback}`).join('\n')}>
          · {fallback.length} LLM fallback{fallback.length > 1 ? 's' : ''} (Jev failed)
        </span>
      )}
    </li>
  )
}

function Skipped({ item }) {
  const a = useAgent(item.agent)
  return (
    <li className="px-1.5 text-sm text-muted">
      {item.agent ? <><span className="font-semibold text-[#c4cbd5]">{a.label}</span> skipped: </> : ''}
      {item.message.replace(new RegExp(`^${item.agent} skipped in [^:]+: `), '')}
    </li>
  )
}

/** Consecutive vote arrivals collapse into one row of avatars. */
function group(feed) {
  const out = []
  for (const item of feed) {
    const last = out[out.length - 1]
    if (item.kind === 'vote' && last?.kind === 'ballots') last.items.push(item)
    else out.push(item.kind === 'vote' ? { kind: 'ballots', id: item.id, items: [item] } : item)
  }
  return out
}

export default function DebateStream({ state, sources }) {
  const end = useRef(null)
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [state.feed.length])
  const items = useMemo(() => group(state.feed), [state.feed])
  const shifts = useShifts(state)
  const revoted = Object.keys(state.votes.revote).length > 0
  const messages = state.feed.filter((f) => f.kind === 'message')
  const flagged = messages.filter((m) => problemsOf(m, sources).length).length

  return (
    <Panel
      title="The floor"
      right={<span className="text-sm text-muted">{messages.length} messages{flagged > 0 && ` · ${flagged} unverified`}{shifts.length > 0 && ` · ${shifts.length} changed their mind`}</span>}
      className="h-full"
      bodyClassName="px-3.5 py-3"
    >
      {!state.feed.length ? (
        <p className="p-2 text-muted">
          {state.status === 'running' ? 'The council is gathering its data…' : 'Members vote blind first, then argue their case here.'}
        </p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {items.map((item) =>
            item.kind === 'divider' ? (
              <li key={item.id} className="flex items-center gap-2.5 px-1 pt-1.5 font-mono text-xs uppercase tracking-[0.08em] text-gold">
                {item.label}
                <span className="h-px flex-1 bg-line" />
              </li>
            ) : item.kind === 'ballots' ? (
              <Ballots key={item.id} items={item.items} />
            ) : item.kind === 'message' && item.guardrail?.action === 'blocked' ? (
              <Withheld key={item.id} msg={item} />
            ) : item.kind === 'message' ? (
              <Message key={item.id} msg={item} sources={sources} />
            ) : (
              <Skipped key={item.id} item={item} />
            ),
          )}
          {revoted && (
            <>
              <li className="flex items-center gap-2.5 px-1 pt-1.5 font-mono text-xs uppercase tracking-[0.08em] text-gold">
                Changed their mind · {shifts.length}
                <span className="h-px flex-1 bg-line" />
              </li>
              {shifts.length ? shifts.map((sh) => <Shift key={`${sh.agent}-${sh.cell}`} s={sh} />)
                : <li className="px-1.5 text-sm text-muted">Nobody changed their view in the revote.</li>}
            </>
          )}
          <li ref={end} />
        </ol>
      )}
    </Panel>
  )
}
