import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { QueryResult } from '@shared/types'
import { CellPanel, type CellMode } from './CellPanel'
import { CellViewer } from './CellViewer'
import { fmt } from './cellFormat'

const MAX_RENDER_ROWS = 1000

export { fmt }

interface Props {
  result: QueryResult
  filter: string
  /** Show the selected cell large, under the grid. */
  textPanel?: boolean
}

export function ResultGrid({ result, filter, textPanel = false }: Props): JSX.Element {
  const [selected, setSelected] = useState<number | null>(null)
  const [viewing, setViewing] = useState<{ column: string; value: unknown } | null>(null)
  const [cell, setCell] = useState<{ r: number; c: number } | null>(null)
  const [mode, setMode] = useState<CellMode>('text')
  const [panelH, setPanelH] = useState(180)

  // A new result is a new grid: nothing in it is selected yet.
  useEffect(() => {
    setSelected(null)
    setCell(null)
  }, [result])

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
  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = panelH
    const move = (ev: MouseEvent): void => setPanelH(Math.max(90, Math.min(520, startH + startY - ev.clientY)))
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const cellValue = cell && shown[cell.r] ? shown[cell.r][cell.c] : undefined

  return (
    <div className="result-col">
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
                    className={`${v === null || v === undefined ? 'null' : ''} ${cell?.r === r && cell.c === c ? 'cell-sel' : ''}`}
                    title={`${fmt(v)}\n(right-click to inspect)`}
                    onClick={() => setCell({ r, c })}
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
      {textPanel && (
        <>
          <div className="hsplit" onMouseDown={startDrag} title="Drag to resize" />
          <CellPanel column={cell ? result.columns[cell.c] : null} value={cellValue} mode={mode} onMode={setMode} height={panelH} />
        </>
      )}
    </div>
  )
}
