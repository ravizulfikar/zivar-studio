import mysql from 'mysql2/promise'
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
import { groupColumns, PREVIEW_LIMIT, quoteWith, type Driver, type InsertOptions } from './driver'
import { buildInsertChunks, buildStatements, importError, orderClause, ROW_NOT_FOUND, whereClause } from './sqlbuild'

const q = (id: string): string => quoteWith('`', '`', id)

const NUMERIC_TYPES = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'decimal', 'numeric', 'float', 'double', 'real', 'bit', 'year'])

const sqlString = (v: string): string => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`

/**
 * information_schema reports string defaults without quotes (MySQL 8) or already quoted
 * (MariaDB) and expression defaults as bare text. Rebuild the SQL a user would have typed.
 */
function mysqlDefault(raw: unknown, extra: string, dataType: string): string | null {
  if (raw === null || raw === undefined) return null
  const v = String(raw)
  if (/DEFAULT_GENERATED/i.test(extra)) return /^(current_timestamp|now|localtime|localtimestamp)\b/i.test(v) ? v : `(${v})`
  if (NUMERIC_TYPES.has(dataType.toLowerCase())) return v
  if (/^'.*'$/s.test(v) || /^b'[01]*'$/i.test(v)) return v
  if (/^(current_timestamp|now)\b/i.test(v)) return v
  return sqlString(v)
}

export class MySqlDriver implements Driver {
  private conn: mysql.Connection | null = null

  constructor(private cfg: ConnectionConfig) {}

  private options(): mysql.ConnectionOptions {
    return {
      host: this.cfg.host,
      port: this.cfg.port ?? 3306,
      user: this.cfg.user,
      password: this.cfg.password,
      database: this.cfg.database || undefined,
      ssl: this.cfg.ssl ? { rejectUnauthorized: false } : undefined
    }
  }

  async connect(): Promise<void> {
    this.conn = await mysql.createConnection({
      ...this.options(),
      multipleStatements: true,
      rowsAsArray: true,
      dateStrings: true,
      // JSON columns come back as their text: parsed, a JSON null would be indistinguishable from SQL NULL.
      jsonStrings: true,
      // BIGINT beyond 2^53 would silently lose digits as a JS number, so those (and only those) come back as strings.
      // bigNumberStrings stays off: ordinary BIGINT ids must remain numbers in grids, exports and Excel.
      supportBigNumbers: true,
      bigNumberStrings: false
    })
  }

  private get c(): mysql.Connection {
    if (!this.conn) throw new Error('Not connected')
    return this.conn
  }

  /** Metadata queries: with rowsAsArray each row is an array of column values. */
  private async rows(sql: string, params?: unknown[]): Promise<unknown[][]> {
    const [rows] = await this.c.query(sql, params)
    return rows as unknown as unknown[][]
  }

  async close(): Promise<void> {
    await this.conn?.end()
    this.conn = null
  }

  async cancel(): Promise<void> {
    const threadId = this.c.threadId
    // KILL QUERY has to be issued from another connection.
    const other = await mysql.createConnection(this.options())
    try {
      await other.query(`KILL QUERY ${Number(threadId)}`)
    } finally {
      await other.end()
    }
  }

  async containers(): Promise<string[]> {
    const rows = await this.rows('SHOW DATABASES')
    return rows.map((r) => String(r[0]))
  }

  async objects(container: string): Promise<DbObject[]> {
    const rows = await this.rows(
      `SELECT table_name, table_type FROM information_schema.tables
       WHERE table_schema = ? ORDER BY table_name`,
      [container]
    )
    const out: DbObject[] = rows.map((r) => ({
      name: String(r[0]),
      type: String(r[1]) === 'VIEW' ? 'view' : 'table'
    }))
    const routines = await this.rows(
      'SELECT routine_name, routine_type FROM information_schema.routines WHERE routine_schema = ? ORDER BY routine_name',
      [container]
    )
    for (const r of routines) {
      out.push({ name: String(r[0]), type: 'function', routine: String(r[1]) === 'PROCEDURE' ? 'procedure' : 'function' })
    }
    return out
  }

  async definition(container: string, obj: DbObject): Promise<string> {
    const target = `${q(container)}.${q(obj.name)}`
    if (obj.type === 'function') {
      const what = obj.routine === 'procedure' ? 'PROCEDURE' : 'FUNCTION'
      // SHOW CREATE FUNCTION/PROCEDURE columns: name, sql_mode, create statement, ...
      const rows = await this.rows(`SHOW CREATE ${what} ${target}`)
      return String(rows[0]?.[2] ?? '')
    }
    // SHOW CREATE VIEW columns: name, create statement, ...
    const rows = await this.rows(`SHOW CREATE VIEW ${target}`)
    return String(rows[0]?.[1] ?? '')
  }

  async designInfo(container: string, obj: DbObject): Promise<TableDesign> {
    const tableColl = await this.rows(
      'SELECT table_collation FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
      [container, obj.name]
    )
    const defaultColl = String(tableColl[0]?.[0] ?? '')
    const cols = await this.rows(
      `SELECT column_name, column_type, data_type, is_nullable, column_default, extra, collation_name, column_comment, generation_expression
       FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
      [container, obj.name]
    )
    const pk = await this.rows(
      `SELECT column_name FROM information_schema.statistics
       WHERE table_schema = ? AND table_name = ? AND index_name = 'PRIMARY' ORDER BY seq_in_index`,
      [container, obj.name]
    )
    const stats = await this.rows(
      `SELECT index_name, non_unique, column_name, sub_part, index_type FROM information_schema.statistics
       WHERE table_schema = ? AND table_name = ? AND index_name <> 'PRIMARY' ORDER BY index_name, seq_in_index`,
      [container, obj.name]
    )
    const pkNames = new Set(pk.map((r) => String(r[0])))

    const fkRows = await this.rows(
      `SELECT k.constraint_name, k.column_name, k.referenced_table_schema, k.referenced_table_name, k.referenced_column_name,
              r.update_rule, r.delete_rule
       FROM information_schema.key_column_usage k
       JOIN information_schema.referential_constraints r
         ON r.constraint_schema = k.constraint_schema AND r.constraint_name = k.constraint_name AND r.table_name = k.table_name
       WHERE k.table_schema = ? AND k.table_name = ? AND k.referenced_table_name IS NOT NULL
       ORDER BY k.constraint_name, k.ordinal_position`,
      [container, obj.name]
    )
    const fks = new Map<string, DesignForeignKey>()
    for (const r of fkRows) {
      const name = String(r[0])
      const fk = fks.get(name) ?? {
        id: crypto.randomUUID(),
        originalName: name,
        name,
        columns: [],
        refSchema: String(r[2]),
        refTable: String(r[3]),
        refColumns: [],
        onUpdate: String(r[5]) as FkAction,
        onDelete: String(r[6]) as FkAction
      }
      fk.columns.push(String(r[1]))
      fk.refColumns.push(String(r[4]))
      fks.set(name, fk)
    }

    const indexes = new Map<string, { unique: boolean; cols: string[]; locked: boolean }>()
    for (const r of stats) {
      const name = String(r[0])
      const ix = indexes.get(name) ?? { unique: Number(r[1]) === 0, cols: [], locked: false }
      // Functional (NULL column), prefix-length and non-BTREE indexes can't round-trip through the model.
      if (r[2] === null || r[3] !== null || String(r[4]).toUpperCase() !== 'BTREE') ix.locked = true
      if (r[2] !== null) ix.cols.push(String(r[2]))
      indexes.set(name, ix)
    }

    return {
      name: obj.name,
      foreignKeys: [...fks.values()],
      columns: cols.map((r) => {
        const extra = String(r[5] ?? '')
        const onUpdate = /on update (\S+)/i.exec(extra)?.[1]
        const comment = String(r[7] ?? '')
        const attrs = [onUpdate ? `ON UPDATE ${onUpdate}` : '', comment ? `COMMENT ${sqlString(comment)}` : ''].filter(Boolean)
        const coll = r[6] === null ? undefined : String(r[6])
        return {
          id: crypto.randomUUID(),
          originalName: String(r[0]),
          name: String(r[0]),
          type: String(r[1]),
          nullable: r[3] === 'YES',
          primaryKey: pkNames.has(String(r[0])),
          defaultValue: mysqlDefault(r[4], extra, String(r[2])),
          autoIncrement: /auto_increment/i.test(extra),
          collation: coll && coll !== defaultColl ? coll : undefined,
          extra: attrs.length ? attrs.join(' ') : undefined,
          locked: /(virtual|stored) generated/i.test(extra) || undefined,
          generated: /(virtual|stored) generated/i.test(extra) && r[8] ? { expr: String(r[8]), stored: /stored generated/i.test(extra) } : undefined
        }
      }),
      indexes: [...indexes.entries()].map(([name, ix]) => ({
        id: crypto.randomUUID(),
        originalName: name,
        name,
        columns: ix.cols,
        unique: ix.unique,
        locked: ix.locked || undefined
      }))
    }
  }

  async executeDdl(_container: string, statements: string[]): Promise<void> {
    // MySQL implicitly commits every DDL statement, so report how far we got on failure.
    for (let i = 0; i < statements.length; i++) {
      try {
        await this.c.query(statements[i])
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        throw new Error(
          i === 0
            ? msg
            : `Statement ${i + 1} of ${statements.length} failed: ${msg}\nThe first ${i} statement(s) were already applied and cannot be rolled back.`
        )
      }
    }
  }

  async describe(container: string, obj: DbObject): Promise<ColumnInfo[]> {
    const rows = await this.rows(
      `SELECT column_name, column_type, is_nullable, column_key, column_default
       FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
      [container, obj.name]
    )
    return rows.map((r) => ({
      name: String(r[0]),
      type: String(r[1]),
      nullable: r[2] === 'YES',
      primaryKey: r[3] === 'PRI',
      defaultValue: r[4] === null ? null : String(r[4])
    }))
  }

  previewSql(container: string, obj: DbObject): string {
    return `SELECT * FROM ${q(container)}.${q(obj.name)} LIMIT ${PREVIEW_LIMIT}`
  }

  async query(sql: string, container: string | null): Promise<QueryResult> {
    if (container) await this.c.query(`USE ${q(container)}`)
    const started = Date.now()
    // With rowsAsArray, `fields` is the column metadata and `rows` is an array of arrays.
    // For multi-statement input both are arrays-of-results; we pick the last.
    const [rows, fields] = await this.c.query<mysql.RowDataPacket[][] | mysql.ResultSetHeader>(sql)
    const durationMs = Date.now() - started

    const pick = <T>(v: unknown): T => {
      const multi = Array.isArray(fields) && fields.length > 0 && Array.isArray(fields[0])
      return (multi && Array.isArray(v) ? (v as unknown[])[(v as unknown[]).length - 1] : v) as T
    }
    const lastRows = pick<mysql.RowDataPacket[][] | mysql.ResultSetHeader>(rows)
    const lastFields = pick<mysql.FieldPacket[] | undefined>(fields)

    if (Array.isArray(lastRows)) {
      return {
        columns: (lastFields ?? []).map((f) => f.name),
        rows: lastRows as unknown[][],
        durationMs
      }
    }
    return { columns: [], rows: [], affected: lastRows.affectedRows, durationMs }
  }

  async tableData(container: string, obj: DbObject, o: TableDataOptions): Promise<TableDataResult> {
    const sql =
      `SELECT * FROM ${q(container)}.${q(obj.name)}${whereClause(o.where)}${orderClause(q, o.orderBy)}` +
      ` LIMIT ${o.limit + 1} OFFSET ${o.offset}`
    const r = await this.query(sql, null)
    return { columns: r.columns, rows: r.rows.slice(0, o.limit), hasNext: r.rows.length > o.limit, durationMs: r.durationMs }
  }

  async applyChanges(container: string, obj: DbObject, changes: RowChange[]): Promise<void> {
    const stmts = buildStatements(changes, {
      quote: q,
      placeholder: () => '?',
      table: `${q(container)}.${q(obj.name)}`,
      emptyInsert: '() VALUES ()'
    })
    await this.c.beginTransaction()
    try {
      for (const s of stmts) {
        const [res] = await this.c.query<mysql.ResultSetHeader>(s.sql, s.params)
        if (s.expectRow && res.affectedRows === 0) throw new Error(ROW_NOT_FOUND)
      }
      await this.c.commit()
    } catch (e) {
      await this.c.rollback().catch(() => undefined)
      throw e
    }
  }

  async tableDdl(container: string, obj: DbObject): Promise<string[] | null> {
    // SHOW CREATE TABLE already contains the indexes, foreign keys, charset, comments and generated columns.
    const rows = await this.rows(`SHOW CREATE TABLE ${q(container)}.${q(obj.name)}`)
    const ddl = String(rows[0]?.[1] ?? '')
    return ddl ? [ddl] : null
  }

  async insertRows(container: string, obj: DbObject, columns: string[], rows: unknown[][], opts: InsertOptions = {}): Promise<number> {
    const own = opts.transaction !== false
    // mysql2 interpolates `?` client-side, so only the row count needs bounding.
    const chunks = buildInsertChunks(columns, rows, { quote: q, placeholder: () => '?', table: `${q(container)}.${q(obj.name)}`, emptyInsert: '() VALUES ()' }, 1_000_000, 1000)
    if (own) await this.c.beginTransaction()
    let current = chunks[0]
    try {
      for (const c of chunks) {
        current = c
        await this.c.query(c.sql, c.params)
      }
      if (own) await this.c.commit()
      return rows.length
    } catch (e) {
      if (own) await this.c.rollback().catch(() => undefined)
      throw importError(current, e)
    }
  }

  async schemaCompletion(container: string): Promise<Record<string, string[]>> {
    const rows = await this.rows(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = ? ORDER BY table_name, ordinal_position`,
      [container]
    )
    return groupColumns(rows.map((r) => [String(r[0]), String(r[1])]))
  }
}
