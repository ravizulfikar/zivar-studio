import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { parseJson } from '@shared/jsonModel'
import { fmt } from './cellFormat'
import { JsonEditor } from './JsonEditor'

type Tab = 'text' | 'json' | 'hex' | 'image'

interface Props {
  column: string
  value: unknown
  /** When set, the text can be edited and written back to the cell. */
  onApply?: (text: string | null) => void
  onClose: () => void
}

const HEX_LIMIT = 64 * 1024

function toBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v
  return new TextEncoder().encode(typeof v === 'string' ? v : fmt(v))
}

/** Recognise common image formats from their first bytes (or an SVG document). */
function imageMime(bytes: Uint8Array): string | null {
  const b = bytes
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length > 5 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  if (b.length > 2 && b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp'
  const head = new TextDecoder().decode(b.slice(0, 200)).trimStart().toLowerCase()
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')) ? 'image/svg+xml' : null
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function hexDump(bytes: Uint8Array): string {
  const shown = bytes.subarray(0, HEX_LIMIT)
  const lines: string[] = []
  for (let i = 0; i < shown.length; i += 16) {
    const row = shown.subarray(i, i + 16)
    const hex = Array.from(row, (x) => x.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ')
    const ascii = Array.from(row, (x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : '.')).join('')
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex}  |${ascii}|`)
  }
  if (bytes.length > HEX_LIMIT) lines.push(`… ${(bytes.length - HEX_LIMIT).toLocaleString()} more byte(s) not shown`)
  return lines.join('\n')
}

function initialText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Uint8Array) return ''
  if (typeof v === 'string') return v
  if (v instanceof Date) return fmt(v)
  if (typeof v === 'object') return JSON.stringify(v, null, 2)
  return String(v)
}

/** Inspect one cell: as text, JSON, hex or an image; optionally edit the text and write it back. */
export function CellViewer({ column, value, onApply, onClose }: Props): JSX.Element {
  const isBinary = value instanceof Uint8Array
  const bytes = useMemo(() => (value === null || value === undefined ? new Uint8Array() : toBytes(value)), [value])
  const mime = useMemo(() => (value === null || value === undefined ? null : imageMime(bytes)), [bytes, value])
  const [text, setText] = useState(() => initialText(value))
  const jsonOk = useMemo(() => parseJson(text).ok, [text])
  const startTab: Tab = mime ? 'image' : isBinary ? 'hex' : jsonOk && /^\s*[[{]/.test(text) ? 'json' : 'text'
  const [tab, setTab] = useState<Tab>(startTab)
  const editable = !!onApply && !isBinary
  const dirty = text !== initialText(value)

  return (
    <div className="backdrop" onClick={onClose}>
      <div className={`dialog cell-viewer ${tab === 'json' ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h3>
            {column}
            <span className="muted"> · {value === null || value === undefined ? 'NULL' : isBinary ? `${bytes.length.toLocaleString()} bytes` : `${text.length.toLocaleString()} characters`}</span>
          </h3>
          <div className="grow" />
          {(['text', 'json', 'hex', ...(mime ? (['image'] as const) : [])] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'text' ? 'Text' : t === 'json' ? 'JSON' : t === 'hex' ? 'Hex' : 'Image'}
            </button>
          ))}
        </div>

        {tab === 'image' && mime && (
          <div className="viewer-image">
            <img alt={column} src={`data:${mime};base64,${toBase64(bytes)}`} />
          </div>
        )}
        {tab === 'hex' && <pre className="viewer-pre">{bytes.length ? hexDump(bytes) : '(empty)'}</pre>}
        {tab === 'json' && <JsonEditor text={text} onChange={editable ? setText : undefined} />}
        {tab === 'text' &&
          (isBinary ? (
            <div className="msg muted">This value is binary. Use the Hex tab{mime ? ' or the Image tab' : ''}.</div>
          ) : (
            <textarea className="viewer-text" spellCheck={false} readOnly={!editable} value={text} onChange={(e) => setText(e.target.value)} placeholder={value === null || value === undefined ? '(NULL)' : ''} />
          ))}

        <div className="row end">
          <button onClick={() => void navigator.clipboard.writeText(isBinary ? Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('') : text)}>Copy</button>
          {editable && (
            <>
              <button onClick={() => (onApply?.(null), onClose())}>Set NULL</button>
              <button className="primary" disabled={!dirty} onClick={() => (onApply?.(text), onClose())}>
                Apply to cell
              </button>
            </>
          )}
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
