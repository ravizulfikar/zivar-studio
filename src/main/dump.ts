import { once } from 'node:events'
import { createWriteStream, rmSync } from 'node:fs'
import { planDdl } from '@shared/ddl'
import { orderByDependencies } from '@shared/sync'
import { insertStatement, quoteIdent } from '@shared/sqlLiteral'
import type { DbKind, DbObject, DesignIndex, DumpOptions, DumpResult, TableDesign } from '@shared/types'
import type { Driver } from './db/driver'

const PAGE = 1000
const INSERT_BATCH = 200

export interface DumpHooks {
  isCancelled(): boolean
  onProgress(done: number, total: number, label: string): void
}

function tableRef(kind: DbKind, container: string, schema: string | undefined, name: string, qualified: boolean): string {
  const q = (s: string): string => quoteIdent(kind, s)
  if (kind === 'sqlite') return q(name)
  if (kind === 'mssql') return qualified ? `${q(container)}.${q(schema ?? 'dbo')}.${q(name)}` : `${q(schema ?? 'dbo')}.${q(name)}`
  return qualified ? `${q(container)}.${q(name)}` : q(name)
}

/** MySQL's SHOW CREATE TABLE is unqualified; add the database when the dump asks for qualified names. */
function qualifyMysqlCreate(ddl: string, container: string, name: string): string {
  const bare = quoteIdent('mysql', name)
  return ddl.replace(`CREATE TABLE ${bare}`, `CREATE TABLE ${quoteIdent('mysql', container)}.${bare}`)
}

/** pg_get_indexdef spells the table schema-qualified; drop that when the dump is unqualified. */
function unqualifyPgIndex(def: string, container: string): string {
  const esc = container.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return def.replace(new RegExp(` ON (ONLY )?("?)${esc}\\2\\.`), ' ON $1')
}

function dropStatement(kind: DbKind, ref: string): string {
  return kind === 'mssql' ? `IF OBJECT_ID(N'${ref.replace(/'/g, "''")}', N'U') IS NOT NULL DROP TABLE ${ref}` : `DROP TABLE IF EXISTS ${ref}`
}

/** After loading explicit ids, PostgreSQL sequences must be moved past them or the next INSERT collides. */
export function pgSequenceFix(ref: string, col: string): string {
  const qc = quoteIdent('postgres', col)
  const regclass = ref.replace(/'/g, "''")
  return `SELECT setval(pg_get_serial_sequence('${regclass}', '${col.replace(/'/g, "''")}'), COALESCE((SELECT MAX(${qc}) FROM ${ref}), 1), (SELECT MAX(${qc}) IS NOT NULL FROM ${ref}))`
}

export async function dumpSql(
  d: Driver,
  kind: DbKind,
  container: string,
  tables: DbObject[],
  opts: DumpOptions,
  filePath: string,
  hooks: DumpHooks
): Promise<DumpResult> {
  const out = createWriteStream(filePath, { encoding: 'utf8' })
  let bytes = 0
  let rowCount = 0
  const notes: string[] = []
  const write = async (text: string): Promise<void> => {
    bytes += Buffer.byteLength(text)
    if (!out.write(text)) await once(out, 'drain')
  }
  const stmt = (s: string): Promise<void> => write(`${s};\n`)

  try {
    await write(`-- Zivar Studio SQL dump\n-- Engine: ${kind}\n-- Source: ${container}\n-- Generated: ${new Date().toISOString()}\n-- Tables: ${tables.length}\n\n`)
    if (kind === 'postgres') {
      await stmt("SET client_encoding = 'UTF8'")
      if (opts.qualified) await stmt(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(kind, container)}`)
    } else if (kind === 'mysql') {
      await write('SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\nSET UNIQUE_CHECKS = 0;\n')
      if (opts.qualified) await stmt(`CREATE DATABASE IF NOT EXISTS ${quoteIdent(kind, container)}`)
    } else if (kind === 'sqlite') {
      await stmt('PRAGMA foreign_keys = OFF')
    }
    await write('\n')

    const designs = new Map<string, TableDesign>()
    for (const t of tables) designs.set(t.name, await d.designInfo(container, t))
    // Parents before children, so a data-only dump loads into tables that already have their foreign keys.
    const sorted = orderByDependencies(tables, (t) => (designs.get(t.name)?.foreignKeys ?? []).map((fk) => fk.refTable))
    const ordered = sorted.ordered
    if (sorted.cyclic.length) notes.push(`Tables ${sorted.cyclic.join(', ')} reference each other in a cycle; their data may need foreign keys switched off when restoring.`)

    const afterData: string[] = [] // indexes and foreign keys come after the data, which loads faster and avoids ordering problems
    const deferFks = kind !== 'sqlite' && kind !== 'mysql'

    // ── structure ──
    if (opts.structure) {
      if (opts.dropExisting) {
        // Children first: PostgreSQL will not drop a table that another table's foreign key still points at.
        for (const t of [...ordered].reverse()) await stmt(dropStatement(kind, tableRef(kind, container, t.schema, t.name, opts.qualified)))
        await write('\n')
      }
      for (const t of ordered) {
        if (hooks.isCancelled()) throw new Error('Dump cancelled')
        const design = designs.get(t.name) as TableDesign
        const ref = tableRef(kind, container, t.schema, t.name, opts.qualified)
        await write(`-- Table ${t.name}\n`)

        const native = await d.tableDdl(container, t)
        if (native) {
          // The engine's own text is the most faithful; MySQL needs foreign_key_checks=0 (set above) for forward references.
          const statements = native.map((s, i) => (i === 0 && kind === 'mysql' && opts.qualified ? qualifyMysqlCreate(s, container, t.name) : s))
          for (const s of statements) await stmt(s.replace(/;\s*$/, ''))
          await write('\n')
          continue
        }

        const modelled: DesignIndex[] = design.indexes.filter((i) => !i.locked)
        const full: TableDesign = { ...design, indexes: modelled, foreignKeys: deferFks ? [] : design.foreignKeys }
        const ctx = { kind, container, schema: t.schema, unqualified: !opts.qualified }
        const plan = planDdl(ctx, null, full)
        if (plan.errors.length) throw new Error(`Cannot write the structure of ${t.name}: ${plan.errors[0]}`)
        await stmt(plan.statements[0])
        afterData.push(...plan.statements.slice(1))

        for (const ix of design.indexes.filter((i) => i.locked)) {
          if (kind === 'postgres' && ix.definition) afterData.push(opts.qualified ? ix.definition : unqualifyPgIndex(ix.definition, container))
          else notes.push(`Index "${ix.name}" on ${t.name} (expression, partial or constraint-backed) was not included.`)
        }
        if (deferFks && design.foreignKeys?.length) {
          const base: TableDesign = { ...design, indexes: [], foreignKeys: [] }
          const fkPlan = planDdl(ctx, base, { ...design, indexes: [], foreignKeys: design.foreignKeys })
          afterData.push(...fkPlan.statements)
          if (fkPlan.errors.length) notes.push(`Foreign keys of ${t.name} could not be written: ${fkPlan.errors[0]}`)
        }
        await write('\n')
      }
    }

    // ── data ──
    if (opts.data) {
      let done = 0
      for (const t of ordered) {
        if (hooks.isCancelled()) throw new Error('Dump cancelled')
        const design = designs.get(t.name) as TableDesign
        const ref = tableRef(kind, container, t.schema, t.name, opts.qualified)
        const writable = design.columns.filter((c) => !c.locked).map((c) => c.name) // generated columns cannot be inserted into
        const pk = design.columns.find((c) => c.primaryKey)
        const identity = design.columns.some((c) => c.autoIncrement && writable.includes(c.name))
        let tableRows = 0
        let headerWritten = false

        for (let offset = 0; ; offset += PAGE) {
          if (hooks.isCancelled()) throw new Error('Dump cancelled')
          // A stable order matters: OFFSET paging over an unordered query can skip or repeat rows.
          const page = await d.tableData(container, t, { limit: PAGE, offset, orderBy: pk ? { column: pk.name, dir: 'asc' } : undefined })
          if (page.rows.length === 0) break
          const idx = writable.map((c) => page.columns.indexOf(c))
          if (!headerWritten) {
            await write(`-- Data of ${t.name}\n`)
            if (identity && kind === 'mssql') await stmt(`SET IDENTITY_INSERT ${ref} ON`)
            headerWritten = true
          }
          for (let k = 0; k < page.rows.length; k += INSERT_BATCH) {
            const batch = page.rows.slice(k, k + INSERT_BATCH).map((r) => idx.map((i) => r[i]))
            await stmt(insertStatement(kind, ref, writable, batch))
          }
          tableRows += page.rows.length
          hooks.onProgress(done, tables.length, `${t.name}: ${(rowCount + tableRows).toLocaleString()} rows`)
          if (!page.hasNext) break
        }
        if (headerWritten) {
          if (identity && kind === 'mssql') await stmt(`SET IDENTITY_INSERT ${ref} OFF`)
          if (kind === 'postgres') {
            for (const c of design.columns) {
              if (c.autoIncrement || /^nextval\(/i.test(c.defaultValue ?? '')) await stmt(pgSequenceFix(ref, c.name))
            }
          }
          await write('\n')
        }
        rowCount += tableRows
        done++
        hooks.onProgress(done, tables.length, `${t.name}: ${tableRows.toLocaleString()} rows`)
      }
    }

    if (afterData.length) await write('-- Indexes and constraints\n')
    for (const s of afterData) await stmt(s)
    if (kind === 'mysql') await write('\nSET UNIQUE_CHECKS = 1;\nSET FOREIGN_KEY_CHECKS = 1;\n')
    else if (kind === 'sqlite') await stmt('PRAGMA foreign_keys = ON')

    out.end()
    await once(out, 'close')
    return { path: filePath, tables: tables.length, rows: rowCount, bytes, notes }
  } catch (e) {
    out.destroy()
    await once(out, 'close').catch(() => undefined)
    try {
      rmSync(filePath, { force: true }) // never leave a half-written dump that looks complete
    } catch {
      /* best effort */
    }
    throw e
  }
}
