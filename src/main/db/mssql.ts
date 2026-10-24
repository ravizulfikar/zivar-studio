import sql from 'mssql'
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

const q = (id: string): string => quoteWith('[', ']', id)

export class MsSqlDriver implements Driver {
  private pool: sql.ConnectionPool
  private current: sql.Request | null = null

  constructor(cfg: ConnectionConfig) {
    this.pool = new sql.ConnectionPool({
      server: cfg.host ?? 'localhost',
      port: cfg.port ?? 1433,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database || undefined,
      // One connection so that USE <db> sticks between calls.
      pool: { max: 1, min: 1 },
      options: { encrypt: !!cfg.ssl, trustServerCertificate: true }
    })
  }

  async connect(): Promise<void> {
    await this.pool.connect()
  }

  async close(): Promise<void> {
    await this.pool.close()
  }

  async cancel(): Promise<void> {
    if (!this.current) throw new Error('Nothing is running')
    this.current.cancel()
  }

  async containers(): Promise<string[]> {
    const r = await this.pool.request().query('SELECT name FROM sys.databases ORDER BY name')
    return r.recordset.map((x: { name: string }) => x.name)
  }

  async objects(container: string): Promise<DbObject[]> {
    const r = await this.pool
      .request()
      .query(
        `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM ${q(container)}.INFORMATION_SCHEMA.TABLES
         ORDER BY TABLE_SCHEMA, TABLE_NAME`
      )
    const out: DbObject[] = r.recordset.map(
      (x: { TABLE_SCHEMA: string; TABLE_NAME: string; TABLE_TYPE: string }) => ({
        schema: x.TABLE_SCHEMA,
        name: x.TABLE_NAME,
        type: x.TABLE_TYPE === 'VIEW' ? ('view' as const) : ('table' as const)
      })
    )
    // FN scalar, IF inline table-valued, TF table-valued functions; P stored procedures.
    const fn = await this.pool.request().query(
      `SELECT s.name AS sch, o.name, o.type FROM ${q(container)}.sys.objects o
       JOIN ${q(container)}.sys.schemas s ON s.schema_id = o.schema_id
       WHERE o.type IN ('FN','IF','TF','P') AND o.is_ms_shipped = 0 ORDER BY s.name, o.name`
    )
    for (const x of fn.recordset as { sch: string; name: string; type: string }[]) {
      out.push({ schema: x.sch, name: x.name, type: 'function', routine: x.type.trim() === 'P' ? 'procedure' : 'function' })
    }
    return out
  }

  async definition(container: string, obj: DbObject): Promise<string> {
    const full = `${q(container)}.${q(obj.schema ?? 'dbo')}.${q(obj.name)}`
    const r = await this.pool.request().input('n', sql.NVarChar, full).query('SELECT OBJECT_DEFINITION(OBJECT_ID(@n)) AS def')
    const def = r.recordset[0]?.def as string | null | undefined
    if (!def) throw new Error('Definition not available (object not found or encrypted)')
    return def
  }

  async designInfo(container: string, obj: DbObject): Promise<TableDesign> {
    const full = `${q(container)}.${q(obj.schema ?? 'dbo')}.${q(obj.name)}`
    const req = (): sql.Request => this.pool.request().input('n', sql.NVarChar, full)
    // sys.* views are database-local, so qualify them with the target database.
    const db = q(container)

    const cols = await req().query(
      `SELECT c.name, t.name AS tname, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity, c.is_computed,
              dc.name AS dcname, dc.definition AS def, cc.definition AS cdef, cc.is_persisted AS cpersisted
       FROM ${db}.sys.columns c JOIN ${db}.sys.types t ON t.user_type_id = c.user_type_id
       LEFT JOIN ${db}.sys.default_constraints dc ON dc.object_id = c.default_object_id
       LEFT JOIN ${db}.sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
       WHERE c.object_id = OBJECT_ID(@n) ORDER BY c.column_id`
    )
    const pk = await req().query(
      `SELECT kc.name AS kname, col.name AS cname
       FROM ${db}.sys.key_constraints kc
       JOIN ${db}.sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
       JOIN ${db}.sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
       WHERE kc.type = 'PK' AND kc.parent_object_id = OBJECT_ID(@n) ORDER BY ic.key_ordinal`
    )
    const ix = await req().query(
      `SELECT i.name AS iname, i.is_unique, i.is_unique_constraint, i.type, i.has_filter, col.name AS cname, ic.is_included_column
       FROM ${db}.sys.indexes i
       JOIN ${db}.sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
       JOIN ${db}.sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
       WHERE i.object_id = OBJECT_ID(@n) AND i.is_primary_key = 0 AND i.type > 0
       ORDER BY i.name, ic.is_included_column, ic.key_ordinal`
    )

    const fkRows = await req().query(
      `SELECT fk.name, fk.delete_referential_action_desc AS del, fk.update_referential_action_desc AS upd,
              pc.name AS col, rs.name AS ref_schema, rt.name AS ref_table, rc.name AS ref_col
       FROM ${db}.sys.foreign_keys fk
       JOIN ${db}.sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
       JOIN ${db}.sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
       JOIN ${db}.sys.tables rt ON rt.object_id = fkc.referenced_object_id
       JOIN ${db}.sys.schemas rs ON rs.schema_id = rt.schema_id
       JOIN ${db}.sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
       WHERE fk.parent_object_id = OBJECT_ID(@n) ORDER BY fk.name, fkc.constraint_column_id`
    )
    const fks = new Map<string, DesignForeignKey>()
    for (const r of fkRows.recordset as Record<string, unknown>[]) {
      const name = String(r.name)
      const fk = fks.get(name) ?? {
        id: crypto.randomUUID(),
        originalName: name,
        name,
        columns: [],
        refSchema: String(r.ref_schema),
        refTable: String(r.ref_table),
        refColumns: [],
        onDelete: String(r.del).replace(/_/g, ' ') as FkAction,
        onUpdate: String(r.upd).replace(/_/g, ' ') as FkAction
      }
      fk.columns.push(String(r.col))
      fk.refColumns.push(String(r.ref_col))
      fks.set(name, fk)
    }

    const typeText = (r: Record<string, unknown>): string => {
      const t = String(r.tname)
      const len = Number(r.max_length)
      if (['char', 'varchar', 'binary', 'varbinary'].includes(t)) return `${t}(${len === -1 ? 'max' : len})`
      if (['nchar', 'nvarchar'].includes(t)) return `${t}(${len === -1 ? 'max' : len / 2})`
      if (['decimal', 'numeric'].includes(t)) return `${t}(${r.precision},${r.scale})`
      if (['datetime2', 'time', 'datetimeoffset'].includes(t)) return `${t}(${r.scale})`
      return t
    }

    const pkNames = new Set(pk.recordset.map((r: { cname: string }) => r.cname))
    const indexes = new Map<string, { unique: boolean; cols: string[]; locked: boolean; constraint: boolean }>()
    for (const r of ix.recordset as Record<string, unknown>[]) {
      const name = String(r.iname)
      const e = indexes.get(name) ?? { unique: !!r.is_unique, cols: [], locked: false, constraint: false }
      if (r.is_unique_constraint && !r.is_included_column && !r.has_filter) e.constraint = true
      // Included columns, filters, unique constraints and columnstore/xml/spatial indexes stay untouched.
      if (r.is_included_column || r.has_filter || r.is_unique_constraint || ![1, 2].includes(Number(r.type))) e.locked = true
      if (!r.is_included_column) e.cols.push(String(r.cname))
      indexes.set(name, e)
    }

    return {
      name: obj.name,
      pkName: (pk.recordset[0] as { kname?: string } | undefined)?.kname,
      foreignKeys: [...fks.values()],
      columns: (cols.recordset as Record<string, unknown>[]).map((r) => ({
        id: crypto.randomUUID(),
        originalName: String(r.name),
        name: String(r.name),
        type: typeText(r),
        nullable: !!r.is_nullable,
        primaryKey: pkNames.has(String(r.name)),
        defaultValue: r.def === null || r.def === undefined ? null : String(r.def),
        autoIncrement: !!r.is_identity,
        defaultConstraint: r.dcname ? String(r.dcname) : undefined,
        locked: !!r.is_computed || undefined,
        generated: r.is_computed && r.cdef ? { expr: String(r.cdef), stored: !!r.cpersisted } : undefined
      })),
      indexes: [...indexes.entries()].map(([name, e]) => ({
        id: crypto.randomUUID(),
        originalName: name,
        name,
        columns: e.cols,
        unique: e.unique,
        locked: e.locked || undefined,
        constraint: e.constraint || undefined
      }))
    }
  }

  async executeDdl(_container: string, statements: string[]): Promise<void> {
    const tx = new sql.Transaction(this.pool)
    await tx.begin()
    try {
      for (const s of statements) await new sql.Request(tx).batch(s)
      await tx.commit()
    } catch (e) {
      await tx.rollback().catch(() => undefined)
      throw e
    }
  }

  async describe(container: string, obj: DbObject): Promise<ColumnInfo[]> {
    const r = await this.pool
      .request()
      .input('schema', sql.NVarChar, obj.schema ?? 'dbo')
      .input('table', sql.NVarChar, obj.name).query(`
        SELECT c.COLUMN_NAME, c.DATA_TYPE, c.CHARACTER_MAXIMUM_LENGTH, c.IS_NULLABLE, c.COLUMN_DEFAULT,
               CASE WHEN EXISTS (
                 SELECT 1 FROM ${q(container)}.INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                 JOIN ${q(container)}.INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
                   ON k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND k.TABLE_SCHEMA = tc.TABLE_SCHEMA
                 WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = c.TABLE_SCHEMA
                   AND tc.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = c.COLUMN_NAME
               ) THEN 1 ELSE 0 END AS is_pk
        FROM ${q(container)}.INFORMATION_SCHEMA.COLUMNS c
        WHERE c.TABLE_SCHEMA = @schema AND c.TABLE_NAME = @table
        ORDER BY c.ORDINAL_POSITION`)
    return r.recordset.map(
      (x: {
        COLUMN_NAME: string
        DATA_TYPE: string
        CHARACTER_MAXIMUM_LENGTH: number | null
        IS_NULLABLE: string
        COLUMN_DEFAULT: string | null
        is_pk: number
      }) => ({
        name: x.COLUMN_NAME,
        type:
          x.CHARACTER_MAXIMUM_LENGTH == null
            ? x.DATA_TYPE
            : `${x.DATA_TYPE}(${x.CHARACTER_MAXIMUM_LENGTH === -1 ? 'max' : x.CHARACTER_MAXIMUM_LENGTH})`,
        nullable: x.IS_NULLABLE === 'YES',
        primaryKey: x.is_pk === 1,
        defaultValue: x.COLUMN_DEFAULT
      })
    )
  }

  previewSql(container: string, obj: DbObject): string {
    return `SELECT TOP ${PREVIEW_LIMIT} * FROM ${q(container)}.${q(obj.schema ?? 'dbo')}.${q(obj.name)}`
  }

  async query(text: string, container: string | null): Promise<QueryResult> {
    const batch = container ? `USE ${q(container)};\n${text}` : text
    const started = Date.now()
    const req = this.pool.request()
    this.current = req
    let res: sql.IResult<unknown>
    try {
      res = await req.query(batch)
    } finally {
      this.current = null
    }
    const durationMs = Date.now() - started
    // `recordsets` holds one entry per SELECT; the last is what we display.
    const sets = res.recordsets as unknown as sql.IRecordSet<Record<string, unknown>>[]
    const last = sets[sets.length - 1]
    if (!last) return { columns: [], rows: [], affected: res.rowsAffected.at(-1), durationMs }
    const columns = Object.keys(last.columns)
    return {
      columns,
      rows: last.map((r) => columns.map((c) => r[c])),
      durationMs
    }
  }

  async tableData(container: string, obj: DbObject, o: TableDataOptions): Promise<TableDataResult> {
    // OFFSET/FETCH requires an ORDER BY; fall back to an arbitrary-but-stable one.
    const order = orderClause(q, o.orderBy) || ' ORDER BY (SELECT NULL)'
    const sqlText =
      `SELECT * FROM ${q(container)}.${q(obj.schema ?? 'dbo')}.${q(obj.name)}${whereClause(o.where)}${order}` +
      ` OFFSET ${o.offset} ROWS FETCH NEXT ${o.limit + 1} ROWS ONLY`
    const r = await this.query(sqlText, null)
    return { columns: r.columns, rows: r.rows.slice(0, o.limit), hasNext: r.rows.length > o.limit, durationMs: r.durationMs }
  }

  async applyChanges(container: string, obj: DbObject, changes: RowChange[]): Promise<void> {
    const stmts = buildStatements(changes, {
      quote: q,
      placeholder: (i) => `@p${i}`,
      table: `${q(container)}.${q(obj.schema ?? 'dbo')}.${q(obj.name)}`,
      emptyInsert: 'DEFAULT VALUES'
    })
    const tx = new sql.Transaction(this.pool)
    await tx.begin()
    try {
      for (const s of stmts) {
        const req = new sql.Request(tx)
        s.params.forEach((v, i) => req.input(`p${i + 1}`, v))
        const res = await req.query(s.sql)
        if (s.expectRow && (res.rowsAffected[0] ?? 0) === 0) throw new Error(ROW_NOT_FOUND)
      }
      await tx.commit()
    } catch (e) {
      await tx.rollback().catch(() => undefined)
      throw e
    }
  }

  async tableDdl(): Promise<string[] | null> {
    return null // no SHOW CREATE TABLE; callers rebuild it from designInfo
  }

  async insertRows(container: string, obj: DbObject, columns: string[], rows: unknown[][], opts: InsertOptions = {}): Promise<number> {
    // A table value constructor allows 1000 rows, and a request 2100 parameters.
    const chunks = buildInsertChunks(columns, rows, { quote: q, placeholder: (i) => `@p${i}`, table: `${q(container)}.${q(obj.schema ?? 'dbo')}.${q(obj.name)}`, emptyInsert: 'DEFAULT VALUES' }, 2000, 1000)
    const tx = opts.transaction === false ? null : new sql.Transaction(this.pool)
    if (tx) await tx.begin()
    // Without our own transaction the caller's BEGIN is on the pool's single connection, so a plain request joins it.
    const request = (): sql.Request => (tx ? new sql.Request(tx) : this.pool.request())
    const target = `${q(container)}.${q(obj.schema ?? 'dbo')}.${q(obj.name)}`
    let current = chunks[0]
    try {
      if (opts.identityInsert) await request().batch(`SET IDENTITY_INSERT ${target} ON`)
      for (const c of chunks) {
        current = c
        const req = request()
        c.params.forEach((v, i) => req.input(`p${i + 1}`, v))
        await req.query(c.sql)
      }
      if (opts.identityInsert) await request().batch(`SET IDENTITY_INSERT ${target} OFF`)
      if (tx) await tx.commit()
      return rows.length
    } catch (e) {
      if (opts.identityInsert) await request().batch(`SET IDENTITY_INSERT ${target} OFF`).catch(() => undefined)
      if (tx) await tx.rollback().catch(() => undefined)
      throw importError(current, e)
    }
  }

  async schemaCompletion(container: string): Promise<Record<string, string[]>> {
    const r = await this.pool
      .request()
      .query(
        `SELECT TABLE_NAME, COLUMN_NAME FROM ${q(container)}.INFORMATION_SCHEMA.COLUMNS
         ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`
      )
    return groupColumns(r.recordset.map((x: { TABLE_NAME: string; COLUMN_NAME: string }) => [x.TABLE_NAME, x.COLUMN_NAME]))
  }
}
