import type { ColumnInfo, DbObject, QueryResult, RowChange, TableDataOptions, TableDataResult, TableDesign } from '@shared/types'

/**
 * Common surface every database backend implements. A "container" is the
 * top-level namespace shown in the tree: a schema for PostgreSQL, a database
 * for MySQL/SQL Server, and "main" for SQLite.
 */
export interface Driver {
  connect(): Promise<void>
  close(): Promise<void>
  containers(): Promise<string[]>
  objects(container: string): Promise<DbObject[]>
  describe(container: string, obj: DbObject): Promise<ColumnInfo[]>
  /** Source text of a view, materialized view or function. */
  definition(container: string, obj: DbObject): Promise<string>
  /** Columns and indexes of a table in the shape the designer edits. */
  designInfo(container: string, obj: DbObject): Promise<TableDesign>
  /** Run DDL as one unit: all-or-nothing where the engine has transactional DDL. */
  executeDdl(container: string, statements: string[]): Promise<void>
  previewSql(container: string, obj: DbObject): string
  /** Run arbitrary SQL, optionally scoped to a container. Returns the last result set. */
  query(sql: string, container: string | null): Promise<QueryResult>
  /** Abort the statement currently running on this connection. */
  cancel(): Promise<void>
  /** One page of a table, with optional server-side sort and raw WHERE filter. */
  tableData(container: string, obj: DbObject, opts: TableDataOptions): Promise<TableDataResult>
  /** Apply all changes in a single transaction; rolls back and throws on the first failure. */
  applyChanges(container: string, obj: DbObject, changes: RowChange[]): Promise<void>
  /** The engine's own CREATE statements for a table and its indexes, when it can produce them exactly (MySQL, SQLite); null otherwise. */
  tableDdl(container: string, obj: DbObject): Promise<string[] | null>
  /** Insert many rows in one all-or-nothing transaction; returns how many were inserted. */
  insertRows(container: string, obj: DbObject, columns: string[], rows: unknown[][], opts?: InsertOptions): Promise<number>
  /** table -> columns for every table in the container (powers autocomplete). */
  schemaCompletion(container: string): Promise<Record<string, string[]>>
}

export interface InsertOptions {
  /** false: the caller already opened a transaction (a multi-page transfer), so don't start or end one. Default true. */
  transaction?: boolean
  /** Write explicit values into identity / auto-increment columns (SQL Server needs IDENTITY_INSERT for that). */
  identityInsert?: boolean
}

export const PREVIEW_LIMIT = 200
/** Upper bound on tables sent to the editor for autocomplete. */
export const MAX_COMPLETION_TABLES = 3000

export function quoteWith(open: string, close: string, id: string): string {
  return open + id.split(close).join(close + close) + close
}

export function groupColumns(rows: [string, string][]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [table, column] of rows) {
    if (!(table in out)) {
      if (Object.keys(out).length >= MAX_COMPLETION_TABLES) continue
      out[table] = []
    }
    out[table].push(column)
  }
  return out
}
