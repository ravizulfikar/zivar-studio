import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { parseJson } from '@shared/jsonModel'
import { hexDump, initialText, toBytes } from './CellViewer'
import { JsonEditor } from './JsonEditor'

export type CellMode = 'text' | 'json' | 'hex'

interface Props {
  /** null: no cell is selected yet. */
  column: string | null
  type?: string
  value: unknown
  mode: CellMode
  onMode: (m: CellMode) => void
  /** When set, the text can be changed and staged as an edit of the cell. */
  onApply?: (text: string | null) => void
  height: number
}

/** The selected cell, large, under the grid: as text, as JSON (tree) or as hex. */
export function CellPanel({ column, type, value, mode, onMode, onApply, height }: Props): JSX.Element {
  const isNull = value === null || value === undefined
  const isBinary = value instanceof Uint8Array
  const initial = useMemo(() => initialText(value), [value])
  // The draft belongs to one cell value: another cell (or a new value) starts again from its own text.
  const [draft, setDraft] = useState<{ of: string; text: string }>({ of: '', text: '' })
  const key = `${column}\u0000${isNull ? 'null' : initial}\u0000${isBinary}`
  const text = draft.of === key ? draft.text : initial
  const edit = (t: string): void => setDraft({ of: key, text: t })
  const dirty = !!onApply && !isBinary && text !== initial
  const shown: CellMode = isBinary ? 'hex' : mode
  const jsonOk = useMemo(() => shown === 'json' && parseJson(text).ok, [shown, text])
  const size = isNull ? 'NULL' : isBinary ? `${(value as Uint8Array).length.toLocaleString()} bytes` : `${text.length.toLocaleString()} characters`

  return (
    <div className="cell-panel" style={{ height }} data-testid="cell-panel">
      <div className="cell-panel-head">
        {column === null ? (
          <span className="muted">Click a cell to see its content here.</span>
        ) : (
          <>
            <strong>{column}</strong>
            {type && <span className="muted"> {type}</span>}
            <span className="muted"> · {size}</span>
          </>
        )}
        <div className="grow" />
        <select value={shown} disabled={isBinary} onChange={(e) => onMode(e.target.value as CellMode)} title="How the content is shown">
          <option value="text">Text</option>
          <option value="json">JSON</option>
          <option value="hex">Hex</option>
        </select>
        <button disabled={column === null || isNull} onClick={() => void navigator.clipboard.writeText(isBinary ? Array.from(toBytes(value), (x) => x.toString(16).padStart(2, '0')).join('') : text)}>
          Copy
        </button>
        {onApply && (
          <>
            <button disabled={column === null || isBinary || isNull} onClick={() => onApply(null)} title="Stage NULL for this cell">
              Set NULL
            </button>
            <button className="run" disabled={!dirty} onClick={() => onApply(text)} title="Stage this text as the new value of the cell (nothing is written until you Apply)">
              Apply to cell
            </button>
          </>
        )}
      </div>
      <div className="cell-panel-body">
        {column === null ? null : shown === 'hex' ? (
          <pre className="viewer-pre">{isNull ? '(NULL)' : hexDump(toBytes(value)) || '(empty)'}</pre>
        ) : shown === 'json' ? (
          jsonOk ? (
            <JsonEditor key={key} text={text} onChange={onApply ? edit : undefined} initialView="split" />
          ) : (
            <div className="msg muted">{isNull ? '(NULL)' : 'This value is not valid JSON; use the Text view.'}</div>
          )
        ) : (
          <textarea className="viewer-text" spellCheck={false} readOnly={!onApply} value={text} placeholder={isNull ? '(NULL)' : ''} onChange={(e) => edit(e.target.value)} />
        )}
      </div>
    </div>
  )
}
