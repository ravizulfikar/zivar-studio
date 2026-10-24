import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { ConnectionConfig, DbKind, DbObject, ProgressEvent, TableDesign, TransferOptions, TransferTableResult } from '@shared/types'
import { dropTableDdl, formatDdl } from '@shared/ddl'
import { orderByDependencies, planNewTable, planSyncTable } from '@shared/sync'
import { errMsg, unwrap } from './api'
import { KindBadge } from './Icons'

export interface Endpoint {
  connId: string
  container: string
}

/* ───────────── shared pieces ───────────── */

function useProgress(active: boolean): ProgressEvent | null {
  const [p, setP] = useState<ProgressEvent | null>(null)
  useEffect(() => {
    if (!active) return
    setP(null)
    return window.api.onProgress('transfer:progress', setP)
  }, [active])
  return p
}

function Bar({ p }: { p: ProgressEvent | null }): JSX.Element {
  const pct = p && p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0
  return (
    <div className="progress">
      <div className="progress-fill" style={{ width: `${pct}%` }} />
      <span>{p ? `${p.label ?? ''} · ${pct}%` : 'Starting…'}</span>
    </div>
  )
}

/** Choose a connection and one of its databases/schemas; opens the connection on demand. */
function EndpointPicker({ title, connections, value, onChange, disabled }: { title: string; connections: ConnectionConfig[]; value: Endpoint; onChange: (e: Endpoint) => void; disabled?: boolean }): JSX.Element {
  const [containers, setContainers] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const conn = connections.find((c) => c.id === value.connId)

  useEffect(() => {
    if (!value.connId) return
    let stale = false
    setError(null)
    void (async () => {
      try {
        await unwrap(window.api.open(value.connId))
        const list = await unwrap(window.api.containers(value.connId))
        if (stale) return
        setContainers(list)
        if (!list.includes(value.container)) onChange({ connId: value.connId, container: list[0] ?? '' })
      } catch (e) {
        if (!stale) {
          setContainers([])
          setError(errMsg(e))
        }
      }
    })()
    return () => {
      stale = true
    }
    // Only a different connection needs the list reloaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.connId])

  return (
    <fieldset className="endpoint">
      <legend>{title}</legend>
      <label>
        Connection
        <select value={value.connId} disabled={disabled} onChange={(e) => onChange({ connId: e.target.value, container: '' })}>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.kind})
            </option>
          ))}
        </select>
      </label>
      <label>
        {conn?.kind === 'postgres' ? 'Schema' : 'Database'}
        <select value={value.container} disabled={disabled || containers.length === 0} onChange={(e) => onChange({ ...value, container: e.target.value })}>
          {containers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {error && <div className="msg error small">{error}</div>}
    </fieldset>
  )
}

function firstOther(connections: ConnectionConfig[], notId: string): string {
  return (connections.find((c) => c.id !== notId) ?? connections[0])?.id ?? ''
}

const tableObjs = (all: DbObject[]): DbObject[] => all.filter((o) => o.type === 'table')

/* ───────────── Data Transfer ───────────── */

interface TransferProps {
  connections: ConnectionConfig[]
  source: Endpoint
  onClose: () => void
  onDone: () => void
}

export function TransferDialog({ connections, source, onClose, onDone }: TransferProps): JSX.Element {
  const [src, setSrc] = useState<Endpoint>(source)
  const [dst, setDst] = useState<Endpoint>({ connId: firstOther(connections, source.connId), container: '' })
  const [tables, setTables] = useState<DbObject[]>([])
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [createTables, setCreateTables] = useState(true)
  const [ifExists, setIfExists] = useState<TransferOptions['ifExists']>('append')
  const [copyData, setCopyData] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<TransferTableResult[] | null>(null)
  const progress = useProgress(busy)

  const srcKind = connections.find((c) => c.id === src.connId)?.kind
  const dstKind = connections.find((c) => c.id === dst.connId)?.kind

  useEffect(() => {
    if (!src.connId || !src.container) return
    let stale = false
    unwrap(window.api.objects(src.connId, src.container)).then(
      (all) => {
        if (stale) return
        const t = tableObjs(all)
        setTables(t)
        setChosen(new Set(t.map((o) => o.name)))
      },
      (e) => !stale && setError(errMsg(e))
    )
    return () => {
      stale = true
    }
  }, [src.connId, src.container])

  const shown = tables.filter((t) => t.name.toLowerCase().includes(filter.trim().toLowerCase()))
  const same = src.connId === dst.connId && src.container === dst.container
  const toggle = (name: string): void =>
    setChosen((prev) => {
      const next = new Set(prev)
      if (!next.delete(name)) next.add(name)
      return next
    })

  const run = async (): Promise<void> => {
    const picked = tables.filter((t) => chosen.has(t.name))
    const where = `${connections.find((c) => c.id === dst.connId)?.name} › ${dst.container}`
    const warn = ifExists === 'truncate' && copyData ? `\n\nEvery row already in the matching target tables will be DELETED first.` : ''
    if (!window.confirm(`Copy ${picked.length} table(s) to "${where}"?${warn}`)) return
    setBusy(true)
    setError(null)
    setResults(null)
    try {
      setResults(await unwrap(window.api.transfer(src, dst, picked, { createTables, ifExists, copyData })))
      onDone()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const cross = srcKind && dstKind && srcKind !== dstKind
  const blocked = chosen.size === 0 || !dst.container || !src.container || same

  return (
    <div className="backdrop" onClick={busy ? undefined : onClose}>
      <div className="dialog transfer-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Data transfer</h3>
        <div className="endpoints">
          <EndpointPicker title="From" connections={connections} value={src} onChange={setSrc} disabled={busy} />
          <EndpointPicker title="To" connections={connections} value={dst} onChange={setDst} disabled={busy} />
        </div>
        {same && <div className="banner err">Source and target are the same database.</div>}
        {cross && <div className="banner info">{srcKind} → {dstKind}: column types are translated for the target; anything without an equivalent becomes text. The notes after the transfer list every change.</div>}

        <div className="row">
          <input className="lib-filter" placeholder="Filter tables" value={filter} onChange={(e) => setFilter(e.target.value)} disabled={busy} />
          <button disabled={busy} onClick={() => setChosen(new Set(tables.map((t) => t.name)))}>
            All
          </button>
          <button disabled={busy} onClick={() => setChosen(new Set())}>
            None
          </button>
          <span className="muted">
            {chosen.size} of {tables.length} selected
          </span>
        </div>
        <div className="map-wrap">
          {shown.map((t) => (
            <label key={t.name} className="check pick-row">
              <input type="checkbox" checked={chosen.has(t.name)} disabled={busy} onChange={() => toggle(t.name)} />
              {t.name}
            </label>
          ))}
        </div>

        <div className="import-opts">
          <label className="check">
            <input type="checkbox" checked={copyData} disabled={busy} onChange={(e) => setCopyData(e.target.checked)} />
            Copy data
          </label>
          <label className="check">
            <input type="checkbox" checked={createTables} disabled={busy} onChange={(e) => setCreateTables(e.target.checked)} />
            Create missing tables
          </label>
          <label>
            If a table already exists
            <select value={ifExists} disabled={busy} onChange={(e) => setIfExists(e.target.value as TransferOptions['ifExists'])}>
              <option value="append">Add the rows to it</option>
              <option value="truncate">Empty it first (deletes rows)</option>
              <option value="skip">Leave it alone</option>
            </select>
          </label>
        </div>
        <div className="muted small-note">Each table is copied in one transaction: if any row is rejected, that table is left as it was. Other tabs on these connections wait until the transfer finishes.</div>

        {busy && <Bar p={progress} />}
        {error && <div className="msg error">{error}</div>}
        {results && (
          <div className="map-wrap preview">
            <table className="grid">
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Result</th>
                  <th>Rows</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.table}>
                    <td>{r.table}</td>
                    <td className={`status-${r.status}`}>
                      {r.status === 'ok' ? (r.created ? 'created + copied' : 'copied') : r.status}
                    </td>
                    <td>{r.rows.toLocaleString()}</td>
                    <td className="notes-cell" title={[r.error, ...r.notes].filter(Boolean).join('\n')}>
                      {r.error && <span className="err-text">{r.error} </span>}
                      {r.notes.join(' ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="row end">
          {busy ? <button onClick={() => void window.api.cancelScript(dst.connId)}>■ Stop</button> : <button onClick={onClose}>{results ? 'Close' : 'Cancel'}</button>}
          <button className="primary" disabled={busy || blocked} onClick={() => void run()}>
            {busy ? 'Transferring…' : 'Start'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ───────────── Structure Sync ───────────── */

type RowKind = 'new' | 'diff' | 'same' | 'extra'

interface SyncRow {
  name: string
  kind: RowKind
  statements: string[]
  foreignKeys: string[]
  warnings: string[]
  errors: string[]
}

interface SyncProps {
  connections: ConnectionConfig[]
  source: Endpoint
  onClose: () => void
  onDone: () => void
}

export function SyncDialog({ connections, source, onClose, onDone }: SyncProps): JSX.Element {
  const [src, setSrc] = useState<Endpoint>(source)
  const [dst, setDst] = useState<Endpoint>({ connId: firstOther(connections, source.connId), container: '' })
  const [dropExtras, setDropExtras] = useState(false)
  const [dropTables, setDropTables] = useState(false)
  const [srcDesigns, setSrcDesigns] = useState<Map<string, TableDesign> | null>(null)
  const [dstDesigns, setDstDesigns] = useState<Map<string, TableDesign> | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [focus, setFocus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const srcKind: DbKind | undefined = connections.find((c) => c.id === src.connId)?.kind
  const dstKind: DbKind | undefined = connections.find((c) => c.id === dst.connId)?.kind
  const sameEngine = !!srcKind && srcKind === dstKind
  const same = src.connId === dst.connId && src.container === dst.container

  const loadDesigns = async (e: Endpoint): Promise<Map<string, TableDesign>> => {
    const out = new Map<string, TableDesign>()
    for (const o of tableObjs(await unwrap(window.api.objects(e.connId, e.container)))) out.set(o.name, await unwrap(window.api.designInfo(e.connId, e.container, o)))
    return out
  }

  const compare = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const [s, d] = await Promise.all([loadDesigns(src), loadDesigns(dst)])
      setSrcDesigns(s)
      setDstDesigns(d)
      setPicked(new Set())
      setFocus(null)
    } catch (e) {
      setError(errMsg(e))
      setSrcDesigns(null)
      setDstDesigns(null)
    } finally {
      setBusy(false)
    }
  }

  const ctx = { kind: (dstKind ?? 'postgres') as DbKind, container: dst.container, schema: dstKind === 'mssql' ? 'dbo' : undefined }

  // Plans depend on the two snapshots and the options only, so changing an option re-plans without reloading.
  const rows = useMemo<SyncRow[]>(() => {
    if (!srcDesigns || !dstDesigns || !sameEngine) return []
    const opts = { dropExtras, sourceContainer: src.container }
    const out: SyncRow[] = []
    for (const [name, s] of srcDesigns) {
      const t = dstDesigns.get(name)
      if (t) {
        const plan = planSyncTable(ctx, t, s, opts)
        out.push({ name, kind: plan.statements.length || plan.errors.length ? 'diff' : 'same', statements: plan.statements, foreignKeys: [], warnings: plan.warnings, errors: plan.errors })
      } else {
        const plan = planNewTable(ctx, s, { sourceContainer: src.container })
        out.push({ name, kind: 'new', statements: plan.statements, foreignKeys: plan.foreignKeys, warnings: plan.notes, errors: plan.errors })
      }
    }
    if (dropTables) {
      for (const [name] of dstDesigns) if (!srcDesigns.has(name)) out.push({ name, kind: 'extra', statements: [dropTableDdl(ctx, name)], foreignKeys: [], warnings: [`Table "${name}" and all its data will be deleted.`], errors: [] })
    }
    return out
    // ctx is derived from dst/dstKind, which are listed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcDesigns, dstDesigns, dropExtras, dropTables, sameEngine, src.container, dst.container, dstKind])

  // Default selection: everything that changes something and can be applied.
  useEffect(() => {
    setPicked(new Set(rows.filter((r) => (r.kind === 'new' || r.kind === 'diff') && r.errors.length === 0).map((r) => r.name)))
  }, [rows])

  const focused = rows.find((r) => r.name === focus) ?? rows.find((r) => r.kind !== 'same') ?? null

  /** Everything to run, in an order that avoids dependency errors. */
  const plan = useMemo(() => {
    const chosen = rows.filter((r) => picked.has(r.name) && r.errors.length === 0)
    const refs = (name: string): string[] => ((srcDesigns?.get(name) ?? dstDesigns?.get(name))?.foreignKeys ?? []).map((f) => f.refTable)
    const byName = (kind: RowKind): SyncRow[] => orderByDependencies(chosen.filter((r) => r.kind === kind), (r) => refs(r.name)).ordered
    const created = byName('new')
    const dropped = [...byName('extra')].reverse() // children first
    return {
      statements: [...created.flatMap((r) => r.statements), ...byName('diff').flatMap((r) => r.statements), ...created.flatMap((r) => r.foreignKeys), ...dropped.flatMap((r) => r.statements)],
      count: chosen.length
    }
  }, [rows, picked, srcDesigns, dstDesigns])

  const apply = async (): Promise<void> => {
    const risky = plan.statements.filter((s) => /DROP/i.test(s))
    const msg =
      `Run ${plan.statements.length} statement(s) on the target for ${plan.count} table(s)?` +
      (risky.length ? `\n\nThese remove structure or data:\n${risky.slice(0, 12).map((s) => `  • ${s.length > 100 ? `${s.slice(0, 100)}…` : s}`).join('\n')}${risky.length > 12 ? `\n  … and ${risky.length - 12} more` : ''}` : '') +
      (dstKind === 'mysql' ? '\n\nMySQL commits each DDL statement at once; a failure part-way leaves the earlier ones applied.' : '')
    if (!window.confirm(msg)) return
    setBusy(true)
    setError(null)
    try {
      await unwrap(window.api.executeDdl(dst.connId, dst.container, plan.statements))
      const applied = plan.statements.length
      onDone()
      await compare() // re-reads both sides (and clears the note), so confirm afterwards
      setNote(`Applied ${applied} statement(s); the target now matches the source.`)
    } catch (e) {
      setError(errMsg(e))
      setBusy(false)
    }
  }

  const toggle = (name: string): void =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (!next.delete(name)) next.add(name)
      return next
    })

  const label: Record<RowKind, string> = { new: 'new', diff: 'differs', same: 'identical', extra: 'only in target' }

  return (
    <div className="backdrop" onClick={busy ? undefined : onClose}>
      <div className="dialog transfer-dialog sync-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Structure synchronization</h3>
        <div className="endpoints">
          <EndpointPicker title="Source (the model)" connections={connections} value={src} onChange={(e) => (setSrc(e), setSrcDesigns(null))} disabled={busy} />
          <EndpointPicker title="Target (will be changed)" connections={connections} value={dst} onChange={(e) => (setDst(e), setDstDesigns(null))} disabled={busy} />
        </div>
        {!sameEngine && srcKind && dstKind && <div className="banner err">Structure sync needs both sides to be the same kind of database ({srcKind} vs {dstKind}). Use Data transfer to copy between different engines.</div>}
        {same && <div className="banner err">Source and target are the same database.</div>}

        <div className="import-opts">
          <button className="primary" disabled={busy || !sameEngine || same || !src.container || !dst.container} onClick={() => void compare()}>
            {busy && !srcDesigns ? 'Comparing…' : srcDesigns ? 'Compare again' : 'Compare'}
          </button>
          <label className="check" title="Also drop columns, indexes and foreign keys that exist only in the target. This destroys data.">
            <input type="checkbox" checked={dropExtras} onChange={(e) => setDropExtras(e.target.checked)} />
            Drop columns / indexes missing in the source
          </label>
          <label className="check" title="Also drop whole tables that exist only in the target.">
            <input type="checkbox" checked={dropTables} onChange={(e) => setDropTables(e.target.checked)} />
            Drop tables missing in the source
          </label>
        </div>

        {rows.length > 0 && (
          <div className="sync-grid">
            <div className="map-wrap sync-list">
              {rows.map((r) => (
                <div key={r.name} className={`sync-row ${focused?.name === r.name ? 'on' : ''}`} onClick={() => setFocus(r.name)}>
                  <input type="checkbox" checked={picked.has(r.name)} disabled={r.kind === 'same' || r.errors.length > 0 || busy} onChange={() => toggle(r.name)} onClick={(e) => e.stopPropagation()} />
                  <span className="sync-name">{r.name}</span>
                  <span className={`chip chip-${r.errors.length ? 'err' : r.kind}`}>{r.errors.length ? 'needs manual work' : label[r.kind]}</span>
                </div>
              ))}
            </div>
            <div className="sync-detail">
              {focused ? (
                <>
                  {focused.errors.map((e) => (
                    <div key={e} className="banner err">
                      {e}
                    </div>
                  ))}
                  {focused.warnings.map((w) => (
                    <div key={w} className="banner warn">
                      {w}
                    </div>
                  ))}
                  <pre className="ddl">{focused.kind === 'same' ? '-- identical' : focused.errors.length ? '' : formatDdl([...focused.statements, ...focused.foreignKeys])}</pre>
                </>
              ) : (
                <div className="muted pad">Select a table to see its SQL.</div>
              )}
            </div>
          </div>
        )}
        {srcDesigns && rows.length > 0 && rows.every((r) => r.kind === 'same') && <div className="msg ok">The target already matches the source.</div>}

        {error && <div className="msg error">{error}</div>}
        {note && <div className="msg ok">{note}</div>}
        <div className="row end">
          <span className="muted grow">{plan.statements.length ? `${plan.statements.length} statement(s) for ${plan.count} table(s)` : ''}</span>
          <button onClick={onClose} disabled={busy}>
            Close
          </button>
          <button className="primary" disabled={busy || plan.statements.length === 0} onClick={() => void apply()}>
            Apply to target
          </button>
        </div>
      </div>
    </div>
  )
}
