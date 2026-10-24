import pg from 'pg'
import type {
  ConnectionConfig,
  ColumnInfo,
  DbObject,
  QueryResult,
  RowChange,
  TableDataOptions,
  FkAction,
  TableDataResult,
  TableDesign
} from '@shared/types'
import { groupColumns, PREVIEW_LIMIT, quoteWith, type Driver, type InsertOptions } from './driver'
import { buildInsertChunks, buildStatements, importError, orderClause, ROW_NOT_FOUND, whereClause } from './sqlbuild'

const q = (id: string): string => quoteWith('"', '"', id)

// date, time, timestamp, timestamptz, timetz, json, jsonb: keep the server's text so values display and copy
// exactly as stored. No JS Date round-trip or timezone shift; json keeps its spacing and key order; and a JSON
// `null` stays distinguishable from SQL NULL, which a parsed value could not.
const RAW_TEXT_OIDS = new Set([114, 3802, 1082, 1083, 1114, 1184, 1266])

export class PostgresDriver implements Driver {
  private client: pg.Client
  private config: pg.ClientConfig

  constructor(cfg: ConnectionConfig) {
    this.config = {
      host: cfg.host,
      port: cfg.port ?? 5432,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database || undefined,
      ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
      types: {
        getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
          RAW_TEXT_OIDS.has(oid) ? (v: string) => v : pg.types.getTypeParser(oid, format as 'text')) as typeof pg.types.getTypeParser
      }
    }
    this.client = new pg.Client(this.config)
  }

  async connect(): Promise<void> {
    await this.client.connect()
  }

  async close(): Promise<void> {
    await this.client.end()
  }

  async cancel(): Promise<void> {
    // The wire protocol cancels via a second connection that names the backend.
    const pid = (this.client as unknown as { processID?: number }).processID
    if (!pid) throw new Error('Backend process id unknown')
    const other = new pg.Client(this.config)
    await other.connect()
    try {
      await other.query('SELECT pg_cancel_backend($1)', [pid])
    } finally {
      await other.end()
    }
  }

  async containers(): Promise<string[]> {
    const r = await this.client.query<{ schema_name: string }>(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name NOT LIKE 'pg\\_%' AND schema_name <> 'information_schema'
       ORDER BY schema_name`
    )
    return r.rows.map((x) => x.schema_name)
  }

  async objects(container: string): Promise<DbObject[]> {
    const r = await this.client.query<{ table_name: string; table_type: string }>(
      `SELECT table_name, table_type FROM information_schema.tables
       WHERE table_schema = $1 ORDER BY table_name`,
      [container]
    )
    const out: DbObject[] = r.rows.map((x) => ({
      schema: container,
      name: x.table_name,
      type: x.table_type === 'VIEW' ? 'view' : 'table'
    }))

    // information_schema.tables does not list materialized views.
    const mv = await this.client.query<{ matviewname: string }>(
      'SELECT matviewname FROM pg_matviews WHERE schemaname = $1 ORDER BY matviewname',
      [container]
    )
    for (const x of mv.rows) out.push({ schema: container, name: x.matviewname, type: 'matview' })

    // Functions and procedures, minus those that belong to an installed extension.
    const fn = await this.client.query<{ proname: string; args: string; prokind: string }>(
      `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prokind
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = $1 AND p.prokind IN ('f', 'p')
         AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
       ORDER BY p.proname, args`,
      [container]
    )
    for (const x of fn.rows) {
      out.push({
        schema: container,
        name: x.proname,
        args: x.args,
        type: 'function',
        routine: x.prokind === 'p' ? 'procedure' : 'function'
      })
    }
    return out
  }

  async definition(container: string, obj: DbObject): Promise<string> {
    if (obj.type === 'function') {
      const r = await this.client.query<{ def: string }>(
        `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = $1 AND p.proname = $2 AND pg_get_function_identity_arguments(p.oid) = $3`,
        [container, obj.name, obj.args ?? '']
      )
      if (!r.rows[0]) throw new Error('Function not found')
      return r.rows[0].def
    }
    const r = await this.client.query<{ def: string }>(
      `SELECT pg_get_viewdef(c.oid, true) AS def FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = $2`,
      [container, obj.name]
    )
    if (!r.rows[0]) throw new Error('Object not found')
    const kind = obj.type === 'matview' ? 'MATERIALIZED VIEW' : 'OR REPLACE VIEW'
    return `CREATE ${kind} ${q(container)}.${q(obj.name)} AS\n${r.rows[0].def}`
  }

  async designInfo(container: string, obj: DbObject): Promise<TableDesign> {
    const cols = await this.client.query(
      `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable,
              pg_get_expr(d.adbin, d.adrelid) AS def, a.attidentity AS ident, a.attgenerated AS gen
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attnum`,
      [container, obj.name]
    )
    const pk = await this.client.query<{ conname: string; attname: string }>(
      `SELECT con.conname, a.attname::text AS attname
       FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
       WHERE con.contype = 'p' AND n.nspname = $1 AND c.relname = $2 ORDER BY k.ord`,
      [container, obj.name]
    )
    const ix = await this.client.query<{ name: string; uniq: boolean; locked: boolean; ucon: boolean; cols: (string | null)[]; def: string }>(
      `SELECT i.relname AS name, ix.indisunique AS uniq, pg_get_indexdef(ix.indexrelid) AS def,
              EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = ix.indexrelid AND k.contype = 'u') AS ucon,
              (ix.indexprs IS NOT NULL OR ix.indpred IS NOT NULL OR am.amname <> 'btree' OR ix.indnatts <> ix.indnkeyatts
               OR EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = ix.indexrelid)) AS locked,
              ARRAY(SELECT a.attname::text FROM unnest(ix.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
                    LEFT JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum ORDER BY k.ord) AS cols
       FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace JOIN pg_am am ON am.oid = i.relam
       WHERE n.nspname = $1 AND t.relname = $2 AND NOT ix.indisprimary ORDER BY i.relname`,
      [container, obj.name]
    )
    const fk = await this.client.query<{
      conname: string
      confupdtype: string
      confdeltype: string
      condeferrable: boolean
      confmatchtype: string
      cols: string[]
      ref_schema: string
      ref_table: string
      ref_cols: string[]
    }>(
      `SELECT con.conname, con.confupdtype, con.confdeltype, con.condeferrable, con.confmatchtype,
              ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum ORDER BY k.ord) AS cols,
              rn.nspname AS ref_schema, rc.relname AS ref_table,
              ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
                    JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum ORDER BY k.ord) AS ref_cols
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_class rc ON rc.oid = con.confrelid JOIN pg_namespace rn ON rn.oid = rc.relnamespace
       WHERE con.contype = 'f' AND n.nspname = $1 AND c.relname = $2 ORDER BY con.conname`,
      [container, obj.name]
    )
    const action = (c: string): FkAction => (c === 'r' ? 'RESTRICT' : c === 'c' ? 'CASCADE' : c === 'n' ? 'SET NULL' : c === 'd' ? 'SET DEFAULT' : 'NO ACTION')
    const pkNames = new Set(pk.rows.map((r) => r.attname))
    return {
      name: obj.name,
      pkName: pk.rows[0]?.conname,
      foreignKeys: fk.rows.map((r) => ({
        id: crypto.randomUUID(),
        originalName: r.conname,
        name: r.conname,
        columns: r.cols,
        refSchema: r.ref_schema,
        refTable: r.ref_table,
        refColumns: r.ref_cols,
        onDelete: action(r.confdeltype),
        onUpdate: action(r.confupdtype),
        // DEFERRABLE and MATCH FULL are not modelled, so such keys are left alone.
        locked: r.condeferrable || r.confmatchtype !== 's' || undefined
      })),
      columns: cols.rows.map((r) => {
        const generated = r.gen !== ''
        const identity = r.ident === 'a' || r.ident === 'd'
        return {
          id: crypto.randomUUID(),
          originalName: r.attname,
          name: r.attname,
          type: r.type,
          nullable: r.nullable,
          primaryKey: pkNames.has(r.attname),
          defaultValue: generated || identity ? null : r.def,
          autoIncrement: identity,
          locked: generated || undefined,
          generated: generated && r.def ? { expr: r.def, stored: r.gen === 's' } : undefined
        }
      }),
      indexes: ix.rows.map((r) => ({
        id: crypto.randomUUID(),
        originalName: r.name,
        name: r.name,
        columns: r.cols.filter((c): c is string => c !== null),
        unique: r.uniq,
        // Expression columns come back as NULL; such indexes are left alone.
        locked: r.locked || r.cols.some((c) => c === null) || undefined,
        constraint: (r.ucon && r.cols.every((c) => c !== null)) || undefined,
        definition: r.def
      }))
    }
  }

  async executeDdl(_container: string, statements: string[]): Promise<void> {
    // PostgreSQL DDL is transactional, so a failure leaves the table untouched.
    await this.client.query('BEGIN')
    try {
      for (const s of statements) await this.client.query(s)
      await this.client.query('COMMIT')
    } catch (e) {
      await this.client.query('ROLLBACK').catch(() => undefined)
      throw e
    }
  }

  async describe(container: string, obj: DbObject): Promise<ColumnInfo[]> {
    if (obj.type === 'matview') {
      // Materialized views are absent from information_schema.columns; read the catalog.
      const r = await this.client.query(
        `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attnum`,
        [container, obj.name]
      )
      return r.rows.map((x) => ({ name: x.attname, type: x.type, nullable: x.nullable, primaryKey: false, defaultValue: null }))
    }
    const r = await this.client.query(
      `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
              EXISTS (
                SELECT 1 FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage k
                  ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema
                WHERE tc.constraint_type = 'PRIMARY KEY'
                  AND tc.table_schema = c.table_schema AND tc.table_name = c.table_name
                  AND k.column_name = c.column_name
              ) AS is_pk
       FROM information_schema.columns c
       WHERE c.table_schema = $1 AND c.table_name = $2
       ORDER BY c.ordinal_position`,
      [container, obj.name]
    )
    return r.rows.map((x) => ({
      name: x.column_name,
      type: x.data_type,
      nullable: x.is_nullable === 'YES',
      primaryKey: x.is_pk,
      defaultValue: x.column_default
    }))
  }

  previewSql(container: string, obj: DbObject): string {
    return `SELECT * FROM ${q(container)}.${q(obj.name)} LIMIT ${PREVIEW_LIMIT}`
  }

  async query(sql: string, container: string | null): Promise<QueryResult> {
    if (container) await this.client.query(`SET search_path TO ${q(container)}`)
    const started = Date.now()
    const res = await this.client.query({ text: sql, rowMode: 'array' })
    // Multiple statements return an array of results; show the last one.
    const last: pg.QueryArrayResult = Array.isArray(res) ? res[res.length - 1] : res
    return {
      columns: last.fields.map((f) => f.name),
      rows: last.rows as unknown[][],
      affected: last.fields.length === 0 ? (last.rowCount ?? undefined) : undefined,
      durationMs: Date.now() - started
    }
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
      placeholder: (i) => `$${i}`,
      table: `${q(container)}.${q(obj.name)}`,
      emptyInsert: 'DEFAULT VALUES'
    })
    await this.client.query('BEGIN')
    try {
      for (const s of stmts) {
        const r = await this.client.query(s.sql, s.params as unknown[])
        if (s.expectRow && r.rowCount === 0) throw new Error(ROW_NOT_FOUND)
      }
      await this.client.query('COMMIT')
    } catch (e) {
      await this.client.query('ROLLBACK').catch(() => undefined)
      throw e
    }
  }

  async tableDdl(): Promise<string[] | null> {
    return null // PostgreSQL has no SHOW CREATE TABLE; callers rebuild it from designInfo
  }

  async insertRows(container: string, obj: DbObject, columns: string[], rows: unknown[][], opts: InsertOptions = {}): Promise<number> {
    const own = opts.transaction !== false
    const chunks = buildInsertChunks(columns, rows, { quote: q, placeholder: (i) => `$${i}`, table: `${q(container)}.${q(obj.name)}`, emptyInsert: 'DEFAULT VALUES' }, 60000, 1000)
    if (own) await this.client.query('BEGIN')
    let current = chunks[0]
    try {
      for (const c of chunks) {
        current = c
        await this.client.query(c.sql, c.params as unknown[])
      }
      if (own) await this.client.query('COMMIT')
      return rows.length
    } catch (e) {
      if (own) await this.client.query('ROLLBACK').catch(() => undefined)
      throw importError(current, e)
    }
  }

  async schemaCompletion(container: string): Promise<Record<string, string[]>> {
    const r = await this.client.query({
      text: `SELECT table_name, column_name FROM information_schema.columns
             WHERE table_schema = $1 ORDER BY table_name, ordinal_position`,
      values: [container],
      rowMode: 'array'
    })
    return groupColumns(r.rows as [string, string][])
  }
}
