import type { TableDesign } from './types'

/**
 * Pure geometry for the ER diagram: turn table designs into boxes and relations, place the boxes in
 * layers (referenced tables to the left of the tables that reference them) and route the relation lines.
 */

export const HEADER_H = 28
export const ROW_H = 20
export const PAD_Y = 6
export const GAP_X = 90
export const GAP_Y = 36

export interface ErColumn {
  name: string
  type: string
  pk: boolean
  fk: boolean
  nullable: boolean
}

export interface ErNode {
  name: string
  columns: ErColumn[]
  /** The columns drawn; all of them, or only keys when the diagram is compact. */
  rows: ErColumn[]
  w: number
  h: number
}

export interface ErEdge {
  id: string
  /** The table that holds the foreign key (the "many" side). */
  from: string
  fromColumn: string
  /** The referenced table (the "one" side). */
  to: string
  toColumn: string
  name: string
}

export interface ErGraph {
  nodes: ErNode[]
  edges: ErEdge[]
}

export interface Placed {
  x: number
  y: number
}

const CHAR_W = 6.7

export function buildGraph(designs: TableDesign[], compact: boolean): ErGraph {
  const known = new Set(designs.map((d) => d.name))
  const edges: ErEdge[] = []
  const fkCols = new Map<string, Set<string>>()
  for (const d of designs) {
    for (const fk of d.foreignKeys ?? []) {
      if (!known.has(fk.refTable)) continue // points outside the diagram
      const set = fkCols.get(d.name) ?? new Set<string>()
      fk.columns.forEach((c) => set.add(c))
      fkCols.set(d.name, set)
      // One line per column pair, so composite keys show every link.
      fk.columns.forEach((c, i) => edges.push({ id: `${d.name}.${fk.name}.${i}`, from: d.name, fromColumn: c, to: fk.refTable, toColumn: fk.refColumns[i] ?? fk.refColumns[0] ?? '', name: fk.name }))
    }
  }
  const nodes: ErNode[] = designs.map((d) => {
    const columns: ErColumn[] = d.columns.map((c) => ({ name: c.name, type: c.type, pk: c.primaryKey, fk: !!fkCols.get(d.name)?.has(c.name), nullable: c.nullable }))
    const rows = compact ? columns.filter((c) => c.pk || c.fk) : columns
    const longest = Math.max(d.name.length + 2, ...rows.map((c) => c.name.length + c.type.length + 6))
    return { name: d.name, columns, rows, w: Math.round(Math.min(360, Math.max(180, longest * CHAR_W + 36))), h: HEADER_H + Math.max(1, rows.length) * ROW_H + PAD_Y }
  })
  return { nodes, edges }
}

/**
 * Layers by reference depth (a table with no foreign keys is layer 0, its children layer 1…), ordered inside
 * each layer to cut line crossings; tables with no relations at all form a tidy grid underneath.
 */
export function layoutGraph(graph: ErGraph): Map<string, Placed> {
  const { nodes, edges } = graph
  const byName = new Map(nodes.map((n) => [n.name, n]))
  const parentsOf = new Map<string, Set<string>>(nodes.map((n) => [n.name, new Set()]))
  const childrenOf = new Map<string, Set<string>>(nodes.map((n) => [n.name, new Set()]))
  for (const e of edges) {
    if (e.from === e.to) continue // a self-reference does not affect layering
    parentsOf.get(e.from)?.add(e.to)
    childrenOf.get(e.to)?.add(e.from)
  }
  const connected = nodes.filter((n) => parentsOf.get(n.name)?.size || childrenOf.get(n.name)?.size || edges.some((e) => e.from === n.name && e.to === n.name))
  const isolated = nodes.filter((n) => !connected.includes(n)).sort((a, b) => a.name.localeCompare(b.name))

  // Longest-path layering with a bounded number of passes, so a cycle just settles instead of looping.
  const layer = new Map<string, number>(connected.map((n) => [n.name, 0]))
  for (let pass = 0; pass < connected.length; pass++) {
    let changed = false
    for (const n of connected) {
      for (const p of parentsOf.get(n.name) ?? []) {
        const want = (layer.get(p) ?? 0) + 1
        if (want > (layer.get(n.name) ?? 0) && want <= connected.length) {
          layer.set(n.name, want)
          changed = true
        }
      }
    }
    if (!changed) break
  }

  const depth = Math.max(-1, ...layer.values())
  const columns: string[][] = Array.from({ length: depth + 1 }, () => [])
  for (const n of [...connected].sort((a, b) => a.name.localeCompare(b.name))) columns[layer.get(n.name) as number].push(n.name)

  // Barycentre sweeps: order each layer by the average position of the tables it connects to.
  const order = (): Map<string, number> => new Map(columns.flatMap((col) => col.map((name, i) => [name, i] as const)))
  const neighbours = (name: string): string[] => [...(parentsOf.get(name) ?? []), ...(childrenOf.get(name) ?? [])]
  for (let sweep = 0; sweep < 6; sweep++) {
    const idx = order()
    const range = sweep % 2 === 0 ? columns.map((_, i) => i) : columns.map((_, i) => columns.length - 1 - i)
    for (const li of range) {
      const score = (name: string): number => {
        const ns = neighbours(name).filter((x) => layer.get(x) !== li)
        return ns.length ? ns.reduce((s, x) => s + (idx.get(x) ?? 0), 0) / ns.length : (idx.get(name) ?? 0)
      }
      columns[li].sort((a, b) => score(a) - score(b) || a.localeCompare(b))
      columns[li].forEach((name, i) => idx.set(name, i))
    }
  }

  const pos = new Map<string, Placed>()
  let x = 0
  let bottom = 0
  for (const col of columns) {
    let y = 0
    let width = 0
    for (const name of col) {
      const n = byName.get(name) as ErNode
      pos.set(name, { x, y })
      y += n.h + GAP_Y
      width = Math.max(width, n.w)
    }
    bottom = Math.max(bottom, y)
    x += width + GAP_X
  }

  // Unconnected tables: a grid below the diagram, as wide as the diagram (at least 3 across).
  if (isolated.length) {
    const perRow = Math.max(3, Math.min(8, Math.round(Math.sqrt(isolated.length * 1.6))))
    let cx = 0
    let cy = bottom ? bottom + GAP_Y : 0
    let rowH = 0
    isolated.forEach((n, i) => {
      if (i > 0 && i % perRow === 0) {
        cx = 0
        cy += rowH + GAP_Y
        rowH = 0
      }
      pos.set(n.name, { x: cx, y: cy })
      cx += n.w + GAP_X / 2
      rowH = Math.max(rowH, n.h)
    })
  }
  return pos
}

export interface Route {
  /** SVG path data. */
  d: string
  /** Anchor points of the two ends, for the "1" and "N" labels. */
  from: { x: number; y: number; side: 'left' | 'right' }
  to: { x: number; y: number; side: 'left' | 'right' }
}

/** Where a column's row is drawn inside its node (the header's middle when the column is hidden). */
export function rowY(node: ErNode, column: string): number {
  const i = node.rows.findIndex((c) => c.name === column)
  return i < 0 ? HEADER_H / 2 : HEADER_H + i * ROW_H + ROW_H / 2
}

/** A smooth line from a foreign-key row to the key row it points at, leaving from whichever sides face each other. */
export function routeEdge(edge: ErEdge, nodes: Map<string, ErNode>, pos: Map<string, Placed>): Route | null {
  const a = nodes.get(edge.from)
  const b = nodes.get(edge.to)
  const pa = pos.get(edge.from)
  const pb = pos.get(edge.to)
  if (!a || !b || !pa || !pb) return null
  const y1 = pa.y + rowY(a, edge.fromColumn)
  const y2 = pb.y + rowY(b, edge.toColumn)

  if (edge.from === edge.to) {
    const x = pa.x + a.w
    const bulge = 36 + Math.abs(y2 - y1) / 4
    return { d: `M ${x} ${y1} C ${x + bulge} ${y1}, ${x + bulge} ${y2}, ${x} ${y2}`, from: { x, y: y1, side: 'right' }, to: { x, y: y2, side: 'right' } }
  }
  const aRight = pa.x + a.w
  const bRight = pb.x + b.w
  let x1: number
  let x2: number
  let s1: 'left' | 'right'
  let s2: 'left' | 'right'
  if (aRight + 20 <= pb.x) {
    ;[x1, s1, x2, s2] = [aRight, 'right', pb.x, 'left']
  } else if (bRight + 20 <= pa.x) {
    ;[x1, s1, x2, s2] = [pa.x, 'left', bRight, 'right']
  } else {
    // Overlapping columns: go out and back on the right-hand side.
    const bulge = 50
    const xr = Math.max(aRight, bRight)
    return { d: `M ${aRight} ${y1} C ${xr + bulge} ${y1}, ${xr + bulge} ${y2}, ${bRight} ${y2}`, from: { x: aRight, y: y1, side: 'right' }, to: { x: bRight, y: y2, side: 'right' } }
  }
  const dx = Math.max(40, Math.abs(x2 - x1) / 2)
  const c1 = s1 === 'right' ? x1 + dx : x1 - dx
  const c2 = s2 === 'left' ? x2 - dx : x2 + dx
  return { d: `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`, from: { x: x1, y: y1, side: s1 }, to: { x: x2, y: y2, side: s2 } }
}

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

export function boundsOf(nodes: ErNode[], pos: Map<string, Placed>, margin = 30): Bounds {
  if (nodes.length === 0) return { x: 0, y: 0, w: 400, h: 300 }
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const n of nodes) {
    const p = pos.get(n.name)
    if (!p) continue
    x1 = Math.min(x1, p.x)
    y1 = Math.min(y1, p.y)
    x2 = Math.max(x2, p.x + n.w)
    y2 = Math.max(y2, p.y + n.h)
  }
  return { x: x1 - margin, y: y1 - margin, w: x2 - x1 + margin * 2, h: y2 - y1 + margin * 2 }
}
