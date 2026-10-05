// Shared pieces for the council builder screens.
import { STEPS } from './styles'

const ICONS = {
  check: 'M5 12l5 5L20 7',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  back: 'M19 12H5M11 6l-6 6 6 6',
  edit: 'M4 20h4L19 9l-4-4L4 16v4z',
}

export function Icon({ name, size = 16, stroke = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  )
}

export function Logo({ size = 36 }) {
  return <img src="/verdisk-logo.png" alt="" width={size} height={size} className="shrink-0 select-none" draggable="false" />
}

/** Logo plus product name, for page headers. */
export function Brand() {
  return (
    <span className="flex items-center gap-2.5">
      <Logo />
      <span className="text-xl font-semibold tracking-[0.01em]">Verdisk</span>
    </span>
  )
}

export function StepNav({ step, onStep, canReach }) {
  return (
    <nav aria-label="Build steps">
      <ol className="flex flex-wrap gap-1.5 text-sm">
        {STEPS.map((label, i) => {
          const current = i === step
          const done = i < step
          return (
            <li key={label}>
              <button
                type="button"
                onClick={() => onStep(i)}
                disabled={!canReach(i)}
                aria-current={current ? 'step' : undefined}
                className={`flex min-h-11 items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 disabled:cursor-not-allowed ${
                  current ? 'bg-gold-soft text-gold-text' : 'text-muted hover:text-ink'
                }`}
              >
                <span
                  className={`inline-flex size-6 items-center justify-center rounded-full font-mono ${
                    current ? 'bg-gold font-semibold text-gold-ink' : done ? 'bg-[#2e3743] text-ink' : 'border border-line-strong'
                  }`}
                >
                  {done ? <Icon name="check" size={14} stroke={3} /> : i + 1}
                </span>
                {label}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export function StepTitle({ step, title, children }) {
  return (
    <div className="mb-5 flex max-w-4xl flex-col gap-1">
      <span className="font-mono text-xs uppercase tracking-[0.08em] text-gold">Step {step} of 3</span>
      <h1 className="text-[28px] font-semibold leading-tight text-ink">{title}</h1>
      <p className="text-base text-muted">{children}</p>
    </div>
  )
}

/** The one section header style for builder panels: small caps label, optional action on the right. */
export function SectionHeader({ title, children }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3">
      <h2 className="font-mono text-xs uppercase tracking-[0.08em] text-muted">{title}</h2>
      {children}
    </div>
  )
}

/** The one toggle chip for multi-select choices (markets, sectors): soft gold when selected. */
export function Chip({ on = false, dashed = false, className = '', children, ...rest }) {
  return (
    <button
      type="button"
      aria-pressed={dashed ? undefined : on}
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
        on ? 'border-gold bg-gold-soft text-gold-text' : dashed
          ? 'border-dashed border-line-strong text-muted hover:bg-raised hover:text-ink'
          : 'border-line-strong text-ink hover:bg-raised'
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Card({ className = '', children, ...rest }) {
  return (
    <div className={`rounded-2xl border border-line bg-panel p-5 ${className}`} {...rest}>
      {children}
    </div>
  )
}

const BUTTON = {
  primary: 'bg-gold text-gold-ink font-semibold hover:bg-gold-hover',
  secondary: 'border border-line-strong text-ink hover:bg-raised font-medium',
  ghost: 'border border-dashed border-line-strong text-ink hover:bg-raised',
}

export function Button({ variant = 'secondary', className = '', children, ...rest }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

/** Toggleable pill used for single-choice options. */
export function Pill({ on, children, ...rest }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={`min-h-11 rounded-full border px-4 text-[15px] font-medium ${
        on ? 'border-gold bg-gold text-gold-ink' : 'border-line-strong text-ink hover:bg-raised'
      }`}
      {...rest}
    >
      {children}
    </button>
  )
}
