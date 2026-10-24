import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type { ConnectionConfig, DbKind, DbObject, DbObjectType, SavedQuery } from '@shared/types'
import { errMsg, unwrap } from './api'
import {
  IconDatabase,
  IconFolder,
  IconFunction,
  IconMatView,
  IconQuery,
  IconSchema,
  IconSearch,
  IconTable,
  IconView,
  KindBadge
} from './Icons'
import { ContextMenu, type ContextMenuState, type MenuItem } from './MenuBar'

export type Selection =
  | { type: 'conn'; connId: string }
  | { type: 'container'; connId: string; container: string }
  | { type: 'object'; connId: string; container: string; obj: DbObject }

export interface OpenRequest {
  connId: string
  container: string
  obj: DbObject
  mode: 'data' | 'structure' | 'definition'
}

interface Props {
  connections: ConnectionConfig[]
  selection: Selection | null
  refreshKey: number
  /** Saved queries of every connection; each container node shows its own. */
  savedQueries: SavedQuery[]
  onSelect: (s: Selection) => void
  onOpenObject: (r: OpenRequest) => void
  onOpenObjects: (connId: string, container: string) => void
  onOpenQuery: (q: SavedQuery) => void
  onDeleteQuery: (q: SavedQuery) => void
  onNewQuery: (connId: string, container: string | null) => void
  onNewTable: (connId: string, container: string) => void
  onImportData: (connId: string, container: string, obj: DbObject) => void
  onRunScript: (connId: string, container: string | null) => void
  onDump: (connId: string, container: string) => void
  onTransfer: (connId: string, container: string) => void
  onSync: (connId: string, container: string) => void
  onDiagram: (connId: string, container: string) => void
  onEdit: (c: ConnectionConfig) => void
  onDelete: (c: ConnectionConfig) => void
}

type ShowMenu = (e: React.MouseEvent, items: MenuItem[]) => void

const sameObj = (a: DbObject, b?: DbObject): boolean =>
  !!b && a.name === b.name && a.schema === b.schema && a.type === b.type && a.args === b.args

const isSel = (s: Selection | null, t: Selection['type'], connId: string, container?: string, obj?: DbObject): boolean => {
  if (!s || s.type !== t || s.connId !== connId) return false
  if (t === 'conn') return true
  if ('container' in s && s.container !== container) return false
  if (t === 'object' && s.type === 'object' && obj) return sameObj(s.obj, obj)
  return true
}

export function Sidebar(props: Props): JSX.Element {
  const [filter, setFilter] = useState('')
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const showMenu: ShowMenu = useCallback((e, items) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }, [])

  const f = filter.trim().toLowerCase()
  const groups = useMemo(() => {
    const map = new Map<string, ConnectionConfig[]>()
    const sorted = [...props.connections].sort((a, b) => a.name.localeCompare(b.name))
    for (const c of sorted) {
      if (f && !c.name.toLowerCase().includes(f) && !(c.group ?? '').toLowerCase().includes(f)) continue
      const key = c.group?.trim() ?? ''
      map.set(key, [...(map.get(key) ?? []), c])
    }
    // Named groups first (alphabetical), loose connections last.
    return [...map.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
  }, [props.connections, f])

  const toggleGroup = (g: string): void =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (!next.delete(g)) next.add(g)
      return next
    })

  return (
    <aside className="sidebar">
      <div className="search">
        <IconSearch size={14} />
        <input placeholder="Search connections / objects" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="tree">
        {groups.map(([group, conns]) => (
          <div key={group || '__none'}>
            {group && (
              <div className="node group" onClick={() => toggleGroup(group)}>
                <span className="chev">{collapsedGroups.has(group) ? '▸' : '▾'}</span>
                <IconFolder size={15} className="ic folder" />
                <span className="label">{group}</span>
                <span className="count">{conns.length}</span>
              </div>
            )}
            {!collapsedGroups.has(group) &&
              conns.map((c) => (
                <div key={c.id} className={group ? 'indent' : ''}>
                  <ConnectionNode cfg={c} filter={f} showMenu={showMenu} {...props} />
                </div>
              ))}
          </div>
        ))}
        {props.connections.length === 0 && <div className="muted pad">No connections yet. Use “Connection” to add one.</div>}
        {props.connections.length > 0 && groups.length === 0 && <div className="muted pad">No match.</div>}
      </div>
      {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} />}
    </aside>
  )
}

type NodeProps = Props & { cfg: ConnectionConfig; filter: string; showMenu: ShowMenu }

function ConnectionNode({ cfg, filter, showMenu, ...p }: NodeProps): JSX.Element {
  const [containers, setContainers] = useState<string[] | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    await unwrap(window.api.open(cfg.id))
    setContainers(await unwrap(window.api.containers(cfg.id)))
  }, [cfg.id])

  const toggle = async (): Promise<void> => {
    if (expanded) return setExpanded(false)
    try {
      setError(null)
      await load()
      setExpanded(true)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const disconnect = async (): Promise<void> => {
    await window.api.close(cfg.id)
    setContainers(null)
    setExpanded(false)
  }

  useEffect(() => {
    if (expanded) load().catch((e) => setError(errMsg(e)))
    // Only a manual refresh should reload; `load` is stable per connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.refreshKey])

  const items: MenuItem[] = [
    expanded ? { label: 'Close connection', onClick: () => void disconnect() } : { label: 'Open connection', onClick: () => void toggle() },
    { label: 'New query', onClick: () => p.onNewQuery(cfg.id, null), disabled: !expanded },
    { label: 'Run SQL file…', onClick: () => p.onRunScript(cfg.id, null), disabled: !expanded },
    { separator: true, label: '' },
    { label: 'Edit connection…', onClick: () => p.onEdit(cfg) },
    { label: 'Delete connection', onClick: () => p.onDelete(cfg) }
  ]

  return (
    <div>
      <div
        className={`node conn ${cfg.color ? 'tinted' : ''} ${isSel(p.selection, 'conn', cfg.id) ? 'selected' : ''}`}
        style={cfg.color ? ({ '--c': cfg.color } as React.CSSProperties) : undefined}
        onClick={() => p.onSelect({ type: 'conn', connId: cfg.id })}
        onDoubleClick={() => void toggle()}
        onContextMenu={(e) => {
          p.onSelect({ type: 'conn', connId: cfg.id })
          showMenu(e, items)
        }}
      >
        <span
          className="chev"
          onClick={(e) => {
            e.stopPropagation()
            void toggle()
          }}
        >
          {expanded ? '▾' : '▸'}
        </span>
        <KindBadge kind={cfg.kind} />
        <span className="label" title={cfg.name}>
          {cfg.name}
        </span>
        {expanded && <span className="dot" title="Connected" />}
      </div>
      {error && <div className="msg error small">{error}</div>}
      {expanded &&
        containers?.map((ct) => <ContainerNode key={ct} cfg={cfg} container={ct} filter={filter} showMenu={showMenu} {...p} />)}
    </div>
  )
}

type FolderKey = DbObjectType | 'queries'

/** Folders shown under a database, in order; some engines have no such objects. */
function foldersFor(kind: DbKind): { key: FolderKey; label: string }[] {
  return [
    { key: 'table', label: 'Tables' },
    { key: 'view', label: 'Views' },
    ...(kind === 'postgres' ? [{ key: 'matview' as const, label: 'Materialized Views' }] : []),
    ...(kind !== 'sqlite' ? [{ key: 'function' as const, label: 'Functions' }] : []),
    { key: 'queries', label: 'Queries' }
  ]
}

function objectLabel(o: DbObject, container: string): string {
  if (o.type === 'function') return `${o.name}(${o.args ?? ''})`
  return o.schema && o.schema !== container ? `${o.schema}.${o.name}` : o.name
}

function ObjectIcon({ type }: { type: DbObjectType }): JSX.Element {
  switch (type) {
    case 'view':
      return <IconView size={15} className="ic view" />
    case 'matview':
      return <IconMatView size={15} className="ic matview" />
    case 'function':
      return <IconFunction size={15} className="ic fn" />
    default:
      return <IconTable size={15} className="ic table" />
  }
}

function ContainerNode({ cfg, container, filter, showMenu, ...p }: NodeProps & { container: string }): JSX.Element {
  const [objects, setObjects] = useState<DbObject[] | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [openFolders, setOpenFolders] = useState<Set<FolderKey>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setObjects(await unwrap(window.api.objects(cfg.id, container)))
  }, [cfg.id, container])

  const toggle = async (): Promise<void> => {
    if (expanded) return setExpanded(false)
    try {
      setError(null)
      await load()
      setExpanded(true)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  useEffect(() => {
    if (expanded) load().catch((e) => setError(errMsg(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.refreshKey])

  const toggleFolder = (k: FolderKey): void =>
    setOpenFolders((prev) => {
      const next = new Set(prev)
      if (!next.delete(k)) next.add(k)
      return next
    })

  const match = (name: string): boolean => !filter || name.toLowerCase().includes(filter)
  // Queries saved with no database apply to every database of the connection.
  const queries = p.savedQueries.filter((q) => q.connId === cfg.id && (q.container === container || q.container === null) && match(q.name))
  const Icon = cfg.kind === 'postgres' ? IconSchema : IconDatabase

  const open = (o: DbObject, mode: OpenRequest['mode']): void => p.onOpenObject({ connId: cfg.id, container, obj: o, mode })

  const leafMenu = (o: DbObject): MenuItem[] => [
    ...(o.type === 'function'
      ? []
      : [
          { label: 'Open data', onClick: () => open(o, 'data') },
          { label: o.type === 'table' ? 'Design table' : 'Structure', onClick: () => open(o, 'structure') },
          ...(o.type === 'table' ? [{ label: 'Import data…', onClick: () => p.onImportData(cfg.id, container, o) }] : [])
        ]),
    ...(o.type !== 'table' ? [{ label: 'Definition (SQL)', onClick: () => open(o, 'definition') }] : []),
    { separator: true, label: '' },
    { label: 'New query here', onClick: () => p.onNewQuery(cfg.id, container) }
  ]

  const renderFolder = (key: FolderKey, label: string): ReactNode => {
    const items = key === 'queries' ? null : (objects ?? []).filter((o) => o.type === key && match(o.name))
    const count = key === 'queries' ? queries.length : (items?.length ?? 0)
    const isOpen = openFolders.has(key)
    return (
      <div key={key} className="indent">
        <div
          className="node folder"
          onClick={() => toggleFolder(key)}
          onContextMenu={(e) => {
            if (key === 'queries') showMenu(e, [{ label: 'New query here', onClick: () => p.onNewQuery(cfg.id, container) }])
            else if (key === 'table') showMenu(e, [{ label: 'New table…', onClick: () => p.onNewTable(cfg.id, container) }])
          }}
        >
          <span className="chev">{isOpen ? '▾' : '▸'}</span>
          {key === 'queries' ? (
            <IconQuery size={15} className="ic query" />
          ) : (
            <ObjectIcon type={key} />
          )}
          <span className="label">{label}</span>
          <span className="count">{count || ''}</span>
        </div>
        {isOpen && (
          <>
            {items?.map((o) => (
              <div
                key={`${o.type}|${o.schema ?? ''}|${o.name}|${o.args ?? ''}`}
                className={`node leaf indent ${isSel(p.selection, 'object', cfg.id, container, o) ? 'selected' : ''}`}
                onClick={() => p.onSelect({ type: 'object', connId: cfg.id, container, obj: o })}
                onDoubleClick={() => open(o, o.type === 'function' ? 'definition' : 'data')}
                onContextMenu={(e) => {
                  p.onSelect({ type: 'object', connId: cfg.id, container, obj: o })
                  showMenu(e, leafMenu(o))
                }}
              >
                <ObjectIcon type={o.type} />
                <span className="label" title={objectLabel(o, container)}>
                  {objectLabel(o, container)}
                </span>
              </div>
            ))}
            {key === 'queries' &&
              queries.map((sq) => (
                <div
                  key={sq.id}
                  className="node leaf indent"
                  title={sq.sql.slice(0, 300)}
                  onDoubleClick={() => p.onOpenQuery(sq)}
                  onContextMenu={(e) =>
                    showMenu(e, [
                      { label: 'Open', onClick: () => p.onOpenQuery(sq) },
                      { label: 'Delete', onClick: () => p.onDeleteQuery(sq) }
                    ])
                  }
                >
                  <IconQuery size={15} className="ic query" />
                  <span className="label">{sq.name}</span>
                </div>
              ))}
            {count === 0 && <div className="muted pad indent small-note">{key === 'queries' ? 'No saved queries. Use “Save” in a query tab.' : filter ? 'No match' : '(none)'}</div>}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="indent">
      <div
        className={`node ${isSel(p.selection, 'container', cfg.id, container) ? 'selected' : ''}`}
        onClick={() => {
          p.onSelect({ type: 'container', connId: cfg.id, container })
          void toggle()
        }}
        onDoubleClick={() => p.onOpenObjects(cfg.id, container)}
        onContextMenu={(e) => {
          p.onSelect({ type: 'container', connId: cfg.id, container })
          showMenu(e, [
            { label: 'Open objects list', onClick: () => p.onOpenObjects(cfg.id, container) },
            { label: 'ER diagram', onClick: () => p.onDiagram(cfg.id, container) },
            { label: 'New table…', onClick: () => p.onNewTable(cfg.id, container) },
            { label: 'New query here', onClick: () => p.onNewQuery(cfg.id, container) },
            { separator: true, label: '' },
            { label: 'Run SQL file…', onClick: () => p.onRunScript(cfg.id, container) },
            { label: 'Dump SQL file…', onClick: () => p.onDump(cfg.id, container) },
            { label: 'Transfer data to…', onClick: () => p.onTransfer(cfg.id, container) },
            { label: 'Synchronize structure…', onClick: () => p.onSync(cfg.id, container) }
          ])
        }}
      >
        <span className="chev">{expanded ? '▾' : '▸'}</span>
        <Icon size={15} className={`ic ${expanded ? 'db-open' : 'db'}`} />
        <span className="label">{container}</span>
      </div>
      {error && <div className="msg error small">{error}</div>}
      {expanded && objects && foldersFor(cfg.kind).map((f) => renderFolder(f.key, f.label))}
    </div>
  )
}
