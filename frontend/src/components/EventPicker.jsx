import { useState } from 'react'
import { PRESETS, STAGES } from '../lib/constants'

export default function EventPicker({ state, onRun, onReplay }) {
  const [text, setText] = useState(PRESETS[0])
  const running = state.status === 'running'

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
