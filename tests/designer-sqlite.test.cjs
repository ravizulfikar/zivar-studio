// Designer end-to-end on a real SQLite file: plan DDL -> execute -> load back -> diff.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { SqliteDriver } = require('./.build/sqlite.cjs')
const { planDdl } = require('./.build/ddl.cjs')

const ctx = { kind: 'sqlite', container: 'main' }
const clone = (d) => JSON.parse(JSON.stringify(d))
let n = 0
const col = (name, type, o = {}) => ({ id: 'c' + ++n, originalName: null, name, type, nullable: true, primaryKey: false, defaultValue: null, autoIncrement: false, ...o })
const apply = async (d, orig, edited) => {
  const p = planDdl(ctx, orig, edited)
  assert.deepEqual(p.errors, [], p.errors.join('|'))
  await d.executeDdl('main', p.statements)
  return p
}
const byName = (design, name) => design.columns.find((c) => c.name === name)

;(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zivar-design-'))
  const d = new SqliteDriver({ id: 'x', name: 'x', kind: 'sqlite', database: path.join(dir, 'e2e.db') })
  await d.connect()

  const fresh = {
    name: 'users',
    indexes: [{ id: 'i1', originalName: null, name: 'ix_email', columns: ['email'], unique: true }],
    columns: [
      col('id', 'integer', { primaryKey: true, nullable: false, autoIncrement: true }),
      col('email', 'text', { nullable: false }),
      col('age', 'integer', { defaultValue: '18' })
    ]
  }
  await apply(d, null, fresh)
  await d.query("INSERT INTO users (email) VALUES ('a@x'), ('b@x')")
  assert.deepEqual((await d.query('SELECT id, email, age FROM users ORDER BY id')).rows, [[1, 'a@x', 18], [2, 'b@x', 18]])
  console.log('create table from design (autoincrement, default) OK')

  const obj = { name: 'users', type: 'table' }
  let loaded = await d.designInfo('main', obj)
  assert.equal(byName(loaded, 'id').primaryKey, true)
  assert.equal(byName(loaded, 'id').autoIncrement, true)
  assert.equal(byName(loaded, 'email').nullable, false)
  assert.equal(byName(loaded, 'age').defaultValue, '18')
  assert.deepEqual(loaded.indexes.map((i) => [i.name, i.columns, i.unique, !!i.locked]), [['ix_email', ['email'], true, false]])
  assert.deepEqual(planDdl(ctx, loaded, clone(loaded)).statements, [])
  console.log('designInfo + no-op round trip OK')

  let e = clone(loaded)
  e.columns.push(col('nick', 'text', { defaultValue: "'anon'" }))
  byName(e, 'email').name = 'mail'
  e.indexes[0].columns = ['mail']
  e.indexes.push({ id: 'i2', originalName: null, name: 'ix_age', columns: ['age'], unique: false })
  await apply(d, loaded, e)
  assert.deepEqual((await d.query('SELECT id, mail, age, nick FROM users ORDER BY id')).rows, [[1, 'a@x', 18, 'anon'], [2, 'b@x', 18, 'anon']])
  loaded = await d.designInfo('main', obj)
  assert.deepEqual(loaded.indexes.map((i) => i.name).sort(), ['ix_age', 'ix_email'])
  assert.deepEqual(loaded.indexes.find((i) => i.name === 'ix_email').columns, ['mail'])
  console.log('add / rename / index on a populated table OK')

  e = clone(loaded)
  e.columns = e.columns.filter((c) => c.name !== 'age')
  e.indexes = e.indexes.filter((i) => i.name !== 'ix_age')
  await apply(d, loaded, e)
  loaded = await d.designInfo('main', obj)
  assert.deepEqual(loaded.columns.map((c) => c.name), ['id', 'mail', 'nick'])
  assert.equal(loaded.indexes.length, 1)
  assert.deepEqual((await d.query('SELECT mail FROM users ORDER BY id')).rows, [['a@x'], ['b@x']])
  console.log('drop column / index OK')

  await assert.rejects(d.executeDdl('main', ['ALTER TABLE users ADD COLUMN ok_col int', 'ALTER TABLE users ADD COLUMN mail text']), /duplicate column/i)
  assert.equal((await d.designInfo('main', obj)).columns.some((c) => c.name === 'ok_col'), false)
  console.log('failed DDL is rolled back as a whole OK')

  e = clone(loaded)
  byName(e, 'mail').type = 'varchar(5)'
  assert.ok(planDdl(ctx, loaded, e).errors.some((x) => /cannot change the type/.test(x)))
  await d.query("INSERT INTO users (mail) VALUES ('c@x')")
  assert.equal((await d.query('SELECT max(id) FROM users')).rows[0][0], 3)
  console.log('SQLite limits reported; autoincrement still works OK')

  await d.query('CREATE TABLE t2 (a int, b int, UNIQUE(a))')
  await d.query('CREATE INDEX ix_expr ON t2 (b + 1)')
  const t2 = await d.designInfo('main', { name: 't2', type: 'table' })
  assert.ok(t2.indexes.length === 2 && t2.indexes.every((i) => i.locked))
  console.log('constraint / expression indexes are locked OK')

  // foreign keys: defined at CREATE time, shown read-only afterwards
  const fkc = (name, columns, refTable, o = {}) => ({ id: 'f' + ++n, originalName: null, name, columns, refTable, refColumns: ['id'], onDelete: 'NO ACTION', onUpdate: 'NO ACTION', ...o })
  await apply(d, null, { name: 'parents', indexes: [], columns: [col('id', 'integer', { primaryKey: true, nullable: false })] })
  const kids = { name: 'kids', indexes: [], columns: [col('id', 'integer', { primaryKey: true, nullable: false }), col('parent_id', 'integer')], foreignKeys: [fkc('fk_parent', ['parent_id'], 'parents', { onDelete: 'CASCADE' })] }
  await apply(d, null, kids)
  const kd = await d.designInfo('main', { name: 'kids', type: 'table' })
  assert.equal(kd.foreignKeys.length, 1)
  assert.deepEqual(
    [kd.foreignKeys[0].columns, kd.foreignKeys[0].refTable, kd.foreignKeys[0].refColumns, kd.foreignKeys[0].onDelete, kd.foreignKeys[0].locked],
    [['parent_id'], 'parents', ['id'], 'CASCADE', true]
  )
  assert.deepEqual(planDdl(ctx, kd, clone(kd)).statements, [])
  const noFk = clone(kd)
  noFk.foreignKeys = []
  assert.ok(planDdl(ctx, kd, noFk).errors.length === 0, 'locked SQLite FKs are never dropped, so removing the row is a no-op')
  assert.deepEqual(planDdl(ctx, kd, noFk).statements, [])
  const addFk = clone(kd)
  addFk.foreignKeys.push(fkc('fk_other', ['id'], 'parents'))
  assert.ok(planDdl(ctx, kd, addFk).errors.some((x) => /cannot add or drop foreign keys/.test(x)))
  console.log('SQLite foreign keys: created inline, loaded read-only, changes refused OK')

  await d.close()
})().catch((e) => {
  console.error('FAIL', e)
  process.exit(1)
})
