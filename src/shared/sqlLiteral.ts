import type { DbKind } from './types'

/**
 * Turning JS values into SQL text, per engine. Used wherever SQL has to be written out as text
 * rather than sent with bound parameters: SQL dumps and "export as INSERT statements".
 */

export function quoteIdent(kind: DbKind, id: string): string {
  switch (kind) {
    case 'mysql':
      return '`' + id.replace(/`/g, '``') + '`'
    case 'mssql':
      return '[' + id.replace(/]/g, ']]') + ']'
    default:
      return '"' + id.replace(/"/g, '""') + '"'
  }
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

function dateText(d: Date): string {
  if (Number.isNaN(d.getTime())) return ''
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`
}

function hex(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

/** PostgreSQL array literal text, e.g. {"a","b c"}; nested arrays recurse. */
function pgArray(a: unknown[]): string {
  const item = (v: unknown): string => {
    if (v === null || v === undefined) return 'NULL'
    if (Array.isArray(v)) return pgArray(v)
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
  }
  return '{' + a.map(item).join(',') + '}'
}

function quoteString(kind: DbKind, s: string): string {
  switch (kind) {
    case 'mysql':
      // MySQL honours backslash escapes inside string literals (unless NO_BACKSLASH_ESCAPES).
      return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/\0/g, '\\0')}'`
    case 'mssql':
      return `N'${s.replace(/'/g, "''")}'`
    default:
      return `'${s.replace(/'/g, "''")}'`
  }
}

/** One value as a SQL literal that the given engine reads back as the same value. */
export function sqlLiteral(kind: DbKind, v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'boolean') return kind === 'postgres' ? (v ? 'true' : 'false') : v ? '1' : '0'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'bigint') return String(v)
  if (typeof v === 'string') return quoteString(kind, v)
  if (v instanceof Date) {
    const t = dateText(v)
    return t ? (kind === 'mssql' ? `'${t.replace(' ', 'T')}'` : `'${t}'`) : 'NULL'
  }
  if (v instanceof Uint8Array) {
    const h = hex(v)
    switch (kind) {
      case 'postgres':
        return `'\\x${h}'`
      case 'mssql':
        return `0x${h}`
      default:
        return `X'${h}'`
    }
  }
  if (Array.isArray(v)) return kind === 'postgres' ? quoteString(kind, pgArray(v)) : quoteString(kind, JSON.stringify(v))
  return quoteString(kind, JSON.stringify(v))
}

/** `INSERT INTO table (cols) VALUES (...), (...)` for a batch of rows. */
export function insertStatement(kind: DbKind, table: string, columns: string[], rows: unknown[][]): string {
  const cols = columns.map((c) => quoteIdent(kind, c)).join(', ')
  const values = rows.map((r) => `(${columns.map((_, i) => sqlLiteral(kind, r[i])).join(', ')})`).join(',\n  ')
  return `INSERT INTO ${table} (${cols}) VALUES\n  ${values}`
}
