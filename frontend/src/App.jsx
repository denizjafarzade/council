import { useEffect, useMemo, useState } from 'react'
import Builder from './builder/Builder'
import { Brand } from './builder/ui'
import { PlainEnglish } from './components/Brief'
import DebateStream from './components/DebateStream'
import EventPicker, { StageBar } from './components/EventPicker'
import MeaningCards from './components/MeaningCards'
import PortfolioPanel from './components/PortfolioPanel'
import Matrix from './components/Matrix'
import SpilloverGraph from './components/SpilloverGraph'
import WhoChanged from './components/WhoChanged'
import { useCouncil } from './hooks/useCouncil'
import { COUNTRY_NAMES, DISCLAIMER } from './lib/constants'
import { RosterContext, buildRoster, marketsOf } from './lib/roster'
import { packsFor, sourcesFor } from './lib/sources'

function Toasts({ toasts, dismiss }) {
  useEffect(() => {
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), 7000))
    return () => timers.forEach(clearTimeout)
  }, [toasts, dismiss])
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2" role="status">
      {toasts.map((t) => (
        <div key={t.id} className="flex items-start gap-2.5 rounded-xl border border-[#5a3a22] bg-[#24180f] px-3.5 py-2.5 text-sm text-[#f7d2b5] shadow-xl">
          <span aria-hidden="true">⚠</span>
          <span className="flex-1">{t.text}</span>
          <button type="button" onClick={() => dismiss(t.id)} className="-m-1 p-1 text-bear hover:text-ink" aria-label="Dismiss">✕</button>
        </div>
      ))}
    </div>
  )
}

/** Live, recorded, mock: always say which, so nobody mistakes a replay for a live run. */
function RunStatus({ state }) {
  if (state.mode === 'idle') return null
  const base = 'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium'
  if (state.recording) {
    const at = state.recording.recorded_at
    return (
      <span className={`${base} bg-gold-soft text-gold-text`} title="A saved run played back at its real pace">
        ▶ Replay of a recorded run{at && ` · ${new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`}
      </span>
    )
  }
  if (state.mode === 'mock') return <span className={`${base} bg-raised text-muted`}>Mock run · made-up data</span>
  const live = state.status === 'running'
  return (
    <span className={`${base} ${state.status === 'error' ? 'bg-[#24180f] text-bear' : 'bg-[#10271f] text-[#8ee3b8]'}`}>
      <span className={`size-2 rounded-full ${state.status === 'error' ? 'bg-bear' : 'bg-[#3dd68c]'} ${live ? 'animate-pulse' : ''}`} />
      {state.status === 'error' ? 'Run stopped' : live ? 'Live' : 'Live run · finished'}
    </span>
  )
}

export default function App() {
  const { state, replayMock, runLive, replayRecorded, recordings, dismiss } = useCouncil()
  // [EVENT] is the headline the run is about; every seat may cite it.
  const sources = useMemo(
    () => ({ ...sourcesFor(state.mode), EVENT: { kind: 'news', label: state.event, value: 'The news item this run is about' } }),
    [state.mode, state.event],
  )
  const roster = useMemo(() => buildRoster(state.council), [state.council])
  const packs = useMemo(() => packsFor(state.mode), [state.mode])
  const names = useMemo(
    () => ({ ...COUNTRY_NAMES, ...Object.fromEntries((state.council?.markets || []).map((m) => [m.code, m.name])) }),
    [state.council],
  )
  // Build the council first; the session screen runs it.
  const [view, setView] = useState('build')
  const [council, setCouncil] = useState(null)
  const [controlsOpen, setControlsOpen] = useState(false)

  function convene(event, config, newsId) {
    setCouncil(config)
    setView('session')
    setControlsOpen(false)
    runLive(event, config, newsId)
  }

  if (view === 'build') {
    return <Builder onConvene={convene} onBackToSession={state.mode === 'idle' ? null : () => setView('session')} />
  }

  const running = state.status === 'running'
  const showControls = !running && (controlsOpen || state.mode === 'idle')
  const start = (fn) => (...args) => { setControlsOpen(false); fn(...args) }
  const seats = state.council?.members.length ?? 7
  const marketCount = marketsOf(state).length

  return (
    <RosterContext.Provider value={roster}>
      <div className="min-h-full bg-desk font-sans text-base text-ink">
        <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-7 py-4">
          <Brand />
          <span className="hidden h-10 w-px bg-line sm:block" aria-hidden="true" />
          <div className="flex min-w-64 flex-1 flex-col">
            <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted">
              {state.council?.name || council?.name || 'Default council'} · {seats} seats · {marketCount} markets
            </span>
            <h1 className="text-[30px] font-semibold leading-tight">{state.event || 'Council ready'}</h1>
          </div>
          <RunStatus state={state} />
          <button type="button" disabled={running} onClick={() => setControlsOpen((o) => !o)}
            className="min-h-11 rounded-xl border border-line-strong px-4 font-medium hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40">
            {showControls && state.mode !== 'idle' ? 'Hide' : 'New event'}
          </button>
          <button type="button" disabled={running} onClick={() => setView('build')}
            className="min-h-11 rounded-xl border border-line-strong px-4 font-medium hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40">
            Edit council
          </button>
        </header>

        <div className="border-b border-line px-7 py-3.5">
          <StageBar state={state} />
        </div>

        <main className="flex flex-col gap-5 px-7 pb-7 pt-5">
          {showControls && (
            <EventPicker
              state={state}
              markets={council?.markets || state.council?.markets.map((m) => m.code)}
              onRun={start((event, newsId) => runLive(event, council, newsId))}
              onReplay={start(replayMock)}
              recordings={recordings}
              onReplayRecorded={start(replayRecorded)}
            />
          )}

          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(22rem,27rem)_minmax(0,1fr)_minmax(20rem,26rem)]">
            <div className="h-[70vh] min-h-[28rem] xl:sticky xl:top-5 xl:h-[calc(100vh-2.5rem)]">
              <DebateStream state={state} sources={sources} />
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <Matrix state={state} />
              <div className="h-[26rem]">
                <SpilloverGraph state={state} sources={sources} />
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <MeaningCards state={state} packs={packs} names={names} sources={sources} />
              <PortfolioPanel names={names} disabled={running} />
              <PlainEnglish state={state} />
              <WhoChanged state={state} />
            </div>
          </div>
          <p className="text-center text-[13px] text-muted">{DISCLAIMER}</p>
        </main>

        <Toasts toasts={state.toasts} dismiss={dismiss} />
      </div>
    </RosterContext.Provider>
  )
}
