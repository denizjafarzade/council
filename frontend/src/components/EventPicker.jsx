import { useEffect, useState } from 'react'
import { PRESETS, STAGES } from '../lib/constants'
import { slugify } from '../lib/council'

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

export default function EventPicker({ state, onRun, onReplay, recordings: bundled = [], onReplayRecorded }) {
  const [text, setText] = useState(PRESETS[0])
  const running = state.status === 'running'
  const recordings = useRecordings(bundled, state.status)
  const recorded = recordings[slugify(text)]
  const [speed, setSpeed] = useState(1)

  function submit(e) {
    e.preventDefault()
    if (text.trim() && !running) onRun(text.trim())
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe a market event…"
          className="min-w-64 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-lg text-white outline-none focus:border-sky-500"
        />
        <button
          type="submit"
          disabled={running}
          className="rounded-lg bg-sky-500 px-5 py-2 font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40"
        >
          {running && state.mode === 'live' ? 'Council in session…' : 'Convene council'}
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() => onReplay(text.trim() || PRESETS[0])}
          className="rounded-lg border border-slate-600 px-4 py-2 text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          title="Replay mocks/council_run.json (no backend needed)"
        >
          Replay mock
        </button>
        {onReplayRecorded && (
          <button
            type="button"
            disabled={running || !recorded}
            onClick={() => onReplayRecorded(recorded.slug, recorded.event || text.trim(), speed)}
            className="rounded-lg border border-emerald-600/70 px-4 py-2 text-emerald-200 hover:bg-emerald-900/40 disabled:opacity-40"
            title={recorded ? `Replay the recorded run${recorded.recorded_at ? ` from ${new Date(recorded.recorded_at).toLocaleString()}` : ''}` : 'No recorded run for this event yet'}
          >
            ▶ Replay recorded
          </button>
        )}
        {onReplayRecorded && recorded && (
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            disabled={running}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-200"
            title="Replay speed: 2× fits the 90-second live-run slot in the pitch"
          >
            <option value={1}>1× real speed</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </select>
        )}
      </form>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={running}
            onClick={() => setText(p)}
            className={`rounded-full px-3 py-1 text-sm ring-1 disabled:opacity-40 ${
              text === p ? 'bg-sky-500/20 text-sky-200 ring-sky-500' : 'text-slate-300 ring-slate-700 hover:bg-slate-800'
            }`}
          >
            {recordings[slugify(p)] && <span className="mr-1 text-emerald-400" title="Recorded run available">●</span>}
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}

const DOT = {
  pending: 'bg-slate-700 text-slate-400',
  started: 'bg-sky-500 text-slate-950 animate-pulse',
  done: 'bg-emerald-500 text-slate-950',
  failed: 'bg-rose-500 text-white',
}

export function StageBar({ stages }) {
  return (
    <ol className="flex flex-wrap items-center gap-1">
      {STAGES.map((s, i) => (
        <li key={s.id} className="flex items-center gap-1">
          <span className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${DOT[stages[s.id]] || DOT.pending}`}>
            {stages[s.id] === 'done' ? '✓ ' : stages[s.id] === 'failed' ? '✕ ' : ''}
            {s.label}
          </span>
          {i < STAGES.length - 1 && <span className="h-px w-3 bg-slate-700" />}
        </li>
      ))}
    </ol>
  )
}
