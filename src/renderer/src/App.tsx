import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { ConnectionConfig, DbKind, DbObject, QueryResult, SavedQuery } from '@shared/types'
import { errMsg, unwrap } from './api'
import { ConnectionDialog } from './ConnectionDialog'
import { Details } from './Details'
import { exportResult, type ExportFormat } from './exportData'
import { IconDatabase, IconDesign, IconDiagram, IconJson, IconList, IconQuery, IconTable, ZivarLogo } from './Icons'
import { JsonTab } from './JsonTab'
import { DocsTab } from './DocsTab'
import { MenuBar, type Menu } from './MenuBar'
import { ObjectsTab } from './ObjectsTab'
import { clearSchemaCache, QueryTab } from './QueryTab'
import { DesignerTab } from './DesignerTab'
import { ErDiagramTab } from './ErDiagramTab'
import { ImportDialog } from './ImportDialog'
import { DumpDialog, RunScriptDialog } from './ScriptDialogs'
import { TableTab } from './TableTab'
import { Sidebar, type OpenRequest, type Selection } from './Sidebar'
import { StructureTab } from './StructureTab'
import { Toolbar } from './Toolbar'
import { SyncDialog, TransferDialog } from './TransferDialogs'
import { applyTheme, loadTheme, ThemeContext, type Theme } from './theme'

type Tab =
  | { id: string; title: string; kind: 'objects'; connId: string; container: string }
  | { id: string; title: string; kind: 'query'; connId: string; container: string | null; sql: string; savedId?: string; defKey?: string }
  | { id: string; title: string; kind: 'table'; connId: string; container: string; obj: DbObject }
  | { id: string; title: string; kind: 'structure'; connId: string; container: string; obj: DbObject }
  | { id: string; title: string; kind: 'design'; connId: string; container: string; obj?: DbObject }
  | { id: string; title: string; kind: 'er'; connId: string; container: string }
  | { id: string; title: string; kind: 'json'; connId: ''; container: null }
  | { id: string; title: string; kind: 'docs'; connId: ''; container: null }

const MIN_SIDE = 220
const MAX_SIDE = 640

export function App(): JSX.Element {
  const [connections, setConnections] = useState<ConnectionConfig[]>([])
  const [tabs, setTabs] = useState<Tab[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ initial: ConnectionConfig | null } | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [showDetails, setShowDetails] = useState(true)
  const [showSide, setShowSide] = useState(true)
  const [sideW, setSideW] = useState(300)
  const [refreshKey, setRefreshKey] = useState(0)
  const [results, setResults] = useState<Record<string, QueryResult | null>>({})
  const [about, setAbout] = useState(false)
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [scriptTarget, setScriptTarget] = useState<{ connId: string; container: string | null } | null>(null)
  const [transferFrom, setTransferFrom] = useState<{ connId: string; container: string } | null>(null)
  const [syncFrom, setSyncFrom] = useState<{ connId: string; container: string } | null>(null)
  const [dumpTarget, setDumpTarget] = useState<{ connId: string; container: string } | null>(null)
  const [importTarget, setImportTarget] = useState<{ connId: string; container: string; obj: DbObject } | null>(null)

  useEffect(() => applyTheme(theme), [theme])
  const toggleTheme = (): void => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  const reload = useCallback(async () => {
    setConnections(await unwrap(window.api.listConnections()))
  }, [])

  const reloadSaved = useCallback(async () => {
    setSavedQueries(await unwrap(window.api.savedList()))
  }, [])

  useEffect(() => {
    void reload()
    void reloadSaved()
  }, [reload, reloadSaved])

  const connName = (id: string): string => connections.find((c) => c.id === id)?.name ?? 'Query'
  const kindOf = (id: string): DbKind => connections.find((c) => c.id === id)?.kind ?? 'postgres'

  const addTab = (t: Tab): void => {
    setTabs((prev) => [...prev, t])
    setActive(t.id)
  }

  /** Focus an existing tab for the same target instead of opening duplicates. */
  const openOnce = (match: (t: Tab) => boolean, make: () => Tab): void => {
    const found = tabs.find(match)
    if (found) setActive(found.id)
    else addTab(make())
  }

  const sameObj = (a: DbObject, b: DbObject): boolean => a.name === b.name && a.schema === b.schema && a.type === b.type && a.args === b.args

  const openDefinition = async (r: OpenRequest): Promise<void> => {
    const key = `def|${r.connId}|${r.container}|${r.obj.type}|${r.obj.schema ?? ''}|${r.obj.name}|${r.obj.args ?? ''}`
    const existing = tabs.find((t) => t.kind === 'query' && t.defKey === key)
    if (existing) return setActive(existing.id)
    try {
      const sql = await unwrap(window.api.definition(r.connId, r.container, r.obj))
      addTab({ id: crypto.randomUUID(), title: `${r.obj.name} · definition`, kind: 'query', connId: r.connId, container: r.container, sql, defKey: key })
    } catch (e) {
      setNotice(`Could not load definition: ${errMsg(e)}`)
    }
  }

  const openObject = (r: OpenRequest): void => {
    if (r.mode === 'definition') {
      void openDefinition(r)
      return
    }
    if (r.mode === 'structure' && r.obj.type === 'table') {
      // Tables open in the designer; views and materialized views stay read-only.
      const obj = r.obj
      openOnce(
        (t) => t.kind === 'design' && t.connId === r.connId && t.container === r.container && !!t.obj && sameObj(t.obj, obj),
        () => ({ id: crypto.randomUUID(), title: `${obj.name} · design`, kind: 'design', connId: r.connId, container: r.container, obj })
      )
      return
    }
    if (r.mode === 'structure') {
      openOnce(
        (t) => t.kind === 'structure' && t.connId === r.connId && t.container === r.container && sameObj(t.obj, r.obj),
        () => ({ id: crypto.randomUUID(), title: `${r.obj.name} · structure`, kind: 'structure', connId: r.connId, container: r.container, obj: r.obj })
      )
      return
    }
    openOnce(
      (t) => t.kind === 'table' && t.connId === r.connId && t.container === r.container && sameObj(t.obj, r.obj),
      () => ({ id: crypto.randomUUID(), title: r.obj.name, kind: 'table', connId: r.connId, container: r.container, obj: r.obj })
    )
  }

  const openObjects = (connId: string, container: string): void =>
    openOnce(
      (t) => t.kind === 'objects' && t.connId === connId && t.container === container,
      () => ({ id: crypto.randomUUID(), title: `${container} · objects`, kind: 'objects', connId, container })
    )

  const openQuery = (q: SavedQuery): void => {
    if (!q.connId) return
    const connId = q.connId
    openOnce(
      (t) => t.kind === 'query' && t.savedId === q.id,
      () => ({ id: crypto.randomUUID(), title: q.name, kind: 'query', connId, container: q.container ?? null, sql: q.sql, savedId: q.id })
    )
  }

  const deleteQuery = async (q: SavedQuery): Promise<void> => {
    if (!window.confirm(`Delete saved query "${q.name}"?`)) return
    try {
      await unwrap(window.api.savedDelete(q.id))
      // Open tabs keep their text; they simply stop being linked to a saved query.
      setTabs((prev) => prev.map((t) => (t.kind === 'query' && t.savedId === q.id ? { ...t, savedId: undefined } : t)))
      await reloadSaved()
    } catch (e) {
      setNotice(errMsg(e))
    }
  }

  /** A query tab saved itself: link the tab to the saved entry and rename it. */
  const querySaved = (tabId: string, savedId: string, name: string): void => {
    setTabs((prev) => prev.map((t) => (t.id === tabId && t.kind === 'query' ? { ...t, savedId, title: name } : t)))
    void reloadSaved()
  }

  const openDiagram = (connId: string, container: string): void =>
    openOnce(
      (t) => t.kind === 'er' && t.connId === connId && t.container === container,
      () => ({ id: crypto.randomUUID(), title: `${container} · diagram`, kind: 'er', connId, container })
    )

  const openDocs = (): void =>
    openOnce(
      (t) => t.kind === 'docs',
      () => ({ id: crypto.randomUUID(), title: 'Dokumentasi', kind: 'docs', connId: '', container: null })
    )

  useEffect(() => {
    const f1 = (e: KeyboardEvent): void => {
      if (e.key === 'F1') {
        e.preventDefault()
        openDocs()
      }
    }
    window.addEventListener('keydown', f1)
    return () => window.removeEventListener('keydown', f1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })

  const jsonCount = useRef(0)
  const newJson = (): void => addTab({ id: crypto.randomUUID(), title: `JSON ${++jsonCount.current}`, kind: 'json', connId: '', container: null })

  const newTable = (connId: string, container: string): void =>
    addTab({ id: crypto.randomUUID(), title: 'New table', kind: 'design', connId, container })

  /** The designer changed the schema: retitle its tab and make every list reload. */
  const designApplied = (tabId: string, obj: DbObject): void => {
    setTabs((prev) => prev.map((t) => (t.id === tabId && t.kind === 'design' ? { ...t, obj, title: `${obj.name} · design` } : t)))
    clearSchemaCache()
    setRefreshKey((k) => k + 1)
  }

  const newQuery = (connId: string, container: string | null): void =>
    addTab({ id: crypto.randomUUID(), title: `${container ?? connName(connId)} · query`, kind: 'query', connId, container, sql: '' })

  const closeTab = (id: string): void => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id)
      if (active === id) setActive(next.at(-1)?.id ?? null)
      return next
    })
    setResults(({ [id]: _drop, ...rest }) => rest)
  }

  const deleteConnection = async (c: ConnectionConfig): Promise<void> => {
    if (!window.confirm(`Delete connection "${c.name}"?`)) return
    await unwrap(window.api.deleteConnection(c.id))
    setTabs((prev) => prev.filter((t) => t.connId !== c.id))
    setSelection((s) => (s?.connId === c.id ? null : s))
    await reload()
  }

  const refresh = (): void => {
    clearSchemaCache()
    void reload()
    void reloadSaved()
    setRefreshKey((k) => k + 1)
  }

  const exportActive = (format: ExportFormat): void => {
    const r = active ? results[active] : null
    const tab = tabs.find((t) => t.id === active)
    if (!r || !tab) return
    try {
      exportResult(r, `${tab.title}`.replace(/[\\/:*?"<>|]/g, '_'), format, { kind: kindOf(tab.connId), table: tab.kind === 'table' ? tab.obj.name : undefined })
    } catch (e) {
      setNotice(errMsg(e))
    }
  }

  // Stable per-tab callbacks so QueryTab's `run` identity doesn't change on every render.
  const resultSetters = useRef(new Map<string, (r: QueryResult | null) => void>())
  const setterFor = (id: string): ((r: QueryResult | null) => void) => {
    let fn = resultSetters.current.get(id)
    if (!fn) {
      fn = (r) => setResults((prev) => ({ ...prev, [id]: r }))
      resultSetters.current.set(id, fn)
    }
    return fn
  }

  const startSideDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sideW
    const move = (ev: MouseEvent): void => setSideW(Math.max(MIN_SIDE, Math.min(MAX_SIDE, startW + ev.clientX - startX)))
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const selConn = selection?.connId ?? null
  const selContainer = selection && 'container' in selection ? selection.container : null
  const selObject = selection?.type === 'object' ? selection : null
  const activeTab = tabs.find((t) => t.id === active)
  const groups = useMemo(() => [...new Set(connections.map((c) => c.group).filter((g): g is string => !!g))].sort(), [connections])

  const hasTableObject = !!selObject && selObject.obj.type !== 'function'
  const canImport = selObject?.obj.type === 'table'
  const startImport = (): void => {
    if (selObject && selObject.obj.type === 'table') setImportTarget({ connId: selObject.connId, container: selObject.container, obj: selObject.obj })
  }

  const doOpenTable = (mode: 'data' | 'structure'): void => {
    if (selObject) openObject({ connId: selObject.connId, container: selObject.container, obj: selObject.obj, mode })
  }

  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'New connection…', onClick: () => setDialog({ initial: null }) },
        { label: 'New query', onClick: () => selConn && newQuery(selConn, selContainer), disabled: !selConn },
        { label: 'New table…', onClick: () => selConn && selContainer && newTable(selConn, selContainer), disabled: !(selConn && selContainer) },
        { label: 'ER diagram', onClick: () => selConn && selContainer && openDiagram(selConn, selContainer), disabled: !(selConn && selContainer) },
        { label: 'Import data into table…', onClick: startImport, disabled: !canImport },
        { label: 'Run SQL file…', onClick: () => selConn && setScriptTarget({ connId: selConn, container: selContainer }), disabled: !selConn },
        { label: 'Dump SQL file…', onClick: () => selConn && selContainer && setDumpTarget({ connId: selConn, container: selContainer }), disabled: !(selConn && selContainer) },
        { label: 'Transfer data…', onClick: () => selConn && selContainer && setTransferFrom({ connId: selConn, container: selContainer }), disabled: !(selConn && selContainer) },
        { label: 'Synchronize structure…', onClick: () => selConn && selContainer && setSyncFrom({ connId: selConn, container: selContainer }), disabled: !(selConn && selContainer) },
        { separator: true, label: '' },
        { label: 'Close tab', onClick: () => active && closeTab(active), disabled: !active },
        { label: 'Exit', onClick: () => window.close() }
      ]
    },
    {
      label: 'View',
      items: [
        { label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', onClick: toggleTheme },
        { label: showSide ? 'Hide sidebar' : 'Show sidebar', onClick: () => setShowSide((v) => !v) },
        { label: showDetails ? 'Hide details panel' : 'Show details panel', onClick: () => setShowDetails((v) => !v) },
        { separator: true, label: '' },
        { label: 'Refresh', onClick: refresh }
      ]
    },
    {
      label: 'Tools',
      items: [
        { label: 'JSON editor', onClick: newJson },
        { separator: true, label: '' },
        { label: 'Export result as Excel (.xlsx)…', onClick: () => exportActive('xlsx'), disabled: !(active && results[active]?.columns.length) },
        { label: 'Export result as CSV…', onClick: () => exportActive('csv'), disabled: !(active && results[active]?.columns.length) },
        { label: 'Export result as JSON…', onClick: () => exportActive('json'), disabled: !(active && results[active]?.columns.length) },
        { label: 'Export result as SQL INSERT…', onClick: () => exportActive('sql'), disabled: !(active && results[active]?.columns.length) }
      ]
    },
    {
      label: 'Help',
      items: [
        { label: 'Documentation', hint: 'F1', onClick: openDocs },
        { separator: true, label: '' },
        { label: 'About Zivar Database Studio', onClick: () => setAbout(true) }
      ]
    }
  ]

  return (
    <ThemeContext.Provider value={theme}>
    <div className="app">
      <MenuBar menus={menus} />
      <Toolbar
        onNewConnection={() => setDialog({ initial: null })}
        onNewQuery={() => selConn && newQuery(selConn, selContainer)}
        onObjects={() => selConn && selContainer && openObjects(selConn, selContainer)}
        onNewTable={() => selConn && selContainer && newTable(selConn, selContainer)}
        canNewTable={!!selConn && !!selContainer}
        onDiagram={() => selConn && selContainer && openDiagram(selConn, selContainer)}
        canDiagram={!!selConn && !!selContainer}
        onImport={startImport}
        canImport={canImport}
        onOpenTable={() => doOpenTable('data')}
        onDesign={() => doOpenTable('structure')}
        onRefresh={refresh}
        onJson={newJson}
        onExport={exportActive}
        onToggleDetails={() => setShowDetails((v) => !v)}
        onToggleTheme={toggleTheme}
        theme={theme}
        hasConnection={!!selConn}
        hasObject={hasTableObject}
        canExport={!!(active && results[active]?.columns.length)}
        detailsOpen={showDetails}
      />
      <div className="body">
        {showSide && (
          <>
            <div className="side" style={{ width: sideW }}>
              <Sidebar
                connections={connections}
                selection={selection}
                refreshKey={refreshKey}
                onSelect={setSelection}
                onOpenObject={openObject}
                onOpenObjects={openObjects}
                savedQueries={savedQueries}
                onOpenQuery={openQuery}
                onDeleteQuery={(q) => void deleteQuery(q)}
                onNewQuery={newQuery}
                onNewTable={newTable}
                onImportData={(connId, container, obj) => setImportTarget({ connId, container, obj })}
                onRunScript={(connId, container) => setScriptTarget({ connId, container })}
                onDump={(connId, container) => setDumpTarget({ connId, container })}
                onTransfer={(connId, container) => setTransferFrom({ connId, container })}
                onSync={(connId, container) => setSyncFrom({ connId, container })}
                onDiagram={openDiagram}
                onEdit={(c) => setDialog({ initial: c })}
                onDelete={(c) => void deleteConnection(c)}
              />
              {showDetails && <Details selection={selection} connections={connections} refreshKey={refreshKey} />}
            </div>
            <div className="vsplit" onMouseDown={startSideDrag} />
          </>
        )}
        <main className="main">
          <div className="tabs">
            {tabs.map((t) => (
              <div key={t.id} className={`tab ${t.id === active ? 'active' : ''}`} onClick={() => setActive(t.id)} title={t.title}>
                {t.kind === 'query' ? <IconQuery size={14} className="ic query" /> : t.kind === 'table' ? <IconTable size={14} className="ic table" /> : t.kind === 'design' ? <IconDesign size={14} className="ic table" /> : t.kind === 'er' ? <IconDiagram size={14} className="ic query" /> : t.kind === 'json' ? <IconJson size={14} className="ic query" /> : t.kind === 'docs' ? <IconList size={14} className="ic db" /> : t.kind === 'objects' ? <IconDatabase size={14} className="ic db" /> : <IconTable size={14} className="ic table" />}
                <span className="tab-title">{t.title}</span>
                <span
                  className="x"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(t.id)
                  }}
                >
                  ×
                </span>
              </div>
            ))}
          </div>
          <div className="panes">
            {tabs.length === 0 && (
              <div className="empty">
                <IconDatabase size={42} />
                <p>Open a connection from the sidebar, then double-click a table — or start a new query.</p>
              </div>
            )}
            {/* Keep inactive tabs mounted so their editor and results survive tab switches. */}
            {tabs.map((t) => (
              <div key={t.id} className="pane" hidden={t.id !== active}>
                {t.kind === 'query' ? (
                  <QueryTab
                    connId={t.connId}
                    connName={connName(t.connId)}
                    kind={kindOf(t.connId)}
                    container={t.container}
                    initialSql={t.sql}
                    savedId={t.savedId}
                    savedName={t.savedId ? t.title : undefined}
                    scopeless={t.defKey !== undefined}
                    onSaved={(id, name) => querySaved(t.id, id, name)}
                    onResult={setterFor(t.id)}
                  />
                ) : t.kind === 'table' ? (
                  <TableTab
                    connId={t.connId}
                    connName={connName(t.connId)}
                    kind={kindOf(t.connId)}
                    container={t.container}
                    obj={t.obj}
                    refreshKey={refreshKey}
                    onResult={setterFor(t.id)}
                    onImport={() => setImportTarget({ connId: t.connId, container: t.container, obj: t.obj })}
                  />
                ) : t.kind === 'docs' ? (
                  <DocsTab />
                ) : t.kind === 'json' ? (
                  <JsonTab />
                ) : t.kind === 'er' ? (
                  <ErDiagramTab
                    connId={t.connId}
                    container={t.container}
                    kind={kindOf(t.connId)}
                    refreshKey={refreshKey}
                    onOpenTable={(obj) => openObject({ connId: t.connId, container: t.container, obj, mode: 'data' })}
                  />
                ) : t.kind === 'design' ? (
                  <DesignerTab
                    connId={t.connId}
                    connName={connName(t.connId)}
                    kind={kindOf(t.connId)}
                    container={t.container}
                    obj={t.obj}
                    onApplied={(o) => designApplied(t.id, o)}
                  />
                ) : t.kind === 'objects' ? (
                  <ObjectsTab
                    connId={t.connId}
                    container={t.container}
                    refreshKey={refreshKey}
                    onOpen={(obj, mode) => openObject({ connId: t.connId, container: t.container, obj, mode })}
                  />
                ) : (
                  <StructureTab connId={t.connId} container={t.container} obj={t.obj} />
                )}
              </div>
            ))}
          </div>
        </main>
      </div>
      <div className="statusbar">
        <span>{connections.length} connection(s)</span>
        <span>
          {activeTab ? `${connName(activeTab.connId)}${activeTab.container ? ` › ${activeTab.container}` : ''}` : 'Ready'}
        </span>
      </div>
      {scriptTarget && (
        <RunScriptDialog
          connId={scriptTarget.connId}
          connName={connName(scriptTarget.connId)}
          kind={kindOf(scriptTarget.connId)}
          container={scriptTarget.container}
          onClose={() => setScriptTarget(null)}
          onDone={() => {
            clearSchemaCache()
            setRefreshKey((k) => k + 1)
          }}
        />
      )}
      {transferFrom && (
        <TransferDialog
          connections={connections}
          source={transferFrom}
          onClose={() => setTransferFrom(null)}
          onDone={() => {
            clearSchemaCache()
            setRefreshKey((k) => k + 1)
          }}
        />
      )}
      {syncFrom && (
        <SyncDialog
          connections={connections}
          source={syncFrom}
          onClose={() => setSyncFrom(null)}
          onDone={() => {
            clearSchemaCache()
            setRefreshKey((k) => k + 1)
          }}
        />
      )}
      {dumpTarget && (
        <DumpDialog
          connId={dumpTarget.connId}
          connName={connName(dumpTarget.connId)}
          kind={kindOf(dumpTarget.connId)}
          container={dumpTarget.container}
          onClose={() => setDumpTarget(null)}
        />
      )}
      {importTarget && (
        <ImportDialog
          connId={importTarget.connId}
          container={importTarget.container}
          obj={importTarget.obj}
          onClose={() => setImportTarget(null)}
          onImported={() => setRefreshKey((k) => k + 1)}
        />
      )}
      {notice && (
        <div className="backdrop" onClick={() => setNotice(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <p className="msg error">{notice}</p>
            <div className="row end">
              <button className="primary" onClick={() => setNotice(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {dialog && (
        <ConnectionDialog
          groups={groups}
          initial={dialog.initial}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            void reload()
          }}
        />
      )}
      {about && (
        <div className="backdrop" onClick={() => setAbout(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="about">
              <ZivarLogo size={64} />
              <h3>Zivar Database Studio</h3>
              <div className="muted">Version {__APP_VERSION__}</div>
              <a
                className="jed-link"
                href="https://zivar.my.id"
                onClick={(e) => {
                  e.preventDefault()
                  window.open('https://zivar.my.id')
                }}
              >
                zivar.my.id
              </a>
            </div>
            <div className="row end">
              <button className="primary" onClick={() => setAbout(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </ThemeContext.Provider>
  )
}
