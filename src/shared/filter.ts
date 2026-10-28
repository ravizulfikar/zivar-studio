import { quoteIdent, sqlLiteral } from './sqlLiteral'
import type { DbKind } from './types'

// The structured filter of the data grid: a list of conditions ("email contains x", "id is between 1 and 9", …)
// turned into one WHERE condition for the engine at hand. Pure, so it is unit-tested against real servers.

export type FilterOp =
  | 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge'
  | 'contains' | 'icontains' | 'ncontains' | 'nicontains'
  | 'begins' | 'nbegins' | 'ends' | 'nends'
  | 'isnull' | 'notnull' | 'isempty' | 'notempty'
  | 'between' | 'nbetween' | 'in' | 'nin' | 'custom'

/** How many values an operator takes: none, one, two (a range), a list, or raw SQL. */
export type FilterArgs = 0 | 1 | 2 | 'list' | 'sql'

/** In the order of the picker, with the wording of the interface. */
export const FILTER_OPS: { op: FilterOp; label: string; args: FilterArgs }[] = [
  { op: 'eq', label: '=', args: 1 },
  { op: 'ne', label: '!=', args: 1 },
  { op: 'lt', label: '<', args: 1 },
  { op: 'le', label: '<=', args: 1 },
  { op: 'gt', label: '>', args: 1 },
  { op: 'ge', label: '>=', args: 1 },
  { op: 'contains', label: 'contains', args: 1 },
  { op: 'icontains', label: 'contains (case insensitive)', args: 1 },
  { op: 'ncontains', label: 'does not contain', args: 1 },
  { op: 'nicontains', label: 'does not contain (case insensitive)', args: 1 },
  { op: 'begins', label: 'begins with', args: 1 },
  { op: 'nbegins', label: 'does not begin with', args: 1 },
  { op: 'ends', label: 'ends with', args: 1 },
  { op: 'nends', label: 'does not end with', args: 1 },
  { op: 'isnull', label: 'is null', args: 0 },
  { op: 'notnull', label: 'is not null', args: 0 },
  { op: 'isempty', label: 'is empty', args: 0 },
  { op: 'notempty', label: 'is not empty', args: 0 },
  { op: 'between', label: 'is between', args: 2 },
  { op: 'nbetween', label: 'is not between', args: 2 },
  { op: 'in', label: 'is in list', args: 'list' },
  { op: 'nin', label: 'is not in list', args: 'list' },
  { op: 'custom', label: '[Custom]', args: 'sql' }
]

export const argsOf = (op: FilterOp): FilterArgs => FILTER_OPS.find((o) => o.op === op)?.args ?? 1

export interface Criterion {
  /** Stable key for the editor. */
  id: string
  /** Unticked conditions stay in the list but are left out. */
  enabled: boolean
  column: string
  op: FilterOp
  value: string
  /** The upper end of "is between". */
  value2: string
  /** How this condition joins the next one. */
  join: 'and' | 'or'
}

export const newCriterion = (column: string, id = Math.random().toString(36).slice(2)): Criterion => ({ id, enabled: true, column, op: 'eq', value: '', value2: '', join: 'and' })

const NUMERIC = /^(?:(?:tiny|small|medium|big)?int(?:eger)?|numeric|decimal|real|double|float\d*|serial|bigserial|smallserial|money|number)\b/i
const NUMBER_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

/** A typed value as a literal: numbers stay numbers (an exact text copy, so nothing is rounded), booleans where the engine has them. */
function valueLiteral(kind: DbKind, type: string, text: string): string {
  const t = text.trim()
  if (NUMERIC.test(type.trim()) && NUMBER_TEXT.test(t)) return t.startsWith('+') ? t.slice(1) : t
  if (kind === 'postgres' && /^bool/i.test(type.trim())) {
    if (/^(true|t|yes|y|1)$/i.test(t)) return 'true'
    if (/^(false|f|no|n|0)$/i.test(t)) return 'false'
  }
  return sqlLiteral(kind, text)
}

/** The column as text, so LIKE works on numbers, dates and the rest too. */
function textOf(kind: DbKind, col: string): string {
  switch (kind) {
    case 'postgres':
      return `${col}::text`
    case 'mysql':
      return `CAST(${col} AS CHAR)`
    case 'mssql':
      return `CAST(${col} AS NVARCHAR(MAX))`
    default:
      return `CAST(${col} AS TEXT)`
  }
}

/**
 * "Is empty": a text of length zero. MySQL and SQL Server ignore trailing spaces when they compare strings ('' = ' ' is true there),
 * so a blank-only value would count as empty; measuring the length avoids that.
 */
function emptyText(kind: DbKind, col: string, text: string, emptyLit: string): string {
  if (kind === 'mysql') return `CHAR_LENGTH(${text}) = 0`
  if (kind === 'mssql') return `DATALENGTH(${text}) = 0`
  return `${text} = ${emptyLit}`
}

const ESC = '!'
/** Makes text safe inside a LIKE pattern; "!" is the escape character (a backslash would mean different things per engine). */
const likeEscape = (kind: DbKind, s: string): string => s.replace(kind === 'mssql' ? /[!%_[]/g : /[!%_]/g, (c) => ESC + c) // SQL Server also gives [ a meaning

/** contains / begins / ends, case sensitive or not, for one engine. */
function matchText(kind: DbKind, col: string, mode: 'contains' | 'begins' | 'ends', text: string, ci: boolean): string {
  const lit = (s: string): string => sqlLiteral(kind, s)
  const esc = likeEscape(kind, text)
  const pattern = mode === 'contains' ? `%${esc}%` : mode === 'begins' ? `${esc}%` : `%${esc}`
  const like = (left: string, right: string, op = 'LIKE'): string => `${left} ${op} ${right} ESCAPE '${ESC}'`
  const t = textOf(kind, col)
  switch (kind) {
    case 'postgres':
      return like(t, lit(pattern), ci ? 'ILIKE' : 'LIKE')
    case 'mysql':
      // The server's collation is usually case-insensitive: be explicit both ways.
      return ci ? like(`LOWER(${t})`, `LOWER(${lit(pattern)})`) : like(`CAST(${col} AS BINARY)`, lit(pattern))
    case 'mssql':
      return like(`${t} COLLATE Latin1_General_100_${ci ? 'CI' : 'CS'}_AS`, lit(pattern))
    default: {
      // SQLite's LIKE ignores case for ASCII and cannot be switched off: use plain string functions when case matters.
      if (ci) return like(`LOWER(${t})`, `LOWER(${lit(pattern)})`)
      const n = [...text].length
      if (mode === 'contains') return `instr(${t}, ${lit(text)}) > 0`
      if (mode === 'begins') return `substr(${t}, 1, ${n}) = ${lit(text)}`
      return `substr(${t}, -${n}) = ${lit(text)}`
    }
  }
}

/** The values of "is in list": one per line, or separated by commas. */
export function listValues(text: string): string[] {
  const parts = /[\r\n]/.test(text) ? text.split(/\r?\n/) : text.split(',')
  return parts.map((p) => p.trim()).filter((p) => p !== '')
}

/** True when a condition has what its operator needs; incomplete ones are left out, as the interface shows "<?>" for them. */
export function isComplete(c: Criterion): boolean {
  if (!c.column) return false
  switch (argsOf(c.op)) {
    case 0:
      return true
    case 1:
      return c.value !== ''
    case 2:
      return c.value !== '' && c.value2 !== ''
    case 'list':
      return listValues(c.value).length > 0
    case 'sql':
      return c.value.trim() !== ''
  }
}

/** One condition as SQL; null when it is not complete. */
export function criterionSql(c: Criterion, type: string, kind: DbKind): string | null {
  if (!isComplete(c)) return null
  const col = quoteIdent(kind, c.column)
  const lit = (v: string): string => valueLiteral(kind, type, v)
  const text = textOf(kind, col)
  const emptyLit = sqlLiteral(kind, '')
  const notMatch = (inner: string): string => `(${col} IS NULL OR NOT (${inner}))` // a missing value does not contain anything
  switch (c.op) {
    case 'eq': return `${col} = ${lit(c.value)}`
    case 'ne': return `${col} <> ${lit(c.value)}`
    case 'lt': return `${col} < ${lit(c.value)}`
    case 'le': return `${col} <= ${lit(c.value)}`
    case 'gt': return `${col} > ${lit(c.value)}`
    case 'ge': return `${col} >= ${lit(c.value)}`
    case 'contains': return matchText(kind, col, 'contains', c.value, false)
    case 'icontains': return matchText(kind, col, 'contains', c.value, true)
    case 'ncontains': return notMatch(matchText(kind, col, 'contains', c.value, false))
    case 'nicontains': return notMatch(matchText(kind, col, 'contains', c.value, true))
    case 'begins': return matchText(kind, col, 'begins', c.value, false)
    case 'nbegins': return notMatch(matchText(kind, col, 'begins', c.value, false))
    case 'ends': return matchText(kind, col, 'ends', c.value, false)
    case 'nends': return notMatch(matchText(kind, col, 'ends', c.value, false))
    case 'isnull': return `${col} IS NULL`
    case 'notnull': return `${col} IS NOT NULL`
    case 'isempty': return emptyText(kind, col, text, emptyLit)
    case 'notempty': return `(${col} IS NOT NULL AND NOT (${emptyText(kind, col, text, emptyLit)}))`
    case 'between': return `${col} BETWEEN ${lit(c.value)} AND ${lit(c.value2)}`
    case 'nbetween': return `${col} NOT BETWEEN ${lit(c.value)} AND ${lit(c.value2)}`
    case 'in': return `${col} IN (${listValues(c.value).map(lit).join(', ')})`
    case 'nin': return `${col} NOT IN (${listValues(c.value).map(lit).join(', ')})`
    case 'custom': return `(${c.value.trim().replace(/;+\s*$/, '')})`
  }
}

/**
 * All the conditions as one WHERE condition (without the keyword), or '' when none is usable.
 * Conditions combine from the top, one after the other: "a and b or c" is "((a and b) or c)".
 */
export function compileFilter(criteria: Criterion[], columns: { name: string; type: string }[], kind: DbKind): string {
  let out = ''
  let join: 'and' | 'or' = 'and'
  for (const c of criteria) {
    if (!c.enabled) continue
    const sql = criterionSql(c, columns.find((x) => x.name === c.column)?.type ?? '', kind)
    if (sql === null) continue
    out = out === '' ? sql : `(${out} ${join.toUpperCase()} ${sql})`
    join = c.join
  }
  return out
}
