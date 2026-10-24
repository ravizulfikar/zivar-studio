import { Database } from 'node-sqlite3-wasm'
import type {
  ConnectionConfig,
  ColumnInfo,
  DbObject,
  QueryResult,
  RowChange,
  TableDataOptions,
  DesignForeignKey,
  FkAction,
  TableDataResult,
  TableDesign
} from '@shared/types'
import { PREVIEW_LIMIT, quoteWith, type Driver, type InsertOptions } from './driver'
import { buildInsertChunks, buildStatements, importError, orderClause, ROW_NOT_FOUND, whereClause } from './sqlbuild'

const q = (id: string): string => quoteWith('"', '"', id)

type Row = Record<string, unknown>
type Bindable = string | number | bigint | Uint8Array | null

/** Values the wasm binder accepts; anything else (Date, boolean, objects) is stringified. */
function toBindable(v: unknown): Bindable {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint' || v instanceof Uint8Array) return v
  if (typeof v === 'boolean') return v ? 1 : 0
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

export class SqliteDriver implements Driver {
  private db: Database | null = null

  constructor(private cfg: ConnectionConfig) {}

  async connect(): Promise<void> {
    if (!this.cfg.database) throw new Error('SQLite file path is required')
    this.db = new Database(this.cfg.database)
  }

  private get d(): Database {
    if (!this.db) throw new Error('Not connected')
    return this.db
  }

  async close(): Promise<void> {
    this.db?.close()
    this.db = null
  }

  async cancel(): Promise<void> {
    // SQLite runs synchronously in-process; there is nothing to interrupt from outside.
    throw new Error('SQLite queries cannot be cancelled')
  }

  async containers(): Promise<string[]> {
    return ['main']
  }

  async objects(): Promise<DbObject[]> {
    const rows = this.d.all(
      `SELECT name, type FROM sqlite_master
       WHERE type IN ('table','view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
       ORDER BY name`
    ) as Row[]
    return rows.map((r) => ({ name: String(r.name), type: r.type === 'view' ? 'view' : 'table' }))
  }

  async definition(_container: string, obj: DbObject): Promise<string> {
    const rows = this.d.all('SELECT sql FROM sqlite_master WHERE name = ?', [obj.name]) as Row[]
    if (!rows[0]?.sql) throw new Error('Object not found')
    return String(rows[0].sql)
  }

  async designInfo(_container: string, obj: DbObject): Promise<TableDesign> {
    // table_xinfo (unlike table_info) also reports generated/hidden columns.
    const cols = this.d.all(`PRAGMA table_xinfo(${q(obj.name)})`) as Row[]
    const ddl = this.d.all('SELECT sql FROM sqlite_master WHERE name = ?', [obj.name]) as Row[]
    const hasAutoInc = /\bAUTOINCREMENT\b/i.test(String(ddl[0]?.sql ?? ''))
    const pkCols = cols.filter((c) => Number(c.pk) > 0)

    const indexes: TableDesign['indexes'] = []
    for (const li of this.d.all(`PRAGMA index_list(${q(obj.name)})`) as Row[]) {
      const origin = String(li.origin)
      if (origin === 'pk') continue
      const info = this.d.all(`PRAGMA index_info(${q(String(li.name))})`) as Row[]
      indexes.push({
        id: crypto.randomUUID(),
        originalName: String(li.name),
        name: String(li.name),
        columns: info.map((r) => String(r.name)),
        unique: Number(li.unique) === 1,
        // UNIQUE constraints (origin 'u'), partial and expression indexes are not ours to rewrite.
        locked: origin !== 'c' || Number(li.partial) === 1 || info.some((r) => r.name === null) || undefined,
        constraint: (origin === 'u' && Number(li.partial) !== 1 && info.every((r) => r.name !== null)) || undefined
      })
    }

    // SQLite exposes foreign keys without names and offers no ALTER for them, so they are shown read-only.
    const fks = new Map<number, DesignForeignKey>()
    for (const r of this.d.all(`PRAGMA foreign_key_list(${q(obj.name)})`) as Row[]) {
      const id = Number(r.id)
      const fk = fks.get(id) ?? {
        id: crypto.randomUUID(),
        originalName: `fk_${id}`,
        name: `fk_${id}`,
        columns: [],
        refTable: String(r.table),
        refColumns: [],
        onDelete: String(r.on_delete) as FkAction,
        onUpdate: String(r.on_update) as FkAction,
        locked: true
      }
      fk.columns.push(String(r.from))
      // `to` is NULL when the FK targets the parent's primary key implicitly.
      if (r.to !== null) fk.refColumns.push(String(r.to))
      fks.set(id, fk)
    }

    return {
      name: obj.name,
      foreignKeys: [...fks.values()],
      columns: cols.map((c) => ({
        id: crypto.randomUUID(),
        originalName: String(c.name),
        name: String(c.name),
        type: String(c.type),
        nullable: Number(c.notnull) === 0 && Number(c.pk) === 0,
        primaryKey: Number(c.pk) > 0,
        defaultValue: c.dflt_value === null ? null : String(c.dflt_value),
        autoIncrement: hasAutoInc && pkCols.length === 1 && Number(c.pk) > 0,
        locked: Number(c.hidden) !== 0 || undefined
      })),
      indexes
    }
  }

  async executeDdl(_container: string, statements: string[]): Promise<void> {
    this.d.run('BEGIN')
    try {
      for (const s of statements) this.d.run(s)
      this.d.run('COMMIT')
    } catch (e) {
      try {
        this.d.run('ROLLBACK')
      } catch {
        /* the transaction may already be gone */
      }
      throw e
    }
  }

  async describe(_container: string, obj: DbObject): Promise<ColumnInfo[]> {
    const rows = this.d.all(`PRAGMA table_info(${q(obj.name)})`) as Row[]
    return rows.map((r) => ({
      name: String(r.name),
      type: String(r.type),
      nullable: Number(r.notnull) === 0,
      primaryKey: Number(r.pk) > 0,
      defaultValue: r.dflt_value === null ? null : String(r.dflt_value)
    }))
  }

  previewSql(_container: string, obj: DbObject): string {
    return `SELECT * FROM ${q(obj.name)} LIMIT ${PREVIEW_LIMIT}`
  }

  async query(sql: string): Promise<QueryResult> {
    const started = Date.now()
    const isRead = /^\s*(select|pragma|with|explain)\b/i.test(sql)
    if (isRead) {
      const rows = this.d.all(sql) as Row[]
      const columns = rows.length ? Object.keys(rows[0]) : []
      return {
        columns,
        rows: rows.map((r) => columns.map((c) => r[c])),
        durationMs: Date.now() - started
      }
    }
    const info = this.d.run(sql)
    return { columns: [], rows: [], affected: info.changes, durationMs: Date.now() - started }
  }

  async tableData(_container: string, obj: DbObject, o: TableDataOptions): Promise<TableDataResult> {
    const sql =
      `SELECT * FROM ${q(obj.name)}${whereClause(o.where)}${orderClause(q, o.orderBy)}` +
      ` LIMIT ${o.limit + 1} OFFSET ${o.offset}`
    const started = Date.now()
    const rows = this.d.all(sql) as Row[]
    // An empty page has no row to read column names from, so ask the schema.
    const columns = rows.length ? Object.keys(rows[0]) : (await this.describe('main', obj)).map((c) => c.name)
    return {
      columns,
      rows: rows.slice(0, o.limit).map((r) => columns.map((c) => r[c])),
      hasNext: rows.length > o.limit,
      durationMs: Date.now() - started
    }
  }

  async applyChanges(_container: string, obj: DbObject, changes: RowChange[]): Promise<void> {
    const stmts = buildStatements(changes, {
      quote: q,
      placeholder: () => '?',
      table: q(obj.name),
      emptyInsert: 'DEFAULT VALUES'
    })
    this.d.run('BEGIN')
    try {
      for (const s of stmts) {
        const info = this.d.run(s.sql, s.params.map(toBindable))
        if (s.expectRow && info.changes === 0) throw new Error(ROW_NOT_FOUND)
      }
      this.d.run('COMMIT')
    } catch (e) {
      try {
        this.d.run('ROLLBACK')
      } catch {
        /* the transaction may already be gone */
      }
      throw e
    }
  }

  async tableDdl(_container: string, obj: DbObject): Promise<string[] | null> {
    // sqlite_master keeps the exact statements: the table first, then its indexes and triggers.
    const rows = this.d.all(
      `SELECT sql FROM sqlite_master WHERE tbl_name = ? AND sql IS NOT NULL
       ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`,
      [obj.name]
    ) as Row[]
    return rows.length ? rows.map((r) => String(r.sql)) : null
  }

  async insertRows(_container: string, obj: DbObject, columns: string[], rows: unknown[][], opts: InsertOptions = {}): Promise<number> {
    const own = opts.transaction !== false
    // A VALUES list counts as a compound SELECT, which SQLite caps at 500 terms by default.
    const chunks = buildInsertChunks(columns, rows, { quote: q, placeholder: () => '?', table: q(obj.name), emptyInsert: 'DEFAULT VALUES' }, 30000, 500)
    if (own) this.d.run('BEGIN')
    let current = chunks[0]
    try {
      for (const c of chunks) {
        current = c
        this.d.run(c.sql, c.params.map(toBindable))
      }
      if (own) this.d.run('COMMIT')
      return rows.length
    } catch (e) {
      if (own) {
        try {
          this.d.run('ROLLBACK')
        } catch {
          /* the transaction may already be gone */
        }
      }
      throw importError(current, e)
    }
  }

  async schemaCompletion(): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {}
    for (const t of await this.objects()) {
      out[t.name] = (await this.describe('main', t)).map((c) => c.name)
    }
    return out
  }
}
