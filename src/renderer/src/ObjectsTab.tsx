import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { DbObject } from '@shared/types'
import { errMsg, unwrap } from './api'
import { IconDesign, IconFunction, IconMatView, IconSearch, IconTable, IconView } from './Icons'

interface Props {
  connId: string
  container: string
  refreshKey: number
  onOpen: (obj: DbObject, mode: 'data' | 'structure' | 'definition') => void
}

export function ObjectsTab({ connId, container, refreshKey, onOpen }: Props): JSX.Element {
  const [objects, setObjects] = useState<DbObject[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [pickedKey, setPickedKey] = useState<string | null>(null)

  useEffect(() => {
    unwrap(window.api.objects(connId, container)).then(setObjects, (e) => setError(errMsg(e)))
  }, [connId, container, refreshKey])

  const shown = useMemo(
    () => objects?.filter((o) => o.name.toLowerCase().includes(filter.trim().toLowerCase())) ?? [],
    [objects, filter]
  )
  // The selection is remembered by name (a reload makes new objects), and falls back to the first row so the
  // Open / Structure buttons work straight away instead of looking dead until a row has been clicked.
  const keyOf = (o: DbObject): string => `${o.type}|${o.schema ?? ''}|${o.name}|${o.args ?? ''}`
  const picked = shown.find((o) => keyOf(o) === pickedKey) ?? shown[0] ?? null

  if (error) return <div className="msg error">{error}</div>
  if (!objects) return <div className="msg">Loading…</div>

  return (
    <div className="pane-col">
      <div className="subtoolbar">
        <button disabled={!picked} onClick={() => picked && onOpen(picked, picked.type === 'function' ? 'definition' : 'data')}>
          <IconTable size={14} /> Open
        </button>
        <button title={picked?.type === 'function' ? 'Functions have no structure — use Open to see the definition' : undefined} disabled={!picked || picked.type === 'function'} onClick={() => picked && onOpen(picked, 'structure')}>
          <IconDesign size={14} /> Structure
        </button>
        <div className="grow" />
        <div className="inline-search">
          <IconSearch size={13} />
          <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </div>
      <div className="grid-wrap">
        <table className="grid objects">
          <thead>
            <tr>
              <th>Name</th>
              <th>Schema</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => (
              <tr
                key={keyOf(o)}
                className={picked && keyOf(picked) === keyOf(o) ? 'sel' : ''}
                onClick={() => setPickedKey(keyOf(o))}
                onDoubleClick={() => onOpen(o, o.type === 'function' ? 'definition' : 'data')}
              >
                <td>
                  {o.type === 'view' ? (
                    <IconView size={14} className="ic view" />
                  ) : o.type === 'matview' ? (
                    <IconMatView size={14} className="ic matview" />
                  ) : o.type === 'function' ? (
                    <IconFunction size={14} className="ic fn" />
                  ) : (
                    <IconTable size={14} className="ic table" />
                  )}{' '}
                  {o.type === 'function' ? `${o.name}(${o.args ?? ''})` : o.name}
                </td>
                <td>{o.schema ?? ''}</td>
                <td>{o.type === 'matview' ? 'materialized view' : o.type === 'function' ? (o.routine ?? 'function') : o.type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="statusline">
        {shown.length} object(s) in {container}
      </div>
    </div>
  )
}
