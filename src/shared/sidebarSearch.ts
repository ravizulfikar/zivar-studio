import type { DbObject, DbObjectType, SavedQuery } from './types'

// The sidebar search: finds tables, views, materialized views, functions and saved queries by what you type,
// in every database the sidebar knows about. Pure, so it is unit-tested.

/** How an object is named in a list: a schema-qualified name when it lives in another schema than its container. */
export function objectLabel(o: DbObject, container: string): string {
  if (o.type === 'function') return `${o.name}(${o.args ?? ''})`
  return o.schema && o.schema !== container ? `${o.schema}.${o.name}` : o.name
}

/** The words of a search; an item matches when it contains every one of them (in any order, ignoring case). */
export const searchWords = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean)

export function matchesAll(text: string, words: string[]): boolean {
  const t = text.toLowerCase()
  return words.length > 0 && words.every((w) => t.includes(w))
}

export interface Highlighted {
  text: string
  hit: boolean
}

/** Cuts text into pieces, marking the ones that match any of the words. */
export function highlight(text: string, words: string[]): Highlighted[] {
  const lower = text.toLowerCase()
  const marked = new Array<boolean>(text.length).fill(false)
  for (const w of words) {
    for (let at = lower.indexOf(w); w && at !== -1; at = lower.indexOf(w, at + w.length)) marked.fill(true, at, at + w.length)
  }
  const out: Highlighted[] = []
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1]
    if (last && last.hit === marked[i]) last.text += text[i]
    else out.push({ text: text[i], hit: marked[i] })
  }
  return out
}

/** What the sidebar has loaded about one connection: its databases / schemas and the objects of each one it has opened. */
export interface IndexedConnection {
  containers: string[]
  objects: Record<string, DbObject[]>
}

export type SearchItem =
  | { kind: 'object'; container: string; obj: DbObject; label: string }
  | { kind: 'query'; query: SavedQuery; label: string }

export interface SearchGroup {
  /** Unique per connection + database. */
  key: string
  connId: string
  connName: string
  /** null: queries saved for every database of the connection. */
  container: string | null
  items: SearchItem[]
}

export interface SearchResult {
  groups: SearchGroup[]
  /** Every match, including the ones cut off by the limit. */
  total: number
  shown: number
}

const ORDER: Record<DbObjectType | 'query', number> = { table: 0, view: 1, matview: 2, function: 3, query: 4 }
const typeOf = (i: SearchItem): DbObjectType | 'query' => (i.kind === 'query' ? 'query' : i.obj.type)
const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

export function searchAll(
  words: string[],
  connections: { id: string; name: string }[],
  index: Record<string, IndexedConnection | undefined>,
  queries: SavedQuery[],
  limit = 200
): SearchResult {
  if (words.length === 0) return { groups: [], total: 0, shown: 0 }
  const groups = new Map<string, SearchGroup>()
  const group = (connId: string, connName: string, container: string | null): SearchGroup => {
    const key = `${connId}\u0000${container ?? ''}\u0000${container === null ? 'q' : 'o'}`
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { key, connId, connName, container, items: [] }))
    return g
  }

  for (const c of connections) {
    const data = index[c.id]
    if (!data) continue
    for (const [container, objects] of Object.entries(data.objects)) {
      for (const obj of objects) {
        const label = objectLabel(obj, container)
        if (matchesAll(label, words)) group(c.id, c.name, container).items.push({ kind: 'object', container, obj, label })
      }
    }
  }
  const names = new Map(connections.map((c) => [c.id, c.name]))
  for (const q of queries) {
    if (!matchesAll(`${q.name} ${q.sql}`, words)) continue
    // A query that belongs to a connection that no longer exists is still worth finding.
    const connName = (q.connId && names.get(q.connId)) || q.connName || 'Saved queries'
    // Queries sit under the database they were saved for; ones saved for any database of the connection get their own group.
    const g = group(q.connId ?? '', connName, q.container ?? null)
    g.items.push({ kind: 'query', query: q, label: q.name })
  }

  const sorted = [...groups.values()]
    .map((g) => ({ ...g, items: [...g.items].sort((a, b) => ORDER[typeOf(a)] - ORDER[typeOf(b)] || byName(a.label, b.label)) }))
    .sort((a, b) => byName(a.connName, b.connName) || (a.container === null ? 1 : b.container === null ? -1 : byName(a.container, b.container)))

  let total = 0
  for (const g of sorted) total += g.items.length
  let left = limit
  const cut: SearchGroup[] = []
  for (const g of sorted) {
    if (left <= 0) break
    const items = g.items.slice(0, left)
    left -= items.length
    cut.push({ ...g, items })
  }
  return { groups: cut, total, shown: cut.reduce((n, g) => n + g.items.length, 0) }
}
