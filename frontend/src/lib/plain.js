// A jargon-free retelling of the council's view, worded in code from the final matrix.
// Used when the Chair did not write one (runs recorded before plain_english existed).

const INDUSTRY = {
  Tech: 'technology companies',
  Financials: 'banks and insurers',
  Property: 'property and real-estate companies',
  Energy: 'oil and energy companies',
}

/** "the United States", "the euro area", but "Japan". */
function place(name) {
  return /^(United|Euro|Netherlands|Philippines)/.test(name) ? `the ${name.replace(/^Euro area$/, 'euro area')}` : name
}

function list(items) {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** "technology companies in Hong Kong" style phrases, most confident first, at most `max`. */
function phrases(cells, names, max = 3) {
  return cells
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, max)
    .map((c) => `${INDUSTRY[c.sector] || c.sector} in ${place(names[c.country] || c.country)}`)
}

export function plainEnglish(brief, event, names = {}) {
  if (brief?.plain_english) return brief.plain_english
  if (!brief?.matrix?.length) return ''
  const up = phrases(brief.matrix.filter((c) => c.view === 'bullish'), names)
  const down = phrases(brief.matrix.filter((c) => c.view === 'bearish'), names)
  const markets = [...new Set(brief.matrix.map((c) => place(names[c.country] || c.country)))]
  const split = brief.matrix.reduce((a, c) => (c.dissent > a.dissent ? c : a))

  const out = [`The council looked at what "${event}" could mean for ${list(markets)}.`]
  if (up.length) out.push(`On balance, it expects ${list(up)} to do better.`)
  if (down.length) out.push(`It expects ${list(down)} to do worse.`)
  if (!up.length && !down.length) out.push('It does not expect big moves either way.')
  if (split.dissent >= 0.5) {
    out.push(`Members disagreed most about ${INDUSTRY[split.sector] || split.sector} in ${place(names[split.country] || split.country)}, so treat that call with extra care.`)
  }
  out.push('This is research to help you think it through, not advice to buy or sell anything.')
  return out.join(' ')
}
