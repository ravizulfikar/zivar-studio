import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import type {
  ConnectionConfig,
  DbObject,
  HistoryEntry,
  IpcResult,
  DumpOptions,
  RowChange,
  SavedQueryInput,
  TransferEndpoint,
  TransferOptions,
  ScriptOptions,
  ScriptStatement,
  TableDataOptions
} from '@shared/types'
import type { Driver } from './db/driver'
import { createDriver } from './db/factory'
import { dumpSql } from './dump'
import { KeyedQueue } from './queue'
import * as library from './library'
import { runScript } from './script'
import { transferTables } from './transfer'
import * as store from './store'
import { legacyProfile } from './userData'
import { openSplash } from './splash'
import { checkForUpdates } from './updates'
import { shouldShowSplash, splashMinMs } from './splashContent'
import { existsSync } from 'node:fs'

// Keep using the data folder of earlier builds (before the rename) so saved connections and queries survive.
// An explicit --user-data-dir always wins, and ZIVAR_APPDATA_DIR stands in for %APPDATA% (tests use a throwaway one:
// Electron reads the real folder from Windows, so the APPDATA variable alone would not keep a test away from it).
if (!app.commandLine.hasSwitch('user-data-dir')) {
  const legacy = legacyProfile(process.env['ZIVAR_APPDATA_DIR'] ?? app.getPath('appData'), app.getPath('userData'), existsSync)
  if (legacy) app.setPath('userData', legacy)
}

const sessions = new Map<string, Driver>()
/** One job at a time per connection, so a transaction is never interleaved with another tab's queries. */
const queue = new KeyedQueue()
/** In-flight opens, so a double-click can't create two connections. */
const opening = new Map<string, Promise<void>>()

async function closeSession(id: string): Promise<void> {
  const d = sessions.get(id)
  sessions.delete(id)
  await d?.close()
}

function session(id: string): Driver {
  const d = sessions.get(id)
  if (!d) throw new Error('Connection is not open')
  return d
}

/** IDs of connections whose running script or dump the user asked to stop. */
const cancelled = new Set<string>()

/** Like handle(), for handlers that need the calling window (progress events, dialogs). */
function handleWithEvent<A extends unknown[], T>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: A) => T | Promise<T>): void {
  ipcMain.handle(channel, async (e, ...args): Promise<IpcResult<T>> => {
    try {
      return { ok: true, data: await fn(e, ...(args as A)) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

/** Wrap a handler so thrown errors reach the renderer as { ok: false }. */
function handle<A extends unknown[], T>(
  channel: string,
  fn: (...args: A) => T | Promise<T>
): void {
  ipcMain.handle(channel, async (_e, ...args): Promise<IpcResult<T>> => {
    try {
      return { ok: true, data: await fn(...(args as A)) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

function registerIpc(): void {
  handle('connections:list', () => store.listConnections())
  handle('connections:save', async (cfg: ConnectionConfig) => {
    store.saveConnection(cfg)
    // Reconnect with the new settings next time it is opened.
    await queue.run(cfg.id, () => closeSession(cfg.id))
  })
  handle('connections:delete', async (id: string) => {
    await queue.run(id, () => closeSession(id))
    store.deleteConnection(id)
  })
  handle('connections:test', async (cfg: ConnectionConfig) => {
    const d = createDriver(cfg)
    await d.connect()
    await d.close()
  })

  ipcMain.handle('dialog:sqlite', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] }, { name: 'All', extensions: ['*'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('dialog:file', async (_e, title: string) => {
    const r = await dialog.showOpenDialog({ title, properties: ['openFile', 'showHiddenFiles'] })
    return r.canceled ? null : r.filePaths[0]
  })

  handle('db:open', async (id: string) => {
    if (sessions.has(id)) return
    let pending = opening.get(id)
    if (!pending) {
      pending = (async () => {
        const d = createDriver(store.getConnection(id))
        await d.connect()
        sessions.set(id, d)
      })().finally(() => opening.delete(id))
      opening.set(id, pending)
    }
    await pending
  })
  handle('db:close', (id: string) => queue.run(id, () => closeSession(id)))
  handle('db:containers', (id: string) => queue.run(id, () => session(id).containers()))
  handle('db:objects', (id: string, c: string) => queue.run(id, () => session(id).objects(c)))
  handle('db:describe', (id: string, c: string, o: DbObject) => queue.run(id, () => session(id).describe(c, o)))
  handle('db:designInfo', (id: string, c: string, o: DbObject) => queue.run(id, () => session(id).designInfo(c, o)))
  handle('db:executeDdl', (id: string, c: string, s: string[]) => queue.run(id, () => session(id).executeDdl(c, s)))
  handle('db:definition', (id: string, c: string, o: DbObject) => queue.run(id, () => session(id).definition(c, o)))
  handle('db:previewSql', (id: string, c: string, o: DbObject) => queue.run(id, async () => session(id).previewSql(c, o)))
  handle('db:query', (id: string, c: string | null, sql: string) => queue.run(id, () => session(id).query(sql, c)))
  handle('db:cancel', (id: string) => session(id).cancel())
  handle('db:tableData', (id: string, c: string, o: DbObject, opts: TableDataOptions) => queue.run(id, () => session(id).tableData(c, o, opts)))
  handle('db:applyChanges', (id: string, c: string, o: DbObject, ch: RowChange[]) => queue.run(id, () => session(id).applyChanges(c, o, ch)))
  handle('db:insertRows', (id: string, c: string, o: DbObject, cols: string[], rows: unknown[][]) => queue.run(id, () => session(id).insertRows(c, o, cols, rows)))
  handleWithEvent('db:runScript', async (e, id: string, container: string | null, statements: ScriptStatement[], opts: ScriptOptions) => {
    const d = session(id)
    const kind = store.getConnection(id).kind
    cancelled.delete(id)
    return queue.run(id, () =>
      runScript(d, kind, container, statements, opts, {
        isCancelled: () => cancelled.has(id),
        onProgress: (done, total) => e.sender.send('script:progress', { done, total })
      })
    )
  })
  handle('db:cancelScript', async (id: string) => {
    cancelled.add(id)
    await session(id).cancel().catch(() => undefined) // also interrupt the statement that is running right now
  })
  handleWithEvent('db:dump', async (e, id: string, container: string, tables: DbObject[], opts: DumpOptions, defaultName: string) => {
    const d = session(id)
    const kind = store.getConnection(id).kind
    const win = BrowserWindow.fromWebContents(e.sender)
    const pick = await dialog.showSaveDialog(win ?? BrowserWindow.getAllWindows()[0], {
      title: 'Save SQL dump',
      defaultPath: defaultName,
      filters: [{ name: 'SQL', extensions: ['sql'] }, { name: 'All files', extensions: ['*'] }]
    })
    if (pick.canceled || !pick.filePath) return null
    cancelled.delete(id)
    return queue.run(id, () =>
      dumpSql(d, kind, container, tables, opts, pick.filePath as string, {
        isCancelled: () => cancelled.has(id),
        onProgress: (done, total, label) => e.sender.send('dump:progress', { done, total, label })
      })
    )
  })
  handleWithEvent('db:transfer', async (e, src: TransferEndpoint, dst: TransferEndpoint, tables: DbObject[], opts: TransferOptions) => {
    const srcDriver = session(src.connId)
    const dstDriver = session(dst.connId)
    const srcKind = store.getConnection(src.connId).kind
    const dstKind = store.getConnection(dst.connId).kind
    cancelled.delete(dst.connId)
    // Both connections are held for the whole job so nothing else interleaves with its transactions.
    return queue.runAll([src.connId, dst.connId], () =>
      transferTables({ driver: srcDriver, kind: srcKind, container: src.container }, { driver: dstDriver, kind: dstKind, container: dst.container }, tables, opts, {
        isCancelled: () => cancelled.has(dst.connId),
        onProgress: (done, total, label) => e.sender.send('transfer:progress', { done, total, label })
      })
    )
  })
  handle('db:schemaCompletion', (id: string, c: string) => queue.run(id, () => session(id).schemaCompletion(c)))

  handle('update:check', (auto: boolean) => checkForUpdates(__APP_VERSION__, !!auto))

  handle('history:list', () => library.history.list())
  handle('history:add', (e: Omit<HistoryEntry, 'id'>) => library.history.add(e))
  handle('history:clear', () => library.history.clear())
  handle('saved:list', () => library.saved.list())
  handle('saved:save', (q: SavedQueryInput) => library.saved.save(q))
  handle('saved:delete', (id: string) => library.saved.delete(id))
  handle('snippets:list', () => library.snippets.list())
  handle('snippets:save', (name: string, body: string) => library.snippets.save(name, body))
  handle('snippets:delete', (id: string) => library.snippets.delete(id))
}

let firstWindow = true

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false, // shown once the page is drawn (and the splash, if any, has been seen)
    title: 'Zivar Database Studio',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  // Links leave the app through the system browser, and only web links: never file: or custom schemes.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // The window itself never navigates away from the app.
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // The start-up splash is for the first window of a normal start only.
  const automated = app.commandLine.hasSwitch('remote-debugging-port')
  const splash = firstWindow && shouldShowSplash(process.env, automated) ? openSplash() : null
  firstWindow = false
  const drawn = new Promise<void>((resolve) => {
    win.once('ready-to-show', () => resolve())
    win.webContents.once('did-fail-load', () => resolve()) // show the window anyway: it will say what went wrong
    setTimeout(resolve, 15000) // never hold the app hostage
  })
  void Promise.all([drawn, splash?.shown ?? Promise.resolve(0)]).then(async ([, shownAt]) => {
    if (splash) await new Promise((r) => setTimeout(r, Math.max(0, splashMinMs(process.env) - (Date.now() - shownAt))))
    if (!win.isDestroyed()) win.show()
    await splash?.dismiss()
  })
}

app.whenReady().then(() => {
  // The renderer draws its own menu bar; drop Electron's default one.
  Menu.setApplicationMenu(null)
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  await Promise.allSettled([...sessions.values()].map((d) => d.close()))
  sessions.clear()
  if (process.platform !== 'darwin') app.quit()
})
