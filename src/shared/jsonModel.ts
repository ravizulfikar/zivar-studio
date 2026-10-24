// A JSON document model for the tree editor. JSON.parse is not good enough for a database tool: it turns
// 9007199254740993 into 9007199254740992, drops duplicate keys and cannot say where a syntax error is.
// This parser keeps numbers as their original text, keeps key order, and reports line / column.

export type JNode =
  | { t: 'object'; entries: { key: string; v: JNode }[] }
  | { t: 'array'; items: JNode[] }
  | { t: 'string'; v: string }
  | { t: 'number'; raw: string }
  | { t: 'boolean'; v: boolean }
  | { t: 'null' }

export type JPath = (string | number)[]

export interface JsonError {
  message: string
  /** 0-based offset into the text. */
  pos: number
  line: number
  column: number
}

export type ParseResult = { ok: true; node: JNode } | { ok: false; error: JsonError }

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const MAX_DEPTH = 512

class Fail extends Error {
  constructor(
    message: string,
    readonly pos: number
  ) {
    super(message)
  }
}

export function parseJson(text: string): ParseResult {
  let i = 0
  const fail = (msg: string, at = i): never => {
    throw new Fail(msg, at)
  }
  const ws = (): void => {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++
  }
  const near = (): string => (i >= text.length ? 'end of input' : `"${text[i]}"`)

  const str = (): string => {
    const start = i
    i++ // opening quote
    let out = ''
    for (;;) {
      if (i >= text.length) fail('Unterminated string', start)
      const c = text[i]
      if (c === '"') {
        i++
        return out
      }
      if (c === '\\') {
        const e = text[i + 1]
        const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
        if (e in simple) {
          out += simple[e]
          i += 2
        } else if (e === 'u') {
          const hex = text.slice(i + 2, i + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid \\u escape', i)
          out += String.fromCharCode(parseInt(hex, 16))
          i += 6
        } else fail(`Invalid escape "\\${e ?? ''}"`, i)
      } else if (c < ' ') {
        fail('Control character in string (use \\n, \\t …)', i)
      } else {
        out += c
        i++
      }
    }
  }

  const value = (depth: number): JNode => {
    if (depth > MAX_DEPTH) fail('Nested too deeply')
    ws()
    const c = text[i]
    if (c === '{') {
      i++
      const entries: { key: string; v: JNode }[] = []
      ws()
      if (text[i] === '}') {
        i++
        return { t: 'object', entries }
      }
      for (;;) {
        ws()
        if (text[i] !== '"') fail(`Expected a property name in double quotes but found ${near()}`)
        const key = str()
        ws()
        if (text[i] !== ':') fail(`Expected ":" after the property name but found ${near()}`)
        i++
        entries.push({ key, v: value(depth + 1) })
        ws()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === '}') {
          i++
          return { t: 'object', entries }
        }
        fail(`Expected "," or "}" but found ${near()}`)
      }
    }
    if (c === '[') {
      i++
      const items: JNode[] = []
      ws()
      if (text[i] === ']') {
        i++
        return { t: 'array', items }
      }
      for (;;) {
        items.push(value(depth + 1))
        ws()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === ']') {
          i++
          return { t: 'array', items }
        }
        fail(`Expected "," or "]" but found ${near()}`)
      }
    }
    if (c === '"') return { t: 'string', v: str() }
    if (text.startsWith('true', i)) return (i += 4), { t: 'boolean', v: true }
    if (text.startsWith('false', i)) return (i += 5), { t: 'boolean', v: false }
    if (text.startsWith('null', i)) return (i += 4), { t: 'null' }
    NUMBER.lastIndex = i
    const m = NUMBER.exec(text)
    if (m) {
      i += m[0].length
      return { t: 'number', raw: m[0] }
    }
    return fail(i >= text.length ? 'Unexpected end of input' : `Unexpected ${near()}`)
  }

  try {
    const node = value(0)
    ws()
    if (i < text.length) fail(`Unexpected ${near()} after the end of the value`)
    return { ok: true, node }
  } catch (e) {
    if (!(e instanceof Fail)) throw e
    const before = text.slice(0, e.pos)
    const line = before.split('\n').length
    return { ok: false, error: { message: e.message, pos: e.pos, line, column: e.pos - before.lastIndexOf('\n') } }
  }
}

function quote(s: string): string {
  return JSON.stringify(s)
}

/** indent 0 = minified. Numbers keep their original text. */
export function stringifyJson(node: JNode, indent = 2): string {
  const nl = (d: number): string => (indent ? '\n' + ' '.repeat(indent * d) : '')
  const go = (n: JNode, d: number): string => {
    switch (n.t) {
      case 'object':
        if (!n.entries.length) return '{}'
        return `{${n.entries.map((e) => `${nl(d + 1)}${quote(e.key)}:${indent ? ' ' : ''}${go(e.v, d + 1)}`).join(',')}${nl(d)}}`
      case 'array':
        if (!n.items.length) return '[]'
        return `[${n.items.map((x) => `${nl(d + 1)}${go(x, d + 1)}`).join(',')}${nl(d)}]`
      case 'string':
        return quote(n.v)
      case 'number':
        return n.raw
      case 'boolean':
        return String(n.v)
      case 'null':
        return 'null'
    }
  }
  return go(node, 0)
}

export function childrenOf(n: JNode): { key: string | number; v: JNode }[] {
  if (n.t === 'object') return n.entries.map((e) => ({ key: e.key, v: e.v }))
  if (n.t === 'array') return n.items.map((v, i) => ({ key: i, v }))
  return []
}

export function getAt(root: JNode, path: JPath): JNode | undefined {
  let cur: JNode | undefined = root
  for (const k of path) {
    if (!cur) return undefined
    if (cur.t === 'object' && typeof k === 'number') cur = cur.entries[k]?.v
    else if (cur.t === 'array' && typeof k === 'number') cur = cur.items[k]
    else return undefined
  }
  return cur
}

/**
 * Object children are addressed by position, not by key, so duplicate keys stay editable.
 * (Array children are addressed by index.) Both are numbers; the container type disambiguates.
 */
export function setAt(root: JNode, path: JPath, next: JNode): JNode {
  if (path.length === 0) return next
  const [k, ...rest] = path
  if (root.t === 'object' && typeof k === 'number' && root.entries[k]) {
    return { t: 'object', entries: root.entries.map((e, i) => (i === k ? { key: e.key, v: setAt(e.v, rest, next) } : e)) }
  }
  if (root.t === 'array' && typeof k === 'number' && k in root.items) {
    return { t: 'array', items: root.items.map((x, i) => (i === k ? setAt(x, rest, next) : x)) }
  }
  return root
}

export function removeAt(root: JNode, path: JPath): JNode {
  if (path.length === 0) return root
  const parent = path.slice(0, -1)
  const k = path[path.length - 1]
  const p = getAt(root, parent)
  if (!p || typeof k !== 'number') return root
  if (p.t === 'object') return setAt(root, parent, { t: 'object', entries: p.entries.filter((_, i) => i !== k) })
  if (p.t === 'array') return setAt(root, parent, { t: 'array', items: p.items.filter((_, i) => i !== k) })
  return root
}

export function renameKeyAt(root: JNode, path: JPath, key: string): JNode {
  if (path.length === 0) return root
  const parent = path.slice(0, -1)
  const k = path[path.length - 1]
  const p = getAt(root, parent)
  if (!p || p.t !== 'object' || typeof k !== 'number') return root
  return setAt(root, parent, { t: 'object', entries: p.entries.map((e, i) => (i === k ? { key, v: e.v } : e)) })
}

/** Append a child to an object (needs a key) or an array. */
export function addChildAt(root: JNode, path: JPath, child: JNode, key = 'key'): JNode {
  const p = getAt(root, path)
  if (!p) return root
  if (p.t === 'object') return setAt(root, path, { t: 'object', entries: [...p.entries, { key, v: child }] })
  if (p.t === 'array') return setAt(root, path, { t: 'array', items: [...p.items, child] })
  return root
}

/** Recursively sort object keys (arrays keep their order). */
export function sortKeys(n: JNode, dir: 'asc' | 'desc' = 'asc'): JNode {
  if (n.t === 'array') return { t: 'array', items: n.items.map((x) => sortKeys(x, dir)) }
  if (n.t !== 'object') return n
  const sign = dir === 'asc' ? 1 : -1
  const entries = n.entries.map((e) => ({ key: e.key, v: sortKeys(e.v, dir) }))
  entries.sort((a, b) => sign * a.key.localeCompare(b.key, undefined, { numeric: true }))
  return { t: 'object', entries }
}

const IDENT = /^[A-Za-z_$][\w$]*$/

/** `$.users[0].name` style path of a node, given the position-based path used by the editor. */
export function pathLabel(root: JNode, path: JPath): string {
  let out = '$'
  let cur: JNode | undefined = root
  for (const k of path) {
    if (!cur || typeof k !== 'number') break
    if (cur.t === 'object') {
      const key = cur.entries[k]?.key ?? ''
      out += IDENT.test(key) ? `.${key}` : `[${quote(key)}]`
      cur = cur.entries[k]?.v
    } else if (cur.t === 'array') {
      out += `[${k}]`
      cur = cur.items[k]
    }
  }
  return out
}

/** Plain JS value for a leaf (numbers via Number, so only for display / copy of small values). */
export function leafText(n: JNode): string {
  switch (n.t) {
    case 'string':
      return n.v
    case 'number':
      return n.raw
    case 'boolean':
      return String(n.v)
    case 'null':
      return 'null'
    default:
      return stringifyJson(n)
  }
}

export interface JsonStats {
  nodes: number
  depth: number
}

export function statsOf(n: JNode): JsonStats {
  let nodes = 0
  let depth = 0
  const go = (x: JNode, d: number): void => {
    nodes++
    if (d > depth) depth = d
    for (const c of childrenOf(x)) go(c.v, d + 1)
  }
  go(n, 0)
  return { nodes, depth }
}

/** Paths of every node whose key or leaf text contains `needle` (case-insensitive). */
export function searchJson(root: JNode, needle: string, limit = 500): JPath[] {
  const q = needle.toLowerCase()
  const hits: JPath[] = []
  if (!q) return hits
  const go = (n: JNode, path: JPath, key: string | number | null): void => {
    if (hits.length >= limit) return
    const keyHit = typeof key === 'string' && key.toLowerCase().includes(q)
    const leafHit = childrenOf(n).length === 0 && n.t !== 'object' && n.t !== 'array' && leafText(n).toLowerCase().includes(q)
    if (keyHit || leafHit) hits.push(path)
    if (n.t === 'object') n.entries.forEach((e, i) => go(e.v, [...path, i], e.key))
    else if (n.t === 'array') n.items.forEach((x, i) => go(x, [...path, i], i))
  }
  go(root, [], null)
  return hits
}

export function fromJs(v: unknown): JNode {
  if (v === null || v === undefined) return { t: 'null' }
  if (Array.isArray(v)) return { t: 'array', items: v.map(fromJs) }
  if (typeof v === 'object') return { t: 'object', entries: Object.entries(v as object).map(([key, x]) => ({ key, v: fromJs(x) })) }
  if (typeof v === 'string') return { t: 'string', v }
  if (typeof v === 'number') return { t: 'number', raw: Number.isFinite(v) ? String(v) : 'null' }
  if (typeof v === 'boolean') return { t: 'boolean', v }
  return { t: 'string', v: String(v) }
}
