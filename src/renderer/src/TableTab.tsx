import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { ColumnInfo, DbKind, DbObject, QueryResult, RowChange } from '@shared/types'
import { errMsg, unwrap } from './api'
import { ExportMenu } from './ExportMenu'
import { exportResult } from './exportData'
import { IconFilter, IconPlus, IconRefresh } from './Icons'
import { CellViewer } from './CellViewer'
import { fmt } from './cellFormat'

const PAGE_SIZES = [100, 500, 1000]

type Order = { column: string; dir: 'asc' | 'desc' } | undefined
/** A cell is addressed by an existing row index or by a not-yet-saved row index. */
type Target = { kind: 'row' | 'new'; i: number; col: string }

interface Props {
  connId: string
  connName: string
  kind: DbKind
  container: string
  obj: DbObject
  refreshKey: number
  /** Reports the loaded page so the toolbar's Export can reach it. */
  onResult: (r: QueryResult | null) => void
  onImport: () => void
}

const sameTarget = (a: Target | null, kind: Target['kind'], i: number, col: string): boolean =>
  !!a && a.kind === kind && a.i === i && a.col === col

export function TableTab({ connId, connName, kind, container, obj, refreshKey, onResult, onImport }: Props): JSX.Element {
  const [meta, setMeta] = useState<ColumnInfo[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<unknown[][]>([])
  const [hasNext, setHasNext] = useState(false)
  const [durationMs, setDurationMs] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [order, setOrder] = useState<Order>(undefined)
  const [whereInput, setWhereInput] = useState('')
  const [where, setWhere] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [edits, setEdits] = useState<Record<number, Record<string, unknown>>>({})
  const [inserts, setInserts] = useState<Record<string, unknown>[]>([])
  const [deletes, setDeletes] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<{ kind: 'row' | 'new'; i: number } | null>(null)
  const [editing, setEditing] = useState<Target | null>(null)
  const [saving, setSaving] = useState(false)
  const [viewing, setViewing] = useState<{ target: Target; value: unknown } | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [findIdx, setFindIdx] = useState(0)
  const gridRef = useRef<HTMLDivElement>(null)

  const pending = Object.keys(edits).length + inserts.length + deletes.size
  const pkCols = useMemo(() => meta.filter((c) => c.primaryKey).map((c) => c.name), [meta])
  const readOnlyReason =
    obj.type !== 'table' ? (obj.type === 'matview' ? 'Materialized views are read-only.' : 'Views are read-only.') : meta.length > 0 && pkCols.length === 0 ? 'This table has no primary key, so it is read-only.' : null
  const editable = readOnlyReason === null && meta.length > 0

  const clearPending = (): void => {
    setEdits({})
    setInserts([])
    setDeletes(new Set())
    setSelected(null)
    setEditing(null)
  }

  const load = useCallback(
    async (p: number, size: number, ord: Order, w: string): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const r = await unwrap(window.api.tableData(connId, container, obj, { limit: size, offset: p * size, orderBy: ord, where: w }))
        setColumns(r.columns)
        setRows(r.rows)
        setHasNext(r.hasNext)
        setDurationMs(r.durationMs)
        onResult({ columns: r.columns, rows: r.rows, durationMs: r.durationMs })
      } catch (e) {
        setError(errMsg(e))
        onResult(null)
      } finally {
        setLoading(false)
      }
    },
    [connId, container, obj, onResult]
  )

  useEffect(() => {
    unwrap(window.api.describe(connId, container, obj)).then(setMeta, (e) => setError(errMsg(e)))
  }, [connId, container, obj])

  // Initial load, and again when the global Refresh is pressed.
  const firstLoad = useRef(true)
  useEffect(() => {
    if (!firstLoad.current && pending > 0 && !window.confirm(`Discard ${pending} pending change(s) and reload?`)) return
    firstLoad.current = false
    clearPending()
    void load(page, pageSize, order, where)
    // Only refreshKey should retrigger this; the other inputs reload via `go`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  /** Change page/sort/filter, asking before throwing away pending edits. */
  const go = (next: { page?: number; size?: number; order?: Order; where?: string }): void => {
    if (pending > 0 && !window.confirm(`Discard ${pending} pending change(s)?`)) return
    const p = next.page ?? 0
    const size = next.size ?? pageSize
    const ord = 'order' in next ? next.order : order
    const w = next.where ?? where
    clearPending()
    setPage(p)
    setPageSize(size)
    setOrder(ord)
    setWhere(w)
    void load(p, size, ord, w)
  }

  const sortBy = (col: string): void => {
    const next: Order = order?.column !== col ? { column: col, dir: 'asc' } : order.dir === 'asc' ? { column: col, dir: 'desc' } : undefined
    go({ order: next })
  }

  const cellValue = (i: number, col: string, ci: number): unknown => (edits[i] && col in edits[i] ? edits[i][col] : rows[i][ci])

  const commitEdit = (t: Target, text: string | null): void => {
    setEditing(null)
    if (t.kind === 'new') {
      setInserts((prev) => prev.map((r, i) => (i === t.i ? { ...r, [t.col]: text } : r)))
      return
    }
    const ci = columns.indexOf(t.col)
    const orig = rows[t.i][ci]
    const unchanged = text === null ? orig === null : orig !== null && orig !== undefined && fmt(orig) === text
    setEdits((prev) => {
      const row = { ...(prev[t.i] ?? {}) }
      if (unchanged) delete row[t.col]
      else row[t.col] = text
      const { [t.i]: _old, ...rest } = prev
      return Object.keys(row).length ? { ...rest, [t.i]: row } : rest
    })
  }

  const addRow = (): void => {
    setInserts((prev) => [...prev, {}])
    setSelected({ kind: 'new', i: inserts.length })
  }

  const deleteSelected = (): void => {
    if (!selected) return
    if (selected.kind === 'new') {
      setInserts((prev) => prev.filter((_, i) => i !== selected.i))
      setSelected(null)
      return
    }
    setDeletes((prev) => {
      const next = new Set(prev)
      if (!next.delete(selected.i)) next.add(selected.i)
      return next
    })
  }

  const apply = async (): Promise<void> => {
    const keyOf = (i: number): Record<string, unknown> =>
      Object.fromEntries(pkCols.map((c) => [c, rows[i][columns.indexOf(c)]]))
    const changes: RowChange[] = []
    for (const [iStr, values] of Object.entries(edits)) {
      const i = Number(iStr)
      if (!deletes.has(i)) changes.push({ type: 'update', key: keyOf(i), values })
    }
    for (const i of deletes) changes.push({ type: 'delete', key: keyOf(i) })
    for (const values of inserts) changes.push({ type: 'insert', values })

    setSaving(true)
    setError(null)
    try {
      await unwrap(window.api.applyChanges(connId, container, obj, changes))
      clearPending()
      await load(page, pageSize, order, where)
    } catch (e) {
      // Everything was rolled back server-side; keep the pending edits so nothing is lost.
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const discard = (): void => {
    if (pending === 0 || window.confirm(`Discard ${pending} pending change(s)?`)) clearPending()
  }

  const startEdit = (kind: Target['kind'], i: number, col: string): void => {
    if (editable && !deletes.has(i)) setEditing({ kind, i, col })
  }

  const renderInput = (t: Target, initial: unknown): JSX.Element => (
    <input
      className="cell-input"
      autoFocus
      defaultValue={initial === null || initial === undefined ? '' : fmt(initial)}
      placeholder="(NULL)"
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => commitEdit(t, e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          e.preventDefault()
          setEditing(null)
        } else if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          commitEdit(t, null)
        }
      }}
    />
  )

  /* ── find & replace over the loaded page (including pending edits) ── */
  const matches = useMemo(() => {
    const out: { i: number; ci: number }[] = []
    if (!findOpen || !findText) return out
    const needle = matchCase ? findText : findText.toLowerCase()
    rows.forEach((row, i) => {
      if (deletes.has(i)) return
      columns.forEach((c, ci) => {
        const v = edits[i] && c in edits[i] ? edits[i][c] : row[ci]
        if (v === null || v === undefined || v instanceof Uint8Array || (typeof v === 'object' && !(v instanceof Date))) return
        const t = typeof v === 'string' ? v : fmt(v)
        if ((matchCase ? t : t.toLowerCase()).includes(needle)) out.push({ i, ci })
      })
    })
    return out
  }, [findOpen, findText, matchCase, rows, columns, edits, deletes])
  const matchAt = useMemo(() => new Map(matches.map((m, k) => [`${m.i}:${m.ci}`, k])), [matches])
  const cur = matches.length ? Math.min(findIdx, matches.length - 1) : -1

  // Keep the current match in view as the user steps through them.
  useEffect(() => {
    if (cur < 0) return
    const m = matches[cur]
    gridRef.current?.querySelector(`[data-r="${m.i}"][data-c="${m.ci}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [cur, matches])

  const replaced = (text: string): string => {
    const re = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi')
    return text.replace(re, () => replaceText) // a function, so "$&" in the replacement stays literal
  }
  const replaceMatch = (m: { i: number; ci: number }): void => {
    const col = columns[m.ci]
    const v = edits[m.i] && col in edits[m.i] ? edits[m.i][col] : rows[m.i][m.ci]
    commitEdit({ kind: 'row', i: m.i, col }, replaced(typeof v === 'string' ? v : fmt(v)))
  }

  const from = rows.length ? page * pageSize + 1 : 0
  return (
    <div className="pane-col">
      <div className="subtoolbar">
        <button onClick={() => go({ page, size: pageSize })} title="Reload this page">
          <IconRefresh size={14} />
        </button>
        <span className="sep-v" />
        <button disabled={!editable} onClick={addRow} title="Add a row">
          <IconPlus size={14} /> Row
        </button>
        <button disabled={!editable || !selected} onClick={deleteSelected} title="Mark the selected row for deletion (click again to undo)">
          − Delete
        </button>
        <button className="run" disabled={pending === 0 || saving} onClick={() => void apply()} title="Write all pending changes in one transaction">
          ✓ Apply{pending ? ` (${pending})` : ''}
        </button>
        <button disabled={pending === 0 || saving} onClick={discard}>
          ✕ Discard
        </button>
        <button disabled={obj.type !== 'table'} onClick={onImport} title="Insert rows from a CSV, Excel or JSON file">
          Import…
        </button>
        <button className={findOpen ? 'on' : ''} onClick={() => setFindOpen((v) => !v)} title="Find and replace in this page of data">
          Find
        </button>
        <div className="grow" />
        <div className="inline-search wide" title="SQL condition, e.g.  status = 'waiting' AND id > 10">
          <IconFilter size={13} />
          <input
            placeholder="WHERE …  (Enter to apply)"
            value={whereInput}
            onChange={(e) => setWhereInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && go({ where: whereInput })}
          />
        </div>
        <ExportMenu
          variant="small"
          disabled={columns.length === 0}
          onExport={(f) => {
            try {
              exportResult({ columns, rows, durationMs }, `${connName}-${obj.name}`, f, { kind, table: obj.name })
            } catch (e) {
              setError(errMsg(e))
            }
          }}
        />
      </div>

      {findOpen && (
        <div className="find-bar">
          <input autoFocus placeholder="Find" value={findText} onChange={(e) => (setFindText(e.target.value), setFindIdx(0))} onKeyDown={(e) => e.key === 'Enter' && matches.length && setFindIdx((cur + (e.shiftKey ? -1 : 1) + matches.length) % matches.length)} />
          <input placeholder="Replace with" value={replaceText} disabled={!editable} onChange={(e) => setReplaceText(e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
            Match case
          </label>
          <button disabled={!matches.length} onClick={() => setFindIdx((cur - 1 + matches.length) % matches.length)}>
            ↑
          </button>
          <button disabled={!matches.length} onClick={() => setFindIdx((cur + 1) % matches.length)}>
            ↓
          </button>
          <span className="muted">{findText ? `${matches.length ? cur + 1 : 0} / ${matches.length}` : ''}</span>
          <button disabled={!editable || cur < 0} onClick={() => replaceMatch(matches[cur])}>
            Replace
          </button>
          <button disabled={!editable || !matches.length} onClick={() => matches.forEach(replaceMatch)} title="Stages the change in every matching cell; nothing is written until you Apply">
            Replace all ({matches.length})
          </button>
        </div>
      )}
      {readOnlyReason && <div className="banner">{readOnlyReason}</div>}
      {error && <div className="msg error">{error}</div>}

      <div className="grid-wrap" ref={gridRef}>
        <table className="grid editable">
          <thead>
            <tr>
              <th className="rownum" />
              {columns.map((c) => {
                const m = meta.find((x) => x.name === c)
                return (
                  <th key={c} className="sortable" onClick={() => sortBy(c)} title={m ? `${m.type}${m.nullable ? '' : ' NOT NULL'}` : ''}>
                    {m?.primaryKey && <span className="pk">⚿ </span>}
                    {c}
                    {order?.column === c && <span className="arrow">{order.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const deleted = deletes.has(i)
              const isSel = selected?.kind === 'row' && selected.i === i
              return (
                <tr key={`r${i}`} className={`${isSel ? 'sel' : ''} ${deleted ? 'deleted' : ''}`}>
                  <td className="rownum" onClick={() => setSelected({ kind: 'row', i })}>
                    {deleted ? '✕' : isSel ? '▶' : from + i}
                  </td>
                  {columns.map((c, ci) => {
                    const v = cellValue(i, c, ci)
                    const dirty = !!edits[i] && c in edits[i]
                    const t: Target = { kind: 'row', i, col: c }
                    return (
                      <td
                        key={c}
                        data-r={i}
                        data-c={ci}
                        className={`${v === null || v === undefined ? 'null' : ''} ${dirty ? 'dirty' : ''} ${matchAt.has(`${i}:${ci}`) ? (matchAt.get(`${i}:${ci}`) === cur ? 'find-cur' : 'find-hit') : ''}`}
                        onClick={() => setSelected({ kind: 'row', i })}
                        onDoubleClick={() => startEdit('row', i, c)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setViewing({ target: t, value: v })
                        }}
                        title={`${fmt(v)}\n(right-click to inspect)`}
                      >
                        {sameTarget(editing, 'row', i, c) ? renderInput(t, v) : fmt(v)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {inserts.map((vals, i) => {
              const isSel = selected?.kind === 'new' && selected.i === i
              return (
                <tr key={`n${i}`} className={`new ${isSel ? 'sel' : ''}`}>
                  <td className="rownum" onClick={() => setSelected({ kind: 'new', i })}>
                    ＋
                  </td>
                  {columns.map((c) => {
                    const set = c in vals
                    const v = vals[c]
                    return (
                      <td
                        key={c}
                        className={`dirty ${!set || v === null ? 'null' : ''}`}
                        onClick={() => setSelected({ kind: 'new', i })}
                        onDoubleClick={() => startEdit('new', i, c)}
                      >
                        {sameTarget(editing, 'new', i, c) ? renderInput({ kind: 'new', i, col: c }, set ? v : null) : set ? fmt(v) : '(default)'}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
        {!loading && rows.length === 0 && inserts.length === 0 && !error && <div className="msg muted">No rows.</div>}
      </div>

      {viewing && (
        <CellViewer
          column={viewing.target.col}
          value={viewing.value}
          onApply={editable && !deletes.has(viewing.target.i) ? (text) => commitEdit(viewing.target, text) : undefined}
          onClose={() => setViewing(null)}
        />
      )}
      <div className="statusline pager">
        <span>
          {loading ? 'Loading…' : rows.length ? `Rows ${from}–${from + rows.length - 1}` : 'No rows'} · {durationMs} ms
          {pending > 0 && <strong className="pending"> · {pending} pending</strong>}
        </span>
        <span className="pager-ctl">
          {editable && <span className="muted">Double-click a cell to edit · Ctrl+0 = NULL</span>}
          <button disabled={page === 0 || loading} onClick={() => go({ page: page - 1 })}>
            ◀
          </button>
          <span>Page {page + 1}</span>
          <button disabled={!hasNext || loading} onClick={() => go({ page: page + 1 })}>
            ▶
          </button>
          <select value={pageSize} onChange={(e) => go({ size: Number(e.target.value) })}>
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s} / page
              </option>
            ))}
          </select>
        </span>
      </div>
    </div>
  )
}
