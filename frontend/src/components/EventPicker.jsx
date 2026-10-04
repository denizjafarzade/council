import { useEffect, useState } from 'react'
import { PRESETS, STAGES } from '../lib/constants'
import { slugify } from '../lib/council'
import { votersOf } from '../lib/roster'

/** Recordings bundled with the frontend, plus any the backend has saved since. */
function useRecordings(bundled, status) {
  const [remote, setRemote] = useState([])
  useEffect(() => {
    fetch('/council/recordings')
      .then((r) => (r.ok ? r.json() : []))
      .then(setRemote)
      .catch(() => setRemote([]))
  }, [status]) // refetch after each run: a finished live run is a new recording
  return Object.fromEntries([...bundled, ...remote].map((r) => [r.slug, r])) // backend entries carry dates, so they win
}

const button = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 disabled:cursor-not-allowed disabled:opacity-40'

/** Pick an event and start it: live, from a recording, or from the mock. */
export default function EventPicker({ state, onRun, onReplay, recordings: bundled = [], onReplayRecorded }) {
  const [text, setText] = useState(state.event || PRESETS[0])
  const running = state.status === 'running'
  const recordings = useRecordings(bundled, state.status)
  const recorded = recordings[slugify(text)]
  const [speed, setSpeed] = useState(1)

  function submit(e) {
    e.preventDefault()
    if (text.trim() && !running) onRun(text.trim())
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-line bg-panel px-5 py-4">
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm font-medium text-muted">
          What should the council debate?
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Describe a market event…"
            className="min-h-12 rounded-xl border border-line-strong bg-desk px-3.5 text-lg text-ink outline-none focus:border-gold"
          />
        </label>
        <button type="submit" disabled={running || !text.trim()} className={`${button} bg-gold px-5 font-semibold text-gold-ink hover:bg-gold-hover`}>
          Convene the council
        </button>
        {onReplayRecorded && (
          <span className="flex items-stretch gap-1.5">
            <button
              type="button"
              disabled={running || !recorded}
              onClick={() => onReplayRecorded(recorded.slug, recorded.event || text.trim(), speed)}
              className={`${button} border border-line-strong text-ink hover:bg-raised`}
              title={recorded ? `Replay the recorded run${recorded.recorded_at ? ` from ${new Date(recorded.recorded_at).toLocaleString()}` : ''}` : 'No recorded run for this event yet'}
            >
              ▶ Replay recorded
            </button>
            {recorded && (
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                disabled={running}
                aria-label="Replay speed"
                className="rounded-xl border border-line-strong bg-desk px-2 text-sm text-ink"
                title="Replay speed: 2× fits the 90-second live-run slot in the pitch"
              >
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={4}>4×</option>
              </select>
            )}
          </span>
        )}
        <button
          type="button"
          disabled={running}
          onClick={() => onReplay(text.trim() || PRESETS[0])}
          className={`${button} border border-dashed border-line-strong text-muted hover:bg-raised hover:text-ink`}
          title="Replay mocks/council_run.json (no backend needed)"
        >
          Mock run
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={running}
            onClick={() => setText(p)}
            aria-pressed={text === p}
            className={`min-h-10 rounded-full border px-3.5 text-sm disabled:opacity-40 ${
              text === p ? 'border-gold bg-gold-soft text-gold-text' : 'border-line-strong text-ink hover:bg-raised'
            }`}
          >
            {recordings[slugify(p)] && <span className="mr-1.5 inline-block size-2 rounded-full bg-ok align-middle" title="Recorded run available" />}
            {p}
          </button>
        ))}
      </div>
    </form>
  )
}

/** What each stage has produced so far, for the rail under its name. */
function stageDetail(id, state) {
  const status = state.stages[id]
  const n = (o) => Object.keys(o).length
  switch (id) {
    case 'data':
      return state.council ? `${state.council.markets.length} markets` : ''
    case 'blind_vote':
      return status === 'pending' ? '' : `${n(state.votes.blind)}/${votersOf(state, 'blind')}`
    case 'debate': {
      const msgs = state.feed.filter((f) => f.kind === 'message').length
      return msgs ? `${msgs} msgs` : ''
    }
    case 'revote':
      return status === 'pending' ? '' : `${n(state.votes.revote)}/${votersOf(state, 'revote')}`
    case 'spillover':
      return status === 'skipped' ? 'no seat' : state.spillover ? `${state.spillover.edges.length} links` : ''
    case 'brief':
      return state.brief ? 'ready' : ''
    default:
      return ''
  }
}

const BAR = { pending: 'bg-line', started: 'bg-gold animate-pulse', done: 'bg-gold', failed: 'bg-bear', skipped: 'bg-line-strong' }

export function StageBar({ state }) {
  return (
    <ol className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-6" aria-label="Session progress">
      {STAGES.map((s) => {
        const status = state.stages[s.id] || 'pending'
        return (
          <li key={s.id} className="flex flex-col gap-1.5" aria-current={status === 'started' ? 'step' : undefined}>
            <span className={`h-1.5 rounded-full transition-colors ${BAR[status] || BAR.pending}`} />
            <span className="flex items-baseline justify-between gap-2 text-sm">
              <span className={`font-semibold ${status === 'pending' ? 'text-muted' : status === 'failed' ? 'text-bear' : 'text-ink'}`}>
                {s.label}{status === 'failed' && ' (failed)'}
              </span>
              <span className="font-mono text-[13px] text-muted">{stageDetail(s.id, state)}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
