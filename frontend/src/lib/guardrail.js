// The compliance guardrail toggle: whether the backend has one set up (/health), and whether
// the viewer wants it on for the next run (remembered in this browser).
import { useEffect, useState } from 'react'

const KEY = 'verdisk.guardrail'

function stored() {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function useGuardrailSetting() {
  const [available, setAvailable] = useState(null) // the guardrail's label, or null when not set up
  const [on, setOnState] = useState(stored)

  useEffect(() => {
    fetch('/health')
      .then((r) => (r.ok ? r.json() : {}))
      .then((h) => setAvailable(h.guardrail || null))
      .catch(() => setAvailable(null))
  }, [])

  function setOn(value) {
    setOnState(value)
    try {
      localStorage.setItem(KEY, value ? 'on' : 'off')
    } catch {
      // Storage can be blocked; the toggle still works for this session.
    }
  }

  return { available, on, setOn, active: !!available && on }
}
