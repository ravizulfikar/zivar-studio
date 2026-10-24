import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { MSSQL, MySQL, PostgreSQL, SQLite, sql, type SQLDialect } from '@codemirror/lang-sql'
import { search, searchKeymap } from '@codemirror/search'
import { keymap, type EditorView } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { minifySql } from '@shared/sqlSplit'
import type { DbKind, QueryResult } from '@shared/types'
import { format as formatSql } from 'sql-formatter'
import { errMsg, unwrap } from './api'
import { LibraryDialog, PromptDialog } from './Dialogs'
import { ExportMenu } from './ExportMenu'
import { exportResult } from './exportData'
import { IconCode, IconPlay, IconRefresh, IconSearch } from './Icons'
import { ResultGrid } from './ResultGrid'
import { SnippetMenu } from './SnippetMenu'
import { ThemeContext } from './theme'

const DIALECT: Record<DbKind, SQLDialect> = { postgres: PostgreSQL, mysql: MySQL, sqlite: SQLite, mssql: MSSQL }

/** EXPLAIN syntax per engine; SQL Server needs SET SHOWPLAN, which doesn't fit one statement. */
const EXPLAIN_PREFIX: Record<DbKind, string | null> = {
  postgres: 'EXPLAIN ',
  mysql: 'EXPLAIN ',
  sqlite: 'EXPLAIN QUERY PLAN ',
  mssql: null
}

const FORMAT_LANGUAGE: Record<DbKind, 'postgresql' | 'mysql' | 'transactsql' | 'sqlite'> = { postgres: 'postgresql', mysql: 'mysql', mssql: 'transactsql', sqlite: 'sqlite' }

/** Where unqualified table names resolve when no scope is picked. */
const defaultScope = (kind: DbKind): string | null => (kind === 'postgres' ? 'public' : kind === 'sqlite' ? 'main' : null)

const schemaCache = new Map<string, Record<string, string[]>>()

/** Forget cached table/column names, e.g. after the user refreshes the schema. */
export const clearSchemaCache = (): void => schemaCache.clear()

interface Props {
  connId: string
  connName: string
  kind: DbKind
  container: string | null
  initialSql: string
  /** Set when this tab is linked to a saved query; Save then overwrites it. */
  savedId?: string
  savedName?: string
  /** Definition tabs show a view/function's source, so they are not tied to a database for saving. */
  scopeless?: boolean
  onSaved: (id: string, name: string) => void
  /** Reports the latest result so the toolbar's Export can reach it. */
  onResult: (r: QueryResult | null) => void
}

export function QueryTab({ connId, connName, kind, container, initialSql, savedId, savedName, scopeless, onSaved, onResult }: Props): JSX.Element {
  const [text, setText] = useState(initialSql)
  const [ctr, setCtr] = useState<string | null>(container)
  const [containers, setContainers] = useState<string[]>([])
  const [schema, setSchema] = useState<Record<string, string[]>>({})
  const [result, setResult] = useState<QueryResult | null>(null)
  const [ranSql, setRanSql] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [filter, setFilter] = useState('')
  const [editorH, setEditorH] = useState(200)
  const [library, setLibrary] = useState(false)
  const [naming, setNaming] = useState(false)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const [editorNote, setEditorNote] = useState<string | null>(null)
  const [hasSelection, setHasSelection] = useState(false)
  const [snippetDraft, setSnippetDraft] = useState<string | null>(null)
  const [snippetVersion, setSnippetVersion] = useState(0)
  const theme = useContext(ThemeContext)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    unwrap(window.api.containers(connId)).then(setContainers, () => setContainers([]))
  }, [connId])

  // Load table/column names for autocomplete; cached per connection + scope.
  useEffect(() => {
    const scope = ctr ?? defaultScope(kind)
    if (!scope) return setSchema({})
    const key = `${connId}|${scope}`
    const cached = schemaCache.get(key)
    if (cached) return setSchema(cached)
    let stale = false
    unwrap(window.api.schemaCompletion(connId, scope)).then(
      (s) => {
        schemaCache.set(key, s)
        if (!stale) setSchema(s)
      },
      () => !stale && setSchema({}) // autocomplete is a nicety; never surface this as an error
    )
    return () => {
      stale = true
    }
  }, [connId, ctr, kind])

  /** The selected text if any, otherwise the whole editor. */
  const currentSql = useCallback((): string => {
    const v = viewRef.current
    if (!v) return text
    const sel = v.state.selection.main
    return sel.empty ? v.state.doc.toString() : v.state.sliceDoc(sel.from, sel.to)
  }, [text])

  const run = useCallback(
    async (sqlText: string, scope: string | null): Promise<void> => {
      if (!sqlText.trim()) return
      setRunning(true)
      setError(null)
      setRanSql(sqlText)
      const at = Date.now()
      let ok = true
      try {
        const r = await unwrap(window.api.query(connId, scope, sqlText))
        setResult(r)
        onResult(r)
      } catch (e) {
        ok = false
        setResult(null)
        onResult(null)
        setError(errMsg(e))
      } finally {
        setRunning(false)
        void window.api.historyAdd({ connName, container: scope, sql: sqlText, at, durationMs: Date.now() - at, ok })
      }
    },
    [connId, connName, onResult]
  )

  const runEditor = (): void => void run(currentSql(), ctr)

  const explain = (): void => {
    const prefix = EXPLAIN_PREFIX[kind]
    if (prefix) void run(prefix + currentSql().trim().replace(/;+\s*$/, ''), ctr)
  }

  const stop = (): void => {
    void unwrap(window.api.cancel(connId)).catch((e) => setError(errMsg(e)))
  }

  // The keymap calls through a ref so editor extensions don't rebuild on every keystroke.
  const runRef = useRef(runEditor)
  runRef.current = runEditor
  const extensions = useMemo(
    () => [
      sql({ dialect: DIALECT[kind], schema, upperCaseKeywords: true }),
      // Ctrl+F opens find / replace inside the editor.
      search({ top: true }),
      keymap.of(searchKeymap),
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              runRef.current()
              return true
            }
          }
        ])
      )
    ],
    [kind, schema]
  )

  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = editorH
    const move = (ev: MouseEvent): void => setEditorH(Math.max(80, Math.min(600, startH + ev.clientY - startY)))
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  /** Save under the database the query is currently scoped to. */
  const persist = async (name: string): Promise<void> => {
    setNaming(false)
    try {
      const scope = scopeless ? container : (ctr ?? defaultScope(kind))
      const id = await unwrap(window.api.savedSave({ id: savedId, name, sql: text, connId, connName, container: scope }))
      onSaved(id, name)
      setSavedNote(`Saved “${name}”`)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const saveClicked = (): void => {
    // First save asks for a name; later saves overwrite quietly under the same name.
    if (savedId && savedName) void persist(savedName)
    else setNaming(true)
  }

  /** Apply a text transformation to the selection, or to the whole editor when nothing is selected. */
  const transform = (fn: (sql: string) => string): void => {
    const v = viewRef.current
    if (!v) return
    const sel = v.state.selection.main
    const from = sel.empty ? 0 : sel.from
    const to = sel.empty ? v.state.doc.length : sel.to
    try {
      v.dispatch({ changes: { from, to, insert: fn(v.state.sliceDoc(from, to)) } })
      setEditorNote(null)
    } catch (e) {
      setEditorNote(`Could not format: ${errMsg(e).split('\n')[0]}`)
    }
  }
  const beautify = (): void => transform((s) => formatSql(s, { language: FORMAT_LANGUAGE[kind], keywordCase: 'upper', tabWidth: 2 }))
  const minify = (): void => transform((s) => minifySql(s, kind))

  const insertSnippet = (body: string): void => {
    const v = viewRef.current
    if (!v) return
    v.dispatch(v.state.replaceSelection(body))
    v.focus()
  }
  const selectedText = (): string => {
    const v = viewRef.current
    const sel = v?.state.selection.main
    return v && sel && !sel.empty ? v.state.sliceDoc(sel.from, sel.to) : ''
  }

  const canStop = running && kind !== 'sqlite'

  return (
    <div className="pane-col">
      <div className="subtoolbar">
        <button className="run" disabled={running} onClick={runEditor} title="Run the selection, or everything if nothing is selected (Ctrl+Enter)">
          <IconPlay size={12} /> {running ? 'Running…' : 'Run'}
        </button>
        <button disabled={!canStop} onClick={stop} title={kind === 'sqlite' ? 'SQLite queries cannot be cancelled' : 'Cancel the running statement'}>
          ■ Stop
        </button>
        <button disabled={running || EXPLAIN_PREFIX[kind] === null} onClick={explain} title={EXPLAIN_PREFIX[kind] === null ? 'Not supported for SQL Server yet' : 'Show the execution plan'}>
          <IconCode size={14} /> Explain
        </button>
        <button onClick={() => void run(ranSql, ctr)} disabled={running || !ranSql} title="Re-run last query">
          <IconRefresh size={14} />
        </button>
        <button disabled={!text.trim()} onClick={beautify} title="Format the selection (or everything) with line breaks and indentation">
          Beautify
        </button>
        <button disabled={!text.trim()} onClick={minify} title="Collapse the selection (or everything) onto one line and strip comments">
          Minify
        </button>
        <SnippetMenu
          kind={kind}
          hasSelection={hasSelection}
          version={snippetVersion}
          onInsert={insertSnippet}
          onSaveSelection={() => setSnippetDraft(selectedText())}
        />
        <span className="sep-v" />
        <button disabled={!text.trim()} onClick={saveClicked} title={savedId ? 'Save changes to this saved query' : 'Save this query for this database'}>
          Save
        </button>
        <button onClick={() => setLibrary(true)} title="Query history and saved queries">
          History
        </button>
        <select value={ctr ?? ''} onChange={(e) => setCtr(e.target.value || null)} title="Database / schema scope">
          <option value="">(default)</option>
          {containers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="grow" />
        <div className="inline-search">
          <IconSearch size={13} />
          <input placeholder="Filter rows" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <ExportMenu
          variant="small"
          disabled={!result?.columns.length}
          onExport={(f) => {
            try {
              if (result) exportResult(result, `${connName}-result`, f, { kind })
            } catch (e) {
              setError(errMsg(e))
            }
          }}
        />
      </div>

      <div className="editor" style={{ height: editorH }}>
        <CodeMirror
          value={text}
          height="100%"
          theme={theme}
          extensions={extensions}
          onChange={setText}
          onCreateEditor={(view) => {
            viewRef.current = view
          }}
          onUpdate={(u) => setHasSelection(!u.state.selection.main.empty)}
        />
      </div>
      <div className="hsplit" onMouseDown={startDrag} />

      <div className="result">
        {error && <div className="msg error">{error}</div>}
        {result && <ResultGrid result={result} filter={filter} />}
        {!result && !error && !running && <div className="msg muted">Ctrl+Enter runs the selection (or the whole editor).</div>}
      </div>
      <div className="statusline">
        <span className="sqltext" title={ranSql}>
          {ranSql.replace(/\s+/g, ' ')}
        </span>
        {editorNote && <span className="editor-note">{editorNote}</span>}
        {savedNote && <span className="saved-note">{savedNote}</span>}
        {result && (
          <span>
            {result.columns.length ? `${result.rows.length} row(s)` : ''} · {result.durationMs} ms
          </span>
        )}
      </div>

      {library && (
        <LibraryDialog
          onClose={() => setLibrary(false)}
          onPick={(s) => {
            setText(s)
            setLibrary(false)
          }}
        />
      )}
      {snippetDraft !== null && (
        <PromptDialog
          title="Save snippet"
          label="Name"
          onCancel={() => setSnippetDraft(null)}
          onSubmit={(name) => {
            const body = snippetDraft
            setSnippetDraft(null)
            void unwrap(window.api.snippetSave(name, body)).then(
              () => {
                setSnippetVersion((v) => v + 1)
                setSavedNote(`Snippet “${name}” saved`)
              },
              (e) => setError(errMsg(e))
            )
          }}
        />
      )}
      {naming && (
        <PromptDialog
          title="Save query"
          label="Name"
          onCancel={() => setNaming(false)}
          onSubmit={(name) => void persist(name)}
        />
      )}
    </div>
  )
}
