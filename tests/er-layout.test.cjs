// ER diagram geometry: graph building, layered layout, edge routing, bounds.
const assert = require('node:assert/strict')
const { buildGraph, layoutGraph, routeEdge, rowY, boundsOf, HEADER_H, ROW_H } = require('./.build/erLayout.cjs')

const col = (name, type, o = {}) => ({ id: name, originalName: name, name, type, nullable: true, primaryKey: false, defaultValue: null, autoIncrement: false, ...o })
const fk = (name, columns, refTable, refColumns = ['id']) => ({ id: name, originalName: name, name, columns, refTable, refColumns, onDelete: 'NO ACTION', onUpdate: 'NO ACTION' })
const table = (name, columns, foreignKeys = []) => ({ name, columns, indexes: [], foreignKeys })
const pkCol = (name = 'id') => col(name, 'integer', { primaryKey: true, nullable: false })

const designs = [
  table('users', [pkCol(), col('email', 'text')]),
  table('orders', [pkCol(), col('user_id', 'integer'), col('total', 'numeric')], [fk('fk_user', ['user_id'], 'users')]),
  table('items', [pkCol(), col('order_id', 'integer'), col('sku', 'text')], [fk('fk_order', ['order_id'], 'orders')]),
  table('audit', [pkCol(), col('note', 'text')]), // no relations
  table('tags', [pkCol(), col('label', 'text')]), // no relations
  table('outside', [pkCol(), col('x', 'integer')], [fk('fk_x', ['x'], 'not_in_diagram')])
]

// ── graph ──
let g = buildGraph(designs, false)
assert.deepEqual(g.edges.map((e) => [e.from, e.fromColumn, e.to, e.toColumn]), [['orders', 'user_id', 'users', 'id'], ['items', 'order_id', 'orders', 'id']], 'foreign keys to tables outside the diagram are dropped')
const orders = g.nodes.find((n) => n.name === 'orders')
assert.deepEqual(orders.columns.map((c) => [c.name, c.pk, c.fk]), [['id', true, false], ['user_id', false, true], ['total', false, false]])
assert.equal(orders.h, HEADER_H + 3 * ROW_H + 6)
assert.ok(orders.w >= 180 && orders.w <= 360)
const compact = buildGraph(designs, true).nodes.find((n) => n.name === 'orders')
assert.deepEqual(compact.rows.map((c) => c.name), ['id', 'user_id'], 'compact mode keeps only key columns')
assert.ok(compact.h < orders.h)
const composite = buildGraph([table('p', [pkCol('a'), pkCol('b')]), table('c', [col('a', 'int'), col('b', 'int')], [fk('fk', ['a', 'b'], 'p', ['a', 'b'])])], false)
assert.equal(composite.edges.length, 2, 'a composite key draws one line per column pair')
console.log('graph building OK')

// ── layout ──
const pos = layoutGraph(g)
assert.equal(pos.size, g.nodes.length, 'every table gets a position')
const p = (n) => pos.get(n)
assert.ok(p('users').x < p('orders').x && p('orders').x < p('items').x, 'referenced tables sit to the left of those that reference them')
// no two boxes overlap
for (const a of g.nodes) {
  for (const b of g.nodes) {
    if (a === b) continue
    const pa = p(a.name)
    const pb = p(b.name)
    const overlap = pa.x < pb.x + b.w && pb.x < pa.x + a.w && pa.y < pb.y + b.h && pb.y < pa.y + a.h
    assert.ok(!overlap, `${a.name} overlaps ${b.name}`)
  }
}
const chainBottom = Math.max(...['users', 'orders', 'items'].map((n) => p(n).y + g.nodes.find((x) => x.name === n).h))
assert.ok(p('audit').y > chainBottom && p('tags').y > chainBottom, 'unrelated tables go in a grid below the connected diagram')
assert.deepEqual([...layoutGraph(g)].map(([k, v]) => [k, v.x, v.y]), [...pos].map(([k, v]) => [k, v.x, v.y]), 'layout is deterministic')
console.log('layered layout (order, no overlap, isolated grid, deterministic) OK')

// cycles settle instead of looping forever; self references are fine
const cyc = buildGraph([table('a', [pkCol(), col('b_id', 'int')], [fk('f1', ['b_id'], 'b')]), table('b', [pkCol(), col('a_id', 'int')], [fk('f2', ['a_id'], 'a')]), table('tree', [pkCol(), col('parent', 'int')], [fk('f3', ['parent'], 'tree')])], false)
const cpos = layoutGraph(cyc)
assert.equal(cpos.size, 3)
assert.ok([...cpos.values()].every((v) => Number.isFinite(v.x) && Number.isFinite(v.y)))
console.log('cycles and self references OK')

// many tables: wide grids, still no overlap
const many = buildGraph(Array.from({ length: 40 }, (_, i) => table(`t${String(i).padStart(2, '0')}`, [pkCol(), col('v', 'text')])), false)
const mp = layoutGraph(many)
const xs = new Set([...mp.values()].map((v) => v.x))
assert.ok(xs.size >= 3 && xs.size <= 8, `isolated tables wrap into a grid (${xs.size} columns)`)
for (const a of many.nodes) for (const b of many.nodes) if (a !== b) {
  const pa = mp.get(a.name), pb = mp.get(b.name)
  assert.ok(!(pa.x < pb.x + b.w && pb.x < pa.x + a.w && pa.y < pb.y + b.h && pb.y < pa.y + a.h), 'grid boxes must not overlap')
}
console.log('large isolated sets wrap into a grid OK')

// ── edge routing ──
const nodes = new Map(g.nodes.map((n) => [n.name, n]))
const r = routeEdge(g.edges[0], nodes, pos) // orders.user_id -> users.id
assert.equal(r.from.side, 'left', 'the child is to the right, so its line leaves from its left side')
assert.equal(r.to.side, 'right')
assert.equal(r.from.y, p('orders').y + rowY(orders, 'user_id'))
assert.equal(r.to.x, p('users').x + nodes.get('users').w)
assert.match(r.d, /^M [\d.-]+ [\d.-]+ C /)
// hidden column (compact mode) anchors on the header
const cg = buildGraph(designs, true)
const cn = new Map(cg.nodes.map((n) => [n.name, n]))
assert.equal(rowY(cn.get('orders'), 'total'), HEADER_H / 2)
// tables stacked in the same column: the line goes out and back on the right
const stacked = new Map([['orders', { x: 0, y: 0 }], ['users', { x: 0, y: 200 }]])
const sr = routeEdge(g.edges[0], nodes, stacked)
assert.equal(sr.from.side, 'right')
assert.equal(sr.to.side, 'right')
// self reference loops on the right
const selfEdge = cyc.edges.find((e) => e.from === 'tree')
const lr = routeEdge(selfEdge, new Map(cyc.nodes.map((n) => [n.name, n])), cpos)
assert.equal(lr.from.side, 'right')
assert.ok(lr.d.includes('C'))
assert.equal(routeEdge(g.edges[0], nodes, new Map()), null, 'no position, no route')
console.log('edge routing OK')

// ── bounds ──
const b = boundsOf(g.nodes, pos, 10)
for (const n of g.nodes) {
  const q = p(n.name)
  assert.ok(q.x >= b.x + 10 - 1e-9 && q.x + n.w <= b.x + b.w - 10 + 1e-9 && q.y >= b.y + 10 - 1e-9 && q.y + n.h <= b.y + b.h - 10 + 1e-9, `${n.name} is inside the bounds`)
}
assert.deepEqual(boundsOf([], new Map()), { x: 0, y: 0, w: 400, h: 300 })
console.log('bounds OK')
console.log('ALL ER-LAYOUT TESTS PASSED')
