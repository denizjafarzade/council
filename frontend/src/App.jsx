import { useEffect, useMemo } from 'react'
import Brief from './components/Brief'
import DebateStream from './components/DebateStream'
import EventPicker, { StageBar } from './components/EventPicker'
import Matrix from './components/Matrix'
import SpilloverGraph from './components/SpilloverGraph'
import WhoChanged from './components/WhoChanged'
import { useCouncil } from './hooks/useCouncil'
import { DISCLAIMER } from './lib/constants'
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
  const { state, replayMock, runLive, dismiss } = useCouncil()
  const sources = useMemo(() => sourcesFor(state.mode), [state.mode])
  const asOf = useMemo(() => asOfFor(state.mode), [state.mode])

  return (
    <div className="flex min-h-full flex-col gap-3 p-4 lg:h-full">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Trading Council</h1>
          <p className="text-sm text-slate-400">
            {state.event ? (
              <>
                Event: <span className="text-slate-200">{state.event}</span>
                {state.mode === 'mock' && <span className="ml-2 rounded bg-slate-700 px-1.5 text-xs">mock replay</span>}
                {state.mode === 'live' && <span className="ml-2 rounded bg-emerald-600/30 px-1.5 text-xs text-emerald-300">live</span>}
              </>
            ) : (
              DISCLAIMER
            )}
          </p>
        </div>
        <StageBar stages={state.stages} />
      </header>

      <EventPicker state={state} onRun={runLive} onReplay={replayMock} />

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
  )
}
