// The council drawn as an amphitheatre: the Chair on the stage, cross-market members in the front
// row, and each market's delegation in its own wedge of the tiers, split by stairways. Used by the
// builder's review step and the session screen; callers decide how each seat is coloured.

// Geometry, in SVG units (the drawing scales to its container's width).
const SEAT = 66 // arc length one seat needs, label included
const ROW = 62 // depth of one tier
const STAGE = 80 // radius of the Chair's stage
const EDGE = 0.07 // radians left clear at each end of the arc
const AISLE = 0.05 // radians of stairway between two delegations
const TIER_FILL = ['#e4d7b8', '#dacbab', '#cfbf9c']

const pt = (cx, cy, r, a) => [cx + r * Math.cos(a), cy - r * Math.sin(a)]

/** A ring segment between radii r0 and r1, from angle a0 to a1 (radians, 0 = right, π = left). */
function ring(cx, cy, r0, r1, a0 = 0, a1 = Math.PI) {
  const [x1, y1] = pt(cx, cy, r1, a1)
  const [x2, y2] = pt(cx, cy, r1, a0)
  const [x3, y3] = pt(cx, cy, r0, a0)
  const [x4, y4] = pt(cx, cy, r0, a1)
  return `M${x1} ${y1}A${r1} ${r1} 0 0 1 ${x2} ${y2}L${x3} ${y3}A${r0} ${r0} 0 0 0 ${x4} ${y4}Z`
}

/** How a delegation of n fills the tiers, front first: 5 → [2, 2, 1]. */
function tierSplit(n) {
  const rows = Math.min(3, n)
  const out = []
  for (let i = 0, left = n; i < rows; i++) {
    const k = Math.ceil(left / (rows - i))
    out.push(k)
    left -= k
  }
  return out
}

/** Spread k seats along radius r, centred on angle mid, never wider than span. */
function spread(k, r, mid, span) {
  const step = Math.min(span / k, SEAT / r)
  return Array.from({ length: k }, (_, i) => mid + ((k - 1) / 2 - i) * step)
}

/**
 * One seat. `s`: {id, code, label, title, color (ring), fill?, ink?, dashed?, changed?}.
 * `changed` adds a brass outer ring.
 */
function Seat({ s, x, y }) {
  return (
    <g>
      <title>{s.title || s.label}</title>
      {s.changed && <circle cx={x} cy={y} r={25} fill="none" stroke="#a8823e" strokeWidth={3} />}
      <circle cx={x} cy={y} r={19} fill={s.fill || '#f8f2e4'} stroke={s.color} strokeWidth={3.5}
        strokeDasharray={s.dashed ? '4 3' : undefined} />
      <text x={x} y={y + 4} textAnchor="middle" className="font-mono" fontSize={11.5} fontWeight={600} fill={s.ink || '#1e1912'}>{s.code}</text>
      <text x={x} y={y + 36} textAnchor="middle" fontSize={12.5} fill="#3a3226">{s.label}</text>
    </g>
  )
}

/**
 * `delegations`: [{code, name, color, seats}] in seating order, left to right.
 * `cross`: seats for the front row; a seat with role 'bull' goes left, 'bear' right.
 * `active`: a market code whose wedge is shown stronger.
 */
export default function Amphitheatre({ delegations, cross, active = null, label }) {
  const splits = delegations.map((d) => tierSplit(d.seats.length))
  const weights = splits.map((s) => Math.max(1, s[0] || 1))
  const totalW = weights.reduce((a, b) => a + b, 0) || 1
  const arc = Math.PI - 2 * EDGE
  const avail = arc - AISLE * Math.max(0, delegations.length - 1)

  const front = Math.max(STAGE + 56, (cross.length * SEAT) / arc)
  const r1 = Math.max(front + ROW, (totalW * SEAT) / avail)
  const tiers = Math.max(3, ...splits.map((s) => s.length)) // always three steps, so a small council still reads as an amphitheatre
  const radii = Array.from({ length: tiers }, (_, i) => r1 + i * ROW)
  const outer = radii[radii.length - 1] + ROW / 2
  const labelR = outer + 20
  const W = 2 * (labelR + 110)
  const cx = W / 2
  const cy = labelR + 26
  const H = cy + 12

  // Wedges run left to right, each as wide as its front tier needs.
  const spans = weights.map((w) => (w / totalW) * avail)
  const wedges = delegations.map((d, i) => {
    const a1 = Math.PI - EDGE - spans.slice(0, i).reduce((a, b) => a + b + AISLE, 0)
    return { d, a1, a0: a1 - spans[i], rows: splits[i] }
  })
  // Bull on the left of the front row, Bear on the right, everyone else between them.
  const rank = (s) => (s.role === 'bull' ? 0 : s.role === 'bear' ? 2 : 1)
  const crossOrder = [...cross].sort((a, b) => rank(a) - rank(b))
  const bands = [STAGE + 10, (front + r1) / 2, ...radii.map((r) => r + ROW / 2)]

  return (
    <div className="overflow-x-auto rounded-md border border-line-strong bg-[#efe3c8]">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full min-w-[560px]" role="img" aria-label={label}>
        {bands.slice(1).map((r, i) => (
          <path key={r} d={ring(cx, cy, bands[i], r)} fill={i === 0 ? '#ebdfc2' : TIER_FILL[(i - 1) % TIER_FILL.length]}
            stroke="#b5a47e" strokeWidth={1} />
        ))}
        {wedges.map((w) => (
          <path key={w.d.code} d={ring(cx, cy, r1 - ROW / 2, outer, w.a0, w.a1)} fill={w.d.color}
            fillOpacity={active && w.d.code === active ? 0.3 : 0.13} />
        ))}
        {wedges.slice(1).map((w) => {
          const a = w.a1 + AISLE / 2
          const [x1, y1] = pt(cx, cy, r1 - ROW / 2, a)
          const [x2, y2] = pt(cx, cy, outer, a)
          return (
            <g key={w.d.code}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#efe3c8" strokeWidth={10} />
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#a8823e" strokeWidth={1.5} strokeDasharray="2 7" />
            </g>
          )
        })}
        <line x1={0} y1={cy} x2={W} y2={cy} stroke="#b5a47e" strokeWidth={1.5} />

        {wedges.map((w) => {
          const mid = (w.a0 + w.a1) / 2
          const [lx, ly] = pt(cx, cy, labelR, mid)
          const c = Math.cos(mid)
          return (
            <text key={w.d.code} x={lx} y={ly} textAnchor={c > 0.35 ? 'start' : c < -0.35 ? 'end' : 'middle'}
              fontSize={12} fontWeight={700} letterSpacing="0.14em" fill={active && w.d.code === active ? '#1e1912' : '#7a5a1e'}>
              {w.d.name.toUpperCase()}
            </text>
          )
        })}
        {wedges.flatMap((w) => {
          let at = 0
          return w.rows.flatMap((k, row) => {
            const seats = w.d.seats.slice(at, at + k)
            at += k
            return spread(k, radii[row], (w.a0 + w.a1) / 2, w.a1 - w.a0).map((a, i) => {
              const [x, y] = pt(cx, cy, radii[row], a)
              return <Seat key={seats[i].id} s={seats[i]} x={x} y={y} />
            })
          })
        })}
        {spread(crossOrder.length, front, Math.PI / 2, arc).map((a, i) => {
          const [x, y] = pt(cx, cy, front, a)
          return <Seat key={crossOrder[i].id} s={crossOrder[i]} x={x} y={y} />
        })}

        <path d={`M${cx - STAGE} ${cy}A${STAGE} ${STAGE} 0 0 1 ${cx + STAGE} ${cy}Z`} fill="#3a2a1c" />
        <path d={`M${cx - STAGE - 5} ${cy}A${STAGE + 5} ${STAGE + 5} 0 0 1 ${cx + STAGE + 5} ${cy}`} fill="none" stroke="#a8823e" strokeWidth={2} />
        <path d={`M${cx - STAGE - 9} ${cy}A${STAGE + 9} ${STAGE + 9} 0 0 1 ${cx + STAGE + 9} ${cy}`} fill="none" stroke="#a8823e" strokeWidth={1} />
        <circle cx={cx} cy={cy - 46} r={20} fill="#f3ead6" stroke="#a8823e" strokeWidth={3} />
        <image href="/verdisk-logo.png" x={cx - 13} y={cy - 59} width={26} height={26} />
        <text x={cx} y={cy - 12} textAnchor="middle" fontSize={11} fontWeight={700} letterSpacing="0.16em" fill="#f3ead6">THE CHAIR</text>
      </svg>
    </div>
  )
}
