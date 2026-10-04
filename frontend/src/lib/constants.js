export const COUNTRIES = ['HK', 'CN', 'US', 'JP']
export const SECTORS = ['Tech', 'Financials', 'Property', 'Energy']

export const COUNTRY_NAMES = { HK: 'Hong Kong', CN: 'Mainland China', US: 'United States', JP: 'Japan' }

// Agent colours stay clear of the red/green used for views.
export const AGENTS = {
  CHAIR: { label: 'Chair', color: '#fbbf24', icon: '⚖️' },
  HK: { label: 'Hong Kong', color: '#f472b6', flag: 'HK' },
  CN: { label: 'Mainland China', color: '#fb923c', flag: 'CN' },
  US: { label: 'United States', color: '#38bdf8', flag: 'US' },
  JP: { label: 'Japan', color: '#a78bfa', flag: 'JP' },
  BEAR: { label: 'Bear', color: '#f87171', icon: '🐻' },
  SPILLOVER: { label: 'Spillover', color: '#2dd4bf', icon: '🔀' },
}

export const STAGES = [
  { id: 'data', label: 'Data' },
  { id: 'blind_vote', label: 'Blind vote' },
  { id: 'debate', label: 'Debate' },
  { id: 'revote', label: 'Revote' },
  { id: 'spillover', label: 'Spillover' },
  { id: 'brief', label: 'Brief' },
]

export const PRESETS = ['Fed cuts 50bp', 'China announces major stimulus', 'BoJ hikes rates', 'Oil spikes 15%']

// Blue/orange rather than green/red so colour-blind viewers can tell them apart; arrows are a second cue.
export const VIEW_STYLE = {
  bullish: { rgb: '90, 162, 240', arrow: '▲', label: 'Bullish', text: 'text-bull', hex: '#8cc2f7' },
  neutral: { rgb: '141, 151, 165', arrow: '●', label: 'Neutral', text: 'text-[#c4cbd5]', hex: '#c4cbd5' },
  bearish: { rgb: '240, 138, 75', arrow: '▼', label: 'Bearish', text: 'text-bear', hex: '#f7b37e' },
}

export const DISCLAIMER = 'Research and decision support only. Not investment advice.'
