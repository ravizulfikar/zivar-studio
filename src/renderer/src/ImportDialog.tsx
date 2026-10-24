import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { DbObject, TableDesign } from '@shared/types'
import { errMsg, unwrap } from './api'
import { decodeText, detectDelimiter, parseCsv, parseJson, parseXlsx, type Cell, type ParsedSheet } from './importParse'

const ENCODINGS = [
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'windows-1252', label: 'Windows-1252 (Western)' },
  { id: 'utf-16le', label: 'UTF-16 LE' }
]
const DELIMS = [
  { id: 'auto', label: 'Auto-detect' },
  { id: ',', label: 'Comma ,' },
  { id: ';', label: 'Semicolon ;' },
  { id: '\t', label: 'Tab' },
  { id: '|', label: 'Pipe |' }
]
const PREVIEW_ROWS = 8

const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const isBlank = (c: Cell | undefined): boolean => c === null || c === undefined || (typeof c === 'string' && c.trim() === '')

interface Props {
  connId: string
  container: string
  obj: DbObject
  onClose: () => void
  /** Called after rows were inserted so open tabs can reload. */
  onImported: () => void
}

export function ImportDialog({ connId, container, obj, onClose, onImported }: Props): JSX.Element {
  const [design, setDesign] = useState<TableDesign | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null)
  const [isXlsx, setIsXlsx] = useState(false)
  const [isJson, setIsJson] = useState(false)
  const [sheets, setSheets] = useState<ParsedSheet[]>([])
  const [sheetIdx, setSheetIdx] = useState(0)
  const [encoding, setEncoding] = useState('utf-8')
  const [delimiter, setDelimiter] = useState('auto')
  const [hasHeader, setHasHeader] = useState(true)
  const [emptyAsNull, setEmptyAsNull] = useState(true)
  const [trim, setTrim] = useState(true)
  /** target column name -> source column index, -1 = not imported */
  const [mapping, setMapping] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)

  useEffect(() => {
    unwrap(window.api.designInfo(connId, container, obj)).then(setDesign, (e) => setError(errMsg(e)))
  }, [connId, container, obj])

  const pickFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setError(null)
    setDone(null)
    try {
      if (/\.xls$/i.test(file.name)) throw new Error('Legacy .xls files are not supported. Save the sheet as .xlsx or CSV and try again.')
      const buf = await file.arrayBuffer()
      const xlsx = /\.xlsx$/i.test(file.name)
      setIsJson(/\.(json|ndjson|jsonl)$/i.test(file.name))
      setFileName(file.name)
      setBuffer(buf)
      setIsXlsx(xlsx)
      setSheetIdx(0)
      setSheets(xlsx ? parseXlsx(new Uint8Array(buf)) : [])
    } catch (e) {
      setFileName(null)
      setBuffer(null)
      setSheets([])
      setError(errMsg(e))
    }
  }

  // Everything below is derived, so changing an option instantly re-reads the file.
  const parsed = useMemo<{ table: Cell[][]; error: string | null }>(() => {
    if (!buffer) return { table: [], error: null }
    try {
      let table: Cell[][]
      if (isXlsx) table = sheets[sheetIdx]?.rows ?? []
      else if (isJson) table = parseJson(decodeText(buffer, encoding))
      else {
        const text = decodeText(buffer, encoding)
        table = parseCsv(text, delimiter === 'auto' ? detectDelimiter(text) : delimiter)
      }
      // Blank lines (and Excel's empty gap rows) are not data.
      return { table: table.filter((r) => r.some((c) => !isBlank(c))), error: null }
    } catch (e) {
      return { table: [], error: errMsg(e) }
    }
  }, [buffer, isXlsx, isJson, sheets, sheetIdx, encoding, delimiter])

  const width = useMemo(() => parsed.table.reduce((w, r) => Math.max(w, r.length), 0), [parsed.table])
  const headers = useMemo(
    () => Array.from({ length: width }, (_, i) => (hasHeader && !isBlank(parsed.table[0]?.[i]) ? String(parsed.table[0][i]).trim() : `Column ${i + 1}`)),
    [parsed.table, width, hasHeader]
  )
  const dataRows = useMemo(() => parsed.table.slice(hasHeader ? 1 : 0), [parsed.table, hasHeader])

  // Re-map automatically whenever the file or header option changes: same name (ignoring case/punctuation) wins.
  useEffect(() => {
    if (!design) return
    const bySource = new Map<string, number>()
    headers.forEach((h, i) => {
      if (!bySource.has(normName(h))) bySource.set(normName(h), i)
    })
    setMapping(Object.fromEntries(design.columns.map((c) => [c.name, hasHeader ? (bySource.get(normName(c.name)) ?? -1) : -1])))
  }, [design, headers, hasHeader])

  const targets = useMemo(() => (design?.columns ?? []).filter((c) => (mapping[c.name] ?? -1) >= 0 && !c.locked), [design, mapping])

  const convert = (v: Cell | undefined): Cell => {
    if (v === null || v === undefined) return null
    if (typeof v === 'string') {
      const t = trim ? v.trim() : v
      return emptyAsNull && t.trim() === '' ? null : t
    }
    return v
  }
  const mapRow = (row: Cell[]): Cell[] => targets.map((c) => convert(row[mapping[c.name]]))

  const missingRequired = (design?.columns ?? []).filter((c) => (mapping[c.name] ?? -1) < 0 && !c.nullable && c.defaultValue === null && !c.autoIncrement && !c.locked)
  const blocking = !fileName
    ? 'Choose a file first.'
    : parsed.error
      ? parsed.error
      : dataRows.length === 0
        ? 'The file has no data rows.'
        : targets.length === 0
          ? 'Map at least one column.'
          : missingRequired.length > 0
            ? `Required column${missingRequired.length > 1 ? 's' : ''} not mapped: ${missingRequired.map((c) => c.name).join(', ')} (NOT NULL without a default).`
            : null

  const run = async (): Promise<void> => {
    if (!window.confirm(`Insert ${dataRows.length.toLocaleString()} row(s) into "${obj.name}" using ${targets.length} column(s)?\n\nThe import is all-or-nothing: if any row is rejected, nothing is inserted.`)) return
    setBusy(true)
    setError(null)
    try {
      const n = await unwrap(window.api.insertRows(connId, container, obj, targets.map((c) => c.name), dataRows.map(mapRow)))
      setDone(n)
      onImported()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const previewRows = dataRows.slice(0, PREVIEW_ROWS).map(mapRow)

  return (
    <div className="backdrop" onClick={busy ? undefined : onClose}>
      <div className="dialog import-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>
          Import into <em>{obj.name}</em>
        </h3>

        <div className="row">
          <label className="grow">
            File (.csv, .tsv, .txt, .xlsx, .json, .ndjson)
            <input type="file" accept=".csv,.tsv,.txt,.xlsx,.json,.ndjson,.jsonl" onChange={(e) => void pickFile(e.target.files?.[0])} />
          </label>
        </div>

        {fileName && (
          <div className="import-opts">
            {isXlsx ? (
              <label>
                Sheet
                <select value={sheetIdx} onChange={(e) => setSheetIdx(Number(e.target.value))}>
                  {sheets.map((s, i) => (
                    <option key={s.name} value={i}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label>
                  Encoding
                  <select value={encoding} onChange={(e) => setEncoding(e.target.value)}>
                    {ENCODINGS.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </label>
                {!isJson && (
                  <label>
                    Delimiter
                    <select value={delimiter} onChange={(e) => setDelimiter(e.target.value)}>
                      {DELIMS.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            <label className="check">
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              First row is a header
            </label>
            <label className="check">
              <input type="checkbox" checked={emptyAsNull} onChange={(e) => setEmptyAsNull(e.target.checked)} />
              Empty values → NULL
            </label>
            <label className="check">
              <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} />
              Trim spaces
            </label>
          </div>
        )}

        {fileName && design && !parsed.error && (
          <>
            <div className="muted">
              {dataRows.length.toLocaleString()} data row(s), {width} column(s) in the file
            </div>
            <div className="map-wrap">
              <table className="grid designer">
                <thead>
                  <tr>
                    <th>Table column</th>
                    <th>Type</th>
                    <th>Take values from</th>
                  </tr>
                </thead>
                <tbody>
                  {design.columns.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {c.name}
                        {!c.nullable && c.defaultValue === null && !c.autoIncrement && <span className="req" title="NOT NULL, no default"> *</span>}
                        {c.autoIncrement && <span className="muted"> (auto)</span>}
                      </td>
                      <td className="note-cell">{c.type}</td>
                      <td>
                        <select value={mapping[c.name] ?? -1} disabled={!!c.locked} onChange={(e) => setMapping((m) => ({ ...m, [c.name]: Number(e.target.value) }))}>
                          <option value={-1}>— don’t import —</option>
                          {headers.map((h, i) => (
                            <option key={i} value={i}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {targets.length > 0 && (
              <>
                <div className="muted">Preview (first {Math.min(PREVIEW_ROWS, dataRows.length)} rows, after your options)</div>
                <div className="map-wrap preview">
                  <table className="grid">
                    <thead>
                      <tr>
                        {targets.map((c) => (
                          <th key={c.id}>{c.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((r, i) => (
                        <tr key={i}>
                          {r.map((v, k) => (
                            <td key={k} className={v === null ? 'null' : ''}>
                              {v === null ? '(Null)' : String(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {error && <div className="msg error">{error}</div>}
        {done !== null && <div className="msg ok">Imported {done.toLocaleString()} row(s).</div>}
        {done === null && blocking && fileName && <div className="msg muted">{blocking}</div>}

        <div className="row end">
          <button onClick={onClose} disabled={busy}>
            {done !== null ? 'Close' : 'Cancel'}
          </button>
          <button className="primary" disabled={busy || blocking !== null || done !== null} onClick={() => void run()}>
            {busy ? 'Importing…' : `Import ${dataRows.length ? dataRows.length.toLocaleString() + ' rows' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
