import { deleteFromDdl } from '@shared/ddl'
import { convertDesign, convertValue } from '@shared/convert'
import { quoteIdent } from '@shared/sqlLiteral'
import { orderByDependencies, planNewTable } from '@shared/sync'
import type { DbKind, DbObject, TableDesign, TransferOptions, TransferTableResult } from '@shared/types'
import type { Driver } from './db/driver'
import { pgSequenceFix } from './dump'

const PAGE = 2000
const BEGIN: Record<DbKind, string> = { postgres: 'BEGIN', mysql: 'START TRANSACTION', sqlite: 'BEGIN', mssql: 'BEGIN TRANSACTION' }

export interface Endpoint {
  driver: Driver
  kind: DbKind
  container: string
}

export interface TransferHooks {
  isCancelled(): boolean
  onProgress(done: number, total: number, label: string): void
}

interface Loadable {
  table: DbObject
  target: DbObject
  srcDesign: TableDesign
  targetDesign: TableDesign
  cols: { src: string; dst: string }[]
  indexes: string[]
  foreignKeys: string[]
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Copy tables from one connection to another, across engines if need be. Each table's rows go in one
 * transaction, so a failing table leaves the target as it was; indexes and foreign keys are added after
 * all data is in, which is faster and means table order cannot matter.
 */
export async function transferTables(src: Endpoint, dst: Endpoint, tables: DbObject[], opts: TransferOptions, hooks: TransferHooks): Promise<TransferTableResult[]> {
  const results = new Map<string, TransferTableResult>()
  const dstTables = new Map((await dst.driver.objects(dst.container)).filter((o) => o.type === 'table').map((o) => [o.name.toLowerCase(), o]))
  const designs = new Map<string, TableDesign>()
  for (const t of tables) designs.set(t.name, await src.driver.designInfo(src.container, t))
  const { ordered, cyclic } = orderByDependencies(tables, (t) => (designs.get(t.name)?.foreignKeys ?? []).map((f) => f.refTable))
  const ctxFor = (schema?: string) => ({ kind: dst.kind, container: dst.container, schema: dst.kind === 'mssql' ? (schema ?? 'dbo') : undefined })

  const loadable: Loadable[] = []
  const failedEarly = new Map<string, string>()
  let step = 0
  const total = ordered.length * (opts.copyData ? 2 : 1) + 1

  // ── emptying first, children before parents, so foreign keys do not block the deletes ──
  const truncated = new Set<string>()
  if (opts.ifExists === 'truncate') {
    for (const t of [...ordered].reverse()) {
      const existing = dstTables.get(t.name.toLowerCase())
      if (!existing || hooks.isCancelled()) continue
      try {
        await dst.driver.query(deleteFromDdl(ctxFor(existing.schema), existing.name), dst.container)
        truncated.add(t.name)
      } catch (e) {
        failedEarly.set(t.name, `Could not empty the target table: ${message(e)}`)
      }
    }
  }

  // ── phase 1: make sure every target table exists ──
  for (const t of ordered) {
    if (hooks.isCancelled()) break
    hooks.onProgress(step++, total, `Preparing ${t.name}`)
    const result: TransferTableResult = { table: t.name, status: 'ok', created: false, rows: 0, notes: cyclic.includes(t.name) ? ['Part of a foreign-key cycle; its constraints are added last.'] : [] }
    results.set(t.name, result)
    const srcDesign = designs.get(t.name) as TableDesign
    try {
      if (failedEarly.has(t.name)) throw new Error(failedEarly.get(t.name))
      const existing = dstTables.get(t.name.toLowerCase())
      let target: DbObject
      let targetDesign: TableDesign
      let indexes: string[] = []
      let foreignKeys: string[] = []
      if (existing) {
        if (opts.ifExists === 'skip') {
          result.status = 'skipped'
          result.notes.push('The table already exists in the target; skipped.')
          continue
        }
        target = existing
        targetDesign = await dst.driver.designInfo(dst.container, existing)
      } else {
        if (!opts.createTables) throw new Error('The table does not exist in the target and "create missing tables" is off.')
        const converted = convertDesign(src.kind, dst.kind, srcDesign, src.container)
        result.notes.push(...converted.notes)
        const plan = planNewTable(ctxFor(), converted.design, { sourceContainer: src.container })
        if (plan.errors.length) throw new Error(plan.errors[0])
        result.notes.push(...plan.notes)
        await dst.driver.executeDdl(dst.container, [plan.statements[0]])
        indexes = plan.statements.slice(1)
        foreignKeys = plan.foreignKeys
        result.created = true
        target = { name: t.name, type: 'table', schema: dst.kind === 'postgres' ? dst.container : dst.kind === 'mssql' ? 'dbo' : undefined }
        targetDesign = await dst.driver.designInfo(dst.container, target)
      }

      const targetCols = new Map(targetDesign.columns.filter((c) => !c.locked).map((c) => [c.name.toLowerCase(), c.name]))
      const cols = srcDesign.columns.filter((c) => !c.locked && targetCols.has(c.name.toLowerCase())).map((c) => ({ src: c.name, dst: targetCols.get(c.name.toLowerCase()) as string }))
      const missing = srcDesign.columns.filter((c) => !c.locked && !targetCols.has(c.name.toLowerCase())).map((c) => c.name)
      if (missing.length) result.notes.push(`Columns missing from the target were skipped: ${missing.join(', ')}.`)
      if (cols.length === 0) throw new Error('No columns of the source exist in the target table.')
      loadable.push({ table: t, target, srcDesign, targetDesign, cols, indexes, foreignKeys })
    } catch (e) {
      result.status = 'failed'
      result.error = message(e)
    }
  }

  // ── phase 2: copy the rows, one transaction per table ──
  if (opts.copyData) {
    for (const L of loadable) {
      const result = results.get(L.table.name) as TransferTableResult
      if (hooks.isCancelled()) {
        result.status = 'failed'
        result.error = 'Cancelled before this table was copied.'
        continue
      }
      hooks.onProgress(step++, total, `Copying ${L.table.name}`)
      const pk = L.srcDesign.columns.find((c) => c.primaryKey)
      const writes = new Set(L.cols.map((c) => c.dst))
      const identity = L.targetDesign.columns.some((c) => c.autoIncrement && writes.has(c.name))
      await dst.driver.query(BEGIN[dst.kind], dst.container)
      try {
        for (let offset = 0; ; offset += PAGE) {
          if (hooks.isCancelled()) throw new Error('Cancelled; this table was rolled back.')
          // A stable order matters: OFFSET paging over an unordered query can skip or repeat rows.
          const page = await src.driver.tableData(src.container, L.table, { limit: PAGE, offset, orderBy: pk ? { column: pk.name, dir: 'asc' } : undefined })
          if (page.rows.length === 0) break
          const idx = L.cols.map((c) => page.columns.indexOf(c.src))
          const rows = page.rows.map((r) => idx.map((i) => convertValue(r[i], src.kind, dst.kind)))
          await dst.driver.insertRows(dst.container, L.target, L.cols.map((c) => c.dst), rows, { transaction: false, identityInsert: identity })
          result.rows += rows.length
          hooks.onProgress(step - 1, total, `Copying ${L.table.name}: ${result.rows.toLocaleString()} rows`)
          if (!page.hasNext) break
        }
        await dst.driver.query('COMMIT', null)
        if (dst.kind === 'postgres') {
          const ref = `${quoteIdent('postgres', dst.container)}.${quoteIdent('postgres', L.target.name)}`
          for (const c of L.targetDesign.columns) {
            if (c.autoIncrement || /^nextval\(/i.test(c.defaultValue ?? '')) await dst.driver.query(pgSequenceFix(ref, c.name), null)
          }
        }
      } catch (e) {
        await dst.driver.query('ROLLBACK', null).catch(() => undefined)
        result.rows = 0
        result.status = 'failed'
        result.error = message(e)
      }
    }
  }

  // ── phase 3: indexes, then foreign keys, for the tables we created and filled ──
  hooks.onProgress(step++, total, 'Adding indexes and foreign keys')
  for (const L of loadable) {
    const result = results.get(L.table.name) as TransferTableResult
    if (result.status !== 'ok' || !result.created) continue
    if (L.indexes.length) {
      try {
        await dst.driver.executeDdl(dst.container, L.indexes)
      } catch (e) {
        result.notes.push(`Indexes could not be created: ${message(e)}`)
      }
    }
  }
  for (const L of loadable) {
    const result = results.get(L.table.name) as TransferTableResult
    if (result.status !== 'ok' || !result.created || L.foreignKeys.length === 0) continue
    try {
      await dst.driver.executeDdl(dst.container, L.foreignKeys)
    } catch (e) {
      result.notes.push(`Foreign keys could not be created: ${message(e)}`)
    }
  }
  hooks.onProgress(total, total, 'Done')
  return tables.map((t) => results.get(t.name) ?? { table: t.name, status: 'failed', created: false, rows: 0, notes: [], error: 'Cancelled before this table was prepared.' })
}
