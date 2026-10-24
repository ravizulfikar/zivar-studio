import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import {
  addChildAt,
  childrenOf,
  getAt,
  leafText,
  parseJson,
  pathLabel,
  removeAt,
  renameKeyAt,
  searchJson,
  setAt,
  sortKeys,
  statsOf,
  stringifyJson,
  type JNode,
  type JPath
} from '@shared/jsonModel'

type View = 'split' | 'text' | 'tree'

interface Props {
  text: string
  /** Omit for a read-only viewer. */
  onChange?: (text: string) => void
  /** Start with this layout. */
  initialView?: View
}

const PAGE = 100
const NUMBER_ONLY = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/
const keyOf = (p: JPath): string => p.join('/')

/** Text for a value typed into the tree: a string stays a string, other leaves may change type. */
function typed(node: JNode, input: string): JNode {
  if (node.t === 'string') return { t: 'string', v: input }
  const s = input.trim()
  if (NUMBER_ONLY.test(s)) return { t: 'number', raw: s }
  if (s === 'true' || s === 'false') return { t: 'boolean', v: s === 'true' }
  if (s === 'null') return { t: 'null' }
  return { t: 'string', v: input }
}

function preview(n: JNode): string {
  const parts = childrenOf(n)
    .slice(0, 4)
    .map((c) => (n.t === 'object' ? `${c.key}: ` : '') + (c.v.t === 'object' ? '{…}' : c.v.t === 'array' ? '[…]' : c.v.t === 'string' ? JSON.stringify(c.v.v.length > 24 ? c.v.v.slice(0, 24) + '…' : c.v.v) : leafText(c.v)))
  const more = childrenOf(n).length > 4 ? ', …' : ''
  return n.t === 'object' ? `{ ${parts.join(', ')}${more} }` : `[ ${parts.join(', ')}${more} ]`
}

/** Text on the left, a collapsible / searchable / editable tree on the right — like jsoneditoronline.org. */
export function JsonEditor({ text, onChange, initialView = 'split' }: Props): JSX.Element {
  const editable = !!onChange
  const [view, setView] = useState<View>(initialView)
  const deferred = useDeferredValue(text)
  const parsed = useMemo(() => parseJson(deferred), [deferred])
  // Keep the last valid tree on screen while the text is mid-edit and temporarily invalid.
  const lastGood = useRef<JNode | null>(null)
  if (parsed.ok) lastGood.current = parsed.node
  const root = parsed.ok ? parsed.node : lastGood.current

  const [depth, setDepth] = useState(2)
  const [over, setOver] = useState<Map<string, boolean>>(new Map())
  const [limits, setLimits] = useState<Map<string, number>>(new Map())
  const [query, setQuery] = useState('')
  const [hit, setHit] = useState(0)
  const [editing, setEditing] = useState<{ path: JPath; what: 'value' | 'key'; value: string } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)

  const hits = useMemo(() => (root ? searchJson(root, query) : []), [root, query])
  const hitKeys = useMemo(() => new Set(hits.map(keyOf)), [hits])
  const current = hits[hit] ? keyOf(hits[hit]) : null
  // Every ancestor of a hit is opened so the match is visible.
  const forced = useMemo(() => {
    const s = new Set<string>()
    for (const h of hits) for (let i = 0; i < h.length; i++) s.add(keyOf(h.slice(0, i)))
    return s
  }, [hits])
  useEffect(() => setHit(0), [query])
  useEffect(() => {
    if (current !== null) treeRef.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'center' })
  }, [current, hit])

  const stats = useMemo(() => (root ? statsOf(root) : null), [root])
  const isOpen = (path: JPath): boolean => over.get(keyOf(path)) ?? (forced.has(keyOf(path)) || path.length < depth)

  const commit = (next: JNode): void => onChange?.(stringifyJson(next, 2))
  const flash = (what: string): void => {
    setCopied(what)
    window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 1200)
  }
  const copy = (value: string, what: string): void => {
    void navigator.clipboard.writeText(value)
    flash(what)
  }

  const expandAll = (): void => (setDepth(Infinity), setOver(new Map()))
  const collapseAll = (): void => (setDepth(0), setOver(new Map()))

  const finishEdit = (): void => {
    if (!editing || !root) return setEditing(null)
    if (editing.what === 'key') commit(renameKeyAt(root, editing.path, editing.value))
    else {
      const node = getAt(root, editing.path)
      if (node) commit(setAt(root, editing.path, typed(node, editing.value)))
    }
    setEditing(null)
  }

  const jumpToError = (): void => {
    if (parsed.ok || !area.current) return
    setView((v) => (v === 'tree' ? 'split' : v))
    window.setTimeout(() => {
      area.current?.focus()
      area.current?.setSelectionRange(parsed.error.pos, Math.min(parsed.error.pos + 1, text.length))
    }, 0)
  }

  const row = (n: JNode, path: JPath, label: string | number | null): JSX.Element => {
    const kids = childrenOf(n)
    const container = n.t === 'object' || n.t === 'array'
    const open = container && isOpen(path)
    const k = keyOf(path)
    const limit = limits.get(k) ?? PAGE
    const isHit = hitKeys.has(k)
    const isCur = current === k
    const editingValue = editing?.what === 'value' && keyOf(editing.path) === k
    const editingKey = editing?.what === 'key' && keyOf(editing.path) === k
    const parentIsObject = path.length > 0 && getAt(root as JNode, path.slice(0, -1))?.t === 'object'
    return (
      <div key={k || 'root'} className="jt-node">
        <div className={`jt-row ${isHit ? 'hit' : ''} ${isCur ? 'cur' : ''}`} data-current={isCur} style={{ paddingLeft: 6 + path.length * 16 }}>
          <span className={`jt-chev ${container ? '' : 'none'}`} onClick={() => container && setOver((m) => new Map(m).set(k, !open))}>
            {container ? (open ? '▾' : '▸') : ''}
          </span>
          {label !== null &&
            (editingKey ? (
              <input
                className="jt-input"
                autoFocus
                value={editing.value}
                onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                onBlur={finishEdit}
                onKeyDown={(e) => (e.key === 'Enter' ? finishEdit() : e.key === 'Escape' ? setEditing(null) : undefined)}
              />
            ) : (
              <span
                className={`jt-key ${typeof label === 'number' ? 'idx' : ''}`}
                title={editable && parentIsObject ? 'Double-click to rename' : undefined}
                onDoubleClick={() => editable && parentIsObject && setEditing({ path, what: 'key', value: String(label) })}
              >
                {label}
              </span>
            ))}
          {label !== null && <span className="jt-colon">:</span>}
          {container ? (
            <span className="jt-meta" onClick={() => setOver((m) => new Map(m).set(k, !open))}>
              {n.t === 'object' ? `{${kids.length}}` : `[${kids.length}]`}
              {!open && kids.length > 0 && <span className="jt-preview"> {preview(n)}</span>}
            </span>
          ) : editingValue ? (
            <input
              className="jt-input"
              autoFocus
              value={editing.value}
              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
              onBlur={finishEdit}
              onKeyDown={(e) => (e.key === 'Enter' ? finishEdit() : e.key === 'Escape' ? setEditing(null) : undefined)}
            />
          ) : (
            <span
              className={`jt-val ${n.t}`}
              title={editable ? 'Double-click to edit' : undefined}
              onDoubleClick={() => editable && setEditing({ path, what: 'value', value: leafText(n) })}
            >
              {n.t === 'string' ? JSON.stringify(n.v) : leafText(n)}
            </span>
          )}
          <span className="jt-actions">
            <button title="Copy value" onClick={() => copy(n.t === 'string' ? n.v : stringifyJson(n, 2), 'value')}>
              ⧉
            </button>
            <button title="Copy path" onClick={() => copy(pathLabel(root as JNode, path), 'path')}>
              $
            </button>
            {editable && container && (
              <button title={n.t === 'array' ? 'Add item' : 'Add property'} onClick={() => root && commit(addChildAt(root, path, { t: 'string', v: '' }, uniqueKey(n)))}>
                +
              </button>
            )}
            {editable && path.length > 0 && (
              <button title="Delete" className="danger" onClick={() => root && commit(removeAt(root, path))}>
                ✕
              </button>
            )}
          </span>
        </div>
        {open && (
          <>
            {kids.slice(0, limit).map((c, i) => row(c.v, [...path, i], c.key))}
            {kids.length > limit && (
              <div className="jt-more" style={{ paddingLeft: 6 + (path.length + 1) * 16 }}>
                <button onClick={() => setLimits((m) => new Map(m).set(k, limit + 200))}>Show {Math.min(200, kids.length - limit)} more</button>
                <button onClick={() => setLimits((m) => new Map(m).set(k, kids.length))}>Show all {kids.length}</button>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  const err = parsed.ok ? null : parsed.error
  return (
    <div className="jed">
      <div className="jed-bar">
        <div className="seg">
          {(['split', 'text', 'tree'] as View[]).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {v === 'split' ? 'Split' : v === 'text' ? 'Text' : 'Tree'}
            </button>
          ))}
        </div>
        {editable && (
          <>
            <button disabled={!parsed.ok} title="Pretty print" onClick={() => parsed.ok && onChange?.(stringifyJson(parsed.node, 2))}>
              Format
            </button>
            <button disabled={!parsed.ok} title="Remove all whitespace" onClick={() => parsed.ok && onChange?.(stringifyJson(parsed.node, 0))}>
              Minify
            </button>
            <button disabled={!parsed.ok} title="Sort keys A → Z, recursively" onClick={() => parsed.ok && onChange?.(stringifyJson(sortKeys(parsed.node), 2))}>
              Sort keys
            </button>
          </>
        )}
        <button disabled={!root} onClick={expandAll}>
          Expand all
        </button>
        <button disabled={!root} onClick={collapseAll}>
          Collapse all
        </button>
        <div className="grow" />
        <input
          className="jed-search"
          placeholder="Search keys and values"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits.length) setHit((h) => (h + (e.shiftKey ? hits.length - 1 : 1)) % hits.length)
          }}
        />
        {query && (
          <>
            <span className="muted">{hits.length ? `${hit + 1} / ${hits.length}${hits.length >= 500 ? '+' : ''}` : 'no match'}</span>
            <button disabled={!hits.length} onClick={() => setHit((h) => (h + hits.length - 1) % hits.length)}>
              ↑
            </button>
            <button disabled={!hits.length} onClick={() => setHit((h) => (h + 1) % hits.length)}>
              ↓
            </button>
          </>
        )}
      </div>
      <div className={`msg small ${err ? 'error' : 'ok'}`}>
        {err ? (
          <>
            Not valid JSON — line {err.line}, column {err.column}: {err.message}{' '}
            <a className="jed-link" onClick={jumpToError}>
              show
            </a>
            {root && <span className="muted"> · the tree shows the last valid version</span>}
          </>
        ) : (
          <>
            Valid JSON{stats ? ` · ${stats.nodes.toLocaleString()} nodes · ${stats.depth} levels deep` : ''}
            {copied && <span className="muted"> · copied {copied}</span>}
          </>
        )}
      </div>
      <div className={`jed-body ${view}`}>
        {view !== 'tree' && (
          <textarea
            ref={area}
            className="viewer-text jed-text"
            spellCheck={false}
            readOnly={!editable}
            value={text}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder="Paste JSON here"
          />
        )}
        {view !== 'text' && (
          <div className={`jed-tree ${err ? 'stale' : ''}`} ref={treeRef}>
            {root ? row(root, [], null) : <div className="msg muted">{text.trim() ? 'Fix the syntax error to see the tree.' : 'Nothing to show yet.'}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

function uniqueKey(n: JNode): string {
  if (n.t !== 'object') return 'key'
  const have = new Set(n.entries.map((e) => e.key))
  let i = 1
  while (have.has(`key${i}`)) i++
  return `key${i}`
}
