import { useEffect, useMemo, useState } from 'react'
import Builder from './builder/Builder'
import Brief from './components/Brief'
import DebateStream from './components/DebateStream'
import EventPicker, { StageBar } from './components/EventPicker'
import Matrix from './components/Matrix'
import SpilloverGraph from './components/SpilloverGraph'
import WhoChanged from './components/WhoChanged'
import { useCouncil } from './hooks/useCouncil'
import { DISCLAIMER } from './lib/constants'
import { RosterContext, buildRoster } from './lib/roster'
import { asOfFor, sourcesFor } from './lib/sources'

function Toasts({ toasts, dismiss }) {
  useEffect(() => {
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), 7000))
    return () => timers.forEach(clearTimeout)
  }, [toasts, dismiss])
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-96 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="flex items-start gap-2 rounded-lg border border-rose-500/50 bg-rose-950/95 px-3 py-2 text-sm text-rose-100 shadow-xl">
          <span>⚠</span>
          <span className="flex-1">{t.text}</span>
          <button onClick={() => dismiss(t.id)} className="text-rose-300 hover:text-white" aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const { state, replayMock, runLive, replayRecorded, recordings, dismiss } = useCouncil()
  const sources = useMemo(() => sourcesFor(state.mode), [state.mode])
  const asOf = useMemo(() => asOfFor(state.mode), [state.mode])
  const roster = useMemo(() => buildRoster(state.council), [state.council])
  // Build the council first; the session screen runs it.
  const [view, setView] = useState('build')
  const [council, setCouncil] = useState(null)

  function convene(event, config) {
    setCouncil(config)
    setView('session')
    runLive(event, config)
  }

  if (view === 'build') {
    return <Builder onConvene={convene} onBackToSession={state.mode === 'idle' ? null : () => setView('session')} />
  }

  return (
    <RosterContext.Provider value={roster}>
    <div className="flex min-h-full flex-col gap-3 p-4 lg:h-full">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Trading Council</h1>
          <p className="text-sm text-slate-400">
            {state.event ? (
              <>
                Event: <span className="text-slate-200">{state.event}</span>
                {state.mode === 'mock' && <span className="ml-2 rounded bg-slate-700 px-1.5 text-xs">mock replay</span>}
                {state.mode === 'live' && !state.recording && (
                  <span className="ml-2 rounded bg-emerald-600/30 px-1.5 text-xs text-emerald-300">live</span>
                )}
                {state.recording && (
                  <span className="ml-2 rounded bg-amber-500/20 px-1.5 text-xs text-amber-200" title="Stage 4 demo safety: a saved run played at real speed">
                    Replay of recorded run
                    {state.recording.recorded_at && ` · recorded ${new Date(state.recording.recorded_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`}
                  </span>
                )}
              </>
            ) : (
              DISCLAIMER
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StageBar stages={state.stages} />
          <button
            type="button"
            onClick={() => setView('build')}
            disabled={state.status === 'running'}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            {state.council ? `Edit council (${state.council.members.length} seats)` : 'Build a council'}
          </button>
        </div>
      </header>

      <EventPicker
        state={state}
        onRun={(event) => runLive(event, council)}
        onReplay={replayMock}
        recordings={recordings}
        onReplayRecorded={replayRecorded}
      />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="min-h-[24rem] lg:col-span-3 lg:min-h-0">
          <DebateStream state={state} sources={sources} />
        </div>
        <div className="flex min-h-0 flex-col gap-3 lg:col-span-5">
          <Matrix state={state} />
          <div className="min-h-[18rem] flex-1">
            <SpilloverGraph state={state} sources={sources} />
          </div>
        </div>
        <div className="flex min-h-0 flex-col gap-3 lg:col-span-4">
          <div className="min-h-0 flex-[3]">
            <Brief state={state} asOf={asOf} />
          </div>
          <div className="min-h-0 flex-[2]">
            <WhoChanged state={state} />
          </div>
        </div>
      </main>

      <Toasts toasts={state.toasts} dismiss={dismiss} />
    </div>
    </RosterContext.Provider>
  )
}
