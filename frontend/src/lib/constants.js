export const COUNTRIES = ['HK', 'CN', 'US', 'JP']
export const SECTORS = ['Tech', 'Financials', 'Property', 'Energy']

export const COUNTRY_NAMES = { HK: 'Hong Kong', CN: 'Mainland China', US: 'United States', JP: 'Japan' }

// Agent colours stay clear of the red/green used for views.
export const AGENTS = {
  CHAIR: { label: 'Chair', color: '#9a6b00', icon: '⚖️' },
  HK: { label: 'Hong Kong', color: '#b83a77', flag: 'HK' },
  CN: { label: 'Mainland China', color: '#b85a12', flag: 'CN' },
  US: { label: 'United States', color: '#1f6fa3', flag: 'US' },
  JP: { label: 'Japan', color: '#6a4fc0', flag: 'JP' },
  BEAR: { label: 'Bear', color: '#b8401a', icon: '🐻' },
  SPILLOVER: { label: 'Spillover', color: '#0f7f74', icon: '🔀' },
}

// The order of proceedings, in chamber terms (Westminster theme).
export const STAGES = [
  { id: 'data', label: 'Evidence', num: 'I' },
  { id: 'blind_vote', label: 'Secret ballot', num: 'II' },
  { id: 'debate', label: 'Debate', num: 'III' },
  { id: 'revote', label: 'Second ballot', num: 'IV' },
  { id: 'spillover', label: 'Spillover inquiry', num: 'V' },
  { id: 'brief', label: 'Ruling', num: 'VI' },
]

// Blue/orange rather than green/red so colour-blind viewers can tell them apart; arrows are a second cue.
export const VIEW_STYLE = {
  bullish: { rgb: '40, 85, 148', arrow: '▲', label: 'Bullish', text: 'text-bull', hex: '#285594' },
  neutral: { rgb: '120, 124, 130', arrow: '●', label: 'Neutral', text: 'text-ink-soft', hex: '#32363e' },
  bearish: { rgb: '176, 84, 38', arrow: '▼', label: 'Bearish', text: 'text-bear', hex: '#974416' },
}

export const DISCLAIMER = 'Research and decision support only. Not investment advice.'
