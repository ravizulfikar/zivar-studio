import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { highlight, matchesAll, objectLabel, searchAll, searchWords, type IndexedConnection } from '@shared/sidebarSearch'

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

/** What the tree has loaded so far, by connection, so the search can look into databases that are not expanded. */
type IndexData = Record<string, IndexedConnection>

interface IndexApi {
  containers: (connId: string, list: string[]) => void
  objects: (connId: string, container: string, list: DbObject[]) => void
}

/** The menu of a table / view / function, wherever it is listed. */
function objectMenu(p: Props, connId: string, container: string, o: DbObject): MenuItem[] {
  const open = (mode: OpenRequest['mode']): void => p.onOpenObject({ connId, container, obj: o, mode })
  return [
    ...(o.type === 'function'
      ? []
      : [
          { label: 'Open data', onClick: () => open('data') },
          { label: o.type === 'table' ? 'Design table' : 'Structure', onClick: () => open('structure') },
          ...(o.type === 'table' ? [{ label: 'Import data…', onClick: () => p.onImportData(connId, container, o) }] : [])
        ]),
    ...(o.type !== 'table' ? [{ label: 'Definition (SQL)', onClick: () => open('definition') }] : []),
    { separator: true, label: '' },
    { label: 'New query here', onClick: () => p.onNewQuery(connId, container) }
  ]
}

/** Text with the parts that matched the search marked. */
function Hl({ text, words }: { text: string; words: string[] }): JSX.Element {
  return (
    <>
      {highlight(text, words).map((seg, i) => (seg.hit ? <mark key={i}>{seg.text}</mark> : <Fragment key={i}>{seg.text}</Fragment>))}
    </>
  )
}

export function Sidebar(props: Props): JSX.Element {
  const [filter, setFilter] = useState('')
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [index, setIndex] = useState<IndexData>({})
  const [scanning, setScanning] = useState(false)
  const [scanErrors, setScanErrors] = useState<Record<string, string>>({})

  const showMenu: ShowMenu = useCallback((e, items) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }, [])

  // Every node that loads its list reports it here.
  const indexApi = useMemo<IndexApi>(
    () => ({
      containers: (connId, list) => setIndex((prev) => ({ ...prev, [connId]: { containers: list, objects: prev[connId]?.objects ?? {} } })),
      objects: (connId, container, list) =>
        setIndex((prev) => ({ ...prev, [connId]: { containers: prev[connId]?.containers ?? [], objects: { ...(prev[connId]?.objects ?? {}), [container]: list } } }))
    }),
    []
  )
  // A refresh makes the expanded nodes reload (and report again). What the search remembers about the others
  // (a database you collapsed, a connection you closed) is read again here, so it does not go stale or vanish.
  const remembered = useRef(index)
  remembered.current = index
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    for (const [connId, data] of Object.entries(remembered.current)) {
      for (const container of Object.keys(data.objects)) {
        void window.api.objects(connId, container).then((r) => {
          if (r.ok) indexApi.objects(connId, container, r.data)
        })
      }
    }
  }, [props.refreshKey, indexApi])

  const words = useMemo(() => searchWords(filter), [filter])
  const searching = words.length > 0

  const groups = useMemo(() => {
    const map = new Map<string, ConnectionConfig[]>()
    const sorted = [...props.connections].sort((a, b) => a.name.localeCompare(b.name))
    for (const c of sorted) {
      const key = c.group?.trim() ?? ''
      map.set(key, [...(map.get(key) ?? []), c])
    }
    // Named groups first (alphabetical), loose connections last.
    return [...map.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
  }, [props.connections])
  /** While searching, only these connections (matching by name or folder) are shown in the tree part. */
  const shown = useMemo(() => new Set(props.connections.filter((c) => !searching || matchesAll(`${c.name} ${c.group ?? ''}`, words)).map((c) => c.id)), [props.connections, words, searching])

  const results = useMemo(() => (searching ? searchAll(words, props.connections, index, props.savedQueries) : null), [searching, words, props.connections, index, props.savedQueries])

  // Connections whose tables, views and functions have not all been loaded yet cannot be searched.
  const unsearched = props.connections.filter((c) => {
    const data = index[c.id]
    return !data || data.containers.some((ct) => !(ct in data.objects))
  })

  /** Opens every connection that has not been searched and reads the objects of all its databases. */
  const searchEverywhere = async (): Promise<void> => {
    setScanning(true)
    setScanErrors({})
    for (const c of unsearched) {
      try {
        await unwrap(window.api.open(c.id))
        const known = index[c.id]
        const containers = known?.containers.length ? known.containers : await unwrap(window.api.containers(c.id))
        indexApi.containers(c.id, containers)
        for (const ct of containers) if (!known || !(ct in known.objects)) indexApi.objects(c.id, ct, await unwrap(window.api.objects(c.id, ct)))
      } catch (e) {
        setScanErrors((prev) => ({ ...prev, [c.id]: errMsg(e) }))
      }
    }
    setScanning(false)
  }

  const toggleGroup = (g: string): void =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (!next.delete(g)) next.add(g)
      return next
    })

  const kindOf = (connId: string): DbKind | undefined => props.connections.find((c) => c.id === connId)?.kind

  return (
    <aside className="sidebar">
      <div className="search">
        <IconSearch size={14} />
        <input
          placeholder="Search connections / objects"
          title="Finds connections, tables, views, functions and saved queries. Several words must all match."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
        />
        {filter && (
          <button className="search-clear" title="Clear (Esc)" onClick={() => setFilter('')}>
            ×
          </button>
        )}
      </div>
      <div className="tree">
        {searching && shown.size > 0 && <div className="sr-head">Connections</div>}
        {groups.map(([group, conns]) => (
          <div key={group || '__none'} hidden={!conns.some((c) => shown.has(c.id))}>
            {group && (
              <div className="node group" onClick={() => toggleGroup(group)}>
                <span className="chev">{collapsedGroups.has(group) ? '▸' : '▾'}</span>
                <IconFolder size={15} className="ic folder" />
                <span className="label">{group}</span>
                <span className="count">{conns.filter((c) => shown.has(c.id)).length}</span>
              </div>
            )}
            {!collapsedGroups.has(group) &&
              conns.map((c) => (
                <div key={c.id} className={group ? 'indent' : ''} hidden={!shown.has(c.id)}>
                  <ConnectionNode cfg={c} filter={searching ? filter.trim().toLowerCase() : ''} showMenu={showMenu} index={indexApi} compact={searching} clearSearch={() => setFilter('')} {...props} />
                </div>
              ))}
          </div>
        ))}
        {props.connections.length === 0 && <div className="muted pad">No connections yet. Use “Connection” to add one.</div>}

        {searching && results && (
          <div className="sr">
            <div className="sr-head">
              Tables, views, functions and queries{results.total > 0 ? ` · ${results.total}` : ''}
            </div>
            {results.groups.map((g) => {
              const kind = kindOf(g.connId)
              return (
                <div key={g.key}>
                  <div className="node sr-group" title={g.container ? `${g.connName} › ${g.container}` : `${g.connName} · saved for every database`}>
                    {kind && <KindBadge kind={kind} />}
                    <span className="label">
                      {g.connName}
                      {g.container ? ` › ${g.container}` : ''}
                    </span>
                    {g.container === null && <span className="count">any database</span>}
                  </div>
                  {g.items.map((item) =>
                    item.kind === 'object' ? (
                      <div
                        key={`${item.container}|${item.obj.type}|${item.obj.schema ?? ''}|${item.obj.name}|${item.obj.args ?? ''}`}
                        className={`node leaf sr-item ${isSel(props.selection, 'object', g.connId, item.container, item.obj) ? 'selected' : ''}`}
                        title={`${item.label}  (${item.obj.type === 'matview' ? 'materialized view' : item.obj.type}) — double-click to open`}
                        onClick={() => props.onSelect({ type: 'object', connId: g.connId, container: item.container, obj: item.obj })}
                        onDoubleClick={() => props.onOpenObject({ connId: g.connId, container: item.container, obj: item.obj, mode: item.obj.type === 'function' ? 'definition' : 'data' })}
                        onContextMenu={(e) => {
                          props.onSelect({ type: 'object', connId: g.connId, container: item.container, obj: item.obj })
                          showMenu(e, objectMenu(props, g.connId, item.container, item.obj))
                        }}
                      >
                        <ObjectIcon type={item.obj.type} />
                        <span className="label">
                          <Hl text={item.label} words={words} />
                        </span>
                        <span className="count">{item.obj.type === 'matview' ? 'mat. view' : item.obj.type}</span>
                      </div>
                    ) : (
                      <div
                        key={item.query.id}
                        className="node leaf sr-item"
                        title={item.query.sql.slice(0, 300)}
                        onDoubleClick={() => props.onOpenQuery(item.query)}
                        onContextMenu={(e) =>
                          showMenu(e, [
                            { label: 'Open', onClick: () => props.onOpenQuery(item.query) },
                            { label: 'Delete', onClick: () => props.onDeleteQuery(item.query) }
                          ])
                        }
                      >
                        <IconQuery size={15} className="ic query" />
                        <span className="label">
                          <Hl text={item.label} words={words} />
                          <span className="sr-sql"> {item.query.sql.replace(/\s+/g, ' ').slice(0, 80)}</span>
                        </span>
                        <span className="count">query</span>
                      </div>
                    )
                  )}
                </div>
              )
            })}
            {results.total === 0 && <div className="muted pad small-note">No table, view, function or saved query matches “{filter.trim()}”.</div>}
            {results.total > results.shown && (
              <div className="muted pad small-note">
                Showing the first {results.shown} of {results.total}. Type more to narrow it down.
              </div>
            )}
            {unsearched.length > 0 && (
              <div className="sr-foot">
                <div className="muted small-note">
                  {unsearched.length} of {props.connections.length} connection(s) are not fully loaded, so some of their tables, views and functions cannot be found yet.
                </div>
                <button disabled={scanning} onClick={() => void searchEverywhere()}>
                  {scanning ? 'Searching…' : 'Search all connections'}
                </button>
                {Object.entries(scanErrors).map(([id, err]) => (
                  <div key={id} className="msg error small">
                    {props.connections.find((c) => c.id === id)?.name}: {err}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} />}
    </aside>
  )
}

type NodeProps = Props & { cfg: ConnectionConfig; filter: string; showMenu: ShowMenu; index: IndexApi; /** While searching, a connection is a plain row: its objects are listed in the results. */ compact: boolean; clearSearch: () => void }

function ConnectionNode({ cfg, filter, showMenu, ...p }: NodeProps): JSX.Element {
  const [containers, setContainers] = useState<string[] | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    await unwrap(window.api.open(cfg.id))
    const list = await unwrap(window.api.containers(cfg.id))
    setContainers(list)
    p.index.containers(cfg.id, list)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        onDoubleClick={() => {
          if (p.compact) p.clearSearch() // open it in the tree, where its databases can be browsed
          void toggle()
        }}
        onContextMenu={(e) => {
          p.onSelect({ type: 'conn', connId: cfg.id })
          showMenu(e, items)
        }}
      >
        <span
          className="chev"
          onClick={(e) => {
            e.stopPropagation()
            if (p.compact) p.clearSearch()
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
        containers?.map((ct) => (
          <div key={ct} hidden={p.compact}>
            <ContainerNode cfg={cfg} container={ct} filter={filter} showMenu={showMenu} {...p} />
          </div>
        ))}
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
    const list = await unwrap(window.api.objects(cfg.id, container))
    setObjects(list)
    p.index.objects(cfg.id, container, list)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const leafMenu = (o: DbObject): MenuItem[] => objectMenu(p, cfg.id, container, o)

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
