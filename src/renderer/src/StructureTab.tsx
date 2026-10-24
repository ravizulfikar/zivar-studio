import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { ColumnInfo, DbObject } from '@shared/types'
import { errMsg, unwrap } from './api'

interface Props {
  connId: string
  container: string
  obj: DbObject
}

export function StructureTab({ connId, container, obj }: Props): JSX.Element {
  const [cols, setCols] = useState<ColumnInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    unwrap(window.api.describe(connId, container, obj)).then(setCols, (e) => setError(errMsg(e)))
  }, [connId, container, obj])

  if (error) return <div className="msg error">{error}</div>
  if (!cols) return <div className="msg">Loading…</div>
  return (
    <div className="pane-col"><div className="grid-wrap">
      <table className="grid">
        <thead>
          <tr>
            <th>Column</th>
            <th>Type</th>
            <th>Nullable</th>
            <th>Key</th>
            <th>Default</th>
          </tr>
        </thead>
        <tbody>
          {cols.map((c) => (
            <tr key={c.name}>
              <td>{c.name}</td>
              <td>{c.type}</td>
              <td>{c.nullable ? 'YES' : 'NO'}</td>
              <td>{c.primaryKey ? 'PK' : ''}</td>
              <td className={c.defaultValue === null ? 'null' : ''}>{c.defaultValue ?? 'NULL'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <div className="statusline">{cols.length} column(s) in {obj.name}</div>
    </div>
  )
}
