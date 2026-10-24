import { strToU8, zipSync } from 'fflate'
import { insertStatement, quoteIdent } from '@shared/sqlLiteral'
import type { DbKind, QueryResult } from '@shared/types'
import { fmt } from './cellFormat'

export type ExportFormat = 'csv' | 'xlsx' | 'json' | 'sql'

export interface ExportOptions {
  /** Needed for the SQL format: which engine's quoting and literals to use. */
  kind?: DbKind
  /** Table name written into the INSERT statements. */
  table?: string
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
// Excel's hard limits.
const MAX_ROWS = 1_048_575
const MAX_CELL_CHARS = 32_767

export function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

const withExt = (name: string, ext: string): string => (name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`)

/** Text for a non-null cell; null/undefined are handled by the callers. */
const text = (v: unknown): string => (typeof v === 'string' ? v : fmt(v))

/* ── CSV ── */

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = text(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The BOM makes Excel pick UTF-8. */
function exportCsv(result: QueryResult, fileName: string): void {
  const lines = [result.columns.map(csvCell).join(','), ...result.rows.map((r) => r.map(csvCell).join(','))]
  download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), withExt(fileName, 'csv'))
}

/* ── XLSX (hand-written minimal OOXML: one sheet, bold frozen header) ── */

// eslint-disable-next-line no-control-regex
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g

const esc = (s: string): string =>
  s
    .replace(XML_ILLEGAL, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function colName(i: number): string {
  let n = i + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function xlsxCell(ref: string, v: unknown, style = 0): string {
  const s = style ? ` s="${style}"` : ''
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`
  if (typeof v === 'boolean') return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`
  let str = text(v)
  if (str.length > MAX_CELL_CHARS) str = str.slice(0, MAX_CELL_CHARS)
  // Inline strings are never evaluated as formulas, unlike "=…" in a CSV.
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(str)}</t></is></c>`
}

function sheetName(name: string): string {
  return name.replace(/[[\]:*?/\\]/g, '_').slice(0, 31) || 'Sheet1'
}

function exportXlsx(result: QueryResult, fileName: string): void {
  if (result.rows.length > MAX_ROWS) throw new Error(`Excel supports at most ${MAX_ROWS.toLocaleString()} rows; use CSV for this result.`)

  // Width from the header and a sample of rows, in characters, capped.
  const widths = result.columns.map((c, i) => {
    let w = c.length
    for (const r of result.rows.slice(0, 100)) {
      const v = r[i]
      if (v !== null && v !== undefined) w = Math.max(w, Math.min(text(v).length, 60))
    }
    return Math.min(w + 2, 60)
  })

  const header = `<row r="1">${result.columns.map((c, i) => xlsxCell(`${colName(i)}1`, c, 1)).join('')}</row>`
  const body = result.rows
    .map((r, ri) => `<row r="${ri + 2}">${r.map((v, ci) => xlsxCell(`${colName(ci)}${ri + 2}`, v)).join('')}</row>`)
    .join('')

  const sheet =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${header}${body}</sheetData></worksheet>`

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${esc(sheetName(fileName))}" sheetId="1" r:id="rId1"/></sheets></workbook>`
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>'
    ),
    'xl/styles.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        '</styleSheet>'
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheet)
  }

  const zipped = zipSync(files, { level: 6 })
  download(new Blob([zipped.buffer as ArrayBuffer], { type: XLSX_MIME }), withExt(fileName, 'xlsx'))
}

/* ── JSON: an array of objects, one per row ── */

function jsonValue(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === 'bigint') return v.toString()
  if (v instanceof Date) return fmt(v)
  // JSON has no bytes; hex with a 0x prefix is what most tools expect.
  if (v instanceof Uint8Array) return `0x${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}`
  return v
}

/** Keys must be unique inside an object, so a repeated column name (a.id, b.id) gets a numeric suffix. */
function uniqueKeys(columns: string[]): string[] {
  const seen = new Map<string, number>()
  return columns.map((c) => {
    const n = (seen.get(c) ?? 0) + 1
    seen.set(c, n)
    return n === 1 ? c : `${c}_${n}`
  })
}

function exportJson(result: QueryResult, fileName: string): void {
  const keys = uniqueKeys(result.columns)
  const rows = result.rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, jsonValue(r[i])])))
  download(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json;charset=utf-8' }), withExt(fileName, 'json'))
}

/* ── SQL: INSERT statements the target engine can run as they are ── */

const SQL_BATCH = 200

function exportSql(result: QueryResult, fileName: string, opts: ExportOptions): void {
  const kind = opts.kind
  if (!kind) throw new Error('Exporting as SQL needs to know the database type.')
  const table = quoteIdent(kind, opts.table || 'exported_data')
  const parts: string[] = [`-- ${result.rows.length} row(s) exported by Zivar Database Studio\n`]
  for (let i = 0; i < result.rows.length; i += SQL_BATCH) parts.push(`${insertStatement(kind, table, result.columns, result.rows.slice(i, i + SQL_BATCH))};\n`)
  download(new Blob(['\uFEFF' + parts.join('\n')], { type: 'application/sql;charset=utf-8' }), withExt(fileName, 'sql'))
}

export function exportResult(result: QueryResult, fileName: string, format: ExportFormat, opts: ExportOptions = {}): void {
  if (format === 'xlsx') exportXlsx(result, fileName)
  else if (format === 'json') exportJson(result, fileName)
  else if (format === 'sql') exportSql(result, fileName, opts)
  else exportCsv(result, fileName)
}
