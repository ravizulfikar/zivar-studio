import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { QueryResult } from '@shared/types'
import { CellViewer } from './CellViewer'
import { fmt } from './cellFormat'

const MAX_RENDER_ROWS = 1000

export { fmt }

export function ResultGrid({ result, filter }: { result: QueryResult; filter: string }): JSX.Element {
  const [selected, setSelected] = useState<number | null>(null)
  const [viewing, setViewing] = useState<{ column: string; value: unknown } | null>(null)

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f) return result.rows
    return result.rows.filter((r) => r.some((v) => v != null && fmt(v).toLowerCase().includes(f)))
  }, [result, filter])

  if (result.columns.length === 0) {
    return (
      <div className="msg">
        OK{result.affected !== undefined ? ` — ${result.affected} row(s) affected` : ''} ({result.durationMs} ms)
      </div>
    )
  }

  const shown = rows.slice(0, MAX_RENDER_ROWS)
  return (
    <div className="grid-wrap">
      <table className="grid">
        <thead>
          <tr>
            <th className="rownum" />
            {result.columns.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, r) => (
            <tr key={r} className={selected === r ? 'sel' : ''} onClick={() => setSelected(r)}>
              <td className="rownum">{selected === r ? '▶' : r + 1}</td>
              {row.map((v, c) => (
                <td
                  key={c}
                  className={v === null || v === undefined ? 'null' : ''}
                  title={`${fmt(v)}\n(right-click to inspect)`}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setViewing({ column: result.columns[c], value: v })
                  }}
                >
                  {fmt(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {viewing && <CellViewer column={viewing.column} value={viewing.value} onClose={() => setViewing(null)} />}
      {rows.length === 0 && <div className="msg muted">No rows.</div>}
      {rows.length > MAX_RENDER_ROWS && <div className="msg muted">Showing the first {MAX_RENDER_ROWS} of {rows.length} rows.</div>}
    </div>
  )
}
