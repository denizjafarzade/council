import { useEffect, useMemo, useState } from 'react'
import { marketColor, marketsOf } from '../lib/roster'
import { Panel, SourceChip } from './bits'

// Edges carry numbered badges; mechanisms are listed beside the graph so long text never
// collides with nodes. Hovering an edge or a list row highlights both.
const W = 540
const H = 300
const NODE_W = 112
const NODE_H = 40
const POS = '#34d399'
const NEG = '#fb7185'

/** Layered layout: column = longest path from a root (the event), rows spread evenly. */
function layout(spill) {
  const ids = spill.nodes.map((n) => n.id)
  const depth = Object.fromEntries(ids.map((id) => [id, 0]))
  const edges = spill.edges.filter((e) => depth[e.from] !== undefined && depth[e.to] !== undefined && e.from !== e.to)
  // Bellman-Ford style relaxation; capped so a cycle cannot loop forever.
  for (let i = 0; i < ids.length; i++) {
    let moved = false
    for (const e of edges) {
      if (depth[e.to] < depth[e.from] + 1 && depth[e.from] + 1 < ids.length) {
        depth[e.to] = depth[e.from] + 1
        moved = true
      }
    }
    if (!moved) break
  }
  const cols = Math.max(...Object.values(depth)) + 1
  const byCol = Array.from({ length: cols }, () => [])
  for (const n of spill.nodes) byCol[depth[n.id]].push(n)
  const pos = {}
  const xGap = cols > 1 ? (W - NODE_W - 8) / (cols - 1) : 0
  byCol.forEach((col, c) => {
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
  return { pos, edges, paths }
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
      <svg viewBox={`0 0 ${W} ${H}`} className={`h-full min-w-0 ${big ? 'flex-[5]' : 'flex-[3]'}`}>
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
          const color = n.country ? marketColor(n.country, markets) : '#fbbf24'
          const lines = wrap(n.label)
          const tx = n.country ? 26 : NODE_W / 2
          return (
            <g key={n.id} transform={`translate(${p.x},${p.y})`}>
              <rect width={NODE_W} height={NODE_H} rx="8" fill="#1e293b" stroke={color} strokeWidth="1.5" />
              {n.country && (
                <text x="6" y={NODE_H / 2 + 4} fontSize="10.5" fontWeight="700" fill={color}>
                  {n.country}
                </text>
              )}
              <text fontSize="12.5" fill="#f8fafc" textAnchor={n.country ? 'start' : 'middle'}>
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
              <circle cx={p.bx} cy={p.by} r="8.5" fill="#0f172a" stroke={e.sign === '+' ? POS : NEG} strokeWidth="1.5" />
              <text x={p.bx} y={p.by + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#f8fafc">
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
            className={`flex gap-2 rounded-md px-1.5 py-1 ${hover === i ? 'bg-slate-800' : ''}`}
          >
            <span
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-bold"
              style={{ borderColor: e.sign === '+' ? POS : NEG }}
            >
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="text-slate-400">
                {label[e.from]} → {label[e.to]}
              </span>
              <span className="block leading-snug text-slate-100">{e.mechanism}</span>
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
  <span className="flex gap-3 text-xs text-slate-400">
    <span style={{ color: POS }}>— raises</span>
    <span style={{ color: NEG }}>— lowers</span>
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
        title="Spillover map"
        right={
          <span className="flex items-center gap-3">
            {LEGEND}
            {graph && (
              <button onClick={() => setExpanded(true)} className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-800">
                ⤢ Expand
              </button>
            )}
          </span>
        }
      >
        {!graph ? (
          <p className="text-slate-500">Shows how the event transmits across markets, after the debate.</p>
        ) : (
          <Graph {...props} />
        )}
      </Panel>
      {expanded && graph && (
        <div className="fixed inset-0 z-40 flex bg-slate-950/85 p-6 backdrop-blur-sm" onClick={() => setExpanded(false)}>
          <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-700 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Spillover map · {state.event}</h2>
              <span className="flex items-center gap-4">
                {LEGEND}
                <button onClick={() => setExpanded(false)} className="rounded border border-slate-600 px-3 py-1 text-sm hover:bg-slate-800">
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
