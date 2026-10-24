import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { DbKind, DbObject, DumpResult, ProgressEvent, ScriptResult } from '@shared/types'
import { splitSql } from '@shared/sqlSplit'
import { errMsg, unwrap } from './api'
import { decodeText } from './importParse'

const ENCODINGS = [
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'windows-1252', label: 'Windows-1252 (Western)' },
  { id: 'utf-16le', label: 'UTF-16 LE' }
]

const fmtBytes = (n: number): string => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`)

/** Live progress from a main-process job while `active`. */
function useProgress(channel: 'script:progress' | 'dump:progress', active: boolean): ProgressEvent | null {
  const [p, setP] = useState<ProgressEvent | null>(null)
  useEffect(() => {
    if (!active) return
    setP(null)
    return window.api.onProgress(channel, setP)
  }, [channel, active])
  return p
}

function Bar({ p }: { p: ProgressEvent | null }): JSX.Element {
  const pct = p && p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0
  return (
    <div className="progress">
      <div className="progress-fill" style={{ width: `${pct}%` }} />
      <span>{p ? `${p.label ?? `${p.done.toLocaleString()} / ${p.total.toLocaleString()}`} · ${pct}%` : 'Starting…'}</span>
    </div>
  )
}

/* ───────────── Run a .sql file ───────────── */

interface RunProps {
  connId: string
  connName: string
  kind: DbKind
  container: string | null
  onClose: () => void
  onDone: () => void
}

export function RunScriptDialog({ connId, connName, kind, container, onClose, onDone }: RunProps): JSX.Element {
  const [fileName, setFileName] = useState<string | null>(null)
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null)
  const [encoding, setEncoding] = useState('utf-8')
  const [stopOnError, setStopOnError] = useState(true)
  const [transaction, setTransaction] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ScriptResult | null>(null)
  const progress = useProgress('script:progress', busy)

  const statements = useMemo(() => (buffer ? splitSql(decodeText(buffer, encoding), kind) : []), [buffer, encoding, kind])

  const pick = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setError(null)
    setResult(null)
    setFileName(file.name)
    setBuffer(await file.arrayBuffer())
  }

  const run = async (): Promise<void> => {
    const where = `${connName}${container ? ` › ${container}` : ''}`
    if (!window.confirm(`Run ${statements.length.toLocaleString()} statement(s) on "${where}"?\n\n${transaction ? 'Everything runs in one transaction and is undone if any statement fails.' : stopOnError ? 'It stops at the first error; statements already run stay applied.' : 'It carries on after errors; statements that succeeded stay applied.'}`)) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await unwrap(window.api.runScript(connId, container, statements, { stopOnError, transaction })))
      onDone()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const cancel = (): void => void window.api.cancelScript(connId)

  return (
    <div className="backdrop" onClick={busy ? undefined : onClose}>
      <div className="dialog import-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>
          Run SQL file on <em>{connName}</em>
          {container ? ` › ${container}` : ''}
        </h3>
        <label>
          SQL file
          <input type="file" accept=".sql,.txt" disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
        {fileName && buffer && (
          <>
            <div className="import-opts">
              <label>
                Encoding
                <select value={encoding} disabled={busy} onChange={(e) => setEncoding(e.target.value)}>
                  {ENCODINGS.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={stopOnError || transaction} disabled={busy || transaction} onChange={(e) => setStopOnError(e.target.checked)} />
                Stop at the first error
              </label>
              <label className="check">
                <input type="checkbox" checked={transaction} disabled={busy} onChange={(e) => setTransaction(e.target.checked)} />
                Run in a single transaction
              </label>
            </div>
            {transaction && kind === 'mysql' && <div className="banner warn">MySQL commits DDL statements (CREATE, ALTER, DROP…) immediately, so a transaction cannot undo them.</div>}
            <div className="muted">
              {fmtBytes(buffer.byteLength)} · {statements.length.toLocaleString()} statement(s)
            </div>
            <div className="map-wrap preview">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>First statements</th>
                  </tr>
                </thead>
                <tbody>
                  {statements.slice(0, 6).map((s, i) => (
                    <tr key={i}>
                      <td>{s.line}</td>
                      <td title={s.text}>{s.text.replace(/\s+/g, ' ').slice(0, 140)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {busy && <Bar p={progress} />}
        {error && <div className="msg error">{error}</div>}
        {result && (
          <div className={`msg ${result.failures.length || result.cancelled ? 'error' : 'ok'}`}>
            {result.rolledBack
              ? `Rolled back: nothing was changed. ${result.failures.length ? 'First error below.' : ''}`
              : result.cancelled
                ? `Cancelled after ${result.executed.toLocaleString()} of ${result.total.toLocaleString()} statements.`
                : `${result.executed.toLocaleString()} of ${result.total.toLocaleString()} statements ran${result.failures.length ? `, ${result.failures.length} failed` : ' with no errors'} (${(result.durationMs / 1000).toFixed(2)} s).`}
          </div>
        )}
        {result && result.failures.length > 0 && (
          <div className="map-wrap preview">
            <table className="grid">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Error</th>
                  <th>Statement</th>
                </tr>
              </thead>
              <tbody>
                {result.failures.map((f) => (
                  <tr key={f.index}>
                    <td>{f.line}</td>
                    <td className="err-cell" title={f.error}>
                      {f.error}
                    </td>
                    <td title={f.statement}>{f.statement.replace(/\s+/g, ' ').slice(0, 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="row end">
          {busy ? (
            <button onClick={cancel}>■ Stop</button>
          ) : (
            <button onClick={onClose}>{result ? 'Close' : 'Cancel'}</button>
          )}
          <button className="primary" disabled={busy || statements.length === 0} onClick={() => void run()}>
            {busy ? 'Running…' : 'Run'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ───────────── Dump to a .sql file ───────────── */

interface DumpProps {
  connId: string
  connName: string
  kind: DbKind
  container: string
  onClose: () => void
}

export function DumpDialog({ connId, connName, kind, container, onClose }: DumpProps): JSX.Element {
  const [tables, setTables] = useState<DbObject[] | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [structure, setStructure] = useState(true)
  const [data, setData] = useState(true)
  const [dropExisting, setDropExisting] = useState(false)
  const [qualified, setQualified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DumpResult | null>(null)
  const progress = useProgress('dump:progress', busy)

  useEffect(() => {
    unwrap(window.api.objects(connId, container)).then(
      (all) => {
        const t = all.filter((o) => o.type === 'table')
        setTables(t)
        setChosen(new Set(t.map((o) => o.name)))
      },
      (e) => setError(errMsg(e))
    )
  }, [connId, container])

  const shown = (tables ?? []).filter((t) => t.name.toLowerCase().includes(filter.trim().toLowerCase()))
  const toggle = (name: string): void =>
    setChosen((prev) => {
      const next = new Set(prev)
      if (!next.delete(name)) next.add(name)
      return next
    })

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const picked = (tables ?? []).filter((t) => chosen.has(t.name))
      const r = await unwrap(window.api.dumpSql(connId, container, picked, { structure, data, dropExisting, qualified }, `${container}.sql`))
      if (r) setResult(r)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const nothing = chosen.size === 0 || (!structure && !data)

  return (
    <div className="backdrop" onClick={busy ? undefined : onClose}>
      <div className="dialog import-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>
          Dump SQL from <em>{connName}</em> › {container}
        </h3>
        <div className="row">
          <input className="lib-filter" placeholder="Filter tables" value={filter} onChange={(e) => setFilter(e.target.value)} disabled={busy} />
          <button disabled={busy} onClick={() => setChosen(new Set((tables ?? []).map((t) => t.name)))}>
            All
          </button>
          <button disabled={busy} onClick={() => setChosen(new Set())}>
            None
          </button>
          <span className="muted">
            {chosen.size} of {tables?.length ?? 0} selected
          </span>
        </div>
        <div className="map-wrap">
          {!tables && !error && <div className="msg">Loading…</div>}
          {shown.map((t) => (
            <label key={t.name} className="check pick-row">
              <input type="checkbox" checked={chosen.has(t.name)} disabled={busy} onChange={() => toggle(t.name)} />
              {t.name}
            </label>
          ))}
        </div>
        <div className="import-opts">
          <label className="check">
            <input type="checkbox" checked={structure} disabled={busy} onChange={(e) => setStructure(e.target.checked)} />
            Structure
          </label>
          <label className="check">
            <input type="checkbox" checked={data} disabled={busy} onChange={(e) => setData(e.target.checked)} />
            Data
          </label>
          <label className="check" title="Adds DROP TABLE IF EXISTS before each CREATE TABLE">
            <input type="checkbox" checked={dropExisting} disabled={busy || !structure} onChange={(e) => setDropExisting(e.target.checked)} />
            Drop tables first
          </label>
          <label className="check" title="Without it the file loads into whichever database/schema you run it in">
            <input type="checkbox" checked={qualified} disabled={busy} onChange={(e) => setQualified(e.target.checked)} />
            Qualify names with “{container}”
          </label>
        </div>
        <div className="muted small-note">Only tables are included — views, functions and triggers are not dumped. {kind === 'mssql' ? 'Indexes with included columns or filters are skipped.' : ''}</div>

        {busy && <Bar p={progress} />}
        {error && <div className="msg error">{error}</div>}
        {result && (
          <div className="msg ok">
            Saved {result.tables} table(s), {result.rows.toLocaleString()} row(s), {fmtBytes(result.bytes)} to <span className="mono">{result.path}</span>
            {result.notes.length > 0 && (
              <ul className="notes">
                {result.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="row end">
          {busy ? <button onClick={() => void window.api.cancelScript(connId)}>■ Stop</button> : <button onClick={onClose}>{result ? 'Close' : 'Cancel'}</button>}
          <button className="primary" disabled={busy || nothing} onClick={() => void run()}>
            {busy ? 'Dumping…' : 'Choose file & dump…'}
          </button>
        </div>
      </div>
    </div>
  )
}
