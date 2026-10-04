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

export function Logo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"
      className="text-gold">
      <circle cx="16" cy="16" r="5" />
      {[[16, 4], [26.4, 10], [26.4, 22], [16, 28], [5.6, 22], [5.6, 10]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="2" />
      ))}
    </svg>
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
    <div className="mb-7 flex max-w-3xl flex-col gap-2">
      <span className="font-mono text-[13px] uppercase tracking-[0.08em] text-gold">Step {step} of 3</span>
      <h1 className="text-[34px] font-semibold leading-tight text-ink">{title}</h1>
      <p className="text-[17px] text-muted">{children}</p>
    </div>
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
