import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HistoryEntry, SavedQuery, SavedQueryInput, Snippet } from '@shared/types'

const MAX_HISTORY = 500

function load<T>(name: string): T[] {
  const f = join(app.getPath('userData'), name)
  if (!existsSync(f)) return []
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as T[]
  } catch {
    // A corrupt file shouldn't block the app; start fresh.
    return []
  }
}

function store<T>(name: string, items: T[]): void {
  writeFileSync(join(app.getPath('userData'), name), JSON.stringify(items))
}

export const history = {
  list: (): HistoryEntry[] => load<HistoryEntry>('history.json'),
  add(e: Omit<HistoryEntry, 'id'>): void {
    const items = [{ ...e, id: crypto.randomUUID() }, ...load<HistoryEntry>('history.json')]
    store('history.json', items.slice(0, MAX_HISTORY))
  },
  clear: (): void => store('history.json', [])
}

export const snippets = {
  list: (): Snippet[] => load<Snippet>('snippets.json'),
  save(name: string, body: string): void {
    store('snippets.json', [{ id: crypto.randomUUID(), name, body, at: Date.now() }, ...load<Snippet>('snippets.json')])
  },
  delete: (id: string): void => store('snippets.json', load<Snippet>('snippets.json').filter((s) => s.id !== id))
}

export const saved = {
  list: (): SavedQuery[] => load<SavedQuery>('saved-queries.json'),
  /** Insert, or overwrite in place when `q.id` matches an existing query. Returns the id. */
  save(q: SavedQueryInput): string {
    const items = load<SavedQuery>('saved-queries.json')
    const id = q.id && items.some((x) => x.id === q.id) ? q.id : crypto.randomUUID()
    const entry: SavedQuery = { id, name: q.name, sql: q.sql, at: Date.now(), connId: q.connId, connName: q.connName, container: q.container }
    store('saved-queries.json', [entry, ...items.filter((x) => x.id !== id)])
    return id
  },
  delete: (id: string): void => store('saved-queries.json', load<SavedQuery>('saved-queries.json').filter((q) => q.id !== id))
}
