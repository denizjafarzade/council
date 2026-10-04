import { useState } from 'react'
import { api } from '../lib/api'
import { toggleMarket, toggleSector } from './model'
import { Button, Card, Icon, StepTitle } from './ui'

// The dot map is equirectangular from latitude 80 to -58 (see public/world-dots.svg).
const LAT_TOP = 80
const LAT_SPAN = 138

// Label offsets so neighbours (HK/CN/TW, UK/EU, KR/JP) don't overlap.
const LABEL = {
  CN: [-50, -34], HK: [-22, 12], KR: [-26, -38], SG: [-22, 12], IN: [-50, -14], UK: [-50, -14],
}

const coverageText = (m) =>
  m.coverage === 'full' ? 'Index, 4 sector proxies, FX, rates, news' : 'Index, FX, news. No sector proxies'

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
  const onMap = lib.markets.filter((m) => m.lat != null && m.lon != null)
  const offMap = lib.markets.filter((m) => m.lat == null || m.lon == null)
  const toggle = (code) => setCouncil((c) => toggleMarket(c, code))
  const asOf = council.markets.map((c) => byCode[c]?.data?.as_of).filter(Boolean).sort()

  return (
    <>
      <StepTitle step={1} title="Which markets sit on the council?">
        Each market you pick gets its own specialist seats in the next step. Specialists only see their own market's
        data, so every market adds a genuinely local view to the debate.
      </StepTitle>

      <div className="flex flex-wrap items-start gap-6">
        <section aria-label="World map" className="min-w-0 flex-[999_1_640px] rounded-2xl border border-line bg-panel px-6 pb-6 pt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
            <div className="flex flex-wrap gap-5">
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
          {!!offMap.length && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-sm">
              <span className="text-muted">Your markets:</span>
              {offMap.map((m) => (
                <button key={m.code} type="button" onClick={() => toggle(m.code)} aria-pressed={council.markets.includes(m.code)}
                  className={`min-h-11 rounded-lg border px-3 font-mono font-semibold ${
                    council.markets.includes(m.code) ? 'border-gold bg-gold text-gold-ink' : 'border-line-strong text-ink hover:bg-raised'
                  }`}>
                  {m.code}
                </button>
              ))}
            </div>
          )}
        </section>

        <aside aria-label="Selected markets" className="flex min-w-0 flex-[1_1_340px] flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">On the council</h2>
              <span className="font-mono text-[15px] text-gold">{council.markets.length} markets</span>
            </div>
            {!council.markets.length && <p className="text-sm text-muted">No markets yet. Pick at least one on the map.</p>}
            <ul className="flex flex-col gap-2">
              {council.markets.map((code) => {
                const m = byCode[code]
                return (
                  <li key={code} className="flex items-center gap-3 rounded-xl bg-raised py-2.5 pl-3 pr-2">
                    <span className="w-9 font-mono text-sm font-semibold text-gold">{code}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">{m?.name || code}</span>
                      <span className="text-[13px] text-muted">
                        {m ? coverageText(m) : 'Unknown market'}
                        {m?.data?.source == null && ' · data fetched at run time'}
                      </span>
                    </span>
                    <button type="button" onClick={() => toggle(code)} aria-label={`Remove ${m?.name || code}`}
                      className="inline-flex size-11 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink">
                      <Icon name="close" size={18} />
                    </button>
                  </li>
                )
              })}
            </ul>
            <Button variant="ghost" onClick={onAddMarket}>
              <Icon name="plus" />
              Add a market that isn't on the map
            </Button>
          </Card>

          <SectorsCard lib={lib} council={council} setCouncil={setCouncil} onLibraryChange={onLibraryChange} />

          <Card className="flex flex-col gap-2.5">
            <span className="font-mono text-[13px] uppercase tracking-[0.08em] text-muted">Stance matrix</span>
            <span className="text-[22px] font-semibold">
              <span className="font-mono">{council.markets.length} × {sectorCount(council, lib)}</span> = {council.markets.length * sectorCount(council, lib)} cells
            </span>
            <span className="text-sm text-muted">
              Market specialists vote on their own market's sectors; cross-market seats vote on every cell.
            </span>
            {!!asOf.length && (
              <span className="border-t border-line pt-2.5 text-sm text-muted">
                Data as of {asOf[0].slice(0, 10)}
                {asOf[0].slice(0, 10) !== asOf[asOf.length - 1].slice(0, 10) && ` to ${asOf[asOf.length - 1].slice(0, 10)}`} (each
                market's last close).
              </span>
            )}
          </Card>

          <Button variant="primary" className="min-h-13 text-[17px]" onClick={onNext} disabled={!council.markets.length}>
            Continue to roles
            <Icon name="arrow" size={18} stroke={2.2} />
          </Button>
        </aside>
      </div>
    </>
  )
}


function sectorCount(council, lib) {
  return (council.sectors?.length ? council.sectors : lib.default_sectors).length
}

/** Which sectors the council covers. Custom sectors need no code: a name plus optional proxy tickers. */
function SectorsCard({ lib, council, setCouncil, onLibraryChange }) {
  const chosen = council.sectors?.length ? council.sectors : lib.default_sectors
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [proxies, setProxies] = useState('')
  const [error, setError] = useState('')

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
    <Card className="flex flex-col gap-2.5">
      <span className="font-mono text-[13px] uppercase tracking-[0.08em] text-muted">Sectors</span>
      <div className="flex flex-wrap gap-2">
        {lib.sectors.map((x) => {
          const on = chosen.includes(x.id)
          const missing = council.markets.filter((m) => !x.proxies?.[m])
          return (
            <button key={x.id} type="button" aria-pressed={on} onClick={() => setCouncil((c) => toggleSector(c, x.id))}
              title={missing.length ? `No price proxy in ${missing.join(', ')}: judged from the index and news there` : 'Price proxy in every chosen market'}
              className={`min-h-9 rounded-full border px-3 text-sm ${on ? 'border-gold bg-gold-soft text-gold-text' : 'border-line-strong text-ink hover:bg-raised'}`}>
              {x.name}{missing.length > 0 && on && <span className="ml-1 text-muted">*</span>}
            </button>
          )
        })}
      </div>
      <span className="text-[13px] text-muted">
        More sectors mean longer, costlier runs. * = no price proxy in some chosen market; members judge it from the index and headlines there, with lower confidence.
      </span>
      {adding ? (
        <form onSubmit={add} className="flex flex-col gap-2 border-t border-line pt-2.5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sector name, e.g. Shipping" required maxLength={60}
            className="min-h-10 rounded-lg border border-line-strong bg-desk px-3 text-ink outline-none focus:border-gold" />
          <input value={proxies} onChange={(e) => setProxies(e.target.value)} placeholder="Optional proxies, e.g. US:ZIM, HK:0316.HK"
            className="min-h-10 rounded-lg border border-line-strong bg-desk px-3 text-ink outline-none focus:border-gold" />
          {error && <span className="text-sm text-bear">{error}</span>}
          <div className="flex gap-2">
            <Button variant="primary" type="submit" disabled={!name.trim()}>Add sector</Button>
            <Button type="button" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
          <span className="text-[13px] text-muted">Proxy prices are fetched on the next data refresh. A ticker that returns no data is reported, never guessed.</span>
        </form>
      ) : (
        <Button variant="ghost" onClick={() => setAdding(true)}>
          <Icon name="plus" />
          Add a sector
        </Button>
      )}
    </Card>
  )
}
