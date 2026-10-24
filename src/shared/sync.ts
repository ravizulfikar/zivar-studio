import { planDdl, type DdlContext } from './ddl'
import type { DbKind, DdlPlan, DesignColumn, DesignForeignKey, DesignIndex, TableDesign } from './types'

export interface SyncOptions {
  /** Remove columns, indexes and foreign keys that exist only in the target. Off by default: it destroys data. */
  dropExtras: boolean
  /** Container of the source table, so a foreign key into the source's own schema/database is rebased onto the target's. */
  sourceContainer: string
}

/** A foreign key pointing into the source's own container points into the target's after the move. */
function rebaseFk(fk: DesignForeignKey, sourceContainer: string): DesignForeignKey {
  return { ...fk, refSchema: fk.refSchema === sourceContainer ? undefined : fk.refSchema }
}

/**
 * Describe the target table as it should look once it matches the source, expressed as an edit of the
 * target (so the DDL planner can diff it). Matching is by name: a renamed column looks like a drop plus an add.
 */
export function alignDesign(target: TableDesign, source: TableDesign, opts: SyncOptions): TableDesign {
  const targetCols = new Map(target.columns.map((c) => [c.name, c]))
  const columns: DesignColumn[] = []
  for (const s of source.columns) {
    const t = targetCols.get(s.name)
    if (t && (t.locked || s.locked)) {
      columns.push({ ...t }) // generated / identity-locked columns are never rewritten
    } else if (t) {
      columns.push({ ...s, id: `sync-${s.name}`, originalName: t.name, defaultConstraint: t.defaultConstraint })
    } else {
      columns.push({ ...s, id: `sync-${s.name}`, originalName: null, defaultConstraint: undefined })
    }
  }
  if (!opts.dropExtras) {
    const sourceNames = new Set(source.columns.map((c) => c.name))
    for (const t of target.columns) if (!sourceNames.has(t.name)) columns.push({ ...t })
  }

  const targetIdx = new Map(target.indexes.map((i) => [i.name, i]))
  const indexes: DesignIndex[] = target.indexes.filter((i) => i.locked).map((i) => ({ ...i })) // never touched
  for (const s of source.indexes) {
    if (s.locked && !s.constraint) continue // expression and partial indexes cannot be expressed in the model
    const t = targetIdx.get(s.name)
    if (t?.locked) continue
    indexes.push({ ...s, id: `sync-ix-${s.name}`, originalName: t ? t.name : null, definition: undefined })
  }
  if (!opts.dropExtras) {
    const sourceNames = new Set(source.indexes.map((i) => i.name))
    for (const t of target.indexes) if (!t.locked && !sourceNames.has(t.name)) indexes.push({ ...t })
  }

  const targetFks = new Map((target.foreignKeys ?? []).map((f) => [f.name, f]))
  const foreignKeys: DesignForeignKey[] = (target.foreignKeys ?? []).filter((f) => f.locked).map((f) => ({ ...f }))
  for (const s of source.foreignKeys ?? []) {
    if (s.locked) continue
    const t = targetFks.get(s.name)
    if (t?.locked) continue
    foreignKeys.push({ ...rebaseFk(s, opts.sourceContainer), id: `sync-fk-${s.name}`, originalName: t ? t.name : null })
  }
  if (!opts.dropExtras) {
    const sourceNames = new Set((source.foreignKeys ?? []).map((f) => f.name))
    for (const t of target.foreignKeys ?? []) if (!t.locked && !sourceNames.has(t.name)) foreignKeys.push({ ...t })
  }

  return { name: target.name, pkName: target.pkName, columns, indexes, foreignKeys }
}

/** DDL that makes an existing target table match the source. */
export function planSyncTable(ctx: DdlContext, target: TableDesign, source: TableDesign, opts: SyncOptions): DdlPlan {
  return planDdl(ctx, target, alignDesign(target, source, opts))
}

export interface NewTablePlan {
  /** CREATE TABLE plus its indexes. */
  statements: string[]
  /** Foreign keys to add once every table exists (empty where the engine needs them inline, i.e. SQLite). */
  foreignKeys: string[]
  notes: string[]
  errors: string[]
}

/** DDL that creates a source table in the target, leaving foreign keys for a later pass so table order does not matter. */
export function planNewTable(ctx: DdlContext, source: TableDesign, opts: { sourceContainer: string }): NewTablePlan {
  const notes: string[] = []
  const inlineFks = ctx.kind === 'sqlite'
  // "Locked" only means the source cannot alter a foreign key in place; copying it into a new table is fine.
  const fks: DesignForeignKey[] = []
  for (const f of source.foreignKeys ?? []) {
    if (f.refColumns.length !== f.columns.length) {
      notes.push(`Foreign key "${f.name}" refers to ${f.refTable}'s primary key implicitly, so it was not carried over.`)
      continue
    }
    fks.push({ ...rebaseFk(f, opts.sourceContainer), locked: undefined })
  }
  for (const i of source.indexes.filter((x) => x.locked && !x.constraint)) notes.push(`Index "${i.name}" (expression or partial) was not carried over.`)

  // Unique constraints are locked for editing but their columns are exact, so they are created as unique indexes.
  const base: TableDesign = { ...source, indexes: source.indexes.filter((i) => !i.locked || i.constraint).map((i) => ({ ...i, locked: undefined })), foreignKeys: inlineFks ? fks : [] }
  const created = planDdl(ctx, null, base)
  if (created.errors.length) return { statements: [], foreignKeys: [], notes, errors: created.errors }

  let foreignKeys: string[] = []
  if (!inlineFks && fks.length) {
    // Treat the table as already created (every column known by its own name), so the diff is only the new constraints.
    const existing: TableDesign = {
      ...base,
      columns: base.columns.map((c) => ({ ...c, originalName: c.name })),
      indexes: base.indexes.map((i) => ({ ...i, originalName: i.name })),
      foreignKeys: []
    }
    const add = planDdl(ctx, existing, { ...existing, foreignKeys: fks.map((f) => ({ ...f, originalName: null })) })
    if (add.errors.length) notes.push(`Foreign keys could not be added: ${add.errors[0]}`)
    else foreignKeys = add.statements
  }
  return { statements: created.statements, foreignKeys, notes, errors: [] }
}

/**
 * Parents before children. Self-references are ignored; tables in a genuine cycle keep their order and are
 * returned in `cyclic` so the caller can warn.
 */
export function orderByDependencies<T extends { name: string }>(tables: T[], refsOf: (t: T) => string[]): { ordered: T[]; cyclic: string[] } {
  const names = new Set(tables.map((t) => t.name))
  const deps = new Map(tables.map((t) => [t.name, new Set(refsOf(t).filter((r) => r !== t.name && names.has(r)))]))
  const ordered: T[] = []
  const placed = new Set<string>()
  let remaining = [...tables]
  while (remaining.length) {
    const ready = remaining.filter((t) => [...(deps.get(t.name) as Set<string>)].every((d) => placed.has(d)))
    if (ready.length === 0) {
      ordered.push(...remaining)
      return { ordered, cyclic: remaining.map((t) => t.name) }
    }
    for (const t of ready) {
      ordered.push(t)
      placed.add(t.name)
    }
    remaining = remaining.filter((t) => !placed.has(t.name))
  }
  return { ordered, cyclic: [] }
}

export type { DbKind }
