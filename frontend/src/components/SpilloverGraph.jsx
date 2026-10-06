import { useEffect, useMemo, useState } from 'react'
import { marketColor, marketsOf } from '../lib/roster'
import { Panel, SourceChip } from './bits'

// Edges carry numbered badges; mechanisms are listed beside the graph so long text never
// collides with nodes. Hovering an edge or a list row highlights both.
const MIN_W = 540 // grows with the column count so nodes never overlap
const COL_GAP = 46
const H = 300
const NODE_W = 112
const NODE_H = 40
// Same blue/orange as the matrix: blue pushes up, orange pushes down.
const POS = '#285594'
const NEG = '#a9501d'

const MAX_PER_COL = 5 // taller columns split into staggered sub-columns

/** Layered layout: column = BFS distance from the roots (the event). BFS cannot loop on cycles. */
function layout(spill) {
  const ids = spill.nodes.map((n) => n.id)
  const known = new Set(ids)
  const edges = spill.edges.filter((e) => known.has(e.from) && known.has(e.to) && e.from !== e.to)
  const incoming = new Set(edges.map((e) => e.to))
  const roots = ids.filter((id) => !incoming.has(id))
  const depth = {}
  const queue = roots.length ? [...roots] : ids.slice(0, 1)
  queue.forEach((id) => (depth[id] = 0))
  while (queue.length) {
    const id = queue.shift()
    for (const e of edges) {
      if (e.from === id && depth[e.to] === undefined) {
        depth[e.to] = depth[id] + 1
        queue.push(e.to)
      }
    }
  }
  const maxDepth = Math.max(0, ...Object.values(depth))
  for (const id of ids) if (depth[id] === undefined) depth[id] = maxDepth + 1 // unreachable nodes go last

  // Split crowded levels into sub-columns so every node keeps a readable size.
  const levels = []
  for (const n of spill.nodes) (levels[depth[n.id]] ||= []).push(n)
  const cols = []
  for (const level of levels.filter(Boolean)) {
    const parts = Math.ceil(level.length / MAX_PER_COL)
    for (let k = 0; k < parts; k++) cols.push(level.filter((_, i) => i % parts === k))
  }
  const pos = {}
  const w = Math.max(MIN_W, cols.length * (NODE_W + COL_GAP))
  const xGap = cols.length > 1 ? (w - NODE_W - 8) / (cols.length - 1) : 0
  cols.forEach((col, c) => {
    col.forEach((n, r) => {
      pos[n.id] = { x: 4 + c * xGap, y: ((r + 1) * H) / (col.length + 1) - NODE_H / 2 }
    })
  })

  // Badge at each edge's midpoint, nudged apart so numbers never sit on each other.
  const badges = []
  const paths = edges.map((e) => {
    const a = pos[e.from]
    const b = pos[e.to]
    const x1 = a.x + NODE_W
    const y1 = a.y + NODE_H / 2
    const x2 = b.x
    const y2 = b.y + NODE_H / 2
    if (x2 <= x1) {
      // same column or backwards: arc over the top
      const ax = a.x + NODE_W / 2
      const bx = b.x + NODE_W / 2
      const top = Math.min(a.y, b.y) - 40
      return { d: `M${ax},${a.y} C${ax},${top} ${bx},${top} ${bx},${b.y}`, mx: (ax + bx) / 2, my: top + 10 }
    }
    return { d: `M${x1},${y1} C${x1 + 30},${y1} ${x2 - 30},${y2} ${x2},${y2}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 }
  })
  for (const p of paths) {
    let { mx, my } = p
    while (badges.some((b) => Math.abs(b.x - mx) < 18 && Math.abs(b.y - my) < 18)) my += 18
    badges.push({ x: mx, y: my })
    p.bx = mx
    p.by = my
  }
  return { pos, edges, paths, w }
}

/** Split a label into at most two lines of ~13 characters. */
function wrap(label, max = 13) {
  if (label.length <= max) return [label]
  const words = label.split(' ')
  let first = ''
  while (words.length && `${first} ${words[0]}`.trim().length <= max) first = `${first} ${words.shift()}`.trim()
  if (!first) first = words.shift()
  let rest = words.join(' ')
  if (rest.length > max) rest = `${rest.slice(0, max - 1)}…`
  return rest ? [first, rest] : [first]
}

function Graph({ spill, graph, label, sources, hover, setHover, big, markets }) {
  return (
    <div className={`flex h-full min-h-0 gap-3 ${big ? 'text-base' : ''}`}>
      <svg viewBox={`0 0 ${graph.w} ${H}`} className={`h-full min-w-0 ${big ? 'flex-[5]' : 'flex-[3]'}`}>
        <defs>
          {[
            ['pos', POS],
            ['neg', NEG],
          ].map(([k, c]) => (
            <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={c} />
            </marker>
          ))}
        </defs>
        {graph.edges.map((e, i) => {
          const p = graph.paths[i]
          const pos = e.sign === '+'
          const color = pos ? POS : NEG
          const active = hover === null || hover === i
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} opacity={active ? 1 : 0.15}>
              <path d={p.d} fill="none" stroke="transparent" strokeWidth="14" />
              <path d={p.d} fill="none" stroke={color} strokeWidth={1 + e.strength * 4} strokeOpacity="0.85" markerEnd={`url(#arrow-${pos ? 'pos' : 'neg'})`} />
            </g>
          )
        })}
        {spill.nodes.map((n) => {
          const p = graph.pos[n.id]
          const color = n.country ? marketColor(n.country, markets) : '#425f87'
          const lines = wrap(n.label)
          const tx = n.country ? 26 : NODE_W / 2
          return (
            <g key={n.id} transform={`translate(${p.x},${p.y})`}>
              <rect width={NODE_W} height={NODE_H} rx="9" fill="#f3f2ed" stroke={color} strokeWidth="1.5" />
              {n.country && (
                <text x="6" y={NODE_H / 2 + 4} fontSize="10.5" fontWeight="700" fill={color}>
                  {n.country}
                </text>
              )}
              <text fontSize="12.5" fill="#1a1e25" textAnchor={n.country ? 'start' : 'middle'}>
                {lines.map((l, k) => (
                  <tspan key={k} x={tx} y={NODE_H / 2 + 4.5 + (k - (lines.length - 1) / 2) * 14}>
                    {l}
                  </tspan>
                ))}
              </text>
              <title>{n.label}</title>
            </g>
          )
        })}
        {graph.edges.map((e, i) => {
          const p = graph.paths[i]
          return (
            <g key={`b${i}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} opacity={hover === null || hover === i ? 1 : 0.15}>
              <circle cx={p.bx} cy={p.by} r="8.5" fill="#e9e8e2" stroke={e.sign === '+' ? POS : NEG} strokeWidth="1.5" />
              <text x={p.bx} y={p.by + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1a1e25">
                {i + 1}
              </text>
            </g>
          )
        })}
      </svg>
      <ol className={`min-w-0 overflow-auto pr-1 ${big ? 'flex-[2]' : 'flex-[2] text-sm'}`}>
        {graph.edges.map((e, i) => (
          <li
            key={i}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className={`flex gap-2 rounded-lg px-1.5 py-1 ${hover === i ? 'bg-raised' : ''}`}
          >
            <span
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-bold"
              style={{ borderColor: e.sign === '+' ? POS : NEG }}
            >
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="text-muted">
                {label[e.from]} → {label[e.to]}
              </span>
              <span className="block leading-snug text-ink">{e.mechanism}</span>
              {!!e.source_ids?.length && (
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {e.source_ids.map((id) => (
                    <SourceChip key={id} id={id} sources={sources} />
                  ))}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

const LEGEND = (
  <span className="flex gap-3 text-[13px] text-muted">
    <span style={{ color: POS }}>— pushes up</span>
    <span style={{ color: NEG }}>— pushes down</span>
    <span>thickness = strength</span>
  </span>
)

export default function SpilloverGraph({ state, sources }) {
  const spill = state.spillover
  const [hover, setHover] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const graph = useMemo(() => (spill?.nodes?.length ? layout(spill) : null), [spill])
  const label = useMemo(() => Object.fromEntries((spill?.nodes || []).map((n) => [n.id, n.label])), [spill])
  const markets = marketsOf(state)
  const props = { spill, graph, label, sources, hover, setHover, markets }

  useEffect(() => {
    if (!expanded) return undefined
    const onKey = (e) => e.key === 'Escape' && setExpanded(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  return (
    <>
      <Panel
        className="h-full"
        title="How it spreads"
        right={
          <span className="flex items-center gap-3">
            {LEGEND}
            {graph && (
              <button type="button" onClick={() => setExpanded(true)} className="min-h-9 rounded-lg border border-line-strong px-2.5 text-sm text-ink hover:bg-raised">
                ⤢ Expand
              </button>
            )}
          </span>
        }
      >
        {!graph ? (
          <p className="text-muted">After the debate, the Spillover Analyst maps how the event travels between markets.</p>
        ) : (
          <Graph {...props} />
        )}
      </Panel>
      {expanded && graph && (
        <div className="fixed inset-0 z-40 flex bg-ink/40 p-6 backdrop-blur-sm" onClick={() => setExpanded(false)}>
          <div className="flex min-h-0 flex-1 flex-col rounded-md border border-line bg-panel p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-semibold">How it spreads · {state.event}</h2>
              <span className="flex items-center gap-4">
                {LEGEND}
                <button type="button" onClick={() => setExpanded(false)} className="min-h-10 rounded-lg border border-line-strong px-3 text-sm hover:bg-raised">
                  Close (Esc)
                </button>
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <Graph {...props} big />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
