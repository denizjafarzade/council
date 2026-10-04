import { useState } from 'react'
import { marketColor } from '../lib/roster'
import NewsPicker from '../components/NewsPicker'
import { estimateCalls, seatId } from './model'
import { Button, Card, Icon, Pill, StepTitle } from './ui'
import { field } from './styles'

const CROSS_COLOR = '#b8a1e3'
const SHORT_ROLE = { macro: 'Macro', technical: 'Market', fundamentals: 'Fundamentals', news: 'News', sentiment: 'Sentiment' }

/** Seats on a half-circle around the Chair. Placed elements, so it scales with the panel width. */
function Chamber({ seats }) {
  const n = seats.length
  return (
    <div className="relative h-[340px] w-full" aria-hidden="true">
      {seats.map((s, i) => {
        const t = n === 1 ? Math.PI / 2 : Math.PI - (i * Math.PI) / (n - 1)
        return (
          <div key={s.id} className="absolute -ml-[60px] flex w-[120px] flex-col items-center gap-1.5 text-center"
            style={{ left: `${50 + 44 * Math.cos(t)}%`, top: `${230 - 210 * Math.sin(t)}px` }}>
            <span className="inline-flex size-14 items-center justify-center rounded-full border-[3px] bg-desk font-mono text-[15px] font-semibold"
              style={{ borderColor: s.color }}>
              {s.code}
            </span>
            <span className="line-clamp-2 text-[13px] leading-tight text-[#c4cbd5]">{s.label}</span>
          </div>
        )
      })}
      <div className="absolute bottom-0 left-1/2 -ml-20 flex w-40 flex-col items-center gap-1.5">
        <span className="inline-flex size-[72px] items-center justify-center rounded-full bg-gold font-mono text-[15px] font-semibold text-gold-ink">CHAIR</span>
        <span className="text-center text-[13px] text-[#c4cbd5]">Runs the session, writes the brief</span>
      </div>
    </div>
  )
}

export default function ReviewStep({ lib, council, setCouncil, councils, onBack, onGoto, onConvene, onSave, onLoad, onDeleteSaved }) {
  const [event, setEvent] = useState('')
  const [newsId, setNewsId] = useState(null)
  const [saveName, setSaveName] = useState(council.name === 'My council' ? '' : council.name)
  const [saveState, setSaveState] = useState('')
  const roles = Object.fromEntries(lib.roles.map((r) => [r.id, r]))
  const markets = Object.fromEntries(lib.markets.map((m) => [m.code, m]))

  const seated = council.members.filter((m) => roles[m.role]?.stage !== 'chair')
  const ordered = [
    ...council.markets.flatMap((code) => seated.filter((m) => m.market === code)),
    ...seated.filter((m) => !m.market),
  ]
  const seats = ordered.map((m) => ({
    id: m.id,
    code: m.market || 'ALL',
    color: m.market ? marketColor(m.market, council.markets) : CROSS_COLOR,
    // Grid seats show their role in short; custom members show their own name.
    label: m.market && m.id === seatId(m.role, m.market) ? SHORT_ROLE[m.role] || roles[m.role]?.name : m.name,
  }))
  const groups = [
    ...council.markets.map((code) => ({
      name: markets[code]?.name || code, color: marketColor(code, council.markets),
      members: council.members.filter((m) => m.market === code),
    })),
    { name: 'Cross-market', color: CROSS_COLOR, members: council.members.filter((m) => !m.market) },
  ]
  const asOf = council.markets.map((c) => markets[c]?.data?.as_of).filter(Boolean).sort()
  const voters = council.members.filter((m) => (m.phases?.vote ?? true) || (m.phases?.revote ?? true)).length
  const problems = [
    !council.markets.length && 'Seat at least one market.',
    !voters && 'Nobody on this council votes.',
  ].filter(Boolean)

  async function save() {
    setSaveState('saving')
    try {
      await onSave(saveName.trim() || 'My council')
      setSaveState('saved')
    } catch (e) {
      setSaveState(e.message)
    }
  }

  return (
    <>
      <StepTitle step={3} title="Your council is seated">
        {council.members.length} members across {council.markets.length} markets. Give them an event and they vote
        blind, debate, revote and hand you a brief.
      </StepTitle>

      <div className="flex flex-wrap items-start gap-6">
        <section aria-label="Seating" className="flex min-w-0 flex-[999_1_680px] flex-col gap-5 rounded-2xl border border-line bg-panel p-6">
          <Chamber seats={seats} />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 border-t border-line pt-5">
            {groups.map((g) => (
              <div key={g.name} className="flex flex-col gap-2">
                <span className="flex items-center gap-2 font-semibold">
                  <span className="size-2.5 rounded-full" style={{ background: g.color }} />{g.name}
                </span>
                <ul className="flex flex-col gap-1 text-sm text-[#c4cbd5]">
                  {g.members.map((m) => <li key={m.id}>{m.name}</li>)}
                  {!g.members.length && <li className="text-muted">No seats</li>}
                </ul>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => onGoto(1)}>Edit seats</Button>
            <Button onClick={() => onGoto(0)}>Edit markets</Button>
          </div>
        </section>

        <aside aria-label="Convene" className="flex min-w-0 flex-[1_1_380px] flex-col gap-4">
          <Card className="flex flex-col gap-3.5">
            <span className="text-lg font-semibold">What should the council discuss?</span>
            <NewsPicker markets={council.markets} selectedId={newsId} onPick={(n) => { setEvent(n.title); setNewsId(n.id) }} limit={6} />
            <label className="flex flex-col gap-2 text-sm font-medium text-muted">Or type your own event
              <textarea rows={2} className={`${field} py-3 text-[17px] font-normal leading-snug`} value={event} maxLength={500}
                onChange={(e) => { setEvent(e.target.value); setNewsId(null) }} />
            </label>
          </Card>

          <Card className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[15px] font-semibold">Debate rounds</legend>
              <div className="flex gap-2">
                {[1, 2].map((r) => (
                  <Pill key={r} on={council.debate_rounds === r} onClick={() => setCouncil((c) => ({ ...c, debate_rounds: r }))}>
                    {r === 1 ? '1 round, faster' : '2 rounds'}
                  </Pill>
                ))}
              </div>
            </fieldset>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-[15px]">
              <dt className="text-muted">Model calls</dt><dd className="font-mono">≈ {estimateCalls(council, lib)}</dd>
              {!!asOf.length && (<><dt className="text-muted">Data as of</dt><dd className="font-mono">{asOf[asOf.length - 1].slice(0, 10)}</dd></>)}
            </dl>
          </Card>

          {problems.map((p) => <p key={p} role="alert" className="text-sm text-gold-text">{p}</p>)}
          <Button variant="primary" className="min-h-14 text-lg" disabled={!event.trim() || problems.length > 0}
            onClick={() => onConvene(event.trim(), newsId)}>
            Convene the council<Icon name="arrow" size={18} stroke={2.2} />
          </Button>

          <Card className="flex flex-col gap-3">
            <div className="flex items-end gap-2">
              <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium">Save this council as
                <input className={field} value={saveName} maxLength={80} placeholder="e.g. Asia rates desk"
                  onChange={(e) => { setSaveName(e.target.value); setSaveState('') }} />
              </label>
              <Button onClick={save} disabled={saveState === 'saving'}>Save</Button>
            </div>
            {saveState && saveState !== 'saving' && (
              <p role="status" className={`text-sm ${saveState === 'saved' ? 'text-muted' : 'text-gold-text'}`}>
                {saveState === 'saved' ? 'Saved. Load it again from the list below.' : saveState}
              </p>
            )}
            {councils.length > 0 && (
              <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                <span className="text-sm font-medium">Saved councils</span>
                <ul className="flex flex-col gap-1">
                  {councils.map((c) => (
                    <li key={c.id} className="flex items-center gap-2">
                      <button type="button" onClick={() => onLoad(c)}
                        className="flex min-h-11 flex-1 items-center justify-between rounded-lg px-3 text-left hover:bg-raised">
                        <span>{c.name}</span>
                        <span className="font-mono text-xs text-muted">{c.members.length} seats · {c.markets.join(' ')}</span>
                      </button>
                      {c.id !== 'default' && (
                        <button type="button" onClick={() => onDeleteSaved(c)} aria-label={`Delete ${c.name}`}
                          className="inline-flex size-11 items-center justify-center rounded-lg text-muted hover:bg-raised hover:text-ink">
                          <Icon name="close" size={16} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
          <Button className="min-h-12" onClick={onBack}><Icon name="back" />Back to roles</Button>
        </aside>
      </div>
    </>
  )
}
