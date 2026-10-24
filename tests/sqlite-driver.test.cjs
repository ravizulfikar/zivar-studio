// Data-editor behaviour of the SQLite driver: paging, sort, filter, edits, rollback, definitions.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { SqliteDriver } = require('./.build/sqlite.cjs')

;(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zivar-sqlite-'))
  const d = new SqliteDriver({ id: 'x', name: 'x', kind: 'sqlite', database: path.join(dir, 't.db') })
  await d.connect()
  await d.query('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INT)')
  for (let i = 1; i <= 25; i++) await d.query(`INSERT INTO t (name, age) VALUES ('n${i}', ${i % 5})`)
  const obj = { name: 't', type: 'table' }

  let p = await d.tableData('main', obj, { limit: 10, offset: 0 })
  assert.equal(p.rows.length, 10)
  assert.equal(p.hasNext, true)
  assert.deepEqual(p.columns, ['id', 'name', 'age'])
  p = await d.tableData('main', obj, { limit: 10, offset: 20 })
  assert.equal(p.rows.length, 5)
  assert.equal(p.hasNext, false)
  p = await d.tableData('main', obj, { limit: 3, offset: 0, orderBy: { column: 'id', dir: 'desc' } })
  assert.equal(p.rows[0][0], 25)
  p = await d.tableData('main', obj, { limit: 100, offset: 0, where: 'age = 0;' })
  assert.equal(p.rows.length, 5)
  p = await d.tableData('main', obj, { limit: 10, offset: 0, where: 'age = 99' })
  assert.deepEqual([p.rows.length, p.columns], [0, ['id', 'name', 'age']])
  console.log('paging / sort / filter OK')

  await d.applyChanges('main', obj, [
    { type: 'update', key: { id: 1 }, values: { name: "O'Brien", age: null } },
    { type: 'insert', values: { name: 'new' } },
    { type: 'delete', key: { id: 2 } }
  ])
  const r = await d.query("SELECT name, age FROM t WHERE id IN (1,2) OR name = 'new' ORDER BY id")
  assert.deepEqual(r.rows, [["O'Brien", null], ['new', null]])
  console.log('update / insert / delete OK')

  await assert.rejects(
    d.applyChanges('main', obj, [
      { type: 'update', key: { id: 3 }, values: { name: 'changed' } },
      { type: 'update', key: { id: 4 }, values: { name: null } }
    ]),
    /NOT NULL/i
  )
  assert.equal((await d.query('SELECT name FROM t WHERE id = 3')).rows[0][0], 'n3')
  console.log('rollback on failure OK')

  await assert.rejects(d.applyChanges('main', obj, [{ type: 'update', key: { id: 9999 }, values: { name: 'x' } }]), /No row matched/)
  await assert.rejects(d.applyChanges('main', obj, [{ type: 'delete', key: {} }]), /no primary key/)
  console.log('missing-row and no-primary-key guards OK')

  assert.deepEqual(await d.schemaCompletion(), { t: ['id', 'name', 'age'] })

  await d.query('CREATE VIEW v AS SELECT id, name FROM t')
  const view = (await d.objects('main')).find((o) => o.name === 'v')
  assert.equal(view.type, 'view')
  assert.match(await d.definition('main', view), /CREATE VIEW v AS SELECT id, name FROM t/)
  assert.equal((await d.tableData('main', view, { limit: 5, offset: 0 })).rows.length, 5)
  await assert.rejects(d.definition('main', { name: 'nope', type: 'view' }), /not found/)
  console.log('schema completion / views / definitions OK')

  // bulk insert: chunking across SQLite's 500-row VALUES limit, atomicity, and the failing row range
  await d.query('CREATE TABLE bulk (id INTEGER PRIMARY KEY, name TEXT NOT NULL, note TEXT)')
  const bulk = { name: 'bulk', type: 'table' }
  const many = Array.from({ length: 1234 }, (_, i) => [i + 1, `n${i}`, i % 3 === 0 ? null : `it's ${i}`])
  assert.equal(await d.insertRows('main', bulk, ['id', 'name', 'note'], many), 1234)
  assert.equal((await d.query('SELECT count(*), count(note) FROM bulk')).rows[0].join('/'), '1234/822')
  assert.equal((await d.query("SELECT note FROM bulk WHERE id = 2")).rows[0][0], "it's 1")
  // a bad row in the 3rd chunk (rows 1001-...): nothing from earlier chunks may remain
  const bad = Array.from({ length: 1200 }, (_, i) => [5000 + i, `m${i}`, null])
  bad[1100][1] = null // NOT NULL violation
  await assert.rejects(d.insertRows('main', bulk, ['id', 'name', 'note'], bad), /rows 1001–1200 of the data/)
  assert.equal((await d.query('SELECT count(*) FROM bulk')).rows[0][0], 1234, 'failed import must leave no rows')
  // subset of columns -> others take their defaults / NULL
  assert.equal(await d.insertRows('main', bulk, ['name'], [['only-name']]), 1)
  assert.equal(await d.insertRows('main', bulk, ['name'], []), 0)
  await assert.rejects(d.insertRows('main', bulk, [], [[1]]), /no columns are mapped/)
  console.log('insertRows: chunking, atomic rollback, failing row range, column subsets OK')

  await d.close()
})().catch((e) => {
  console.error('FAIL', e)
  process.exit(1)
})
