import type { RowChange } from '@shared/types'

export interface Dialect {
  quote(id: string): string
  /** 1-based placeholder for the i-th parameter. */
  placeholder(i: number): string
  /** Fully qualified, quoted table reference. */
  table: string
  /** Text that follows "INSERT INTO <table> " when no column is given a value. */
  emptyInsert: string
}

export interface Statement {
  sql: string
  params: unknown[]
  /** Update/delete must touch exactly one row; zero means the row is gone or changed. */
  expectRow: boolean
}

function where(key: Record<string, unknown>, d: Dialect, params: unknown[]): string {
  const cols = Object.keys(key)
  if (cols.length === 0) throw new Error('This table has no primary key, so rows cannot be edited safely')
  return cols
    .map((c) => {
      params.push(key[c])
      return `${d.quote(c)} = ${d.placeholder(params.length)}`
    })
    .join(' AND ')
}

export function buildStatements(changes: RowChange[], d: Dialect): Statement[] {
  const out: Statement[] = []
  for (const ch of changes) {
    const params: unknown[] = []
    if (ch.type === 'update') {
      const cols = Object.keys(ch.values)
      if (cols.length === 0) continue
      const set = cols
        .map((c) => {
          params.push(ch.values[c])
          return `${d.quote(c)} = ${d.placeholder(params.length)}`
        })
        .join(', ')
      out.push({ sql: `UPDATE ${d.table} SET ${set} WHERE ${where(ch.key, d, params)}`, params, expectRow: true })
    } else if (ch.type === 'delete') {
      out.push({ sql: `DELETE FROM ${d.table} WHERE ${where(ch.key, d, params)}`, params, expectRow: true })
    } else {
      const cols = Object.keys(ch.values)
      if (cols.length === 0) {
        out.push({ sql: `INSERT INTO ${d.table} ${d.emptyInsert}`, params, expectRow: false })
      } else {
        const marks = cols.map((c) => {
          params.push(ch.values[c])
          return d.placeholder(params.length)
        })
        out.push({
          sql: `INSERT INTO ${d.table} (${cols.map(d.quote).join(', ')}) VALUES (${marks.join(', ')})`,
          params,
          expectRow: false
        })
      }
    }
  }
  return out
}

export interface InsertChunk extends Statement {
  /** Row range of the import this statement covers: [first, last) as zero-based indexes. */
  first: number
  last: number
}

/** Rows that may be imported in one call; beyond this the user should split the file. */
export const MAX_IMPORT_ROWS = 500_000

/**
 * Multi-row INSERTs, sized so that no statement exceeds the engine's parameter or row limits.
 * `maxParams` / `maxRows` are per-engine (PostgreSQL 65535 params, SQL Server 2100 params and 1000 rows,
 * SQLite 500 rows per VALUES list).
 */
export function buildInsertChunks(columns: string[], rows: unknown[][], d: Dialect, maxParams: number, maxRows: number): InsertChunk[] {
  if (columns.length === 0) throw new Error('Nothing to import: no columns are mapped')
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Too many rows (${rows.length.toLocaleString()}); import at most ${MAX_IMPORT_ROWS.toLocaleString()} at a time`)
  const perChunk = Math.max(1, Math.min(maxRows, Math.floor(maxParams / columns.length)))
  const cols = columns.map(d.quote).join(', ')
  const out: InsertChunk[] = []
  for (let start = 0; start < rows.length; start += perChunk) {
    const slice = rows.slice(start, start + perChunk)
    const params: unknown[] = []
    const tuples = slice.map((r) => `(${columns.map((_, ci) => {
      params.push(r[ci] ?? null)
      return d.placeholder(params.length)
    }).join(', ')})`)
    out.push({ sql: `INSERT INTO ${d.table} (${cols}) VALUES ${tuples.join(', ')}`, params, expectRow: false, first: start, last: start + slice.length })
  }
  return out
}

/** Tell the user which rows of their file a failed statement covered. */
export function importError(c: InsertChunk, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err)
  return new Error(`Import rolled back — rows ${c.first + 1}–${c.last} of the data: ${msg}`)
}

export const ROW_NOT_FOUND = 'No row matched — it was changed or deleted since it was loaded. Refresh and try again.'

/** `ORDER BY "col" ASC` for a user-chosen column, quoted by the dialect. */
export function orderClause(quote: (id: string) => string, orderBy?: { column: string; dir: 'asc' | 'desc' }): string {
  return orderBy ? ` ORDER BY ${quote(orderBy.column)} ${orderBy.dir === 'desc' ? 'DESC' : 'ASC'}` : ''
}

export function whereClause(where?: string): string {
  const w = where?.trim().replace(/;+\s*$/, '')
  return w ? ` WHERE ${w}` : ''
}
