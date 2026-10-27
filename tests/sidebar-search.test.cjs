// Sidebar search: tables, views, functions and saved queries, across the databases the sidebar has loaded.
const assert = require('node:assert/strict')
const { searchAll, searchWords, matchesAll, highlight, objectLabel } = require('./.build/sidebarSearch.cjs')

const t = (name, extra = {}) => ({ name, type: 'table', ...extra })
const v = (name) => ({ name, type: 'view' })
const mv = (name) => ({ name, type: 'matview' })
const fn = (name, args = '') => ({ name, type: 'function', args })
const q = (id, name, sql, connId, container) => ({ id, name, sql, at: 0, connId, connName: connId, container })

const connections = [
  { id: 'pg', name: 'Antrian Lokal' },
  { id: 'my', name: 'Billing' }
]
const index = {
  pg: {
    containers: ['public', 'audit'],
    objects: {
      public: [t('audit_logs'), t('cache'), t('failed_jobs'), v('v_queue_summary'), mv('mv_daily_totals'), fn('fn_queue_size', 'integer'), t('users', { schema: 'public' }), t('legacy', { schema: 'old' })],
      audit: [t('events')]
    }
  },
  my: { containers: ['shop'], objects: { shop: [t('orders'), t('order_items'), v('v_orders_open'), fn('order_total', 'id int')] } }
}
const queries = [
  q('1', 'Daily revenue', 'SELECT sum(total) FROM orders GROUP BY day', 'my', 'shop'),
  q('2', 'Failed jobs report', 'select * from failed_jobs', 'pg', 'public'),
  q('3', 'Any database', 'select now()', 'pg', null),
  q('4', 'Orphan', 'select 1 /* orders */', 'gone', 'x')
]
const find = (text, opts = {}) => searchAll(searchWords(text), connections, opts.index ?? index, opts.queries ?? queries, opts.limit)
const labels = (r) => r.groups.flatMap((g) => g.items.map((i) => `${g.connName}/${g.container ?? '*'}/${i.kind === 'query' ? 'query' : i.obj.type}/${i.label}`))

// ── words ──
assert.deepEqual(searchWords('  Order   ITEMS '), ['order', 'items'])
assert.deepEqual(searchWords('   '), [])
assert.equal(matchesAll('order_items', ['order', 'item']), true)
assert.equal(matchesAll('order_items', ['item', 'order']), true, 'order of the words does not matter')
assert.equal(matchesAll('order_items', ['order', 'zzz']), false, 'every word must match')
assert.equal(matchesAll('anything', []), false, 'nothing typed matches nothing')
console.log('words OK')

// ── finding each kind ──
assert.deepEqual(labels(find('audit')), ['Antrian Lokal/public/table/audit_logs'], 'a database called "audit" does not make its tables match: only names are searched')
assert.deepEqual(labels(find('cache')), ['Antrian Lokal/public/table/cache'], 'a table')
assert.deepEqual(labels(find('v_queue')), ['Antrian Lokal/public/view/v_queue_summary'], 'a view')
assert.deepEqual(labels(find('daily')), ['Antrian Lokal/public/matview/mv_daily_totals', 'Billing/shop/query/Daily revenue'], 'a materialized view and a saved query, grouped under their connection')
assert.deepEqual(labels(find('queue_size')), ['Antrian Lokal/public/function/fn_queue_size(integer)'], 'a function (shown with its arguments)')
console.log('each kind is found OK')

// ── saved queries are found by their SQL text too ──
assert.deepEqual(labels(find('group by')), ['Billing/shop/query/Daily revenue'])
assert.deepEqual(labels(find('now()')), ['Antrian Lokal/*/query/Any database'], 'a query saved for every database has its own group')
assert.ok(labels(find('orders')).some((l) => l.endsWith('/query/Orphan')), 'a query of a deleted connection is still found')
console.log('queries by name and SQL OK')

// ── several words, case, schema-qualified names ──
assert.deepEqual(labels(find('ORDER items')), ['Billing/shop/table/order_items'])
assert.deepEqual(labels(find('failed jobs')), ['Antrian Lokal/public/table/failed_jobs', 'Antrian Lokal/public/query/Failed jobs report'])
assert.deepEqual(labels(find('old.legacy')), ['Antrian Lokal/public/table/old.legacy'], 'the schema is part of the name that is searched')
console.log('words, case and schemas OK')

// ── order: connection, then database, then tables → views → matviews → functions → queries ──
const all = find('o')
const order = ['table', 'view', 'matview', 'function', 'query']
for (const g of all.groups) {
  const kinds = g.items.map((i) => (i.kind === 'query' ? 'query' : i.obj.type))
  assert.deepEqual(kinds, [...kinds].sort((a, b) => order.indexOf(a) - order.indexOf(b)), `kinds in order within ${g.connName}/${g.container}`)
}
assert.deepEqual(all.groups.map((g) => g.connName), [...all.groups.map((g) => g.connName)].sort((a, b) => a.localeCompare(b)), 'connections in alphabetical order')
const pgGroups = all.groups.filter((g) => g.connName === 'Antrian Lokal').map((g) => g.container)
assert.deepEqual(pgGroups.slice(-1), [null], 'the "every database" group comes last')
assert.deepEqual(find('order').groups.find((g) => g.container === 'shop').items.map((i) => i.label), ['order_items', 'orders', 'v_orders_open', 'order_total(id int)', 'Daily revenue'], 'natural order inside a kind, and the query (found through its SQL) last')
console.log('ordering OK')

// ── only what has been loaded can be found; nothing typed finds nothing ──
assert.deepEqual(labels(find('orders', { index: { pg: index.pg }, queries: [] })), [], 'a connection that is not loaded has no objects to search')
assert.deepEqual(labels(find('users', { index: { pg: { containers: ['public'], objects: {} } }, queries: [] })), [], 'a connection whose databases are not opened yet')
assert.deepEqual(searchAll([], connections, index, queries), { groups: [], total: 0, shown: 0 })
assert.equal(find('zzzzzz').total, 0)
console.log('scope OK')

// ── limit ──
const big = { pg: { containers: ['public'], objects: { public: Array.from({ length: 500 }, (_, i) => t(`item_${String(i).padStart(3, '0')}`)) } } }
const limited = find('item', { index: big, queries: [], limit: 50 })
assert.equal(limited.total, 500)
assert.equal(limited.shown, 50)
assert.equal(limited.groups[0].items[0].label, 'item_000')
assert.equal(limited.groups[0].items[49].label, 'item_049', 'the first matches are kept')
// across groups
const two = { pg: { containers: ['a', 'b'], objects: { a: [t('x1'), t('x2'), t('x3')], b: [t('x4'), t('x5')] } } }
const cut = find('x', { index: two, queries: [], limit: 4 })
assert.deepEqual([cut.total, cut.shown, cut.groups.map((g) => g.items.length)], [5, 4, [3, 1]])
console.log('limit OK')

// ── highlight ──
const text = (h) => h.map((s) => (s.hit ? `[${s.text}]` : s.text)).join('')
assert.equal(text(highlight('order_items', ['item'])), 'order_[item]s')
assert.equal(text(highlight('Order_Items', ['order', 'item'])), '[Order]_[Item]s', 'case is kept, matches are found ignoring it')
assert.equal(text(highlight('aaaa', ['aa'])), '[aaaa]', 'repeated matches are merged')
assert.equal(text(highlight('abc', ['zz'])), 'abc')
assert.equal(text(highlight('abcabc', ['bc', 'ca'])), 'a[bcabc]', 'overlapping words merge into one piece')
assert.equal(text(highlight('', ['a'])), '')
assert.equal(objectLabel({ name: 'users', type: 'table', schema: 'public' }, 'public'), 'users')
assert.equal(objectLabel({ name: 'users', type: 'table', schema: 'old' }, 'public'), 'old.users')
console.log('highlight OK')
console.log('ALL SIDEBAR SEARCH TESTS PASSED')
