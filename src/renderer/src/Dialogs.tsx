import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { HistoryEntry, SavedQuery } from '@shared/types'
import { errMsg, unwrap } from './api'

/** window.prompt() is unavailable in Electron, so ask for text with our own dialog. */
export function PromptDialog(props: {
  title: string
  label: string
  initial?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(props.initial ?? '')
  const submit = (): void => {
    if (value.trim()) props.onSubmit(value.trim())
  }
  return (
    <div className="backdrop" onClick={props.onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{props.title}</h3>
        <label>
          {props.label}
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') props.onCancel()
            }}
          />
        </label>
        <div className="row end">
          <button onClick={props.onCancel}>Cancel</button>
          <button className="primary" disabled={!value.trim()} onClick={submit}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

const snippet = (sql: string): string => sql.replace(/\s+/g, ' ').slice(0, 180)

export function LibraryDialog(props: { onPick: (sql: string) => void; onClose: () => void }): JSX.Element {
  const [tab, setTab] = useState<'history' | 'saved'>('history')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [saved, setSaved] = useState<SavedQuery[]>([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reload = (): void => {
    unwrap(window.api.historyList()).then(setHistory, (e) => setError(errMsg(e)))
    unwrap(window.api.savedList()).then(setSaved, (e) => setError(errMsg(e)))
  }
  useEffect(reload, [])

  const f = filter.trim().toLowerCase()
  const hist = useMemo(() => history.filter((h) => !f || h.sql.toLowerCase().includes(f)), [history, f])
  const sav = useMemo(() => saved.filter((s) => !f || s.sql.toLowerCase().includes(f) || s.name.toLowerCase().includes(f)), [saved, f])

  return (
    <div className="backdrop" onClick={props.onClose}>
      <div className="dialog library" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>
            History ({history.length})
          </button>
          <button className={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}>
            Saved ({saved.length})
          </button>
          <div className="grow" />
          <input className="lib-filter" placeholder="Search" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {error && <div className="msg error small">{error}</div>}
        <div className="lib-list">
          {tab === 'history' &&
            hist.map((h) => (
              <div key={h.id} className="lib-item" onClick={() => props.onPick(h.sql)} title="Click to load into the editor">
                <div className="lib-meta">
                  <span className={h.ok ? 'ok' : 'bad'}>{h.ok ? '✓' : '✕'}</span>
                  <span>{new Date(h.at).toLocaleString()}</span>
                  <span className="muted">
                    {h.connName}
                    {h.container ? ` › ${h.container}` : ''} · {h.durationMs} ms
                  </span>
                </div>
                <div className="lib-sql">{snippet(h.sql)}</div>
              </div>
            ))}
          {tab === 'saved' &&
            sav.map((s) => (
              <div key={s.id} className="lib-item" onClick={() => props.onPick(s.sql)} title="Click to load into the editor">
                <div className="lib-meta">
                  <strong>{s.name}</strong>
                  <span className="muted">
                    {s.connName ? `${s.connName}${s.container ? ` › ${s.container}` : ''} · ` : ''}
                    {new Date(s.at).toLocaleDateString()}
                  </span>
                  <button
                    className="lib-del"
                    onClick={(e) => {
                      e.stopPropagation()
                      void unwrap(window.api.savedDelete(s.id)).then(reload, (er) => setError(errMsg(er)))
                    }}
                  >
                    Delete
                  </button>
                </div>
                <div className="lib-sql">{snippet(s.sql)}</div>
              </div>
            ))}
          {((tab === 'history' && hist.length === 0) || (tab === 'saved' && sav.length === 0)) && (
            <div className="msg muted">{tab === 'history' ? 'No history yet.' : 'Nothing saved yet. Use “Save” in the editor toolbar.'}</div>
          )}
        </div>
        <div className="row end">
          {tab === 'history' && history.length > 0 && (
            <button
              onClick={() => window.confirm('Clear all query history?') && void unwrap(window.api.historyClear()).then(reload, (er) => setError(errMsg(er)))}
            >
              Clear history
            </button>
          )}
          <button className="primary" onClick={props.onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
