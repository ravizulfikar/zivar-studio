// The structured filter and multi-column sort, run on real engines: every operator is compiled to SQL for the engine,
// executed through the driver, and the rows it returns are compared with what the same condition means in JavaScript.
const assert = require('node:assert/strict')
const { Env } = require('./helpers/engines.cjs')
const { compileFilter, criterionSql, newCriterion, listValues, isComplete, FILTER_OPS } = require('./.build/filter.cjs')

const C = (column, op, value = '', value2 = '', extra = {}) => ({ ...newCriterion(column, `${column}-${op}`), op, value, value2, ...extra })

// id, name, qty, grp — names chosen to trip up LIKE patterns, quoting, case and NULL handling
const NAMES = ['Alpha', 'alpha', 'ALPHA beta', 'Bé_ta', '100% sure', 'a_b', "O'Brien", null, '', ' ', 'back\\slash', 'tail alpha', 'wow!']
const ROWS = NAMES.map((name, i) => ({ id: i + 1, name, qty: i === 3 || i === 7 ? null : (i + 1) * 10, grp: (i + 1) % 3 }))

const has = (s, v) => s !== null && s.includes(v)
const lc = (s) => (s === null ? null : s.toLowerCase())
const notNull = (r, f) => r.qty !== null && f(r.qty)
// what each case means, in plain JavaScript (a missing value contains nothing, and SQL comparisons skip NULLs)
const CASES = [
  ['name', 'contains', 'alpha', '', (r) => has(r.name, 'alpha')],
  ['name', 'icontains', 'ALPHA', '', (r) => has(lc(r.name), 'alpha')],
  ['name', 'icontains', 'alpha b', '', (r) => has(lc(r.name), 'alpha b')],
  ['name', 'ncontains', 'alpha', '', (r) => !has(r.name, 'alpha')],
  ['name', 'nicontains', 'ALPHA', '', (r) => !has(lc(r.name), 'alpha')],
  ['name', 'begins', 'Al', '', (r) => r.name !== null && r.name.startsWith('Al')],
  ['name', 'nbegins', 'Al', '', (r) => !(r.name !== null && r.name.startsWith('Al'))],
  ['name', 'ends', 'alpha', '', (r) => r.name !== null && r.name.endsWith('alpha')],
  ['name', 'nends', 'alpha', '', (r) => !(r.name !== null && r.name.endsWith('alpha'))],
  // characters that mean something inside LIKE patterns, string literals and escapes
  ['name', 'contains', '%', '', (r) => has(r.name, '%')],
  ['name', 'contains', '_', '', (r) => has(r.name, '_')],
  ['name', 'contains', '!', '', (r) => has(r.name, '!')],
  ['name', 'contains', "'", '', (r) => has(r.name, "'")],
  ['name', 'contains', '\\', '', (r) => has(r.name, '\\')],
  ['name', 'contains', 'é', '', (r) => has(r.name, 'é')],
  ['name', 'begins', '100%', '', (r) => r.name !== null && r.name.startsWith('100%')],
  ['name', 'ends', '!', '', (r) => r.name !== null && r.name.endsWith('!')],
  ['name', 'eq', "O'Brien", '', (r) => r.name === "O'Brien"],
  ['name', 'eq', 'back\\slash', '', (r) => r.name === 'back\\slash'],
  // = and != follow the column's collation (MySQL and SQL Server compare text without regard to case by default), so test them on a value whose case is not in play
  ['name', 'ne', "O'Brien", '', (r) => r.name !== null && r.name !== "O'Brien"],
  ['name', 'isnull', '', '', (r) => r.name === null],
  ['name', 'notnull', '', '', (r) => r.name !== null],
  ['name', 'isempty', '', '', (r) => r.name === ''],
  ['name', 'notempty', '', '', (r) => r.name !== null && r.name !== ''],
  ['name', 'in', "Alpha, alpha,O'Brien", '', (r) => ['Alpha', 'alpha', "O'Brien"].includes(r.name)],
  ['name', 'nin', "Alpha\nalpha", '', (r) => r.name !== null && !['Alpha', 'alpha'].includes(r.name)],
  // numbers
  ['qty', 'eq', '20', '', (r) => r.qty === 20],
  ['qty', 'ne', '20', '', (r) => notNull(r, (q) => q !== 20)],
  ['qty', 'lt', '30', '', (r) => notNull(r, (q) => q < 30)],
  ['qty', 'le', '30', '', (r) => notNull(r, (q) => q <= 30)],
  ['qty', 'gt', '100', '', (r) => notNull(r, (q) => q > 100)],
  ['qty', 'ge', '100', '', (r) => notNull(r, (q) => q >= 100)],
  ['qty', 'between', '20', '60', (r) => notNull(r, (q) => q >= 20 && q <= 60)],
  ['qty', 'nbetween', '20', '60', (r) => notNull(r, (q) => q < 20 || q > 60)],
  ['qty', 'in', '10, 30, 50', '', (r) => [10, 30, 50].includes(r.qty)],
  ['qty', 'nin', '10, 30, 50', '', (r) => notNull(r, (q) => ![10, 30, 50].includes(q))],
  ['qty', 'isnull', '', '', (r) => r.qty === null],
  ['qty', 'contains', '0', '', (r) => r.qty !== null && String(r.qty).includes('0')], // LIKE on a number
  ['qty', 'begins', '1', '', (r) => r.qty !== null && String(r.qty).startsWith('1')],
  ['qty', 'isempty', '', '', () => false],
  ['qty', 'eq', 'abc', '', null], // not a number: must not blow up the query on engines that coerce (checked separately)
  ['id', 'custom', 'qty > 25 AND name IS NOT NULL', '', (r) => r.qty !== null && r.qty > 25 && r.name !== null]
].filter((c) => c[4] !== null)

async function run(c, kind) {
  const q = (s) => (kind === 'mysql' ? `\`${s}\`` : `"${s}"`)
  const table = kind === 'sqlite' ? q('t') : kind === 'mysql' ? `${q(c.container)}.${q('t')}` : `${q(c.container)}.${q('t')}`
  const textType = kind === 'mysql' ? 'VARCHAR(100)' : 'TEXT'
  const intType = kind === 'sqlite' ? 'INTEGER' : kind === 'mysql' ? 'INT' : 'integer'
  await c.driver.query(`CREATE TABLE ${table} (id ${intType} PRIMARY KEY, name ${textType}, qty ${intType}, grp ${intType})`, null)
  const obj = { name: 't', type: 'table', schema: kind === 'postgres' ? c.container : undefined }
  await c.driver.insertRows(c.container, obj, ['id', 'name', 'qty', 'grp'], ROWS.map((r) => [r.id, r.name, r.qty, r.grp]))
  const meta = (await c.driver.describe(c.container, obj)).map((m) => ({ name: m.name, type: m.type }))

  const ids = async (where, orderBy = { column: 'id', dir: 'asc' }) => {
    const page = await c.driver.tableData(c.container, obj, { limit: 1000, offset: 0, where, orderBy })
    return page.rows.map((r) => Number(r[page.columns.indexOf('id')]))
  }
  let n = 0
  for (const [col, op, v1, v2, expect] of CASES) {
    const where = compileFilter([C(col, op, v1, v2)], meta, kind)
    const got = await ids(where)
    const want = ROWS.filter(expect).map((r) => r.id)
    assert.deepEqual(got, want, `${kind}: ${col} ${op} ${JSON.stringify(v1)}${v2 ? ' .. ' + JSON.stringify(v2) : ''}\n  where: ${where}`)
    n++
  }
  console.log(`${kind}: ${n} operator cases return exactly the rows they should`)

  // conditions combine from the top, one after the other: ((a and b) or c)
  const combined = compileFilter([C('name', 'contains', 'alpha', '', { join: 'and' }), C('qty', 'gt', '5', '', { join: 'or' }), C('id', 'eq', '13')], meta, kind)
  assert.deepEqual(await ids(combined), ROWS.filter((r) => (has(r.name, 'alpha') && notNull(r, (q) => q > 5)) || r.id === 13).map((r) => r.id), `${kind}: and / or combine left to right`)
  // unticked and unfinished conditions are left out
  const partial = compileFilter([C('qty', 'gt', '100', '', { enabled: false }), C('name', 'contains', ''), C('qty', 'between', '20', ''), C('id', 'eq', '3')], meta, kind)
  assert.deepEqual(await ids(partial), [3], `${kind}: disabled and incomplete conditions are skipped`)
  // text typed into a number column is quoted, never pasted in: whatever the engine says about the comparison, the table survives
  await ids(compileFilter([C('qty', 'eq', "1'; DROP TABLE t; --")], meta, kind)).catch(() => undefined)
  assert.equal((await ids('')).length, ROWS.length, `${kind}: the table is intact after that text`)
  console.log(`${kind}: joins, skipped conditions and hostile text OK`)

  // ── sorting by several columns ──
  const sorted = async (orderBy) => ids('', orderBy)
  const byJs = (cmp) => [...ROWS].sort(cmp).map((r) => r.id)
  assert.deepEqual(await sorted([{ column: 'grp', dir: 'asc' }, { column: 'id', dir: 'desc' }]), byJs((a, b) => a.grp - b.grp || b.id - a.id), `${kind}: sort by grp, then id descending`)
  assert.deepEqual(await sorted([{ column: 'grp', dir: 'desc' }, { column: 'id', dir: 'asc' }]), byJs((a, b) => b.grp - a.grp || a.id - b.id), `${kind}: sort by grp descending, then id`)
  assert.deepEqual(await sorted({ column: 'id', dir: 'desc' }), byJs((a, b) => b.id - a.id), `${kind}: a single order still works`)
  assert.equal((await sorted([])).length, ROWS.length, `${kind}: an empty list of orders is no order`)
  console.log(`${kind}: multi-column sort OK`)
}

;(async () => {
  // ── pure parts ──
  assert.equal(FILTER_OPS.length, 23)
  assert.deepEqual(FILTER_OPS.slice(0, 6).map((o) => o.label), ['=', '!=', '<', '<=', '>', '>='])
  assert.deepEqual(listValues('a, b ,,c'), ['a', 'b', 'c'])
  assert.deepEqual(listValues('a, b\nc d\n\n e '), ['a, b', 'c d', 'e'], 'one value per line when there are lines (commas are then part of the value)')
  assert.equal(isComplete(C('x', 'eq', '')), false)
  assert.equal(isComplete(C('x', 'isnull')), true)
  assert.equal(isComplete(C('x', 'between', '1', '')), false)
  assert.equal(isComplete(C('', 'isnull')), false, 'no column yet')
  assert.equal(compileFilter([], [], 'postgres'), '')
  assert.equal(criterionSql(C('qty', 'eq', '5'), 'integer', 'postgres'), '"qty" = 5', 'a number stays a number')
  assert.equal(criterionSql(C('qty', 'eq', '5'), 'text', 'postgres'), `"qty" = '5'`, 'text stays text')
  assert.equal(criterionSql(C('p', 'eq', '12345678901234567890.5'), 'numeric(30,2)', 'mysql'), '`p` = 12345678901234567890.5', 'no rounding through JavaScript numbers')
  assert.equal(criterionSql(C('qty', 'eq', "5 OR 1=1"), 'integer', 'postgres'), `"qty" = '5 OR 1=1'`, 'something that is not a number is quoted, never pasted in')
  assert.equal(criterionSql(C('b', 'eq', 'yes'), 'boolean', 'postgres'), '"b" = true')
  assert.equal(criterionSql(C('name', 'icontains', 'x'), 'text', 'postgres'), `"name"::text ILIKE '%x%' ESCAPE '!'`)
  assert.equal(criterionSql(C('name', 'contains', '5%_!'), 'text', 'postgres'), `"name"::text LIKE '%5!%!_!!%' ESCAPE '!'`, '% _ and ! are escaped')
  assert.match(criterionSql(C('name', 'contains', '[a]'), 'nvarchar(50)', 'mssql'), /LIKE N'%!\[a]%' ESCAPE '!'/, 'SQL Server also escapes [')
  assert.match(criterionSql(C('name', 'contains', 'x'), 'nvarchar(50)', 'mssql'), /COLLATE Latin1_General_100_CS_AS/)
  assert.match(criterionSql(C('name', 'icontains', 'x'), 'nvarchar(50)', 'mssql'), /COLLATE Latin1_General_100_CI_AS/)
  assert.equal(criterionSql(C('name', 'eq', 'x'), 'varchar', 'mssql'), `[name] = N'x'`)
  assert.equal(compileFilter([C('a', 'isnull', '', '', { join: 'or' }), C('b', 'isnull', '', '', { join: 'and' }), C('c', 'isnull')], [], 'sqlite'), '(("a" IS NULL OR "b" IS NULL) AND "c" IS NULL)')
  assert.equal(compileFilter([C('x', 'custom', 'a = 1 OR b = 2;')], [], 'sqlite'), '(a = 1 OR b = 2)', 'a custom condition is parenthesised and loses a trailing semicolon')
  console.log('pure parts OK')

  // ── on real engines ──
  const env = await new Env().init(['postgres', 'mysql'])
  try {
    for (const kind of env.kinds) await run(await env.container(kind, 'f'), kind)
    console.log(`engines covered: ${env.kinds.join(', ')}`)
  } finally {
    await env.stop()
  }
  console.log('ALL FILTER TESTS PASSED')
})().catch((e) => {
  console.error('FAIL', e)
  process.exit(1)
})
