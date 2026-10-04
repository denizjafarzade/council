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

export const VIEW_STYLE = {
  bullish: { rgb: '16, 185, 129', arrow: '▲', text: 'text-emerald-300' },
  neutral: { rgb: '100, 116, 139', arrow: '●', text: 'text-slate-300' },
  bearish: { rgb: '244, 63, 94', arrow: '▼', text: 'text-rose-300' },
}

export const DISCLAIMER = 'Research and decision support only. Not investment advice.'
