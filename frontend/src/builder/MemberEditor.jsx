import { useEffect, useRef, useState } from 'react'
import { memberIdFor, slug } from './model'
import { Button, Icon, Pill } from './ui'
import { field } from './styles'

const PHASES = [
  ['vote', 'Blind vote'],
  ['debate', 'Debate'],
  ['revote', 'Revote'],
]

/**
 * Create or edit one council member. Saving can also add a new role to the library,
 * so the member shows up as a column (market) or card (cross-market) from then on.
 */
export default function MemberEditor({ lib, council, member, defaults, onSave, onDelete, onClose, saveRole }) {
  const editing = !!member
  const [market, setMarket] = useState(member ? member.market : defaults?.market ?? council.markets[0] ?? null)
  const scope = market ? 'market' : 'cross'
  const pickable = lib.roles.filter((r) => r.scope === scope && r.stage !== 'chair' && r.stage !== 'spillover')
  const [roleId, setRoleId] = useState(member?.role || pickable[0]?.id)
  const role = lib.roles.find((r) => r.id === roleId) || pickable[0]
  const marketDef = lib.markets.find((m) => m.code === market)

  const [name, setName] = useState(member?.name || '')
  const [instructions, setInstructions] = useState(member?.instructions ?? role?.instructions ?? '')
  const [brief, setBrief] = useState(member?.brief ?? marketDef?.brief ?? '')
  const [phases, setPhases] = useState(member?.phases || { vote: true, debate: true, revote: true })
  const [model, setModel] = useState(member?.model || '')
  const [toLibrary, setToLibrary] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const first = useRef(null)

  useEffect(() => first.current?.focus(), [])

  // Switching seat or base role refreshes the prefilled text unless the user has written their own.
  function pickRole(id) {
    const next = lib.roles.find((r) => r.id === id)
    if (!instructions.trim() || instructions === role?.instructions) setInstructions(next.instructions)
    setRoleId(id)
  }
  function pickMarket(code) {
    const nextScope = code ? 'market' : 'cross'
    if (nextScope !== scope) {
      const next = lib.roles.find((r) => r.scope === nextScope && r.stage !== 'chair' && r.stage !== 'spillover')
      setRoleId(next.id)
      setInstructions(next.instructions)
    }
    const nextMarket = lib.markets.find((m) => m.code === code)
    if (!brief.trim() || brief === marketDef?.brief) setBrief(nextMarket?.brief || '')
    setMarket(code)
  }

  async function save(e) {
    e.preventDefault()
    if (!name.trim()) return setError('Give this member a name.')
    if (!instructions.trim()) return setError('Write some instructions: what should this member focus on?')
    setError('')
    setSaving(true)
    try {
      let memberRole = role.id
      let override = instructions.trim() === role.instructions ? null : instructions.trim()
      if (toLibrary) {
        const taken = new Set(lib.roles.map((r) => r.id))
        let id = slug(name) || 'role'
        for (let n = 2; taken.has(id); n++) id = `${slug(name)}-${n}`
        const saved = await saveRole({
          id, name: name.trim().slice(0, 60), scope, stage: role.stage,
          blurb: instructions.trim().split(/(?<=\.)\s/)[0].slice(0, 200), instructions: instructions.trim(),
        })
        memberRole = saved.id
        override = null
      }
      const taken = new Set(council.members.map((m) => m.id).filter((id) => id !== member?.id))
      onSave({
        id: member?.id || memberIdFor(name, taken),
        name: name.trim(),
        role: memberRole,
        market,
        instructions: override,
        brief: market && brief.trim() !== (marketDef?.brief || '') ? brief.trim() : null,
        phases,
        model: model || null,
      }, member?.id)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const extraCalls = (phases.vote ? 1 : 0) + (phases.revote ? 1 : 0) +
    (phases.debate ? (role?.stage === 'debate' ? council.debate_rounds : 1) : 0)

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-10"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <form role="dialog" aria-modal="true" aria-labelledby="editor-title" onSubmit={save}
        className="w-full max-w-[980px] overflow-hidden rounded-[20px] border border-line bg-panel shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
        <div className="flex items-start justify-between gap-4 border-b border-line px-7 py-6">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[13px] uppercase tracking-[0.08em] text-gold">{editing ? 'Edit council member' : 'New council member'}</span>
            <h2 id="editor-title" className="text-[28px] font-semibold">{name.trim() || 'Untitled member'}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="inline-flex size-11 items-center justify-center rounded-xl text-muted hover:bg-raised hover:text-ink">
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="flex flex-wrap">
          <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-5 px-7 py-6">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
              <label className="flex flex-col gap-1.5 text-sm font-medium">Name
                <input ref={first} className={field} value={name} maxLength={60} placeholder="e.g. Semis Specialist"
                  onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">Start from a role
                <select className={field} value={roleId} onChange={(e) => pickRole(e.target.value)}>
                  {pickable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">Seat</legend>
              <div className="flex flex-wrap gap-2">
                {council.markets.map((code) => (
                  <Pill key={code} on={market === code} onClick={() => pickMarket(code)}>
                    {lib.markets.find((m) => m.code === code)?.name || code}
                  </Pill>
                ))}
                <Pill on={!market} onClick={() => pickMarket(null)}>Cross-market</Pill>
              </div>
              <span className="text-[13px] text-muted">
                {market
                  ? `Sits with the ${marketDef?.name} delegation and only sees that market's data.`
                  : 'Sees every market. Speaks after the debate rounds, like the Bear and Bull.'}
              </span>
            </fieldset>

            <label className="flex flex-col gap-1.5 text-sm font-medium">Instructions
              <span className="text-[13px] font-normal text-muted">
                What this member focuses on and how it argues. {'{MARKET_NAME}'} becomes the seat's market. Shared council
                rules (cite sources, no trade advice, JSON only) are added automatically.
              </span>
              <textarea rows={5} className={`${field} py-3 text-[15px] leading-relaxed`} value={instructions} maxLength={4000}
                onChange={(e) => setInstructions(e.target.value)} />
            </label>

            {market && (
              <label className="flex flex-col gap-1.5 text-sm font-medium">Local knowledge
                <span className="text-[13px] font-normal text-muted">Background about its market. Prefilled from the market brief.</span>
                <textarea rows={3} className={`${field} py-3 text-[15px] leading-relaxed`} value={brief} maxLength={2000}
                  onChange={(e) => setBrief(e.target.value)} />
              </label>
            )}

            <fieldset>
              <legend className="mb-2 text-sm font-medium">Takes part in</legend>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {PHASES.map(([key, label]) => (
                  <label key={key} className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px]">
                    <input type="checkbox" className="size-5 accent-gold" checked={phases[key]}
                      onChange={() => setPhases((p) => ({ ...p, [key]: !p[key] }))} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="flex max-w-md flex-col gap-1.5 text-sm font-medium">Model
              <select className={field} value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">Council default ({lib.profile} profile)</option>
                {lib.models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          </div>

          <aside aria-label="Preview" className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5 border-l border-line bg-[#10141a] px-7 py-6">
            <span className="font-mono text-[13px] uppercase tracking-[0.08em] text-muted">How it will appear</span>
            <div className="flex items-center gap-2.5 rounded-2xl border border-line bg-panel p-4">
              <span className="inline-flex size-9 items-center justify-center rounded-full bg-gold-soft font-mono text-[13px] font-semibold text-gold-text">
                {market || 'ALL'}
              </span>
              <span className="flex flex-col leading-tight">
                <span className="font-semibold">{name.trim() || 'Untitled member'}</span>
                <span className="text-[13px] text-muted">{market ? `${marketDef?.name} seat` : 'Cross-market seat'} · {role?.name}</span>
              </span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted">Sees</dt>
              <dd>{market ? `Only the ${market} data and the transcript` : 'All market data and the transcript'}</dd>
              <dt className="text-muted">Votes on</dt>
              <dd>{phases.vote || phases.revote
                ? (market ? `Its own market's ${(council.sectors || lib.default_sectors).length} sectors`
                  : `All ${council.markets.length * (council.sectors || lib.default_sectors).length} matrix cells`)
                : 'Does not vote'}</dd>
              <dt className="text-muted">Adds</dt>
              <dd className="font-mono">≈ {extraCalls} calls / run</dd>
            </dl>
            {!editing && (
              <label className="mt-auto inline-flex min-h-11 cursor-pointer items-center gap-2.5 border-t border-line pt-3 text-[15px]">
                <input type="checkbox" className="size-5 accent-gold" checked={toLibrary} onChange={() => setToLibrary((v) => !v)} />
                Also save as a role in my library
              </label>
            )}
          </aside>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-7 py-5">
          {error && <p role="alert" className="mr-auto text-sm text-gold-text">{error}</p>}
          {editing && (
            <Button className="mr-auto" onClick={() => onDelete(member.id)}>Remove from council</Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={saving}>{editing ? 'Save member' : 'Add to council'}</Button>
        </div>
      </form>
    </div>
  )
}
