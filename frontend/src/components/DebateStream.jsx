import { useEffect, useRef } from 'react'
import { AGENTS } from '../lib/constants'
import { AgentIcon, AgentName, Panel, SourceChip } from './bits'

// A claim is unverified if the backend flags it (Stage 3A) or a cited id is not in the data.
function isUnverified(msg, sources) {
  if (msg.unverified === true || (Array.isArray(msg.unverified) && msg.unverified.length)) return true
  return (msg.source_ids || []).some((id) => !sources[id])
}

function Message({ msg, sources }) {
  const color = AGENTS[msg.agent]?.color || '#94a3b8'
  const unverified = isUnverified(msg, sources)
  const uncited = !(msg.source_ids || []).length && msg.agent !== 'CHAIR'
  return (
    <li className="rounded-lg border-l-4 bg-slate-800/60 px-3 py-2" style={{ borderColor: color }}>
      <div className="mb-1 flex items-center gap-2">
        <AgentName agent={msg.agent} />
        {unverified && (
          <span className="rounded bg-amber-500/20 px-1.5 text-xs font-semibold text-amber-300" title="Cites a source that is not in the data">
            ⚠ unverified
          </span>
        )}
        {uncited && !unverified && (
          <span className="rounded bg-slate-700 px-1.5 text-xs text-slate-300" title="No source cited">
            no source
          </span>
        )}
      </div>
      <p className="leading-snug text-slate-100">{msg.text}</p>
      {!!msg.source_ids?.length && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {msg.source_ids.map((id) => (
            <SourceChip key={id} id={id} sources={sources} />
          ))}
        </div>
      )}
    </li>
  )
}

function VoteArrival({ item }) {
  return (
    <li className="flex items-center gap-2 px-1 text-sm text-slate-400">
      <AgentIcon agent={item.agent} className="h-3 w-[18px]" />
      <span>
        {AGENTS[item.agent]?.label || item.agent} {item.round === 'blind' ? 'cast a blind vote' : 'revoted'}
      </span>
      {item.source === 'jev' && <span className="rounded bg-violet-500/20 px-1.5 text-xs text-violet-300">votes by Jev</span>}
    </li>
  )
}

export default function DebateStream({ state, sources }) {
  const end = useRef(null)
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [state.feed.length])

  const messages = state.feed.filter((f) => f.kind === 'message').length
  return (
    <Panel title="Live debate" right={<span className="text-sm text-slate-500">{messages} messages</span>} className="h-full">
      {!state.feed.length ? (
        <p className="text-slate-500">Pick an event and convene the council. Delegates vote blind first, then debate.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {state.feed.map((item) =>
            item.kind === 'message' ? (
              <Message key={item.id} msg={item} sources={sources} />
            ) : item.kind === 'vote' ? (
              <VoteArrival key={item.id} item={item} />
            ) : (
              <li key={item.id} className="rounded-lg bg-rose-950/60 px-3 py-2 text-sm text-rose-200">
                {item.agent ? `${AGENTS[item.agent]?.label || item.agent} skipped: ` : ''}
                {item.message}
              </li>
            ),
          )}
          <li ref={end} />
        </ul>
      )}
    </Panel>
  )
}
