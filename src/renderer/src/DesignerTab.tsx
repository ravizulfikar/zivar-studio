import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { DbKind, DbObject, DesignColumn, DesignForeignKey, DesignIndex, FkAction, TableDesign } from '@shared/types'
import { formatDdl, planDdl } from '@shared/ddl'
import { errMsg, unwrap } from './api'
import { IconPlus } from './Icons'

const TYPE_HINTS: Record<DbKind, string[]> = {
  postgres: ['integer', 'bigint', 'smallint', 'numeric(10,2)', 'real', 'double precision', 'boolean', 'text', 'varchar(255)', 'char(1)', 'date', 'timestamp', 'timestamptz', 'time', 'uuid', 'json', 'jsonb', 'bytea'],
  mysql: ['int', 'bigint', 'smallint', 'tinyint', 'decimal(10,2)', 'float', 'double', 'boolean', 'varchar(255)', 'char(1)', 'text', 'longtext', 'date', 'datetime', 'timestamp', 'time', 'json', 'blob'],
  mssql: ['int', 'bigint', 'smallint', 'tinyint', 'bit', 'decimal(18,2)', 'float', 'real', 'nvarchar(255)', 'varchar(255)', 'nvarchar(max)', 'char(1)', 'date', 'datetime2', 'datetime', 'time', 'uniqueidentifier', 'varbinary(max)'],
  sqlite: ['integer', 'text', 'real', 'blob', 'numeric', 'boolean', 'datetime']
}

const FK_ACTIONS: FkAction[] = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT']

const ID_TYPE: Record<DbKind, string> = { postgres: 'integer', mysql: 'int', mssql: 'int', sqlite: 'integer' }
const TEXT_TYPE: Record<DbKind, string> = { postgres: 'text', mysql: 'varchar(255)', mssql: 'nvarchar(255)', sqlite: 'text' }

const uid = (): string => crypto.randomUUID()
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function newTableDesign(kind: DbKind): TableDesign {
  return {
    name: 'new_table',
    columns: [{ id: uid(), originalName: null, name: 'id', type: ID_TYPE[kind], nullable: false, primaryKey: true, defaultValue: null, autoIncrement: true }],
    indexes: []
  }
}

/** Trim what the user typed and drop blanks, so half-typed input doesn't show up as errors. */
function normalized(d: TableDesign): TableDesign {
  return {
    ...d,
    name: d.name.trim(),
    columns: d.columns.map((c) => ({ ...c, name: c.name.trim(), defaultValue: c.defaultValue?.trim() ? c.defaultValue.trim() : null })),
    indexes: d.indexes.map((ix) => (ix.locked ? ix : { ...ix, name: ix.name.trim(), columns: ix.columns.map((c) => c.trim()).filter(Boolean) })),
    foreignKeys: (d.foreignKeys ?? []).map((fk) =>
      fk.locked
        ? fk
        : {
            ...fk,
            name: fk.name.trim(),
            refSchema: fk.refSchema?.trim() || undefined,
            refTable: fk.refTable.trim(),
            columns: fk.columns.map((c) => c.trim()).filter(Boolean),
            refColumns: fk.refColumns.map((c) => c.trim()).filter(Boolean)
          }
    )
  }
}

const DESTRUCTIVE = /DROP COLUMN|DROP CONSTRAINT|DROP PRIMARY KEY|DROP INDEX|\bTYPE\b|ALTER COLUMN/i

interface Props {
  connId: string
  connName: string
  kind: DbKind
  container: string
  /** Absent when designing a table that does not exist yet. */
  obj?: DbObject
  /** Called after DDL succeeded so the tree can refresh and the tab can be renamed. */
  onApplied: (obj: DbObject) => void
}

export function DesignerTab({ connId, connName, kind, container, obj, onApplied }: Props): JSX.Element {
  const [current, setCurrent] = useState<DbObject | undefined>(obj)
  const [original, setOriginal] = useState<TableDesign | null>(null)
  const [edited, setEdited] = useState<TableDesign>(() => newTableDesign(kind))
  const [loading, setLoading] = useState(!!obj)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [view, setView] = useState<'columns' | 'indexes' | 'fks' | 'ddl'>('columns')
  const [selCol, setSelCol] = useState<string | null>(null)
  const [selIx, setSelIx] = useState<string | null>(null)
  const [selFk, setSelFk] = useState<string | null>(null)
  /** Tables of this database/schema, and their columns, to suggest while editing foreign keys. */
  const [tables, setTables] = useState<string[]>([])
  const [refCols, setRefCols] = useState<Record<string, string[]>>({})

  const isNew = current === undefined
  const schema = current?.schema ?? 'dbo'

  const load = async (o: DbObject): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const d = await unwrap(window.api.designInfo(connId, container, o))
      setOriginal(d)
      setEdited(clone(d))
      setSelCol(null)
      setSelIx(null)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    unwrap(window.api.objects(connId, container)).then(
      (list) => setTables(list.filter((o) => o.type === 'table').map((o) => o.name)),
      () => setTables([]) // suggestions only; typing a name still works
    )
  }, [connId, container])

  const sameScope = (fk: DesignForeignKey): boolean => !fk.refSchema?.trim() || fk.refSchema === container

  // Fetch the columns of every referenced table once, for the "referenced columns" suggestions.
  useEffect(() => {
    for (const fk of edited.foreignKeys ?? []) {
      const t = fk.refTable.trim()
      if (!t || !sameScope(fk) || refCols[t] || !tables.includes(t)) continue
      setRefCols((prev) => ({ ...prev, [t]: [] })) // placeholder prevents duplicate requests
      const target: DbObject = { name: t, type: 'table', schema: kind === 'mssql' ? 'dbo' : kind === 'postgres' ? container : undefined }
      unwrap(window.api.describe(connId, container, target)).then(
        (cols) => setRefCols((prev) => ({ ...prev, [t]: cols.map((c) => c.name) })),
        () => undefined
      )
    }
    // sameScope only depends on `container`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edited.foreignKeys, tables])

  useEffect(() => {
    if (obj) void load(obj)
    // Load once for the table this tab was opened on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const plan = useMemo(
    () => planDdl({ kind, container, schema }, isNew ? null : original, normalized(edited)),
    [kind, container, schema, isNew, original, edited]
  )
  const dirty = isNew || plan.statements.length > 0
  const canApply = !applying && !loading && plan.errors.length === 0 && plan.statements.length > 0

  /* ── editing helpers ── */
  const patchColumn = (id: string, patch: Partial<DesignColumn>): void =>
    setEdited((d) => {
      const old = d.columns.find((c) => c.id === id)
      if (!old) return d
      const next: DesignColumn = { ...old, ...patch }
      if (patch.primaryKey) next.nullable = false
      const renamed = patch.name !== undefined && patch.name !== old.name
      return {
        ...d,
        columns: d.columns.map((c) => (c.id === id ? next : c)),
        // Keep indexes and foreign keys pointing at the column when it is renamed.
        indexes: renamed ? d.indexes.map((ix) => (ix.locked ? ix : { ...ix, columns: ix.columns.map((c) => (c === old.name ? (patch.name as string) : c)) })) : d.indexes,
        foreignKeys: renamed
          ? (d.foreignKeys ?? []).map((fk) => (fk.locked ? fk : { ...fk, columns: fk.columns.map((c) => (c === old.name ? (patch.name as string) : c)) }))
          : d.foreignKeys
      }
    })

  const addColumn = (): void => {
    const names = new Set(edited.columns.map((c) => c.name))
    let i = edited.columns.length + 1
    while (names.has(`column_${i}`)) i++
    const col: DesignColumn = { id: uid(), originalName: null, name: `column_${i}`, type: TEXT_TYPE[kind], nullable: true, primaryKey: false, defaultValue: null, autoIncrement: false }
    setEdited((d) => ({ ...d, columns: [...d.columns, col] }))
    setSelCol(col.id)
  }

  const removeColumn = (): void => {
    const col = edited.columns.find((c) => c.id === selCol)
    if (!col) return
    setEdited((d) => ({
      ...d,
      columns: d.columns.filter((c) => c.id !== col.id),
      // An index can't outlive its columns: take the column out, and drop indexes left empty.
      indexes: d.indexes
        .map((ix) => (ix.locked ? ix : { ...ix, columns: ix.columns.filter((c) => c !== col.name) }))
        .filter((ix) => ix.locked || ix.columns.length > 0),
      foreignKeys: (d.foreignKeys ?? [])
        .map((fk) => {
          if (fk.locked || !fk.columns.includes(col.name)) return fk
          // Take the column out together with its referenced partner so the pairs stay aligned.
          const i = fk.columns.indexOf(col.name)
          return { ...fk, columns: fk.columns.filter((_, k) => k !== i), refColumns: fk.refColumns.filter((_, k) => k !== i) }
        })
        .filter((fk) => fk.locked || fk.columns.length > 0)
    }))
    setSelCol(null)
  }

  const moveColumn = (dir: -1 | 1): void =>
    setEdited((d) => {
      const i = d.columns.findIndex((c) => c.id === selCol)
      const j = i + dir
      if (i < 0 || j < 0 || j >= d.columns.length) return d
      const cols = [...d.columns]
      ;[cols[i], cols[j]] = [cols[j], cols[i]]
      return { ...d, columns: cols }
    })

  const patchIndex = (id: string, patch: Partial<DesignIndex>): void =>
    setEdited((d) => ({ ...d, indexes: d.indexes.map((ix) => (ix.id === id ? { ...ix, ...patch } : ix)) }))

  const addIndex = (): void => {
    const names = new Set(edited.indexes.map((i) => i.name))
    let i = edited.indexes.length + 1
    const base = (edited.name || 'table').trim()
    while (names.has(`ix_${base}_${i}`)) i++
    const first = edited.columns.find((c) => c.name.trim())?.name ?? ''
    const ix: DesignIndex = { id: uid(), originalName: null, name: `ix_${base}_${i}`, columns: first ? [first] : [], unique: false }
    setEdited((d) => ({ ...d, indexes: [...d.indexes, ix] }))
    setSelIx(ix.id)
  }

  const removeIndex = (): void => {
    if (!selIx) return
    setEdited((d) => ({ ...d, indexes: d.indexes.filter((i) => i.id !== selIx) }))
    setSelIx(null)
  }

  const patchFk = (id: string, patch: Partial<DesignForeignKey>): void =>
    setEdited((d) => ({ ...d, foreignKeys: (d.foreignKeys ?? []).map((fk) => (fk.id === id ? { ...fk, ...patch } : fk)) }))

  const addFk = (): void => {
    const existing = new Set((edited.foreignKeys ?? []).map((f) => f.name))
    const base = (edited.name || 'table').trim()
    let i = existing.size + 1
    while (existing.has(`fk_${base}_${i}`)) i++
    const first = edited.columns.find((c) => c.name.trim())?.name
    const fk: DesignForeignKey = {
      id: uid(),
      originalName: null,
      name: `fk_${base}_${i}`,
      columns: first ? [first] : [],
      refTable: '',
      refColumns: [],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION'
    }
    setEdited((d) => ({ ...d, foreignKeys: [...(d.foreignKeys ?? []), fk] }))
    setSelFk(fk.id)
  }

  const removeFk = (): void => {
    if (!selFk) return
    setEdited((d) => ({ ...d, foreignKeys: (d.foreignKeys ?? []).filter((f) => f.id !== selFk) }))
    setSelFk(null)
  }

  const reset = (): void => {
    if (dirty && !window.confirm('Discard all unsaved changes in this designer?')) return
    setNote(null)
    setError(null)
    if (original && !isNew) setEdited(clone(original))
    else setEdited(newTableDesign(kind))
  }

  const apply = async (): Promise<void> => {
    const risky = plan.statements.filter((s) => DESTRUCTIVE.test(s))
    const msg =
      `Run ${plan.statements.length} statement(s) on "${connName}"?` +
      (risky.length ? `\n\nThese change or remove existing structure:\n${risky.map((s) => `  • ${s.length > 110 ? `${s.slice(0, 110)}…` : s}`).join('\n')}` : '') +
      (plan.warnings.length ? `\n\nWarnings:\n${plan.warnings.map((w) => `  • ${w}`).join('\n')}` : '')
    if (!window.confirm(msg)) return

    setApplying(true)
    setError(null)
    setNote(null)
    try {
      await unwrap(window.api.executeDdl(connId, container, plan.statements))
      const name = edited.name.trim()
      const target: DbObject = current ?? { name, schema: kind === 'sqlite' ? undefined : kind === 'mssql' ? 'dbo' : container, type: 'table' }
      setCurrent(target)
      setNote(`Applied ${plan.statements.length} statement(s).`)
      // The confirmation is only useful for a moment; don't let it sit next to later errors.
      setTimeout(() => setNote(null), 4000)
      onApplied(target)
      await load(target)
    } catch (e) {
      // Whatever the engine could roll back is rolled back; the designer keeps the user's edits.
      setError(errMsg(e))
    } finally {
      setApplying(false)
    }
  }

  const copyDdl = (): void => {
    void navigator.clipboard.writeText(formatDdl(plan.statements)).then(() => setNote('DDL copied to clipboard.'), () => setError('Could not access the clipboard.'))
  }

  /* ── per-column editing rules ── */
  const rules = (c: DesignColumn): { attrs: boolean; auto: boolean; pk: boolean } => {
    const existing = c.originalName !== null
    return {
      attrs: !!c.locked || (kind === 'sqlite' && existing),
      auto: !!c.locked || (kind === 'sqlite' && existing) || (kind === 'mssql' && existing),
      pk: !!c.locked || (kind === 'sqlite' && !isNew)
    }
  }

  const fkLocked = kind === 'sqlite' && !isNew

  const banner =
    kind === 'sqlite' && !isNew
      ? 'SQLite can only add, rename and drop columns of an existing table. Changing a column’s type, nullability, default, the primary key or foreign keys would need a table rebuild, so those are disabled.'
      : kind === 'mysql'
        ? 'MySQL commits each DDL statement immediately: if one fails, the statements before it stay applied.'
        : 'All changes run in a single transaction; if anything fails, nothing is applied.'

  if (loading && !original) return <div className="msg">Loading…</div>

  return (
    <div className="pane-col">
      <div className="subtoolbar">
        <button className="run" disabled={!canApply} onClick={() => void apply()} title={plan.errors[0] ?? 'Run the DDL shown in the Preview tab'}>
          ✓ {isNew ? 'Create table' : 'Apply changes'}
        </button>
        <button disabled={!dirty || applying} onClick={reset}>
          ↺ Reset
        </button>
        <span className="sep-v" />
        {view === 'fks' ? (
          <>
            <button onClick={addFk} disabled={fkLocked} title={fkLocked ? 'SQLite cannot add foreign keys to an existing table' : undefined}>
              <IconPlus size={14} /> Foreign key
            </button>
            <button disabled={!selFk || fkLocked} onClick={removeFk}>
              − Delete FK
            </button>
          </>
        ) : view === 'indexes' ? (
          <>
            <button onClick={addIndex}>
              <IconPlus size={14} /> Index
            </button>
            <button disabled={!selIx} onClick={removeIndex}>
              − Delete index
            </button>
          </>
        ) : (
          <>
            <button onClick={addColumn} disabled={view === 'ddl'}>
              <IconPlus size={14} /> Column
            </button>
            <button disabled={!selCol || view === 'ddl'} onClick={removeColumn}>
              − Delete column
            </button>
            {isNew && (
              <>
                <button disabled={!selCol || view === 'ddl'} onClick={() => moveColumn(-1)} title="Move up">
                  ↑
                </button>
                <button disabled={!selCol || view === 'ddl'} onClick={() => moveColumn(1)} title="Move down">
                  ↓
                </button>
              </>
            )}
          </>
        )}
        <div className="grow" />
        <label className="table-name">
          Table
          {isNew ? <input value={edited.name} onChange={(e) => setEdited((d) => ({ ...d, name: e.target.value }))} /> : <strong>{edited.name}</strong>}
        </label>
      </div>

      <div className="subtabs">
        {(['columns', 'indexes', 'fks', 'ddl'] as const).map((v) => (
          <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
            {v === 'columns'
              ? `Columns (${edited.columns.length})`
              : v === 'indexes'
                ? `Indexes (${edited.indexes.length})`
                : v === 'fks'
                  ? `Foreign keys (${(edited.foreignKeys ?? []).length})`
                  : `DDL preview${plan.errors.length ? ' ⚠' : ''}`}
          </button>
        ))}
      </div>

      <div className="banner info">{banner}</div>
      {error && <div className="msg error">{error}</div>}
      {note && <div className="msg ok">{note}</div>}
      {plan.errors.length > 0 && view !== 'ddl' && (
        <div className="banner err">
          {plan.errors[0]}
          {plan.errors.length > 1 ? ` (+${plan.errors.length - 1} more — see DDL preview)` : ''}
        </div>
      )}

      <datalist id="col-types">
        {TYPE_HINTS[kind].map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <datalist id="tbl-names">
        {tables.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <datalist id="col-names">
        {edited.columns.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>

      {view === 'columns' && (
        <div className="grid-wrap">
          <table className="grid designer">
            <thead>
              <tr>
                <th className="rownum" />
                <th>Name</th>
                <th>Type</th>
                <th title="Allows NULL">Null</th>
                <th title="Primary key">PK</th>
                <th title="Auto-increment / identity">Auto</th>
                <th>Default (SQL expression)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {edited.columns.map((c, i) => {
                const r = rules(c)
                return (
                  <tr key={c.id} className={`${selCol === c.id ? 'sel' : ''} ${c.originalName === null ? 'new' : ''}`} onClick={() => setSelCol(c.id)}>
                    <td className="rownum">{i + 1}</td>
                    <td>
                      <input value={c.name} disabled={!!c.locked} onChange={(e) => patchColumn(c.id, { name: e.target.value })} />
                    </td>
                    <td>
                      <input list="col-types" value={c.type} disabled={r.attrs} onChange={(e) => patchColumn(c.id, { type: e.target.value })} />
                    </td>
                    <td className="chk">
                      <input type="checkbox" checked={c.nullable} disabled={r.attrs || c.primaryKey} onChange={(e) => patchColumn(c.id, { nullable: e.target.checked })} />
                    </td>
                    <td className="chk">
                      <input type="checkbox" checked={c.primaryKey} disabled={r.pk} onChange={(e) => patchColumn(c.id, { primaryKey: e.target.checked })} />
                    </td>
                    <td className="chk">
                      <input type="checkbox" checked={c.autoIncrement} disabled={r.auto} onChange={(e) => patchColumn(c.id, { autoIncrement: e.target.checked })} />
                    </td>
                    <td>
                      <input
                        value={c.defaultValue ?? ''}
                        placeholder={c.autoIncrement ? '(generated)' : "e.g. 0, 'text', now()"}
                        disabled={r.attrs || (c.autoIncrement && kind === 'postgres')}
                        onChange={(e) => patchColumn(c.id, { defaultValue: e.target.value })}
                      />
                    </td>
                    <td className="note-cell">
                      {c.locked ? 'generated — read-only' : [c.collation && `collate ${c.collation}`, c.extra].filter(Boolean).join(' · ')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {view === 'indexes' && (
        <div className="grid-wrap">
          <table className="grid designer">
            <thead>
              <tr>
                <th className="rownum" />
                <th>Name</th>
                <th>Columns (comma-separated, in order)</th>
                <th title="Unique index">Unique</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {edited.indexes.map((ix, i) => (
                <tr key={ix.id} className={`${selIx === ix.id ? 'sel' : ''} ${ix.originalName === null ? 'new' : ''}`} onClick={() => setSelIx(ix.id)}>
                  <td className="rownum">{i + 1}</td>
                  <td>
                    <input value={ix.name} disabled={!!ix.locked} onChange={(e) => patchIndex(ix.id, { name: e.target.value })} />
                  </td>
                  <td>
                    <input
                      list="col-names"
                      value={ix.columns.join(', ')}
                      disabled={!!ix.locked}
                      onChange={(e) => patchIndex(ix.id, { columns: e.target.value.split(',').map((s) => s.replace(/^\s+/, '')) })}
                    />
                  </td>
                  <td className="chk">
                    <input type="checkbox" checked={ix.unique} disabled={!!ix.locked} onChange={(e) => patchIndex(ix.id, { unique: e.target.checked })} />
                  </td>
                  <td className="note-cell">{ix.locked ? 'expression / partial / constraint — read-only' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {edited.indexes.length === 0 && <div className="msg muted">No indexes. Use “+ Index” to add one.</div>}
          <div className="msg muted small-note">The primary key is edited with the PK column in the Columns tab.</div>
        </div>
      )}

      {view === 'fks' && (
        <div className="grid-wrap">
          <table className="grid designer">
            <thead>
              <tr>
                <th className="rownum" />
                <th>Name</th>
                <th>Columns</th>
                <th title={kind === 'mysql' ? 'Database of the referenced table' : 'Schema of the referenced table'}>{kind === 'mysql' ? 'Ref. database' : 'Ref. schema'}</th>
                <th>Referenced table</th>
                <th>Referenced columns</th>
                <th>On delete</th>
                <th>On update</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(edited.foreignKeys ?? []).map((fk, i) => {
                const off = !!fk.locked || fkLocked
                return (
                  <tr key={fk.id} className={`${selFk === fk.id ? 'sel' : ''} ${fk.originalName === null ? 'new' : ''}`} onClick={() => setSelFk(fk.id)}>
                    <td className="rownum">{i + 1}</td>
                    <td>
                      <input value={fk.name} disabled={off} onChange={(e) => patchFk(fk.id, { name: e.target.value })} />
                    </td>
                    <td>
                      <input
                        list="col-names"
                        value={fk.columns.join(', ')}
                        disabled={off}
                        onChange={(e) => patchFk(fk.id, { columns: e.target.value.split(',').map((x) => x.replace(/^\s+/, '')) })}
                      />
                    </td>
                    <td>
                      <input value={fk.refSchema ?? ''} placeholder="(same)" disabled={off} onChange={(e) => patchFk(fk.id, { refSchema: e.target.value })} />
                    </td>
                    <td>
                      <input list="tbl-names" value={fk.refTable} disabled={off} onChange={(e) => patchFk(fk.id, { refTable: e.target.value })} />
                    </td>
                    <td>
                      <datalist id={`refcols-${fk.id}`}>
                        {(refCols[fk.refTable.trim()] ?? []).map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                      <input
                        list={`refcols-${fk.id}`}
                        value={fk.refColumns.join(', ')}
                        disabled={off}
                        onChange={(e) => patchFk(fk.id, { refColumns: e.target.value.split(',').map((x) => x.replace(/^\s+/, '')) })}
                      />
                    </td>
                    <td>
                      <select value={fk.onDelete} disabled={off} onChange={(e) => patchFk(fk.id, { onDelete: e.target.value as FkAction })}>
                        {FK_ACTIONS.map((a) => (
                          <option key={a}>{a}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select value={fk.onUpdate} disabled={off} onChange={(e) => patchFk(fk.id, { onUpdate: e.target.value as FkAction })}>
                        {FK_ACTIONS.map((a) => (
                          <option key={a}>{a}</option>
                        ))}
                      </select>
                    </td>
                    <td className="note-cell">{fk.locked ? 'read-only' : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {(edited.foreignKeys ?? []).length === 0 && <div className="msg muted">No foreign keys. Use “+ Foreign key” to add one.</div>}
          <div className="msg muted small-note">Columns and referenced columns are matched by position. Leave the schema blank to reference a table next to this one.</div>
        </div>
      )}

      {view === 'ddl' && (
        <div className="ddl-view">
          {plan.errors.length > 0 && (
            <div className="banner err">
              {plan.errors.map((e) => (
                <div key={e}>• {e}</div>
              ))}
            </div>
          )}
          {plan.warnings.length > 0 && (
            <div className="banner warn">
              {plan.warnings.map((w) => (
                <div key={w}>• {w}</div>
              ))}
            </div>
          )}
          {plan.statements.length > 0 ? (
            <>
              <div className="ddl-actions">
                <button onClick={copyDdl}>Copy</button>
              </div>
              <pre className="ddl">{formatDdl(plan.statements)}</pre>
            </>
          ) : (
            plan.errors.length === 0 && <div className="msg muted">No changes.</div>
          )}
        </div>
      )}

      <div className="statusline">
        <span>
          {kind === 'sqlite' ? 'main' : container}
          {' › '}
          {edited.name || '(unnamed)'}
        </span>
        <span>{plan.statements.length ? `${plan.statements.length} statement(s) pending` : 'No pending changes'}</span>
      </div>
    </div>
  )
}
