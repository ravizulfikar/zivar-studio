import type { JSX } from 'react'
import { argsOf, FILTER_OPS, isComplete, newCriterion, type Criterion, type FilterOp } from '@shared/filter'
import type { ColumnInfo, OrderBy } from '@shared/types'

interface FilterProps {
  columns: ColumnInfo[]
  criteria: Criterion[]
  /** The list differs from what was last applied. */
  edited: boolean
  onChange: (c: Criterion[]) => void
  onApply: () => void
  onClear: () => void
}

/** The structured filter: one line per condition — column, operator, value — joined with and / or. */
export function FilterPanel({ columns, criteria, edited, onChange, onApply, onClear }: FilterProps): JSX.Element {
  const patch = (id: string, p: Partial<Criterion>): void => onChange(criteria.map((c) => (c.id === id ? { ...c, ...p } : c)))
  const enter = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement && e.shiftKey)) {
      e.preventDefault()
      onApply()
    }
  }
  return (
    <div className="crit-panel" data-testid="filter-panel">
      {criteria.map((c, i) => {
        const args = argsOf(c.op)
        const missing = c.enabled && !isComplete(c)
        return (
          <div key={c.id} className={`crit-row ${c.enabled ? '' : 'off'}`}>
            <input type="checkbox" checked={c.enabled} title="Use this condition" onChange={(e) => patch(c.id, { enabled: e.target.checked })} />
            <select className="crit-col" value={c.column} onChange={(e) => patch(c.id, { column: e.target.value })}>
              {columns.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
            <select className="crit-op" value={c.op} onChange={(e) => patch(c.id, { op: e.target.value as FilterOp })}>
              {FILTER_OPS.map((o) => (
                <option key={o.op} value={o.op}>
                  {o.label}
                </option>
              ))}
            </select>
            {args === 1 && <input className={`crit-val ${missing ? 'missing' : ''}`} placeholder="<?>" value={c.value} onChange={(e) => patch(c.id, { value: e.target.value })} onKeyDown={enter} />}
            {args === 2 && (
              <>
                <input className={`crit-val ${missing ? 'missing' : ''}`} placeholder="<?>" value={c.value} onChange={(e) => patch(c.id, { value: e.target.value })} onKeyDown={enter} />
                <span className="muted">and</span>
                <input className={`crit-val ${missing ? 'missing' : ''}`} placeholder="<?>" value={c.value2} onChange={(e) => patch(c.id, { value2: e.target.value })} onKeyDown={enter} />
              </>
            )}
            {args === 'list' && (
              <textarea className={`crit-val crit-list ${missing ? 'missing' : ''}`} rows={1} placeholder="one value per line, or separated by commas" value={c.value} onChange={(e) => patch(c.id, { value: e.target.value })} onKeyDown={enter} />
            )}
            {args === 'sql' && <input className={`crit-val crit-sql ${missing ? 'missing' : ''}`} placeholder="SQL condition, e.g. qty > 5 OR note IS NULL" value={c.value} onChange={(e) => patch(c.id, { value: e.target.value })} onKeyDown={enter} />}
            {i < criteria.length - 1 && (
              <select className="crit-join" value={c.join} title="How this condition joins the next one" onChange={(e) => patch(c.id, { join: e.target.value as 'and' | 'or' })}>
                <option value="and">and</option>
                <option value="or">or</option>
              </select>
            )}
            <button className="crit-x" title="Remove this condition" onClick={() => onChange(criteria.filter((x) => x.id !== c.id))}>
              ✕
            </button>
          </div>
        )
      })}
      <div className="crit-foot">
        <button onClick={() => onChange([...criteria, newCriterion(columns[0]?.name ?? '')])} disabled={columns.length === 0}>
          + Condition
        </button>
        <button className="run" onClick={onApply}>
          ✓ Apply
        </button>
        <button onClick={onClear} disabled={criteria.length === 0}>
          Clear
        </button>
        <span className="muted">{edited ? 'Criteria edited' : criteria.some((c) => c.enabled && isComplete(c)) ? 'Applied' : ''}</span>
        <span className="muted crit-hint">Conditions combine from the top: “a and b or c” means ((a and b) or c). Unfinished ones are left out.</span>
      </div>
    </div>
  )
}

interface SortProps {
  columns: ColumnInfo[]
  sorts: OrderBy[]
  edited: boolean
  onChange: (s: OrderBy[]) => void
  onApply: () => void
  onClear: () => void
}

/** Sort by several columns; the first one counts most. */
export function SortPanel({ columns, sorts, edited, onChange, onApply, onClear }: SortProps): JSX.Element {
  const patch = (i: number, p: Partial<OrderBy>): void => onChange(sorts.map((s, k) => (k === i ? { ...s, ...p } : s)))
  const move = (i: number, d: -1 | 1): void => {
    const next = [...sorts]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    onChange(next)
  }
  return (
    <div className="crit-panel" data-testid="sort-panel">
      {sorts.map((s, i) => (
        <div key={i} className="crit-row">
          <span className="muted sort-n">{i === 0 ? 'Sort by' : 'then by'}</span>
          <select className="crit-col" value={s.column} onChange={(e) => patch(i, { column: e.target.value })}>
            {columns.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
          <select className="crit-op" value={s.dir} onChange={(e) => patch(i, { dir: e.target.value as 'asc' | 'desc' })}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
          <button className="crit-x" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
            ↑
          </button>
          <button className="crit-x" title="Move down" disabled={i === sorts.length - 1} onClick={() => move(i, 1)}>
            ↓
          </button>
          <button className="crit-x" title="Remove" onClick={() => onChange(sorts.filter((_, k) => k !== i))}>
            ✕
          </button>
        </div>
      ))}
      <div className="crit-foot">
        <button onClick={() => onChange([...sorts, { column: columns.find((m) => !sorts.some((s) => s.column === m.name))?.name ?? columns[0]?.name ?? '', dir: 'asc' }])} disabled={columns.length === 0}>
          + Sort column
        </button>
        <button className="run" onClick={onApply}>
          ✓ Apply
        </button>
        <button onClick={onClear} disabled={sorts.length === 0}>
          Clear
        </button>
        <span className="muted">{edited ? 'Sort edited' : ''}</span>
        <span className="muted crit-hint">Clicking a column heading sorts by it; Shift+click adds it as another sort column.</span>
      </div>
    </div>
  )
}
