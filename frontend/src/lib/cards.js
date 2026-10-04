// "What this means for you": everything here is worded in code from the run's data, the
// user's portfolio summary and each market seat's own report. Rules for user-facing text:
// no source ids inside sentences (they stay as chips), no "cell"/"dissent", names written out.

const SCORE = { bearish: -1, neutral: 0, bullish: 1 }
// A market leans one way when, on balance, at least two of its four sectors point that way
// (bearish = -1, neutral = 0, bullish = 1; average at or past +/-0.5).
const LEAN_AT = 0.5
const SPLIT_AT = 0.5 // same threshold as the matrix's "split" tag

export const SECTOR_NAMES = { Tech: 'Technology', Financials: 'Financials', Property: 'Property', Energy: 'Energy' }

/** Drop [HK-n3, US-10y] style citations from a sentence and tidy the spacing. */
export function stripIds(text = '') {
  return text.replace(/\s*\[[^\]]*\]/g, '').replace(/\s+([.,;:])/g, '$1').replace(/\s{2,}/g, ' ').trim()
}

const MARKET_SECTOR = /\b([A-Z]{2,4})[/ ]([A-Z][A-Za-z]+)\b/g // "HK/Tech" or "HK Health": only known sectors are rewritten

/** Model text made plain for the cards: no ids, no "bearish"/"cell"/"dissent", names written out. */
export function plain(text = '', names = {}, sectorNames = SECTOR_NAMES) {
  return stripIds(text)
    .replace(MARKET_SECTOR, (m, code, sector) => (sectorNames[sector] ? `${names[code] || code} ${sectorNames[sector]}` : m))
    .replace(/\bbearish\b/gi, (w) => (w[0] === 'B' ? 'Negative' : 'negative'))
    .replace(/\bbullish\b/gi, (w) => (w[0] === 'B' ? 'Positive' : 'positive'))
    .replace(/\bdissent\b/gi, 'disagreement')
    .replace(/\s*\bcells?\b/gi, '')
}

/** At most `n` words, ending cleanly. */
export function clip(text, n = 25) {
  const words = text.split(/\s+/)
  if (words.length <= n) return text
  return `${words.slice(0, n).join(' ').replace(/[,;:]$/, '')}…`
}

export function firstSentence(text) {
  const m = text.match(/^.*?[.!?](\s|$)/)
  return (m ? m[0] : text).trim()
}

export function timeAgo(iso, now = Date.now()) {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const mins = Math.max(0, Math.round((now - t) / 60000))
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

function isToday(iso) {
  const d = new Date(iso)
  const n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}

/** "2 Oct 2026", or "today, 14:05" when it is today: nothing is called live unless dated today.
 * marketDate: use the date as written (the market's own day), not converted to this time zone. */
export function when(iso, withTime = false, marketDate = false) {
  if (!iso || iso === 'unknown') return 'unknown'
  if (marketDate) {
    const day = iso.slice(0, 10)
    const today = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD
    const [y, m, dd] = day.split('-').map(Number)
    return day === today ? 'today' : new Date(y, m - 1, dd).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
  }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (isToday(iso)) return `today, ${time}`
  const date = d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
  return withTime ? `${date}, ${time}` : date
}

function leanOf(cells) {
  if (!cells.length) return null
  const avg = cells.reduce((a, c) => a + SCORE[c.view], 0) / cells.length
  return avg <= -LEAN_AT ? 'bearish' : avg >= LEAN_AT ? 'bullish' : 'neutral'
}

export const LEAN_WORDS = { bearish: 'leans negative', bullish: 'leans positive', neutral: 'no clear lean' }

function pct(n) {
  return `${Math.abs(n).toFixed(1).replace(/\.0$/, '')}%`
}

function moveSentence(idx) {
  if (!idx) return 'No index data for this market.'
  const day = idx.chg_1d_pct === 0 ? 'was flat on the last trading day'
    : `${idx.chg_1d_pct > 0 ? 'rose' : 'fell'} ${pct(idx.chg_1d_pct)} on the last trading day`
  const month = idx.chg_1m_pct === 0 ? 'flat over the past month'
    : `${idx.chg_1m_pct > 0 ? 'up' : 'down'} ${pct(idx.chg_1m_pct)} over the past month`
  return `The ${idx.name} ${day} and is ${month}.`
}

/**
 * One card per council market, sorted by the user's exposure; markets they don't hold last.
 * `packs` is code -> DataPack, `names` code -> market name.
 */
export function buildCards(state, packs, names, sectorNames = SECTOR_NAMES) {
  const markets = state.council?.markets?.map((m) => m.code) || Object.keys(names)
  const members = state.council?.members || []
  const exposure = Object.fromEntries((state.portfolio?.by_market || []).map((m) => [m.name, m.pct]))
  const matrix = state.brief?.matrix || []

  const cards = markets.map((code) => {
    // The market's specialist: its Macro Strategist, else the first seat tied to the market.
    const seat = members.find((m) => m.market === code && m.role === 'macro') || members.find((m) => m.market === code)
    const seatId = seat?.id || code
    const report = state.reports[seatId]
    const vote = state.votes.revote[seatId] || state.votes.blind[seatId]
    const own = (vote?.cells || []).filter((c) => c.country === code)
    const cells = matrix.filter((c) => c.country === code)
    const pack = packs[code]
    const trigger = report?.triggers?.[0]
    return {
      code,
      name: names[code] || code,
      exposure: exposure[code] ?? 0,
      happened: moveSentence(pack?.series?.find((s) => s.id === `${code}-idx`)),
      view: report ? clip(plain(firstSentence(report.impact_summary), names, sectorNames), 25) : '',
      lean: leanOf(own),
      seatName: seat?.name,
      chips: [...new Set((report?.claims || []).flatMap((c) => c.source_ids))].slice(0, 4),
      council: cells.length ? (Math.max(...cells.map((c) => c.dissent)) >= SPLIT_AT ? 'split' : 'agree') : null,
      councilLean: leanOf(cells),
      watch: trigger ? `${plain(trigger.condition, names, sectorNames).replace(/[.]$/, '')}: ${plain(trigger.would_change, names, sectorNames)}` : '',
      risk: state.brief?.risk?.markets?.[code] || null,
      evidence: state.brief?.evidence_weights?.[seatId],
      pricesAsOf: pack?.as_of,
      headlinesAt: pack?.news_fetched_at || pack?.as_of,
    }
  })
  return cards.sort((a, b) => b.exposure - a.exposure || a.name.localeCompare(b.name))
}

/** The line above the cards: how much invested money sits where the council leans negative. */
export function bearishShareLine(cards, portfolio) {
  if (!portfolio?.by_market?.length) return 'Load your trades to see how this news touches your own money.'
  const bearish = cards.filter((c) => c.councilLean === 'bearish' && c.exposure > 0)
  const share = bearish.reduce((a, c) => a + c.exposure, 0)
  if (!cards.some((c) => c.councilLean)) return 'The council has not finished yet.'
  if (!bearish.length) return 'None of your invested money sits in markets the council leans negative on.'
  if (bearish.length === cards.filter((c) => c.exposure > 0).length) {
    return 'All of your invested money sits in markets the council leans negative on.'
  }
  const list = bearish.map((c) => c.name)
  const named = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0]
  return `About ${pct(share)} of your invested money sits in markets the council leans negative on: ${named}.`
}

export function exposureLine(card, portfolio) {
  if (!portfolio?.by_market?.length) return 'No portfolio loaded.'
  if (!card.exposure) return 'You hold nothing here.'
  return `${pct(card.exposure)} of your invested money.`
}

/**
 * The bottom line for the user's money, worded in code from the council's final views:
 * an outlook (cautious / mixed / positive) weighted by exposure, the risk level, and which
 * markets drive it. Research language only: it never says buy, sell or hold.
 */
export function bottomLine(cards, portfolio, risk) {
  const voted = cards.filter((c) => c.councilLean)
  if (!voted.length) return null
  const held = portfolio?.by_market?.length ? voted.filter((c) => c.exposure > 0) : []
  const basis = held.length ? held : voted
  const weight = (c) => (held.length ? c.exposure : 1)
  const total = basis.reduce((a, c) => a + weight(c), 0) || 1
  const outlookScore = basis.reduce((a, c) => a + weight(c) * (SCORE[c.councilLean] ?? 0), 0) / total
  const outlook = outlookScore <= -0.25 ? 'cautious' : outlookScore >= 0.25 ? 'positive' : 'mixed'
  const neg = basis.filter((c) => c.councilLean === 'bearish').map((c) => c.name)
  const pos = basis.filter((c) => c.councilLean === 'bullish').map((c) => c.name)
  const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0])
  const whose = held.length ? 'your money' : 'these markets'

  let why
  if (outlook === 'cautious') why = `The council expects more downside than upside for most of ${whose}${neg.length ? `, mainly ${list(neg)}` : ''}.`
  else if (outlook === 'positive') why = `The council expects more upside than downside for most of ${whose}${pos.length ? `, mainly ${list(pos)}` : ''}.`
  else why = `The council sees no clear direction for ${whose} overall${neg.length || pos.length ? `: ${[neg.length && `${list(neg)} ${neg.length > 1 ? 'lean' : 'leans'} negative`, pos.length && `${list(pos)} ${pos.length > 1 ? 'lean' : 'leans'} positive`].filter(Boolean).join(', ')}` : ''}.`

  const r = risk?.portfolio || risk?.together
  return {
    outlook,
    why,
    risk: r ? { score: r.score, label: r.label } : null,
    note: 'This is research, not a recommendation to buy or sell. Before acting, weigh how long you plan to hold, '
      + 'how big these positions are for you, and the questions below.',
  }
}
