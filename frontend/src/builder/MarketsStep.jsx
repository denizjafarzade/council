import { useState } from 'react'
import { PortfolioSection } from '../components/PortfolioPanel'
import { api } from '../lib/api'
import { toggleMarket, toggleSector } from './model'
import { field } from './styles'
import { Button, Chip, Icon, SectionHeader, StepTitle } from './ui'

// The dot map is equirectangular from latitude 80 to -58 (see public/world-dots.svg).
const LAT_TOP = 80
const LAT_SPAN = 138

// Label offsets so neighbours (HK/CN/TW, UK/EU, KR/JP) don't overlap.
const LABEL = {
  CN: [-50, -34], HK: [-22, 12], KR: [-26, -38], SG: [-22, 12], IN: [-50, -14], UK: [-50, -14],
}

const coverageText = (m) =>
  m.coverage === 'full' ? 'Full data: index, sector proxies, FX, rates, news' : 'Partial data: index, FX and news; no sector proxies'

function Marker({ market, on, onToggle }) {
  const [lx, ly] = LABEL[market.code] || [12, -14]
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      aria-label={`${on ? 'Remove' : 'Seat'} ${market.name}`}
      title={`${market.name}: ${coverageText(market)}`}
      className="group absolute -ml-[22px] -mt-[22px] size-11 cursor-pointer"
      style={{ left: `${((market.lon + 180) / 360) * 100}%`, top: `${((LAT_TOP - market.lat) / LAT_SPAN) * 100}%` }}
    >
      <span
        className={`absolute left-1/2 top-1/2 -ml-[7px] -mt-[7px] size-3.5 rounded-full border-2 transition-shadow ${
          market.coverage === 'full' ? 'border-solid' : 'border-dashed'
        } ${on ? 'border-gold bg-gold shadow-[0_0_0_6px_rgba(232,176,74,0.22)]' : 'border-ink bg-desk group-hover:shadow-[0_0_0_5px_rgba(236,239,243,0.15)]'}`}
      />
      <span
        className={`absolute whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-[13px] font-semibold tracking-wide ${
          on ? 'border-gold bg-gold text-gold-ink' : 'border-line-strong bg-raised text-ink group-hover:border-ink'
        }`}
        style={{ left: `calc(50% + ${lx}px)`, top: `calc(50% + ${ly}px)` }}
      >
        {market.code}
      </span>
    </button>
  )
}

export default function MarketsStep({ lib, council, setCouncil, onNext, onAddMarket, onLibraryChange }) {
  const byCode = Object.fromEntries(lib.markets.map((m) => [m.code, m]))
  const names = Object.fromEntries(lib.markets.map((m) => [m.code, m.name]))
  const onMap = lib.markets.filter((m) => m.lat != null && m.lon != null)
  // Custom markets added without a map position are offered as chips instead.
  const offMap = lib.markets.filter((m) => (m.lat == null || m.lon == null) && !council.markets.includes(m.code))
  const toggle = (code) => setCouncil((c) => toggleMarket(c, code))
  const asOf = council.markets.map((c) => byCode[c]?.data?.as_of).filter(Boolean).sort()
  const sectors = sectorCount(council, lib)
  const partial = council.markets.filter((c) => byCode[c]?.coverage !== 'full').length

  return (
    <>
      <StepTitle step={1} title="Which markets sit on the council?">
        Pick markets on the map. Each one gets its own specialists in the next step, and they only see that market's data.
      </StepTitle>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        <section aria-label="Markets" className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 text-[13px] text-muted">
            <div className="flex flex-wrap gap-4">
              <span className="inline-flex items-center gap-2"><span className="size-3 rounded-full border-2 border-ink" />Full data</span>
              <span className="inline-flex items-center gap-2"><span className="size-3 rounded-full border-2 border-dashed border-ink" />Partial data</span>
              <span className="inline-flex items-center gap-2"><span className="size-3 rounded-full bg-gold" />On the council</span>
            </div>
            <span>Click a market to seat or remove it</span>
          </div>

          <div className="relative aspect-[1800/690] w-full">
            <img src="/world-dots.svg" alt="" className="absolute inset-0 block size-full select-none" draggable="false" />
            {onMap.map((m) => (
              <Marker key={m.code} market={m} on={council.markets.includes(m.code)} onToggle={() => toggle(m.code)} />
            ))}
          </div>

          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <SectionHeader title={`On the council · ${council.markets.length}`}>
              {partial > 0 && <span className="text-[13px] text-muted">{partial} with partial data (dashed)</span>}
            </SectionHeader>
            <div className="flex flex-wrap gap-2">
              {council.markets.map((code) => {
                const m = byCode[code]
                return (
                  <Chip key={code} on aria-pressed={undefined} onClick={() => toggle(code)} aria-label={`Remove ${m?.name || code}`}
                    title={m ? coverageText(m) : 'Unknown market'}
                    className={m?.coverage === 'full' ? '' : 'border-dashed'}>
                    <span className="font-mono font-semibold">{code}</span>
                    <span className="text-ink">{m?.name || code}</span>
                    <Icon name="close" size={14} />
                  </Chip>
                )
              })}
              {offMap.map((m) => (
                <Chip key={m.code} onClick={() => toggle(m.code)} title={coverageText(m)}>
                  <span className="font-mono font-semibold">{m.code}</span>{m.name}
                </Chip>
              ))}
              <Chip dashed onClick={onAddMarket}><Icon name="plus" size={14} />Add a market</Chip>
            </div>
            {!council.markets.length && <p className="text-sm text-gold-text">Pick at least one market on the map to continue.</p>}
          </div>
        </section>

        <aside aria-label="Council setup"
          className="flex min-w-0 flex-col rounded-2xl border border-line bg-panel lg:sticky lg:top-5 lg:max-h-[calc(100vh-2.5rem)]">
          <div className="flex min-h-0 flex-1 flex-col divide-y divide-line overflow-y-auto">
            <div className="p-5">
              {/* Trading history first: the run reads the portfolio that is loaded when the council convenes. */}
              <PortfolioSection names={names} />
            </div>
            <div className="p-5">
              <SectorsSection lib={lib} council={council} setCouncil={setCouncil} onLibraryChange={onLibraryChange} />
            </div>
          </div>

          <footer className="flex flex-col gap-3 border-t border-line p-5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-muted">Stance matrix</span>
              <span className="text-[15px]">
                <span className="font-mono">{council.markets.length} × {sectors}</span> = <b className="font-semibold">{council.markets.length * sectors} cells</b>
              </span>
            </div>
            {!!asOf.length && (
              <span className="text-[13px] text-muted">
                Prices as of {asOf[0].slice(0, 10)}
                {asOf[0].slice(0, 10) !== asOf[asOf.length - 1].slice(0, 10) && ` to ${asOf[asOf.length - 1].slice(0, 10)}`} (each market's last close)
              </span>
            )}
            <Button variant="primary" className="min-h-12 text-base" onClick={onNext} disabled={!council.markets.length}>
              Continue to roles
              <Icon name="arrow" size={18} stroke={2.2} />
            </Button>
          </footer>
        </aside>
      </div>
    </>
  )
}

function sectorCount(council, lib) {
  return (council.sectors?.length ? council.sectors : lib.default_sectors).length
}

/** Which sectors the council covers. Custom sectors need no code: a name plus optional proxy tickers. */
function SectorsSection({ lib, council, setCouncil, onLibraryChange }) {
  const chosen = council.sectors?.length ? council.sectors : lib.default_sectors
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [proxies, setProxies] = useState('')
  const [error, setError] = useState('')
  const anyMissing = lib.sectors.some((x) => chosen.includes(x.id) && council.markets.some((m) => !x.proxies?.[m]))

  async function add(e) {
    e.preventDefault()
    const id = name.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').map((w) => w[0].toUpperCase() + w.slice(1)).join('').slice(0, 24)
    // "US:XOP, HK:0857.HK" -> { US: ["XOP", "XOP"], HK: ["0857.HK", "0857.HK"] }
    const map = Object.fromEntries(proxies.split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
      const [market, ticker] = p.split(':').map((x) => x.trim())
      return [market.toUpperCase(), [ticker, ticker]]
    }).filter(([m, [t]]) => m && t))
    try {
      await api.addSector({ id, name: name.trim(), proxies: map })
      await onLibraryChange()
      setCouncil((c) => toggleSector(c, id))
      setAdding(false)
      setName('')
      setProxies('')
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <SectionHeader title={`Sectors · ${chosen.length}`} />
      <div className="flex flex-wrap gap-2">
        {lib.sectors.map((x) => {
          const on = chosen.includes(x.id)
          const missing = council.markets.filter((m) => !x.proxies?.[m])
          return (
            <Chip key={x.id} on={on} onClick={() => setCouncil((c) => toggleSector(c, x.id))}
              title={missing.length ? `No price proxy in ${missing.join(', ')}: judged from the index and news there` : 'Price proxy in every chosen market'}>
              {x.name}{missing.length > 0 && on && <span className="text-muted">*</span>}
            </Chip>
          )
        })}
        {!adding && <Chip dashed onClick={() => setAdding(true)}><Icon name="plus" size={14} />Add</Chip>}
      </div>
      <p className="text-[13px] leading-snug text-muted">
        More sectors mean longer runs.{anyMissing && ' * No price proxy in some chosen market: judged from the index and headlines there.'}
      </p>
      {adding && (
        <form onSubmit={add} className="flex flex-col gap-2 rounded-xl bg-raised p-3">
          <label className="flex flex-col gap-1 text-[13px] text-muted">Sector name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shipping" required maxLength={60}
              className={`${field} min-h-10 text-sm`} autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-muted">Proxy tickers (optional)
            <input value={proxies} onChange={(e) => setProxies(e.target.value)} placeholder="US:ZIM, HK:0316.HK"
              className={`${field} min-h-10 font-mono text-sm`} />
          </label>
          {error && <span className="text-sm text-bear">{error}</span>}
          <div className="flex gap-2">
            <Button variant="primary" type="submit" className="min-h-10" disabled={!name.trim()}>Add sector</Button>
            <Button type="button" className="min-h-10" onClick={() => { setAdding(false); setError('') }}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  )
}
