import { useEffect, useRef, useState } from 'react'
import { Button, Icon } from './ui'
import { field } from './styles'

/** Add a custom market by ticker. The backend saves it and fetches index, FX and news right away. */
export default function AddMarketDialog({ taken, onAdd, onClose }) {
  const [form, setForm] = useState({ code: '', name: '', idx: '', fx: '', news: '', brief: '', lat: '', lon: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const first = useRef(null)
  useEffect(() => first.current?.focus(), [])
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: key === 'code' ? e.target.value.toUpperCase() : e.target.value }))

  async function submit(e) {
    e.preventDefault()
    const code = form.code.trim()
    if (!/^[A-Z]{2,4}$/.test(code)) return setError('The code is 2 to 4 letters, like PH or NZ.')
    if (taken.has(code)) return setError(`${code} is already in the library.`)
    if (!form.name.trim() || !form.idx.trim()) return setError('A name and an index ticker are required.')
    const num = (v) => (v.trim() === '' ? null : Number(v))
    const lat = num(form.lat)
    const lon = num(form.lon)
    if ((lat !== null && !(lat >= -90 && lat <= 90)) || (lon !== null && !(lon >= -180 && lon <= 180))) {
      return setError('Latitude is -90 to 90 and longitude -180 to 180.')
    }
    setError('')
    setBusy(true)
    try {
      const tickers = { idx: [form.idx.trim(), `${form.name.trim()} index`] }
      if (form.fx.trim()) tickers.fx = [form.fx.trim(), `USD/${code}`]
      await onAdd({
        code, name: form.name.trim(), lat, lon, brief: form.brief.trim(), tickers,
        news_query: form.news.trim() || form.name.trim(),
      })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-10"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <form role="dialog" aria-modal="true" aria-labelledby="market-title" onSubmit={submit}
        className="w-full max-w-[640px] overflow-hidden rounded-[20px] border border-line bg-panel shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
        <div className="flex items-start justify-between gap-4 border-b border-line px-7 py-6">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[13px] uppercase tracking-[0.08em] text-gold">New market</span>
            <h2 id="market-title" className="text-2xl font-semibold">Add a market by ticker</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="inline-flex size-11 items-center justify-center rounded-xl text-muted hover:bg-raised hover:text-ink">
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="flex flex-col gap-4 px-7 py-6">
          <p className="text-sm text-muted">
            Uses Yahoo Finance tickers. Custom markets get partial data: the index, an exchange rate and headlines.
          </p>
          <div className="grid grid-cols-[120px_1fr] gap-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium">Code
              <input ref={first} className={`${field} font-mono uppercase`} value={form.code} maxLength={4} placeholder="PH" onChange={set('code')} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">Name
              <input className={field} value={form.name} maxLength={60} placeholder="Philippines" onChange={set('name')} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium">Index ticker
              <input className={`${field} font-mono`} value={form.idx} placeholder="PSEI.PS" onChange={set('idx')} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">FX ticker (optional)
              <input className={`${field} font-mono`} value={form.fx} placeholder="PHP=X" onChange={set('fx')} />
            </label>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium">News search (optional)
            <input className={field} value={form.news} placeholder='"Philippine stocks" OR "Bangko Sentral"' onChange={set('news')} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">Local knowledge (optional)
            <textarea rows={3} className={`${field} py-3`} value={form.brief} maxLength={2000}
              placeholder="What a specialist should know about this market" onChange={set('brief')} />
          </label>
          <fieldset className="grid grid-cols-2 gap-4">
            <legend className="mb-1.5 text-sm font-medium">Map position (optional)</legend>
            <label className="flex flex-col gap-1.5 text-sm text-muted">Latitude
              <input className={`${field} font-mono`} inputMode="decimal" value={form.lat} placeholder="14.6" onChange={set('lat')} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm text-muted">Longitude
              <input className={`${field} font-mono`} inputMode="decimal" value={form.lon} placeholder="121" onChange={set('lon')} />
            </label>
          </fieldset>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-7 py-5">
          {error && <p role="alert" className="mr-auto text-sm text-gold-text">{error}</p>}
          {busy && <p className="mr-auto text-sm text-muted">Saving and fetching data…</p>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>Add market</Button>
        </div>
      </form>
    </div>
  )
}
