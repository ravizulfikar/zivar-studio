import { strFromU8, unzipSync } from 'fflate'

/** What a spreadsheet/CSV cell can hold once parsed; the database casts it to the column type. */
export type Cell = string | number | boolean | null

export interface ParsedSheet {
  name: string
  rows: Cell[][]
}

/* ───────────────────────────── CSV ───────────────────────────── */

const DELIMITERS = [',', ';', '\t', '|']

/** RFC 4180: quoted fields may contain delimiters, doubled quotes and line breaks. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  if (text.charCodeAt(0) === 0xfeff) i = 1 // BOM

  for (; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"' && field === '') {
      quoted = true
    } else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  // Last line without a trailing newline.
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** Pick the delimiter that splits the first lines into the most consistent set of columns. */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 20000)
  let best = ','
  let bestScore = 0
  for (const d of DELIMITERS) {
    const rows = parseCsv(sample, d).slice(0, 10)
    const width = rows[0]?.length ?? 0
    if (width < 2) continue
    const score = width * rows.filter((r) => r.length === width).length
    if (score > bestScore) {
      best = d
      bestScore = score
    }
  }
  return best
}

export function decodeText(buf: ArrayBuffer, encoding: string): string {
  return new TextDecoder(encoding).decode(buf)
}

/* ───────────────────────────── JSON ───────────────────────────── */

const cellOf = (v: unknown): Cell => {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  return JSON.stringify(v) // nested objects/arrays are stored as JSON text
}

function recordsOf(root: unknown): unknown[] {
  if (Array.isArray(root)) return root
  if (root && typeof root === 'object') {
    // {"rows": [...]} / {"data": [...]} wrappers are common API shapes.
    for (const v of Object.values(root as Record<string, unknown>)) if (Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object')) return v
    return [root]
  }
  throw new Error('The JSON must be an array of objects (or one object per line).')
}

/**
 * JSON array of objects, a wrapper object around one, an array of arrays, or newline-delimited JSON.
 * Objects become a header row of their keys (in first-seen order) followed by the values.
 */
export function parseJson(text: string): Cell[][] {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  let records: unknown[]
  try {
    records = recordsOf(JSON.parse(t))
  } catch (e) {
    // NDJSON: one JSON value per line.
    const lines = t.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length < 2) throw new Error(`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
    try {
      records = lines.map((l) => JSON.parse(l))
    } catch {
      throw new Error(`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (records.length === 0) return []
  if (records.every((r) => Array.isArray(r))) return (records as unknown[][]).map((r) => r.map(cellOf))
  const keys: string[] = []
  const seen = new Set<string>()
  for (const r of records) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('Every JSON record must be an object (or every record an array).')
    for (const k of Object.keys(r)) if (!seen.has(k)) (seen.add(k), keys.push(k))
  }
  return [keys, ...records.map((r) => keys.map((k) => cellOf((r as Record<string, unknown>)[k])))]
}

/* ───────────────────────────── XLSX ───────────────────────────── */

const MAX_PART_BYTES = 300 * 1024 * 1024
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58])

const local = (el: Element | Document, name: string): Element[] => Array.from(el.getElementsByTagNameNS('*', name))
const attr = (el: Element, name: string): string | null => el.getAttribute(name)

function parseXml(bytes: Uint8Array): Document {
  return new DOMParser().parseFromString(strFromU8(bytes), 'application/xml')
}

/** "AB12" -> zero-based column 27. */
function columnIndex(ref: string): number {
  let n = 0
  for (const ch of ref) {
    const c = ch.charCodeAt(0)
    if (c < 65 || c > 90) break
    n = n * 26 + (c - 64)
  }
  return n - 1
}

function isDateFormat(id: number, code: string | undefined): boolean {
  if (code === undefined) return BUILTIN_DATE_FORMATS.has(id)
  // Ignore quoted literals, escaped characters and [colour]/[locale] sections before looking for date tokens.
  const stripped = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '')
  return /[ymdhs]/i.test(stripped) && !/general/i.test(stripped)
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

/** Excel serial date -> 'YYYY-MM-DD', 'YYYY-MM-DD HH:MM:SS' or 'HH:MM:SS' for a time of day. */
function serialToText(serial: number, date1904: boolean): string {
  const epoch = Date.UTC(1899, 11, 30) + (date1904 ? 1462 * 86400000 : 0)
  const wholeDays = Math.floor(serial)
  const seconds = Math.round((serial - wholeDays) * 86400)
  const d = new Date(epoch + wholeDays * 86400000 + seconds * 1000)
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  if (wholeDays === 0 && !date1904) return time
  const day = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  return seconds === 0 ? day : `${day} ${time}`
}

function textOf(si: Element): string {
  // Rich text is split into runs; phonetic hints (rPh) must not be appended.
  return local(si, 't')
    .filter((t) => (t.parentNode as Element | null)?.localName !== 'rPh')
    .map((t) => t.textContent ?? '')
    .join('')
}

/** Read every worksheet of an .xlsx. Dates become text, formulas yield their cached value. */
export function parseXlsx(data: Uint8Array): ParsedSheet[] {
  const wanted = (name: string): boolean =>
    name === 'xl/workbook.xml' || name === 'xl/_rels/workbook.xml.rels' || name === 'xl/sharedStrings.xml' || name === 'xl/styles.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(name)
  const files = unzipSync(data, { filter: (f) => wanted(f.name) && f.originalSize <= MAX_PART_BYTES })
  if (!files['xl/workbook.xml']) throw new Error('This does not look like an .xlsx file (xl/workbook.xml is missing).')

  const workbook = parseXml(files['xl/workbook.xml'])
  const date1904 = local(workbook, 'workbookPr').some((e) => attr(e, 'date1904') === '1' || attr(e, 'date1904') === 'true')

  const rels = new Map<string, string>()
  if (files['xl/_rels/workbook.xml.rels']) {
    for (const r of local(parseXml(files['xl/_rels/workbook.xml.rels']), 'Relationship')) {
      const target = attr(r, 'Target') ?? ''
      rels.set(attr(r, 'Id') ?? '', target.startsWith('/') ? target.slice(1) : `xl/${target}`)
    }
  }

  const shared: string[] = files['xl/sharedStrings.xml'] ? local(parseXml(files['xl/sharedStrings.xml']), 'si').map(textOf) : []

  // Which cell styles are date formats.
  const dateStyles = new Set<number>()
  if (files['xl/styles.xml']) {
    const styles = parseXml(files['xl/styles.xml'])
    const codes = new Map<number, string>()
    for (const nf of local(styles, 'numFmt')) codes.set(Number(attr(nf, 'numFmtId')), attr(nf, 'formatCode') ?? '')
    const cellXfs = local(styles, 'cellXfs')[0]
    if (cellXfs) {
      Array.from(cellXfs.children).forEach((xf, i) => {
        const id = Number(attr(xf, 'numFmtId') ?? 0)
        if (isDateFormat(id, codes.get(id))) dateStyles.add(i)
      })
    }
  }

  const sheets: ParsedSheet[] = []
  for (const s of local(workbook, 'sheet')) {
    const path = rels.get(attr(s, 'r:id') ?? attr(s, 'id') ?? '')
    const bytes = path ? files[path] : undefined
    if (!bytes) continue
    const rows: Cell[][] = []
    for (const rowEl of local(parseXml(bytes), 'row')) {
      const r = Number(attr(rowEl, 'r') ?? rows.length + 1) - 1
      while (rows.length < r) rows.push([])
      const cells: Cell[] = []
      Array.from(rowEl.children)
        .filter((c) => c.localName === 'c')
        .forEach((c, k) => {
          const ref = attr(c, 'r')
          const col = ref ? columnIndex(ref) : k
          const type = attr(c, 't')
          const v = local(c, 'v')[0]?.textContent ?? null
          let value: Cell = null
          if (type === 'inlineStr') value = local(c, 'is').map(textOf).join('')
          else if (v === null) value = null
          else if (type === 's') value = shared[Number(v)] ?? null
          else if (type === 'b') value = v === '1'
          else if (type === 'str' || type === 'e' || type === 'd') value = v
          else {
            const num = Number(v)
            value = Number.isFinite(num) ? (dateStyles.has(Number(attr(c, 's') ?? -1)) ? serialToText(num, date1904) : num) : v
          }
          while (cells.length < col) cells.push(null)
          cells[col] = value
        })
      rows[r] = cells
    }
    sheets.push({ name: attr(s, 'name') ?? `Sheet${sheets.length + 1}`, rows })
  }
  if (sheets.length === 0) throw new Error('The workbook has no readable worksheets.')
  return sheets
}
