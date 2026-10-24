// Data transfer between every pair of engines available, on real databases.
const assert = require('node:assert/strict')
const { Env, seed, snapshot } = require('./helpers/engines.cjs')
const { transferTables } = require('./.build/transfer.cjs')

const hooks = (cancelAfter) => {
  let calls = 0
  return { isCancelled: () => cancelAfter !== undefined && ++calls > cancelAfter, onProgress() {} }
}
const COLS = { parents: ['id', 'label'], items: ['id', 'parent_id', 'title', 'qty', 'price', 'note', 'bin', 'created', 'big', 'meta'] }
const tablesOf = (c) => ['parents', 'items'].map((name) => ({ name, type: 'table', schema: c.kind === 'postgres' ? c.container : undefined }))
const ep = (c) => ({ driver: c.driver, kind: c.kind, container: c.container })
const OPTS = { createTables: true, ifExists: 'append', copyData: true }

;(async () => {
  const env = await new Env().init()
  console.log(`engines available: ${env.kinds.join(', ')}`)
  try {
    for (const from of env.kinds) {
      for (const to of env.kinds) {
        const label = `${from} → ${to}`
        const src = await env.container(from, 's')
        const dst = await env.container(to, 'd')
        const counts = await seed(src)
        const expected = { parents: await snapshot(src, 'parents', COLS.parents), items: await snapshot(src, 'items', COLS.items) }

        // ── create tables + copy everything ──
        const res = await transferTables(ep(src), ep(dst), tablesOf(src), OPTS, hooks())
        assert.deepEqual(res.map((r) => [r.table, r.status, r.created, r.rows]), [['parents', 'ok', true, counts.parents], ['items', 'ok', true, counts.items]], `${label}: ${JSON.stringify(res)}`)
        for (const name of ['parents', 'items']) {
          const got = await snapshot(dst, name, COLS[name])
          assert.equal(got.length, expected[name].length, `${label}: ${name} row count`)
          assert.deepEqual(got, expected[name], `${label}: ${name} data must survive the trip cell for cell`)
        }

        // ── structure: keys, indexes and the foreign key arrived ──
        const items = (await dst.driver.objects(dst.container)).find((o) => o.name === 'items')
        const design = await dst.driver.designInfo(dst.container, items)
        assert.equal(design.columns.find((c) => c.name === 'id').primaryKey, true, `${label}: primary key`)
        assert.equal(design.columns.find((c) => c.name === 'id').autoIncrement, true, `${label}: auto-increment`)
        assert.equal(design.foreignKeys.length, 1, `${label}: foreign key; notes: ${JSON.stringify(res.map((r) => r.notes))}`)
        assert.deepEqual([design.foreignKeys[0].refTable, design.foreignKeys[0].onDelete], ['parents', 'CASCADE'])
        assert.ok(design.indexes.some((i) => i.columns.join() === 'parent_id,title' && i.unique), `${label}: unique index`)
        assert.ok(design.indexes.some((i) => i.columns.join() === 'title'), `${label}: plain index`)

        // ── the next auto id continues after the copied ones ──
        await dst.driver.insertRows(dst.container, items, ['title'], [['after transfer']])
        const max = Math.max(...(await snapshot(dst, 'items', ['id'])).map((r) => Number(r[0])))
        assert.equal(max, Math.max(...expected.items.map((r) => Number(r[0]))) + 1, `${label}: id sequence continues`)

        // ── existing tables: skip / append (fails whole, rolls back) / truncate ──
        const before = (await snapshot(dst, 'items', ['id'])).length
        let r2 = await transferTables(ep(src), ep(dst), tablesOf(src), { ...OPTS, ifExists: 'skip' }, hooks())
        assert.deepEqual(r2.map((r) => r.status), ['skipped', 'skipped'], `${label}: skip`)
        r2 = await transferTables(ep(src), ep(dst), tablesOf(src), { ...OPTS, ifExists: 'append' }, hooks())
        assert.deepEqual(r2.map((r) => r.status), ['failed', 'failed'], `${label}: appending the same keys must fail`)
        assert.ok(r2.every((r) => r.rows === 0 && r.error), `${label}: failed tables report no rows and an error`)
        assert.equal((await snapshot(dst, 'items', ['id'])).length, before, `${label}: a failed table copy is rolled back completely`)
        r2 = await transferTables(ep(src), ep(dst), tablesOf(src), { ...OPTS, ifExists: 'truncate' }, hooks())
        assert.deepEqual(r2.map((r) => [r.status, r.rows]), [['ok', counts.parents], ['ok', counts.items]], `${label}: truncate then reload: ${JSON.stringify(r2)}`)
        assert.deepEqual(await snapshot(dst, 'items', COLS.items), expected.items, `${label}: truncate+reload gives exactly the source data`)

        // ── missing table with "create" off, structure only, cancel ──
        const dst2 = await env.container(to, 'e')
        const r3 = await transferTables(ep(src), ep(dst2), tablesOf(src), { ...OPTS, createTables: false }, hooks())
        assert.ok(r3.every((r) => r.status === 'failed' && /does not exist/.test(r.error)), `${label}: create off`)
        const dst3 = await env.container(to, 'f')
        const r4 = await transferTables(ep(src), ep(dst3), tablesOf(src), { ...OPTS, copyData: false }, hooks())
        assert.ok(r4.every((r) => r.status === 'ok' && r.created && r.rows === 0), `${label}: structure only`)
        assert.equal((await snapshot(dst3, 'items', ['id'])).length, 0)
        const dst4 = await env.container(to, 'g')
        const r5 = await transferTables(ep(src), ep(dst4), tablesOf(src), OPTS, hooks(6)) // the 7th check lands between items page 1 and 2: a cancel in the middle of a table
        assert.ok(r5.some((r) => r.status === 'failed' && /Cancel/i.test(r.error)), `${label}: cancel is reported: ${JSON.stringify(r5.map((r) => [r.table, r.status, r.error]))}`)
        for (const name of ['parents', 'items']) {
          const objs = await dst4.driver.objects(dst4.container)
          if (objs.some((o) => o.name === name)) assert.equal((await snapshot(dst4, name, ['id'])).length, r5.find((r) => r.table === name).status === 'ok' ? expected[name].length : 0, `${label}: cancelled table ${name} left no partial rows`)
        }

        console.log(`  ${label}: ${counts.items + counts.parents} rows, structure, sequences, skip/append/truncate, cancel OK`)
      }
    }
    console.log('ALL TRANSFER TESTS PASSED')
  } finally {
    await env.stop()
  }
})().catch((e) => {
  console.error('FAIL', e)
  process.exit(1)
})
