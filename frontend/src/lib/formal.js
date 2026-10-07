// Formal chamber titles for seats: "THE MEMBER FOR HONG KONG (MACRO STRATEGIST)", "THE BEAR RESEARCHER".

const CROSS_TITLES = { CHAIR: 'The Chair', BEAR: 'The Bear Researcher', BULL: 'The Bull Researcher',
  SPILLOVER: 'The Spillover Analyst', RISK: 'The Risk Officer' }

/** `agent` is a roster entry ({label, market, role}); `names` maps market codes to names. */
export function formalTitle(id, agent, names = {}) {
  if (CROSS_TITLES[id]) return CROSS_TITLES[id]
  if (agent?.market) {
    const place = names[agent.market] || agent.market
    // Original delegates are labelled with their market's name; others carry their own name.
    const who = agent.label && agent.label !== place ? agent.label : agent.role
    return `The member for ${place}${who ? ` (${who})` : ''}`
  }
  return agent?.label ? `The ${agent.label}` : id
}

/** The clock time an item reached the floor, for the minutes. */
export function minuteTime(at) {
  if (!at) return ''
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Shorten a label to fit under a seat in the amphitheatre. */
export const seatLabel = (text = '') => (text.length > 10 ? `${text.slice(0, 9)}…` : text)
