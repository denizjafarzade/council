// Resolves a cited source id (HK-hibor, US-n3, JP-Tech) to what it points at.
// Live runs read the same backend/data/cache files the engine reads; mock runs use mocks/datapacks.
const cachePacks = import.meta.glob('../../../backend/data/cache/*.json', { eager: true, import: 'default' })
const mockPacks = import.meta.glob('../../../mocks/datapacks/*.json', { eager: true, import: 'default' })

function fmt(n) {
  return typeof n === 'number' ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n
}

function pct(n) {
  return `${n > 0 ? '+' : ''}${fmt(n)}%`
}

/** id -> what it points at, for a set of DataPacks (code -> pack, or a list). */
export function indexPacks(packs) {
  const map = {}
  for (const p of Object.values(packs)) {
    for (const s of p.series) {
      map[s.id] = {
        kind: 'series', label: s.name, value: fmt(s.last),
        detail: `1d ${pct(s.chg_1d_pct)} · 1m ${pct(s.chg_1m_pct)} · vol ${fmt(s.vol_20d_pct)}%`, asOf: p.as_of,
      }
    }
    for (const s of p.sectors) {
      const entry = {
        kind: 'sector', label: `${p.country} ${s.sector} (${s.ticker})`, value: pct(s.chg_1m_pct),
        detail: `1m change · vol ${fmt(s.vol_20d_pct)}%`, asOf: p.as_of,
      }
      map[`${p.country}-${s.sector}`] = entry
      // Agents often cite the ticker itself (XLK, 8035.T); it is in the DataPack, so it counts.
      if (s.ticker) map[s.ticker] = entry
    }
    for (const m of p.macro) map[m.id] = { kind: 'macro', label: m.name, value: fmt(m.value), asOf: p.as_of }
    for (const n of p.news) {
      map[n.id] = { kind: 'news', label: n.title, value: n.source, detail: n.published?.slice(0, 10), url: n.url }
    }
  }
  return map
}

const SOURCES = { live: indexPacks(cachePacks), mock: indexPacks(mockPacks) }

/** Fallback when a run did not send its own data (recordings made before the "data" event). */
export function sourcesFor(mode) {
  return mode === 'mock' ? SOURCES.mock : SOURCES.live
}

/** Market code -> the DataPack this run's mode reads (for prices dates and the index move). */
export function packsFor(mode) {
  const packs = Object.values(mode === 'mock' ? mockPacks : cachePacks) // never mock data for real runs
  return Object.fromEntries(packs.map((p) => [p.country, p]))
}
