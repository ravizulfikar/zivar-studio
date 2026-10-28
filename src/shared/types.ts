import type { UpdateResult } from './updates'

export type DbKind = 'postgres' | 'mysql' | 'sqlite' | 'mssql'

export interface SshConfig {
  enabled: boolean
  host: string
  port: number
  user: string
  authType: 'password' | 'key'
  password?: string
  /** Path to a private key file on this machine. */
  keyPath?: string
  passphrase?: string
}

export interface ConnectionConfig {
  id: string
  name: string
  kind: DbKind
  host?: string
  port?: number
  user?: string
  password?: string
  /** Database name; for SQLite this is the file path. */
  database?: string
  ssl?: boolean
  ssh?: SshConfig
  /** Folder in the sidebar tree. */
  group?: string
  /** Hex tint for the connection row (e.g. to flag production). */
  color?: string
}

export type DbObjectType = 'table' | 'view' | 'matview' | 'function'

export interface DbObject {
  schema?: string
  name: string
  type: DbObjectType
  /** Functions only: argument signature, to tell overloads apart (PostgreSQL). */
  args?: string
  /** Functions only: stored procedures are listed with functions. */
  routine?: 'function' | 'procedure'
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
  defaultValue: string | null
}

export interface DesignColumn {
  /** Stable key for the editor; not stored anywhere. */
  id: string
  /** Name in the database; null for a column added in the designer. */
  originalName: string | null
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
  /** Raw SQL expression exactly as it follows DEFAULT (e.g. 0, 'x', now()). */
  defaultValue: string | null
  autoIncrement: boolean
  /** MySQL: collation when it differs from the table's. */
  collation?: string
  /** Engine-specific attributes kept verbatim so editing a column does not drop them (MySQL ON UPDATE / COMMENT). */
  extra?: string
  /** Cannot be changed safely (generated columns, existing identity columns). */
  locked?: boolean
  /** Generated / computed column: its expression, so that a table built from this model keeps it. */
  generated?: { expr: string; stored: boolean }
  /** SQL Server: name of the DEFAULT constraint, needed to change or drop it. */
  defaultConstraint?: string
}

export interface DesignIndex {
  id: string
  originalName: string | null
  name: string
  columns: string[]
  unique: boolean
  /** Engine-reported CREATE INDEX text, kept for indexes the model cannot express (used by dumps). */
  definition?: string
  /** Expression, partial, prefix, full-text… indexes are shown but left untouched. */
  locked?: boolean
  /** Backed by a UNIQUE constraint: not editable in place, but its column list is exact, so it can be copied as a unique index. */
  constraint?: boolean
}

export type FkAction = 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT'

export interface DesignForeignKey {
  id: string
  originalName: string | null
  name: string
  /** Columns of this table, in order. */
  columns: string[]
  /** Schema (PostgreSQL, SQL Server) or database (MySQL) of the referenced table; blank = same as this table. */
  refSchema?: string
  refTable: string
  refColumns: string[]
  onDelete: FkAction
  onUpdate: FkAction
  /** Deferrable, MATCH FULL, unnamed (SQLite)… shown but left untouched. */
  locked?: boolean
}

export interface TableDesign {
  name: string
  columns: DesignColumn[]
  indexes: DesignIndex[]
  foreignKeys?: DesignForeignKey[]
  /** Existing primary-key constraint name (PostgreSQL, SQL Server). */
  pkName?: string
}

export interface DdlPlan {
  statements: string[]
  warnings: string[]
  /** Problems that must be fixed before the plan can be applied. */
  errors: string[]
}

export interface QueryResult {
  columns: string[]
  rows: unknown[][]
  /** Rows changed by INSERT/UPDATE/DELETE, when the driver reports it. */
  affected?: number
  durationMs: number
}

export interface OrderBy {
  column: string
  dir: 'asc' | 'desc'
}

export interface TableDataOptions {
  limit: number
  offset: number
  /** One column, or several (the first one counts most). */
  orderBy?: OrderBy | OrderBy[]
  /** Raw SQL condition typed by the user (without the WHERE keyword). */
  where?: string
}

export interface TableDataResult {
  columns: string[]
  rows: unknown[][]
  /** True when at least one more row exists after this page. */
  hasNext: boolean
  durationMs: number
}

/** One pending edit. `key` holds the original primary-key values of the row. */
export type RowChange =
  | { type: 'update'; key: Record<string, unknown>; values: Record<string, unknown> }
  | { type: 'insert'; values: Record<string, unknown> }
  | { type: 'delete'; key: Record<string, unknown> }

export interface HistoryEntry {
  id: string
  connName: string
  container: string | null
  sql: string
  at: number
  durationMs: number
  ok: boolean
}

export interface SavedQuery {
  id: string
  name: string
  sql: string
  at: number
  /** Which connection/database the query belongs to; absent on queries saved by older versions. */
  connId?: string
  connName?: string
  /** null = usable in any database of the connection. */
  container?: string | null
}

export interface Snippet {
  id: string
  name: string
  body: string
  at: number
}

export interface SavedQueryInput {
  /** Pass an existing id to overwrite that query instead of adding a new one. */
  id?: string
  name: string
  sql: string
  connId: string
  connName: string
  container: string | null
}

export interface ScriptStatement {
  text: string
  /** 1-based line in the file where the statement's code starts. */
  line: number
}

export interface ScriptOptions {
  /** Stop at the first failing statement instead of carrying on. */
  stopOnError: boolean
  /** Run everything in one transaction; implies stopping at the first error. */
  transaction: boolean
}

export interface ScriptFailure {
  index: number
  line: number
  statement: string
  error: string
}

export interface ScriptResult {
  total: number
  executed: number
  failures: ScriptFailure[]
  cancelled: boolean
  rolledBack: boolean
  durationMs: number
}

export interface DumpOptions {
  structure: boolean
  data: boolean
  /** Emit DROP TABLE IF EXISTS before each CREATE TABLE. */
  dropExisting: boolean
  /** Prefix table names with their database/schema (otherwise the file loads into whichever one is selected). */
  qualified: boolean
}

export interface DumpResult {
  path: string
  tables: number
  rows: number
  bytes: number
  /** Things the dump could not carry over faithfully. */
  notes: string[]
}

export interface ProgressEvent {
  done: number
  total: number
  label?: string
}

export interface TransferOptions {
  /** Create tables that do not exist in the target (types are translated for the target engine). */
  createTables: boolean
  /** What to do with a table that already exists in the target. */
  ifExists: 'append' | 'truncate' | 'skip'
  /** false: structure only. */
  copyData: boolean
}

export interface TransferEndpoint {
  connId: string
  container: string
}

export interface TransferTableResult {
  table: string
  status: 'ok' | 'skipped' | 'failed'
  created: boolean
  rows: number
  notes: string[]
  error?: string
}

export type ProgressChannel = 'script:progress' | 'dump:progress' | 'transfer:progress'

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface Api {
  /** Asks GitHub for the latest release. `auto` marks the check the app makes by itself on start-up. */
  checkForUpdates(auto: boolean): Promise<IpcResult<UpdateResult>>
  listConnections(): Promise<IpcResult<ConnectionConfig[]>>
  saveConnection(cfg: ConnectionConfig): Promise<IpcResult<void>>
  deleteConnection(id: string): Promise<IpcResult<void>>
  testConnection(cfg: ConnectionConfig): Promise<IpcResult<void>>
  pickSqliteFile(): Promise<string | null>
  pickFile(title: string): Promise<string | null>

  open(id: string): Promise<IpcResult<void>>
  close(id: string): Promise<IpcResult<void>>
  containers(id: string): Promise<IpcResult<string[]>>
  objects(id: string, container: string): Promise<IpcResult<DbObject[]>>
  describe(id: string, container: string, obj: DbObject): Promise<IpcResult<ColumnInfo[]>>
  /** Full column/index model of a table for the designer. */
  designInfo(id: string, container: string, obj: DbObject): Promise<IpcResult<TableDesign>>
  /** Run DDL statements as one unit (transactional where the engine allows it). */
  executeDdl(id: string, container: string, statements: string[]): Promise<IpcResult<void>>
  /** CREATE statement / source text of a view, materialized view or function. */
  definition(id: string, container: string, obj: DbObject): Promise<IpcResult<string>>
  previewSql(id: string, container: string, obj: DbObject): Promise<IpcResult<string>>
  query(id: string, container: string | null, sql: string): Promise<IpcResult<QueryResult>>
  cancel(id: string): Promise<IpcResult<void>>

  tableData(id: string, container: string, obj: DbObject, opts: TableDataOptions): Promise<IpcResult<TableDataResult>>
  applyChanges(id: string, container: string, obj: DbObject, changes: RowChange[]): Promise<IpcResult<void>>
  /** Insert rows (all or nothing) into a table; returns the count inserted. */
  insertRows(id: string, container: string, obj: DbObject, columns: string[], rows: unknown[][]): Promise<IpcResult<number>>
  runScript(id: string, container: string | null, statements: ScriptStatement[], opts: ScriptOptions): Promise<IpcResult<ScriptResult>>
  cancelScript(id: string): Promise<IpcResult<void>>
  /** Ask where to save, then write a SQL dump of the tables; null when the user cancels the dialog. */
  dumpSql(id: string, container: string, tables: DbObject[], opts: DumpOptions, defaultName: string): Promise<IpcResult<DumpResult | null>>
  /** Copy tables between two connections (possibly different engines). Stop it with cancelScript on the target. */
  transfer(src: TransferEndpoint, dst: TransferEndpoint, tables: DbObject[], opts: TransferOptions): Promise<IpcResult<TransferTableResult[]>>
  /** Progress notifications from long-running main-process jobs; returns an unsubscribe function. */
  onProgress(channel: ProgressChannel, cb: (e: ProgressEvent) => void): () => void
  /** table name -> column names, for editor autocomplete. */
  schemaCompletion(id: string, container: string): Promise<IpcResult<Record<string, string[]>>>

  historyList(): Promise<IpcResult<HistoryEntry[]>>
  historyAdd(e: Omit<HistoryEntry, 'id'>): Promise<IpcResult<void>>
  historyClear(): Promise<IpcResult<void>>
  savedList(): Promise<IpcResult<SavedQuery[]>>
  savedSave(q: SavedQueryInput): Promise<IpcResult<string>>
  savedDelete(id: string): Promise<IpcResult<void>>
  snippetsList(): Promise<IpcResult<Snippet[]>>
  snippetSave(name: string, body: string): Promise<IpcResult<void>>
  snippetDelete(id: string): Promise<IpcResult<void>>
}
