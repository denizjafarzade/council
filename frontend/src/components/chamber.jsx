// Westminster chamber pieces shared by the builder and the session screen: the crest,
// the oak header bar and the small-caps label style.
import { Logo } from '../builder/ui'

/** Verdisk's crest: the logo in a parchment roundel ringed in brass. */
export function Crest({ size = 48 }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-wood-ink shadow-[0_0_0_3px_var(--color-brass)]"
      style={{ width: size, height: size }}>
      <Logo size={Math.round(size * 0.66)} />
    </span>
  )
}

/** The oak bar at the top of every screen, with a brass double rule underneath. */
export function OakBar({ subtitle, children }) {
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b-4 border-double border-brass bg-wood px-7 py-3 text-wood-ink">
      <span className="flex items-center gap-3.5">
        <Crest />
        <span className="flex flex-col leading-tight">
          <span className="text-xs font-bold tracking-[0.22em]">VERDISK</span>
          <span className="font-serif text-xl">Council of Markets</span>
        </span>
      </span>
      {subtitle && (
        <span className="min-w-60 flex-1 text-center text-[13px] uppercase tracking-[0.16em] text-wood-muted">{subtitle}</span>
      )}
      {children}
    </header>
  )
}

/** Small-caps section label in brass. */
export function Caps({ children, className = '' }) {
  return <span className={`text-[13px] font-bold uppercase tracking-[0.18em] ${className}`}>{children}</span>
}

/** Buttons that sit on the oak bar. */
export const oakButton =
  'min-h-11 rounded-md border border-wood-muted px-4 font-semibold text-wood-ink hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40'
export const brassButton =
  'min-h-11 rounded-md bg-brass px-4 font-bold text-wood hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40'
