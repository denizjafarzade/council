import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { timeAgo, when } from '../lib/cards'

/** The latest cached headlines for the council's markets; picking one makes it the event. */
export default function NewsPicker({ markets, selectedId, onPick, disabled, limit = 8 }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const key = (markets || []).join(',')

  const load = useCallback(() => {
    api.topNews(key ? key.split(',') : [])
      .then((list) => {
        if (!Array.isArray(list)) throw new Error('the backend did not return headlines')
        setItems(list)
        setError('')
      })
      .catch((e) => { setItems([]); setError(e.message) })
  }, [key])

  useEffect(load, [load])

  async function refresh() {
    setRefreshing(true)
    try {
      await api.refreshNews(key ? key.split(',') : undefined)
      load()
    } catch (e) {
      setError(`Could not refresh headlines: ${e.message}`)
    } finally {
      setRefreshing(false)
    }
  }

  const fetched = items?.length ? items.reduce((a, i) => (i.fetched_at > a ? i.fetched_at : a), items[0].fetched_at) : null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted">
          Top headlines{fetched && <> · fetched {when(fetched, true)}</>}
        </span>
        <button type="button" onClick={refresh} disabled={disabled || refreshing}
          className="min-h-9 rounded-lg border border-line-strong px-3 text-sm text-ink hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40">
          {refreshing ? 'Refreshing…' : '↻ Refresh news'}
        </button>
      </div>
      {error && <p className="text-sm text-bear">{error}</p>}
      {items === null ? (
        <p className="text-sm text-muted">Loading headlines…</p>
      ) : !items.length ? (
        <p className="text-sm text-muted">No cached headlines for these markets yet. Refresh the news.</p>
      ) : (
        <ul className="flex max-h-80 flex-col gap-1.5 overflow-auto pr-1">
          {items.slice(0, limit).map((n) => {
            const on = n.id === selectedId
            return (
              <li key={n.id}>
                <button type="button" disabled={disabled} onClick={() => onPick(n)} aria-pressed={on}
                  className={`flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left disabled:opacity-40 ${
                    on ? 'border-oat bg-gold-soft' : 'border-line hover:bg-raised'}`}>
                  <span className="mt-0.5 rounded bg-raised px-1.5 font-mono text-xs text-muted">{n.market}</span>
                  <span className="flex min-w-0 flex-col">
                    <span className={`leading-snug ${on ? 'text-gold-text' : 'text-ink'}`}>{n.title}</span>
                    <span className="text-[13px] text-muted">{n.source || 'unknown source'} · {timeAgo(n.published)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
