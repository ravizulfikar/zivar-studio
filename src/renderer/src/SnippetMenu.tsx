import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { DbKind, Snippet } from '@shared/types'
import { errMsg, unwrap } from './api'
import { BUILTIN_SNIPPETS } from './snippets'

interface Props {
  kind: DbKind
  /** True when the editor has a selection, which "Save selection as snippet" needs. */
  hasSelection: boolean
  onInsert: (text: string) => void
  onSaveSelection: () => void
  /** Bump to make the menu reload the user's snippets (after saving one). */
  version: number
}

/** Drop-down of built-in and user snippets; choosing one inserts it at the cursor. */
export function SnippetMenu({ kind, hasSelection, onInsert, onSaveSelection, version }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [mine, setMine] = useState<Snippet[]>([])
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    unwrap(window.api.snippetsList()).then(setMine, (e) => setError(errMsg(e)))
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open, version])

  const remove = (s: Snippet): void => {
    void unwrap(window.api.snippetDelete(s.id)).then(
      () => setMine((prev) => prev.filter((x) => x.id !== s.id)),
      (e) => setError(errMsg(e))
    )
  }

  return (
    <div className="export-menu" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} title="Insert a snippet at the cursor">
        Snippets ▾
      </button>
      {open && (
        <div className="popup snippet-popup">
          {error && <div className="msg error small">{error}</div>}
          <div className="popup-group">Built-in</div>
          {BUILTIN_SNIPPETS.map((s) => (
            <button
              key={s.name}
              className="popup-item"
              onClick={() => {
                setOpen(false)
                onInsert(s.body(kind))
              }}
            >
              {s.name}
            </button>
          ))}
          {mine.length > 0 && <div className="popup-group">Yours</div>}
          {mine.map((s) => (
            <div key={s.id} className="popup-item snippet-mine">
              <button
                className="linklike"
                title={s.body.slice(0, 300)}
                onClick={() => {
                  setOpen(false)
                  onInsert(s.body)
                }}
              >
                {s.name}
              </button>
              <button className="lib-del" onClick={() => remove(s)}>
                ✕
              </button>
            </div>
          ))}
          <div className="sep" />
          <button
            className="popup-item"
            disabled={!hasSelection}
            title={hasSelection ? undefined : 'Select some SQL in the editor first'}
            onClick={() => {
              setOpen(false)
              onSaveSelection()
            }}
          >
            Save selection as snippet…
          </button>
        </div>
      )}
    </div>
  )
}
