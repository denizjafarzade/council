import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { DISCLAIMER } from '../lib/constants'
import AddMarketDialog from './AddMarketDialog'
import MarketsStep from './MarketsStep'
import MemberEditor from './MemberEditor'
import { defaultCouncil, normalise, removeMember, slug, toggleMarket, upsertMember } from './model'
import ReviewStep from './ReviewStep'
import RolesStep from './RolesStep'
import { Brand, Button, StepNav } from './ui'

const DRAFT_KEY = 'council.draft'

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** Drop anything the library no longer has (a deleted custom role or market). */
function reconcile(council, lib) {
  const markets = new Set(lib.markets.map((m) => m.code))
  const roles = new Set(lib.roles.map((r) => r.id))
  const keep = council.markets.filter((c) => markets.has(c))
  return {
    ...council,
    markets: keep,
    members: council.members.filter((m) => roles.has(m.role) && (!m.market || keep.includes(m.market))),
  }
}

export default function Builder({ onConvene, onBackToSession }) {
  const [lib, setLib] = useState(null)
  const [error, setError] = useState('')
  const [step, setStep] = useState(0)
  const [council, setCouncil] = useState(() => loadDraft() || defaultCouncil())
  const [councils, setCouncils] = useState([])
  const [editor, setEditor] = useState(null) // { member, defaults } while the member editor is open
  const [addingMarket, setAddingMarket] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [library, saved] = await Promise.all([api.library(), api.councils()])
      setLib(library)
      setCouncils(saved)
      setCouncil((c) => reconcile(c, library))
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(council))
    } catch {
      // A private window can refuse storage; the draft just won't survive a reload.
    }
  }, [council])

  if (!lib) {
    return (
      <div className="flex min-h-full items-center justify-center bg-desk p-8 text-ink">
        {error ? (
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <h1 className="text-2xl font-semibold">Can't reach the council backend</h1>
            <p className="text-muted">
              Start it with <code className="font-mono text-ink">make backend</code> (uvicorn on port 8000), then retry. ({error})
            </p>
            <Button variant="primary" onClick={() => { setError(''); refresh() }}>Retry</Button>
          </div>
        ) : (
          <p className="text-muted">Loading the council library…</p>
        )}
      </div>
    )
  }

  const canReach = (i) => i === 0 || council.markets.length > 0

  async function addMarket(market) {
    const saved = await api.addMarket(market)
    await refresh()
    setCouncil((c) => (c.markets.includes(saved.code) ? c : toggleMarket(c, saved.code)))
    setAddingMarket(false)
  }

  async function deleteRole(role) {
    await api.deleteRole(role.id)
    await refresh() // reconcile() drops seats that used it
  }

  async function saveCouncil(name) {
    const saved = await api.saveCouncil({ ...normalise(council, lib), name, id: slug(name) || null })
    setCouncil((c) => ({ ...c, id: saved.id, name: saved.name }))
    setCouncils(await api.councils())
  }

  async function deleteSaved(c) {
    await api.deleteCouncil(c.id)
    setCouncils(await api.councils())
  }

  return (
    <div className="min-h-full bg-desk font-sans text-base leading-normal text-ink">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-8 py-4">
        <Brand />
        <StepNav step={step} onStep={setStep} canReach={canReach} />
        <div className="flex items-center gap-4">
          {onBackToSession && <Button onClick={onBackToSession}>Back to session</Button>}
          <span className="text-[13px] text-muted">{DISCLAIMER}</span>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-8 py-8">
        {step === 0 && (
          <MarketsStep lib={lib} council={council} setCouncil={setCouncil} onNext={() => setStep(1)}
            onAddMarket={() => setAddingMarket(true)} />
        )}
        {step === 1 && (
          <RolesStep lib={lib} council={council} setCouncil={setCouncil} onBack={() => setStep(0)} onNext={() => setStep(2)}
            onEditMember={(member, defaults) => setEditor({ member, defaults })} onDeleteRole={deleteRole} />
        )}
        {step === 2 && (
          <ReviewStep lib={lib} council={council} setCouncil={setCouncil} councils={councils}
            onBack={() => setStep(1)} onGoto={setStep}
            onConvene={(event) => onConvene(event, normalise(council, lib))}
            onSave={saveCouncil} onDeleteSaved={deleteSaved}
            onLoad={(c) => setCouncil(reconcile({ ...c, id: c.id === 'default' ? null : c.id }, lib))} />
        )}
      </main>

      {editor && (
        <MemberEditor lib={lib} council={council} member={editor.member} defaults={editor.defaults}
          saveRole={async (role) => { const saved = await api.addRole(role); await refresh(); return saved }}
          onSave={(member, replaceId) => { setCouncil((c) => upsertMember(c, member, replaceId)); setEditor(null) }}
          onDelete={(id) => { setCouncil((c) => removeMember(c, id)); setEditor(null) }}
          onClose={() => setEditor(null)} />
      )}
      {addingMarket && (
        <AddMarketDialog taken={new Set(lib.markets.map((m) => m.code))} onAdd={addMarket} onClose={() => setAddingMarket(false)} />
      )}
    </div>
  )
}
