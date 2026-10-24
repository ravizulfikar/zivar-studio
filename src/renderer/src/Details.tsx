import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { ColumnInfo, ConnectionConfig } from '@shared/types'
import { errMsg, unwrap } from './api'
import { IconKey, KindBadge } from './Icons'
import type { Selection } from './Sidebar'

const KIND_NAME = { postgres: 'PostgreSQL', mysql: 'MySQL / MariaDB', sqlite: 'SQLite', mssql: 'SQL Server' } as const

export function Details({ selection, connections, refreshKey }: { selection: Selection | null; connections: ConnectionConfig[]; refreshKey: number }): JSX.Element {
  const [cols, setCols] = useState<ColumnInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const obj = selection?.type === 'object' ? selection.obj : null
  const connId = selection?.connId
  const container = selection && 'container' in selection ? selection.container : null

  useEffect(() => {
    setCols(null)
    setError(null)
    if (!obj || obj.type === 'function' || !connId || !container) return
    let stale = false
    unwrap(window.api.describe(connId, container, obj)).then(
      (c) => !stale && setCols(c),
      (e) => !stale && setError(errMsg(e))
    )
    return () => {
      stale = true
    }
  }, [connId, container, obj, refreshKey])

  const cfg = connections.find((c) => c.id === connId)
  if (!selection || !cfg) return <div className="details empty-details">Select an item to see its details.</div>

  return (
    <div className="details">
      <div className="details-head">
        <KindBadge kind={cfg.kind} />
        <strong>{obj?.name ?? container ?? cfg.name}</strong>
        <span className="muted">{obj ? (obj.type === 'matview' ? 'materialized view' : obj.type) : container ? (cfg.kind === 'postgres' ? 'schema' : 'database') : 'connection'}</span>
      </div>
      <dl className="props">
        <dt>Connection</dt>
        <dd>{cfg.name}</dd>
        <dt>Engine</dt>
        <dd>{KIND_NAME[cfg.kind]}</dd>
        {cfg.kind === 'sqlite' ? (
          <>
            <dt>File</dt>
            <dd title={cfg.database}>{cfg.database}</dd>
          </>
        ) : (
          <>
            <dt>Server</dt>
            <dd>
              {cfg.host}:{cfg.port}
            </dd>
            <dt>User</dt>
            <dd>{cfg.user || '—'}</dd>
          </>
        )}
        {container && (
          <>
            <dt>{cfg.kind === 'postgres' ? 'Schema' : 'Database'}</dt>
            <dd>{container}</dd>
          </>
        )}
      </dl>
      {obj?.type === 'function' && <div className="muted pad">{obj.routine === 'procedure' ? 'Stored procedure' : 'Function'} — double-click to view its source.</div>}
      {obj && obj.type !== 'function' && (
        <>
          <div className="details-sub">Columns {cols ? `(${cols.length})` : ''}</div>
          {error && <div className="msg error small">{error}</div>}
          {!cols && !error && <div className="muted pad">Loading…</div>}
          <ul className="collist">
            {cols?.map((c) => (
              <li key={c.name}>
                {c.primaryKey ? <IconKey size={12} className="ic key" /> : <span className="pk-gap" />}
                <span className="cname">{c.name}</span>
                <span className="ctype">{c.type}</span>
                {!c.nullable && <span className="notnull">NN</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
