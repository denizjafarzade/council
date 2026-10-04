import Brief from './components/Brief'
import DebateStream from './components/DebateStream'
import EventPicker from './components/EventPicker'
import Matrix from './components/Matrix'
import SpilloverGraph from './components/SpilloverGraph'

export default function App() {
  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">AI Trading Council</h1>
        <p className="text-sm text-slate-400">Research and decision support only. Not investment advice.</p>
      </header>
      <EventPicker />
      <main className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
        <DebateStream />
        <div className="flex flex-col gap-4">
          <Matrix />
          <SpilloverGraph />
        </div>
        <Brief />
      </main>
    </div>
  )
}
