// Compliance guardrail status for the session header: proof that safety is enforced by
// infrastructure (Bedrock Guardrails on every message and brief line), not only by prompts.

export function ShieldIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </svg>
  )
}

function guardrailCounts(state) {
  const messages = state.feed.filter((f) => f.kind === 'message' && f.guardrail?.action === 'blocked').length
  const lines = (state.brief?.guardrail || []).filter((g) => g.action === 'blocked').length
  const unchecked = state.feed.filter((f) => f.guardrail?.action === 'unchecked').length +
    (state.brief?.guardrail || []).filter((g) => g.action === 'unchecked').length
  return { messages, lines, unchecked }
}

export default function GuardrailBadge({ state, available }) {
  if (!state.council?.guardrail) {
    // Set up but switched off for this live run: say so, so nobody assumes it was checked.
    return available && state.mode === 'live' && state.council ? (
      <span className="inline-flex items-center gap-2 rounded-full bg-raised px-3 py-1.5 text-sm font-medium text-muted">
        <ShieldIcon />Guardrail off for this run
      </span>
    ) : null
  }
  const { messages, lines, unchecked } = guardrailCounts(state)
  const parts = [
    messages && `${messages} message${messages === 1 ? '' : 's'}`,
    lines && `${lines} brief line${lines === 1 ? '' : 's'}`,
  ].filter(Boolean)
  const text = parts.length ? `Guardrail blocked ${parts.join(', ')}` : 'Guardrail on · no interventions'
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${
        parts.length ? 'bg-gold-soft text-gold-text' : 'bg-raised text-muted'
      }`}
      title={`${state.council.guardrail}: every message and brief line is checked for personal buy/sell advice and political commentary before it is shown.${
        unchecked ? ` ${unchecked} could not be checked (guardrail unavailable).` : ''
      }`}
    >
      <ShieldIcon />
      {text}
      {unchecked > 0 && <span className="text-bear">· {unchecked} unchecked</span>}
    </span>
  )
}

/** On/off switch for the compliance guardrail on the next run. */
export function GuardrailToggle({ guard, compact = false }) {
  const disabled = !guard.available
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={guard.active}
        aria-label="Compliance guardrail"
        disabled={disabled}
        onClick={() => guard.setOn(!guard.on)}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          guard.active ? 'border-gold bg-gold' : 'border-line-strong bg-desk'
        }`}
      >
        <span className={`inline-block size-5 rounded-full bg-ink transition-transform ${guard.active ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
      <span className="flex flex-col leading-tight">
        <span className="inline-flex items-center gap-1.5 text-[15px] font-medium">
          <ShieldIcon size={15} />Compliance guardrail {guard.active ? 'on' : 'off'}
        </span>
        {!compact && (
          <span className="text-[13px] text-muted">
            {disabled
              ? 'Not set up: add GUARDRAIL_ID to .env (scripts/create_guardrail.py).'
              : guard.active
                ? 'Blocks personal buy/sell advice and political commentary before it is shown.'
                : 'Messages are shown exactly as the members wrote them.'}
          </span>
        )}
      </span>
    </div>
  )
}
