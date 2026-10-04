// Council builder state: pure functions over the Council config the backend runs
// (backend/schemas.py: Council, Member). Ids follow backend/library.py so the
// default council keeps the original agent ids (HK, CN, US, JP, BEAR, SPILLOVER, CHAIR).

const CROSS_IDS = { bear: 'BEAR', spillover: 'SPILLOVER', chair: 'CHAIR', bull: 'BULL', risk: 'RISK' }

/** A market seat's id: the market code for its Macro Strategist, else MARKET-ROLE. */
export function seatId(roleId, market) {
  return roleId === 'macro' ? market : `${market}-${roleId.toUpperCase()}`.slice(0, 40)
}

export function crossId(roleId) {
  return CROSS_IDS[roleId] || roleId.toUpperCase().slice(0, 40)
}

export function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

/** A unique member id derived from a display name. */
export function memberIdFor(name, taken) {
  const base = (slug(name) || 'member').toUpperCase().slice(0, 36)
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

export function defaultCouncil() {
  const markets = ['HK', 'CN', 'US', 'JP']
  return {
    id: null,
    name: 'My council',
    markets,
    members: [
      ...markets.map((m) => ({ id: m, name: '', role: 'macro', market: m })),
      { id: 'BEAR', name: 'Bear Researcher', role: 'bear', market: null },
      { id: 'SPILLOVER', name: 'Spillover Analyst', role: 'spillover', market: null },
      { id: 'CHAIR', name: 'Chair', role: 'chair', market: null },
    ],
    debate_rounds: 1,
  }
}

/** Fill in display names and phases so the council validates on the backend. */
export function normalise(council, lib) {
  const marketName = (code) => lib.markets.find((m) => m.code === code)?.name || code
  const roleName = (id) => lib.roles.find((r) => r.id === id)?.name || id
  return {
    ...council,
    members: council.members.map((m) => ({
      ...m,
      name: m.name || (m.market ? `${marketName(m.market)} ${roleName(m.role)}` : roleName(m.role)),
      phases: m.phases || { vote: true, debate: true, revote: true },
    })),
  }
}

export function toggleMarket(council, code) {
  if (council.markets.includes(code)) {
    return {
      ...council,
      markets: council.markets.filter((c) => c !== code),
      members: council.members.filter((m) => m.market !== code),
    }
  }
  return {
    ...council,
    markets: [...council.markets, code],
    // A newly seated market starts with its Macro Strategist.
    members: [...council.members, { id: seatId('macro', code), name: '', role: 'macro', market: code }],
  }
}

export function hasSeat(council, roleId, market) {
  return council.members.some((m) => m.id === seatId(roleId, market))
}

export function toggleSeat(council, roleId, market) {
  const id = seatId(roleId, market)
  if (council.members.some((m) => m.id === id)) {
    return { ...council, members: council.members.filter((m) => m.id !== id) }
  }
  return { ...council, members: [...council.members, { id, name: '', role: roleId, market }] }
}

export function hasCross(council, roleId) {
  return council.members.some((m) => m.id === crossId(roleId))
}

export function toggleCross(council, roleId) {
  const id = crossId(roleId)
  if (council.members.some((m) => m.id === id)) {
    return { ...council, members: council.members.filter((m) => m.id !== id) }
  }
  return { ...council, members: [...council.members, { id, name: '', role: roleId, market: null }] }
}

/** Members the role grid does not show as a toggle: user-built ones. */
export function customMembers(council, market) {
  return council.members.filter((m) => m.market === market && m.id !== seatId(m.role, market))
}

export function customCross(council, crossRoleIds) {
  return council.members.filter((m) => !m.market && !(crossRoleIds.includes(m.role) && m.id === crossId(m.role)))
}

export function upsertMember(council, member, replaceId) {
  const rest = council.members.filter((m) => m.id !== (replaceId || member.id))
  return { ...council, members: [...rest, member] }
}

export function removeMember(council, id) {
  return { ...council, members: council.members.filter((m) => m.id !== id) }
}

const phasesOf = (m) => m.phases || { vote: true, debate: true, revote: true }

/** Model calls one run makes, mirroring backend/orchestrator.py. */
export function estimateCalls(council, lib) {
  const stageOf = (m) => lib.roles.find((r) => r.id === m.role)?.stage || 'debate'
  let calls = 0
  for (const m of council.members) {
    const p = phasesOf(m)
    calls += (p.vote ? 1 : 0) + (p.revote ? 1 : 0)
    if (p.debate) calls += stageOf(m) === 'debate' ? council.debate_rounds : 1
  }
  return calls
}

export function marketSeatCount(council) {
  return council.members.filter((m) => m.market).length
}
