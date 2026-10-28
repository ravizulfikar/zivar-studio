import { contextBridge, ipcRenderer } from 'electron'
import type { Api, ProgressEvent } from '@shared/types'

const api: Api = {
  checkForUpdates: (auto) => ipcRenderer.invoke('update:check', auto),
  listConnections: () => ipcRenderer.invoke('connections:list'),
  saveConnection: (cfg) => ipcRenderer.invoke('connections:save', cfg),
  deleteConnection: (id) => ipcRenderer.invoke('connections:delete', id),
  testConnection: (cfg) => ipcRenderer.invoke('connections:test', cfg),
  pickSqliteFile: () => ipcRenderer.invoke('dialog:sqlite'),
  pickFile: (title) => ipcRenderer.invoke('dialog:file', title),

  open: (id) => ipcRenderer.invoke('db:open', id),
  close: (id) => ipcRenderer.invoke('db:close', id),
  containers: (id) => ipcRenderer.invoke('db:containers', id),
  objects: (id, c) => ipcRenderer.invoke('db:objects', id, c),
  describe: (id, c, o) => ipcRenderer.invoke('db:describe', id, c, o),
  designInfo: (id, c, o) => ipcRenderer.invoke('db:designInfo', id, c, o),
  executeDdl: (id, c, s) => ipcRenderer.invoke('db:executeDdl', id, c, s),
  definition: (id, c, o) => ipcRenderer.invoke('db:definition', id, c, o),
  previewSql: (id, c, o) => ipcRenderer.invoke('db:previewSql', id, c, o),
  query: (id, c, sql) => ipcRenderer.invoke('db:query', id, c, sql),
  cancel: (id) => ipcRenderer.invoke('db:cancel', id),
  tableData: (id, c, o, opts) => ipcRenderer.invoke('db:tableData', id, c, o, opts),
  applyChanges: (id, c, o, ch) => ipcRenderer.invoke('db:applyChanges', id, c, o, ch),
  insertRows: (id, c, o, cols, rows) => ipcRenderer.invoke('db:insertRows', id, c, o, cols, rows),
  runScript: (id, c, statements, opts) => ipcRenderer.invoke('db:runScript', id, c, statements, opts),
  cancelScript: (id) => ipcRenderer.invoke('db:cancelScript', id),
  dumpSql: (id, c, tables, opts, name) => ipcRenderer.invoke('db:dump', id, c, tables, opts, name),
  transfer: (src, dst, tables, opts) => ipcRenderer.invoke('db:transfer', src, dst, tables, opts),
  onProgress: (channel, cb) => {
    const listener = (_e: unknown, p: ProgressEvent): void => cb(p)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  schemaCompletion: (id, c) => ipcRenderer.invoke('db:schemaCompletion', id, c),

  historyList: () => ipcRenderer.invoke('history:list'),
  historyAdd: (e) => ipcRenderer.invoke('history:add', e),
  historyClear: () => ipcRenderer.invoke('history:clear'),
  savedList: () => ipcRenderer.invoke('saved:list'),
  savedSave: (q) => ipcRenderer.invoke('saved:save', q),
  savedDelete: (id) => ipcRenderer.invoke('saved:delete', id),
  snippetsList: () => ipcRenderer.invoke('snippets:list'),
  snippetSave: (name, body) => ipcRenderer.invoke('snippets:save', name, body),
  snippetDelete: (id) => ipcRenderer.invoke('snippets:delete', id)
}

contextBridge.exposeInMainWorld('api', api)
