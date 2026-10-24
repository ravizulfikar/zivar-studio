import type { DbKind, DesignColumn, DesignForeignKey, DesignIndex, TableDesign } from './types'

/**
 * Best-effort translation of a table design from one engine to another, for data transfer.
 * Types go through a small neutral vocabulary; anything without a sensible equivalent becomes text
 * and is reported in `notes` so nothing changes silently.
 */

type Canon =
  | { t: 'int'; bits: 16 | 32 | 64 }
  | { t: 'dec'; p?: number; s?: number }
  | { t: 'float'; bits: 32 | 64 }
  | { t: 'bool' }
  | { t: 'text' }
  | { t: 'varchar'; n: number }
  | { t: 'char'; n: number }
  | { t: 'date' }
  | { t: 'time' }
  | { t: 'ts' }
  | { t: 'tstz' }
  | { t: 'blob' }
  | { t: 'json'; binary?: boolean }
  | { t: 'uuid' }
  | { t: 'other'; raw: string }

const nums = (params: string | undefined): number[] => (params ?? '').split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n))

function parseType(kind: DbKind, raw: string): Canon {
  const lower = raw.trim().toLowerCase()
  const params = /\(([^)]*)\)/.exec(lower)?.[1]
  const base = lower.replace(/\([^)]*\)/g, '').replace(/\b(unsigned|signed|zerofill)\b/g, '').replace(/\s+/g, ' ').trim()
  const [a, b] = nums(params)
  const sized = (n: number | undefined, fallback: Canon): Canon => (n && n > 0 ? { t: 'varchar', n } : fallback)

  switch (kind) {
    case 'postgres':
      switch (base) {
        case 'smallint': case 'int2': return { t: 'int', bits: 16 }
        case 'integer': case 'int': case 'int4': return { t: 'int', bits: 32 }
        case 'bigint': case 'int8': return { t: 'int', bits: 64 }
        case 'numeric': case 'decimal': return { t: 'dec', p: a, s: b }
        case 'real': case 'float4': return { t: 'float', bits: 32 }
        case 'double precision': case 'float8': return { t: 'float', bits: 64 }
        case 'boolean': case 'bool': return { t: 'bool' }
        case 'text': return { t: 'text' }
        case 'character varying': case 'varchar': return sized(a, { t: 'text' })
        case 'character': case 'char': case 'bpchar': return { t: 'char', n: a ?? 1 }
        case 'date': return { t: 'date' }
        case 'time without time zone': case 'time with time zone': case 'time': case 'timetz': return { t: 'time' }
        case 'timestamp without time zone': case 'timestamp': return { t: 'ts' }
        case 'timestamp with time zone': case 'timestamptz': return { t: 'tstz' }
        case 'bytea': return { t: 'blob' }
        case 'json': return { t: 'json', binary: false }
        case 'jsonb': return { t: 'json', binary: true }
        case 'uuid': return { t: 'uuid' }
      }
      break
    case 'mysql':
      switch (base) {
        case 'tinyint': return a === 1 ? { t: 'bool' } : { t: 'int', bits: 16 }
        case 'smallint': case 'year': return { t: 'int', bits: 16 }
        case 'mediumint': case 'int': case 'integer': return { t: 'int', bits: 32 }
        case 'bigint': return { t: 'int', bits: 64 }
        case 'decimal': case 'numeric': case 'dec': case 'fixed': return { t: 'dec', p: a, s: b }
        case 'float': return { t: 'float', bits: 32 }
        case 'double': case 'double precision': case 'real': return { t: 'float', bits: 64 }
        case 'bit': return a === 1 ? { t: 'bool' } : { t: 'int', bits: 64 }
        case 'varchar': return sized(a, { t: 'text' })
        case 'char': return { t: 'char', n: a ?? 1 }
        case 'tinytext': case 'text': case 'mediumtext': case 'longtext': return { t: 'text' }
        case 'date': return { t: 'date' }
        case 'datetime': case 'timestamp': return { t: 'ts' }
        case 'time': return { t: 'time' }
        case 'json': return { t: 'json' }
        case 'tinyblob': case 'blob': case 'mediumblob': case 'longblob': case 'binary': case 'varbinary': return { t: 'blob' }
      }
      break
    case 'mssql':
      switch (base) {
        case 'bit': return { t: 'bool' }
        case 'tinyint': case 'smallint': return { t: 'int', bits: 16 }
        case 'int': return { t: 'int', bits: 32 }
        case 'bigint': return { t: 'int', bits: 64 }
        case 'decimal': case 'numeric': return { t: 'dec', p: a, s: b }
        case 'money': return { t: 'dec', p: 19, s: 4 }
        case 'smallmoney': return { t: 'dec', p: 10, s: 4 }
        case 'float': return { t: 'float', bits: a !== undefined && a <= 24 ? 32 : 64 }
        case 'real': return { t: 'float', bits: 32 }
        case 'varchar': case 'nvarchar': return /max/.test(lower) ? { t: 'text' } : sized(a, { t: 'text' })
        case 'char': case 'nchar': return { t: 'char', n: a ?? 1 }
        case 'text': case 'ntext': case 'xml': return { t: 'text' }
        case 'date': return { t: 'date' }
        case 'time': return { t: 'time' }
        case 'datetime': case 'datetime2': case 'smalldatetime': return { t: 'ts' }
        case 'datetimeoffset': return { t: 'tstz' }
        case 'binary': case 'varbinary': case 'image': return { t: 'blob' }
        case 'uniqueidentifier': return { t: 'uuid' }
      }
      break
    case 'sqlite': {
      // SQLite types are just names; its own affinity rules decide what they mean.
      if (/bool/.test(base)) return { t: 'bool' }
      if (/int/.test(base)) return { t: 'int', bits: 64 }
      if (/^(varchar|nvarchar|character varying)/.test(base)) return sized(a, { t: 'text' })
      if (/char|clob|text/.test(base)) return /^(n?char|character)$/.test(base) && a ? { t: 'char', n: a } : { t: 'text' }
      if (/blob/.test(base)) return { t: 'blob' }
      if (/real|floa|doub/.test(base)) return { t: 'float', bits: 64 }
      if (/numeric|decimal/.test(base)) return { t: 'dec', p: a, s: b }
      if (base === 'date') return { t: 'date' }
      if (base === 'time') return { t: 'time' }
      if (/datetime|timestamp/.test(base)) return { t: 'ts' }
      if (/json/.test(base)) return { t: 'json' }
      if (base === '' || /text/.test(base)) return { t: 'text' }
      break
    }
  }
  return { t: 'other', raw }
}

function renderType(dst: DbKind, c: Canon, col: string, notes: string[]): string {
  const pick = (pg: string, my: string, ms: string, lite: string): string => (dst === 'postgres' ? pg : dst === 'mysql' ? my : dst === 'mssql' ? ms : lite)
  switch (c.t) {
    case 'int':
      return c.bits === 16 ? pick('smallint', 'smallint', 'smallint', 'integer') : c.bits === 32 ? pick('integer', 'int', 'int', 'integer') : pick('bigint', 'bigint', 'bigint', 'integer')
    case 'dec': {
      if (dst === 'sqlite') return 'numeric'
      const cap = dst === 'mysql' ? 65 : 38
      if (c.p === undefined) {
        if (dst !== 'postgres') notes.push(`Column "${col}": unbounded numeric became decimal(38,10) — check the value range.`)
        return dst === 'postgres' ? 'numeric' : 'decimal(38,10)'
      }
      return `${dst === 'postgres' ? 'numeric' : 'decimal'}(${Math.min(c.p, cap)},${Math.min(c.s ?? 0, Math.min(c.p, dst === 'mysql' ? 30 : 38))})`
    }
    case 'float':
      return c.bits === 32 ? pick('real', 'float', 'real', 'real') : pick('double precision', 'double', 'float', 'real')
    case 'bool':
      return pick('boolean', 'tinyint(1)', 'bit', 'boolean')
    case 'text':
      return pick('text', 'longtext', 'nvarchar(max)', 'text')
    case 'varchar':
      if (dst === 'postgres') return `varchar(${c.n})`
      if (dst === 'mysql') return c.n <= 16383 ? `varchar(${c.n})` : 'longtext'
      if (dst === 'mssql') return c.n <= 4000 ? `nvarchar(${c.n})` : 'nvarchar(max)'
      return 'text'
    case 'char':
      if (dst === 'postgres') return `char(${c.n})`
      if (dst === 'mysql') return c.n <= 255 ? `char(${c.n})` : `varchar(${c.n})`
      if (dst === 'mssql') return c.n <= 4000 ? `nchar(${c.n})` : 'nvarchar(max)'
      return 'text'
    case 'date':
      return pick('date', 'date', 'date', 'text')
    case 'time':
      return pick('time', 'time', 'time', 'text')
    case 'ts':
      return pick('timestamp', 'datetime', 'datetime2', 'text')
    case 'tstz':
      return pick('timestamptz', 'timestamp', 'datetimeoffset', 'text')
    case 'blob':
      return pick('bytea', 'longblob', 'varbinary(max)', 'blob')
    case 'json':
      // PostgreSQL json keeps the text exactly as written; jsonb normalises it. Keep whichever the source used.
      return pick(c.binary === false ? 'json' : 'jsonb', 'json', 'nvarchar(max)', 'text')
    case 'uuid':
      return pick('uuid', 'char(36)', 'uniqueidentifier', 'text')
    case 'other':
      notes.push(`Column "${col}": type "${c.raw}" has no equivalent in the target; stored as text.`)
      return pick('text', 'longtext', 'nvarchar(max)', 'text')
  }
}

/** Keywords for "now" in each engine; null means the target has no usable default for that. */
const NOW: Record<DbKind, string> = { postgres: 'now()', mysql: 'CURRENT_TIMESTAMP', mssql: 'SYSUTCDATETIME()', sqlite: 'CURRENT_TIMESTAMP' }
const UUID: Record<DbKind, string | null> = { postgres: 'gen_random_uuid()', mysql: '(uuid())', mssql: 'NEWID()', sqlite: null }

/** Strip parentheses that wrap the whole expression (SQL Server stores defaults as ((0)) or ('x')). */
function unwrap(expr: string): string {
  let e = expr.trim()
  while (e.startsWith('(') && e.endsWith(')')) {
    let depth = 0
    let closesAtEnd = true
    for (let i = 0; i < e.length; i++) {
      if (e[i] === '(') depth++
      else if (e[i] === ')') depth--
      if (depth === 0 && i < e.length - 1) {
        closesAtEnd = false
        break
      }
    }
    if (!closesAtEnd) break
    e = e.slice(1, -1).trim()
  }
  return e
}

function mapDefault(dst: DbKind, raw: string | null, canon: Canon, col: string, notes: string[]): string | null {
  if (raw === null || raw.trim() === '') return null
  // `'abc'::character varying` -> `'abc'`; N'abc' -> 'abc'
  let e = unwrap(raw).replace(/::[a-z_ ]+(\([^)]*\))?(\[\])?$/i, '').replace(/^N'/, "'").trim()
  e = unwrap(e)
  const lower = e.toLowerCase()
  if (lower === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(e)) {
    if (canon.t === 'bool') return dst === 'postgres' ? (e === '0' ? 'false' : 'true') : e === '0' ? '0' : '1'
    return e
  }
  if (lower === 'true' || lower === 'false') return dst === 'postgres' ? lower : lower === 'true' ? '1' : '0'
  if (/^'([^']|'')*'$/.test(e)) return e
  if (/^(now\(\)|current_timestamp(\(\d*\))?|getdate\(\)|getutcdate\(\)|sysdatetime\(\)|sysutcdatetime\(\)|localtimestamp(\(\d*\))?)$/i.test(e) && (canon.t === 'ts' || canon.t === 'tstz')) {
    return dst === 'sqlite' && canon.t !== 'ts' ? 'CURRENT_TIMESTAMP' : NOW[dst]
  }
  if (/^(gen_random_uuid\(\)|uuid_generate_v4\(\)|uuid\(\)|newid\(\))$/i.test(e) && UUID[dst] && (canon.t === 'uuid' || canon.t === 'char' || canon.t === 'varchar')) return UUID[dst]
  notes.push(`Default of column "${col}" (${raw.trim().slice(0, 60)}) was not carried over.`)
  return null
}

export interface ConvertResult {
  design: TableDesign
  notes: string[]
}

/** Translate a table design for another engine. Constraint names are kept; generated columns are left out. */
export function convertDesign(src: DbKind, dst: DbKind, design: TableDesign, srcContainer: string): ConvertResult {
  const notes: string[] = []
  const skipped = new Set(design.columns.filter((c) => c.generated || c.locked).map((c) => c.name))
  for (const name of skipped) notes.push(`Column "${name}" is generated or read-only and was not carried over (its values are computed in the source).`)

  const kept = design.columns.filter((c) => !skipped.has(c.name))
  const pkCount = kept.filter((c) => c.primaryKey).length
  const usedInKeys = new Set<string>([
    ...kept.filter((c) => c.primaryKey).map((c) => c.name),
    ...design.indexes.filter((i) => !i.locked).flatMap((i) => i.columns),
    ...(design.foreignKeys ?? []).flatMap((f) => f.columns)
  ])

  const columns: DesignColumn[] = kept.map((c, i) => {
    const canon = parseType(src, c.type)
    let type = renderType(dst, canon, c.name, notes)
    // MySQL cannot index or key an unbounded TEXT/BLOB column without a prefix length.
    if (dst === 'mysql' && usedInKeys.has(c.name) && (type === 'longtext' || type === 'longblob')) {
      type = type === 'longtext' ? 'varchar(255)' : 'varbinary(255)'
      notes.push(`Column "${c.name}" is part of a key, so it became ${type} (MySQL cannot key a TEXT/BLOB column).`)
    }
    // A PostgreSQL serial column is an integer whose default draws from a sequence: that is auto-increment.
    const serial = src === 'postgres' && canon.t === 'int' && /^nextval\(/i.test(c.defaultValue ?? '')
    let autoIncrement = c.autoIncrement || serial
    if (autoIncrement && dst === 'sqlite' && !(pkCount === 1 && c.primaryKey && canon.t === 'int')) {
      autoIncrement = false
      notes.push(`Column "${c.name}" lost its auto-increment: SQLite only supports it on a single integer primary key.`)
    }
    return {
      id: `conv-${i}`,
      originalName: null,
      name: c.name,
      type,
      nullable: c.nullable && !c.primaryKey,
      primaryKey: c.primaryKey,
      defaultValue: autoIncrement ? null : mapDefault(dst, c.defaultValue, canon, c.name, notes),
      autoIncrement
    }
  })

  // MySQL, SQL Server and SQLite allow a single auto-increment column per table: keep the primary key's, else the first.
  if (dst !== 'postgres') {
    const autos = columns.filter((c) => c.autoIncrement)
    const keep = autos.find((c) => c.primaryKey) ?? autos[0]
    for (const c of autos) {
      if (c === keep) continue
      c.autoIncrement = false
      notes.push(`Column "${c.name}" lost its auto-increment: ${dst === 'mysql' ? 'MySQL' : dst === 'mssql' ? 'SQL Server' : 'SQLite'} allows only one per table.`)
    }
  }

  const present = new Set(columns.map((c) => c.name))
  const indexes: DesignIndex[] = []
  for (const ix of design.indexes) {
    if (ix.locked && !ix.constraint) {
      notes.push(`Index "${ix.name}" (expression or partial) was not carried over.`)
    } else if (ix.columns.every((c) => present.has(c))) {
      indexes.push({ id: `conv-ix-${ix.name}`, originalName: null, name: ix.name, columns: ix.columns, unique: ix.unique })
    }
  }
  const foreignKeys: DesignForeignKey[] = []
  for (const fk of design.foreignKeys ?? []) {
    if (!fk.columns.every((c) => present.has(c))) continue
    if (fk.refColumns.length !== fk.columns.length) {
      // SQLite allows `REFERENCES parent` with no column list; the planner needs the columns spelled out.
      notes.push(`Foreign key "${fk.name}" refers to ${fk.refTable}'s primary key implicitly, so it was not carried over.`)
      continue
    }
    // "Locked" only means the source engine cannot alter it; a copy into a new table is always possible.
    if (fk.locked && src !== 'sqlite') notes.push(`Foreign key "${fk.name}" was copied without its special options (deferrable / match).`)
    // SQLite foreign keys have no names (we call them fk_0…); MySQL needs names unique per database.
    const name = src === 'sqlite' ? `fk_${design.name}_${fk.columns.join('_')}` : fk.name
    foreignKeys.push({ ...fk, id: `conv-fk-${name}`, name, originalName: null, locked: undefined, refSchema: fk.refSchema === srcContainer ? undefined : fk.refSchema })
  }

  return { design: { name: design.name, columns, indexes, foreignKeys }, notes }
}

/**
 * Make a value read from one engine acceptable to another's driver. Objects must become JSON text
 * (mysql2 would otherwise expand them into `key = value` pairs); dates become unambiguous text.
 */
export function convertValue(v: unknown, src: DbKind, dst: DbKind): unknown {
  if (v === null || v === undefined) return null
  if (v instanceof Uint8Array) return v
  if (v instanceof Date) {
    const p = (n: number, w = 2): string => String(n).padStart(w, '0')
    return `${p(v.getUTCFullYear(), 4)}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())} ${p(v.getUTCHours())}:${p(v.getUTCMinutes())}:${p(v.getUTCSeconds())}.${p(v.getUTCMilliseconds(), 3)}`
  }
  if (Array.isArray(v)) return src === 'postgres' && dst === 'postgres' ? v : JSON.stringify(v)
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'bigint') return v.toString()
  return v
}
