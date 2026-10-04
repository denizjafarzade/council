import {
  customCross, customMembers, estimateCalls, hasCross, hasSeat, marketSeatCount, toggleCross, toggleSeat,
} from './model'
import { Button, Card, Icon, StepTitle } from './ui'

function RoleHeader({ role, onDeleteRole }) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-l border-line px-3 py-4">
      <span className="flex items-start justify-between gap-1">
        <span className="text-[15px] font-semibold leading-tight">{role.name}</span>
        {!role.builtin && (
          <button type="button" onClick={() => onDeleteRole(role)} aria-label={`Remove ${role.name} from your role library`}
            className="-mr-1 -mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-ink">
            <Icon name="close" size={14} />
          </button>
        )}
      </span>
      <span className="text-[13px] leading-snug text-muted">{role.blurb || role.instructions.slice(0, 80)}</span>
      {role.limited_data && (
        <span className="self-start rounded bg-gold-soft px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-gold-text">LIMITED DATA</span>
      )}
      {!role.builtin && (
        <span className="self-start rounded bg-raised px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-muted">YOURS</span>
      )}
    </div>
  )
}

function SeatToggle({ on, label, onClick }) {
  return (
    <div className="flex border-b border-l border-line p-2.5">
      <button type="button" onClick={onClick} aria-pressed={on} aria-label={label}
        className={`inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border text-sm font-medium ${
          on ? 'border-gold bg-gold-soft text-gold-text' : 'border-dashed border-line-strong text-muted hover:bg-raised hover:text-ink'
        }`}>
        <Icon name={on ? 'check' : 'plus'} size={on ? 16 : 14} stroke={on ? 2.6 : 2} />
        {on ? 'Seated' : 'Seat'}
      </button>
    </div>
  )
}

export default function RolesStep({ lib, council, setCouncil, onBack, onNext, onEditMember, onDeleteRole }) {
  const marketRoles = lib.roles.filter((r) => r.scope === 'market')
  const crossRoles = lib.roles.filter((r) => r.scope === 'cross')
  const byCode = Object.fromEntries(lib.markets.map((m) => [m.code, m]))
  const extraCross = customCross(council, crossRoles.map((r) => r.id))
  const marketSeats = marketSeatCount(council)
  const total = council.members.length

  return (
    <>
      <StepTitle step={2} title="Who speaks for each market?">
        Seat one or more specialists per market. Each one votes on every cell, argues from its own market's data in
        the debate, and can change its mind in the revote.
      </StepTitle>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_760px] flex-col gap-7">
          <section aria-labelledby="market-seats">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="market-seats" className="text-xl font-semibold">Market seats</h2>
              <span className="text-sm text-muted">Sees only its own market's data</span>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-line bg-panel">
              <div className="grid" style={{
                gridTemplateColumns: `170px repeat(${marketRoles.length + 1}, minmax(132px, 1fr))`,
                minWidth: 170 + (marketRoles.length + 1) * 132,
              }}>
                <div className="border-b border-line" />
                {marketRoles.map((r) => <RoleHeader key={r.id} role={r} onDeleteRole={onDeleteRole} />)}
                <div className="flex flex-col gap-1.5 border-b border-l border-line px-3 py-4">
                  <span className="text-[15px] font-semibold leading-tight">Custom</span>
                  <span className="text-[13px] leading-snug text-muted">Your own specialist, with your own instructions.</span>
                </div>

                {council.markets.map((code) => {
                  const custom = customMembers(council, code)
                  const n = council.members.filter((m) => m.market === code).length
                  return (
                    <div key={code} className="contents">
                      <div className="flex flex-col justify-center border-b border-line px-4 py-3">
                        <span className="flex items-center gap-2.5">
                          <span className="font-mono font-semibold text-gold">{code}</span>
                          <span className="font-medium">{byCode[code]?.name}</span>
                        </span>
                        <span className={`text-[13px] ${n ? 'text-muted' : 'text-gold-text'}`}>
                          {n ? `${n} seat${n === 1 ? '' : 's'}` : 'No seats: only cross-market members will judge it'}
                        </span>
                      </div>
                      {marketRoles.map((r) => (
                        <SeatToggle key={r.id} on={hasSeat(council, r.id, code)}
                          label={`${hasSeat(council, r.id, code) ? 'Unseat' : 'Seat'} ${byCode[code]?.name} ${r.name}`}
                          onClick={() => setCouncil((c) => toggleSeat(c, r.id, code))} />
                      ))}
                      <div className="flex flex-col gap-1.5 border-b border-l border-line p-2.5">
                        {custom.map((m) => (
                          <button key={m.id} type="button" onClick={() => onEditMember(m)}
                            className="flex min-h-11 flex-col items-center justify-center rounded-xl border border-gold bg-gold-soft px-2 text-center text-sm font-medium leading-tight text-gold-text hover:bg-[#332b17]">
                            {m.name}
                            <span className="text-xs text-[#c9ad72]">Edit</span>
                          </button>
                        ))}
                        <button type="button" onClick={() => onEditMember(null, { market: code })}
                          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong text-sm text-muted hover:bg-raised hover:text-ink">
                          <Icon name="plus" size={14} />Create
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>

          <section aria-labelledby="cross-seats">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="cross-seats" className="text-xl font-semibold">Cross-market seats</h2>
              <span className="text-sm text-muted">Sees every market's data and the full transcript</span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {crossRoles.map((r) => {
                const on = r.required || hasCross(council, r.id)
                return (
                  <button key={r.id} type="button" disabled={r.required} aria-pressed={on}
                    onClick={() => setCouncil((c) => toggleCross(c, r.id))}
                    className={`flex min-h-[150px] flex-col gap-2 rounded-2xl border p-4 text-left disabled:cursor-default ${
                      on ? 'border-gold bg-[#1f1c14]' : 'border-line bg-panel hover:border-line-strong'
                    }`}>
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="font-semibold">{r.name}</span>
                      <span className={`rounded-full px-2 py-0.5 font-mono text-xs tracking-wide ${on ? 'bg-gold text-gold-ink' : 'bg-[#232a33] text-muted'}`}>
                        {r.required ? 'REQUIRED' : on ? 'SEATED' : 'OFF'}
                      </span>
                    </span>
                    <span className="text-sm leading-relaxed text-muted">{r.blurb}</span>
                    {!r.builtin && <span className="mt-auto font-mono text-[11px] tracking-wide text-muted">YOUR ROLE</span>}
                  </button>
                )
              })}
              {extraCross.map((m) => (
                <button key={m.id} type="button" onClick={() => onEditMember(m)}
                  className="flex min-h-[150px] flex-col gap-2 rounded-2xl border border-gold bg-[#1f1c14] p-4 text-left">
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="font-semibold">{m.name}</span>
                    <span className="rounded-full bg-gold px-2 py-0.5 font-mono text-xs tracking-wide text-gold-ink">CUSTOM</span>
                  </span>
                  <span className="line-clamp-3 text-sm leading-relaxed text-muted">{m.instructions || 'Custom cross-market member'}</span>
                  <span className="mt-auto inline-flex items-center gap-1.5 text-sm text-gold-text"><Icon name="edit" size={14} />Edit</span>
                </button>
              ))}
              <button type="button" onClick={() => onEditMember(null, { market: null })}
                className="flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong p-4 text-muted hover:bg-raised hover:text-ink">
                <Icon name="plus" size={20} />
                <span className="font-medium">Create a cross-market member</span>
                <span className="text-center text-sm">A thematic view, like a commodities or rates specialist</span>
              </button>
            </div>
          </section>
        </div>

        <aside aria-label="Council summary" className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          <Card className="flex flex-col gap-3.5">
            <h2 className="text-lg font-semibold">Your council</h2>
            <span className="flex items-baseline gap-2.5">
              <span className="font-mono text-[44px] font-semibold leading-none text-gold">{total}</span>
              <span className="text-muted">seats</span>
            </span>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-[15px]">
              <dt className="text-muted">Market seats</dt><dd className="font-mono">{marketSeats}</dd>
              <dt className="text-muted">Cross-market seats</dt><dd className="font-mono">{total - marketSeats}</dd>
              <dt className="text-muted">Model calls per run</dt><dd className="font-mono">≈ {estimateCalls(council, lib)}</dd>
            </dl>
            <span className="border-t border-line pt-3 text-sm text-muted">
              More seats means a richer debate and a slower run. Above about 15 seats, try one debate round.
            </span>
          </Card>
          <Button onClick={() => onEditMember(null, { market: council.markets[0] || null })}>
            <Icon name="plus" />Create a custom member
          </Button>
          <div className="flex gap-3">
            <Button className="min-h-13 flex-1" onClick={onBack}>Back</Button>
            <Button variant="primary" className="min-h-13 flex-[2] text-[17px]" onClick={onNext}>
              Review council<Icon name="arrow" size={18} stroke={2.2} />
            </Button>
          </div>
        </aside>
      </div>
    </>
  )
}
