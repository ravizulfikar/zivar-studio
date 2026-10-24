// Script runner + SQL dump, proven by a full round trip: dump a database, run the dump into an empty one,
// compare structure and data. Runs on SQLite always, and on PostgreSQL / MySQL when their binaries exist.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { startPg, startMysql } = require('./helpers/servers.cjs')
const { dumpSql } = require('./.build/dump.cjs')
const { runScript } = require('./.build/script.cjs')
const { splitSql } = require('./.build/sqlSplit.cjs')
const { planDdl } = require('./.build/ddl.cjs')
const { SqliteDriver } = require('./.build/sqlite.cjs')
const { PostgresDriver } = require('./.build/postgres.cjs')
const { MySqlDriver } = require('./.build/mysql.cjs')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zivar-dump-'))
const clone = (d) => JSON.parse(JSON.stringify(d))
const hooks = (cancelAfter) => {
  let calls = 0
  return { isCancelled: () => cancelAfter !== undefined && ++calls > cancelAfter, onProgress() {} }
}

/** Rows as comparable plain values: bytes as hex, objects as sorted JSON. */
const norm = (v) => (v instanceof Uint8Array ? `hex:${Buffer.from(v).toString('hex')}` : v !== null && typeof v === 'object' ? JSON.stringify(v) : v)

async function allRows(d, container, obj) {
  const p = await d.tableData(container, obj, { limit: 100000, offset: 0, orderBy: { column: 'id', dir: 'asc' } })
  return { columns: p.columns, rows: p.rows.map((r) => r.map(norm)) }
}

const TRICKY = [
  "plain",
  'back\\slash \\n literal',
  "; DROP TABLE items; --",
  "it's \"quoted\"",
  'emoji 😀 ünï 日本語',
  'line1\nline2\r\nline3\ttab',
  '',
  null
]

async function exercise(name, kind, make) {
  const { source, target, srcC, dstC, setup, extraCompare, close } = await make()
  try {
    await setup()
    const objs = (await source.objects(srcC)).filter((o) => o.type === 'table')
    assert.deepEqual(objs.map((o) => o.name).sort(), ['items', 'parents'])
    const dump = (opts, file, h = hooks()) => dumpSql(source, kind, srcC, objs, opts, file, h)
    const run = async (file, cont, o = { stopOnError: true, transaction: false }) => {
      const stmts = splitSql(fs.readFileSync(file, 'utf8'), kind)
      return { stmts, result: await runScript(target, kind, cont, stmts, o, hooks()) }
    }

    // ── full dump → restore ──
    const full = path.join(tmp, `${name}-full.sql`)
    const info = await dump({ structure: true, data: true, dropExisting: false, qualified: false }, full)
    assert.equal(info.tables, 2)
    assert.ok(info.rows > 1100, `rows dumped: ${info.rows}`)
    assert.ok(info.bytes > 1000 && fs.statSync(full).size === info.bytes, 'reported size equals the file size')
    const { stmts, result } = await run(full, dstC)
    assert.deepEqual(result.failures, [], result.failures.map((f) => `line ${f.line}: ${f.error}\n${f.statement}`).join('\n'))
    assert.equal(result.cancelled, false)
    console.log(`  [${name}] dump ${info.rows} rows → ${stmts.length} statements restored with no failures${info.notes.length ? ` (notes: ${info.notes.length})` : ''}`)

    for (const o of objs) {
      const a = await allRows(source, srcC, o)
      const b = await allRows(target, dstC, o)
      assert.deepEqual(b.columns, a.columns, `${o.name}: columns`)
      assert.equal(b.rows.length, a.rows.length, `${o.name}: row count`)
      assert.deepEqual(b.rows, a.rows, `${o.name}: every cell must match after the round trip`)
    }
    console.log(`  [${name}] all cells identical after restore (quotes, backslashes, newlines, emoji, NULLs, blobs, big ints)`)

    // structure: the restored table must produce no DDL when compared with the original design
    const scrub = (d) => ({ ...d, foreignKeys: (d.foreignKeys ?? []).map((f) => ({ ...f, refSchema: undefined })) })
    for (const o of objs) {
      const sd = scrub(await source.designInfo(srcC, o))
      const td = scrub(await target.designInfo(dstC, o))
      const plan = planDdl({ kind, container: dstC }, td, clone(sd))
      assert.deepEqual(plan.statements.concat(plan.errors), [], `${o.name}: restored structure differs from the original`)
    }
    console.log(`  [${name}] structure round trip: restored tables match the originals (columns, indexes, foreign keys)`)

    if (extraCompare) await extraCompare()

    // ── re-running with DROP TABLE IF EXISTS resets instead of duplicating ──
    const withDrop = path.join(tmp, `${name}-drop.sql`)
    await dump({ structure: true, data: true, dropExisting: true, qualified: false }, withDrop)
    const again = await run(withDrop, dstC)
    assert.deepEqual(again.result.failures, [], again.result.failures.map((f) => f.error).join('|'))
    assert.equal((await allRows(target, dstC, objs.find((o) => o.name === 'items'))).rows.length, (await allRows(source, srcC, objs.find((o) => o.name === 'items'))).rows.length)
    console.log(`  [${name}] re-running a dump with DROP TABLE IF EXISTS gives the same row counts`)

    // ── options: structure only, data only ──
    const structOnly = path.join(tmp, `${name}-struct.sql`)
    const s = await dump({ structure: true, data: false, dropExisting: true, qualified: false }, structOnly)
    assert.equal(s.rows, 0)
    assert.ok(!/INSERT INTO/.test(fs.readFileSync(structOnly, 'utf8')))
    assert.deepEqual((await run(structOnly, dstC)).result.failures, [])
    assert.equal((await allRows(target, dstC, objs.find((o) => o.name === 'items'))).rows.length, 0, 'structure-only restore leaves empty tables')
    const dataOnly = path.join(tmp, `${name}-data.sql`)
    await dump({ structure: false, data: true, dropExisting: false, qualified: false }, dataOnly)
    assert.ok(!/CREATE TABLE/.test(fs.readFileSync(dataOnly, 'utf8')))
    assert.deepEqual((await run(dataOnly, dstC)).result.failures, [])
    assert.equal((await allRows(target, dstC, objs.find((o) => o.name === 'items'))).rows.length, (await allRows(source, srcC, objs.find((o) => o.name === 'items'))).rows.length)
    console.log(`  [${name}] structure-only and data-only dumps OK`)

    // ── identity / sequence: the next insert must not collide with restored ids ──
    const items = objs.find((o) => o.name === 'items')
    const before = (await allRows(target, dstC, items)).rows.length
    await target.insertRows(dstC, items, ['title'], [['inserted after restore']])
    assert.equal((await allRows(target, dstC, items)).rows.length, before + 1, 'auto id must continue past the restored ids')
    console.log(`  [${name}] auto-increment / identity continues after restore`)

    // ── cancel removes the partial file ──
    const cancelled = path.join(tmp, `${name}-cancel.sql`)
    await assert.rejects(dump({ structure: true, data: true, dropExisting: false, qualified: false }, cancelled, hooks(1)), /cancelled/)
    assert.equal(fs.existsSync(cancelled), false, 'a cancelled dump leaves no file behind')
    console.log(`  [${name}] cancelling a dump deletes the partial file`)

    // ── script runner behaviours ──
    const T = (sql) => splitSql(sql, kind)
    const q = kind === 'mysql' ? '`' : '"'
    const probe = `${q}probe${q}`
    await target.query(`DROP TABLE IF EXISTS ${probe}`, dstC)
    await target.query(`CREATE TABLE ${probe} (id INTEGER NOT NULL PRIMARY KEY, v VARCHAR(20))`, dstC)
    const script = `INSERT INTO ${probe} VALUES (1,'a'); INSERT INTO ${probe} VALUES (1,'dup'); INSERT INTO ${probe} VALUES (2,'b'); INSERT INTO ${probe} VALUES (3,'c');`
    const count = async () => (await target.query(`SELECT count(*) FROM ${probe}`, dstC)).rows[0][0]
    // 1. carry on after an error
    let r = await runScript(target, kind, dstC, T(script), { stopOnError: false, transaction: false }, hooks())
    assert.deepEqual([r.total, r.executed, r.failures.length, r.failures[0].index, r.failures[0].line], [4, 3, 1, 1, 1])
    assert.equal(Number(await count()), 3)
    // 2. stop at the first error
    await target.query(`DELETE FROM ${probe}`, dstC)
    r = await runScript(target, kind, dstC, T(script), { stopOnError: true, transaction: false }, hooks())
    assert.deepEqual([r.executed, r.failures.length], [1, 1])
    assert.equal(Number(await count()), 1)
    // 3. one transaction: the error undoes the earlier insert too
    await target.query(`DELETE FROM ${probe}`, dstC)
    r = await runScript(target, kind, dstC, T(script), { stopOnError: false, transaction: true }, hooks())
    assert.deepEqual([r.rolledBack, r.executed, r.failures.length], [true, 0, 1])
    assert.equal(Number(await count()), 0, 'transaction mode leaves nothing behind')
    // 4. a clean script in a transaction commits
    r = await runScript(target, kind, dstC, T(`INSERT INTO ${probe} VALUES (10,'x'); INSERT INTO ${probe} VALUES (11,'y');`), { stopOnError: true, transaction: true }, hooks())
    assert.deepEqual([r.rolledBack, r.executed, r.failures.length], [false, 2, 0])
    assert.equal(Number(await count()), 2)
    // 5. cancel between statements
    r = await runScript(target, kind, dstC, T(`INSERT INTO ${probe} VALUES (20,'a'); INSERT INTO ${probe} VALUES (21,'b'); INSERT INTO ${probe} VALUES (22,'c');`), { stopOnError: false, transaction: false }, hooks(1))
    assert.equal(r.cancelled, true)
    assert.ok(r.executed >= 1 && r.executed < 3)
    console.log(`  [${name}] script runner: continue / stop / transaction rollback / commit / cancel OK`)
  } finally {
    await close()
  }
}

;(async () => {
  // ── SQLite ──
  console.log('SQLite')
  await exercise('sqlite', 'sqlite', async () => {
    const source = new SqliteDriver({ id: 's', name: 's', kind: 'sqlite', database: path.join(tmp, 'src.db') })
    const target = new SqliteDriver({ id: 't', name: 't', kind: 'sqlite', database: path.join(tmp, 'dst.db') })
    await source.connect()
    await target.connect()
    return {
      source,
      target,
      srcC: 'main',
      dstC: 'main',
      async setup() {
        await source.query('CREATE TABLE parents (id INTEGER PRIMARY KEY, label TEXT NOT NULL)')
        await source.query('CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER REFERENCES parents(id) ON DELETE CASCADE, title TEXT NOT NULL, qty INTEGER DEFAULT 1, price REAL, note TEXT, bin BLOB, created TEXT, big TEXT)')
        await source.query('CREATE INDEX ix_title ON items (title)')
        await source.query('CREATE UNIQUE INDEX ux_pt ON items (parent_id, title)')
        await source.insertRows('main', { name: 'parents', type: 'table' }, ['id', 'label'], [[1, 'Alpha'], [2, "O'Brien & Sons"]])
        const rows = TRICKY.map((t, i) => [(i % 2) + 1, `${t ?? 'NULL'}#${i}`, i === 1 ? null : i, i * 1.25, t, i === 0 ? Buffer.from([0, 1, 2, 255]) : null, '2025-09-17 13:39:18', '9007199254740993'])
        for (let i = 0; i < 1100; i++) rows.push([1, `bulk ${i}`, i, 0.5, `note ${i}`, null, null, null])
        await source.insertRows('main', { name: 'items', type: 'table' }, ['parent_id', 'title', 'qty', 'price', 'note', 'bin', 'created', 'big'], rows)
      },
      async close() {
        await source.close()
        await target.close()
      }
    }
  })

  // ── PostgreSQL ──
  const pg = await startPg()
  if (!pg) console.log('PostgreSQL: SKIPPED (binaries not found)')
  else {
    console.log('PostgreSQL')
    try {
      await exercise('postgres', 'postgres', async () => {
        const cfg = { id: 'x', name: 'x', kind: 'postgres', ...pg.target }
        const source = new PostgresDriver(cfg)
        const target = new PostgresDriver(cfg)
        await source.connect()
        await target.connect()
        await target.query('CREATE SCHEMA dst', null)
        return {
          source,
          target,
          srcC: 'src',
          dstC: 'dst',
          async setup() {
            await source.query('CREATE SCHEMA src', null)
            await source.query('CREATE TABLE src.parents (id integer PRIMARY KEY, label text NOT NULL)', null)
            await source.query(
              `CREATE TABLE src.items (id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, parent_id integer REFERENCES src.parents(id) ON DELETE CASCADE, title text NOT NULL,
                 qty integer DEFAULT 1, price numeric(10,2), note text, bin bytea, created timestamp, tags text[], meta jsonb, big bigint, total integer GENERATED ALWAYS AS (qty * 2) STORED)`,
              null
            )
            await source.query('CREATE INDEX ix_title ON src.items (title)', null)
            await source.query('CREATE UNIQUE INDEX ux_pt ON src.items (parent_id, title)', null)
            await source.query('CREATE INDEX ix_lower ON src.items (lower(title))', null)
            await source.insertRows('src', { name: 'parents', type: 'table' }, ['id', 'label'], [[1, 'Alpha'], [2, "O'Brien & Sons"]])
            const rows = TRICKY.map((t, i) => [(i % 2) + 1, `${t ?? 'NULL'}#${i}`, i === 1 ? null : i, `${i}.25`, t, i === 0 ? Buffer.from([0, 1, 2, 255]) : null, '2025-09-17 13:39:18', ['a', 'b c', "q'x"], JSON.stringify([{ i, s: t }, 'a string', 42, true, [1, 2], { i, s: t }][i % 6]), '9007199254740993'])
            for (let i = 0; i < 1100; i++) rows.push([1, `bulk ${i}`, i, '0.50', `note ${i}`, null, null, null, null, null])
            await source.insertRows('src', { name: 'items', type: 'table' }, ['parent_id', 'title', 'qty', 'price', 'note', 'bin', 'created', 'tags', 'meta', 'big'], rows)
          },
          async extraCompare() {
            // the expression index cannot be modelled, so it is replayed from pg_get_indexdef
            const idx = (await target.designInfo('dst', { name: 'items', type: 'table' })).indexes.map((i) => i.name).sort()
            assert.ok(idx.includes('ix_lower'), 'expression index must be restored')
            const gen = (await target.designInfo('dst', { name: 'items', type: 'table' })).columns.find((c) => c.name === 'total')
            assert.equal(gen.locked, true, 'generated column stays generated')
          },
          async close() {
            await source.close()
            await target.close()
          }
        }
      })

      // qualified names: the dump recreates the schema itself
      {
        console.log('PostgreSQL (qualified names)')
        const cfg = { id: 'x', name: 'x', kind: 'postgres', ...pg.target }
        const d = new PostgresDriver(cfg)
        await d.connect()
        await d.query('CREATE SCHEMA q1', null)
        await d.query('CREATE TABLE q1.t (id integer PRIMARY KEY, v text)', null)
        await d.insertRows('q1', { name: 't', type: 'table' }, ['id', 'v'], [[1, 'x'], [2, 'y']])
        const file = path.join(tmp, 'pg-qualified.sql')
        await dumpSql(d, 'postgres', 'q1', [{ name: 't', type: 'table', schema: 'q1' }], { structure: true, data: true, dropExisting: false, qualified: true }, file, hooks())
        assert.match(fs.readFileSync(file, 'utf8'), /CREATE SCHEMA IF NOT EXISTS "q1"[\s\S]*CREATE TABLE "q1"\."t"/)
        await d.query('DROP SCHEMA q1 CASCADE', null)
        const res = await runScript(d, 'postgres', null, splitSql(fs.readFileSync(file, 'utf8'), 'postgres'), { stopOnError: true, transaction: false }, hooks())
        assert.deepEqual(res.failures, [])
        assert.deepEqual((await d.query('SELECT id, v FROM q1.t ORDER BY id', null)).rows, [[1, 'x'], [2, 'y']])
        await d.close()
        console.log('  [postgres] qualified dump recreates its schema and loads OK')
      }
    } finally {
      pg.stop()
    }
  }

  // ── MySQL ──
  const my = await startMysql()
  if (!my) console.log('MySQL: SKIPPED (mysqld not found)')
  else {
    console.log('MySQL')
    try {
      const mysql = require('mysql2/promise')
      const admin = await mysql.createConnection({ ...my.target, multipleStatements: true })
      await admin.query('CREATE DATABASE dst; CREATE DATABASE src;')
      await exercise('mysql', 'mysql', async () => {
        const cfg = { id: 'x', name: 'x', kind: 'mysql', ...my.target }
        const source = new MySqlDriver(cfg)
        const target = new MySqlDriver(cfg)
        await source.connect()
        await target.connect()
        return {
          source,
          target,
          srcC: 'src',
          dstC: 'dst',
          async setup() {
            await admin.query('CREATE TABLE src.parents (id INT PRIMARY KEY, label VARCHAR(50) NOT NULL) ENGINE=InnoDB')
            await admin.query(
              `CREATE TABLE src.items (id INT AUTO_INCREMENT PRIMARY KEY, parent_id INT, title VARCHAR(100) NOT NULL, qty INT DEFAULT 1, price DECIMAL(10,2), note TEXT, bin BLOB,
                 created DATETIME, meta JSON, big BIGINT, total INT AS (qty * 2) STORED, KEY ix_title (title), UNIQUE KEY ux_pt (parent_id, title),
                 CONSTRAINT fk_items_parent FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE CASCADE) ENGINE=InnoDB`
            )
            await source.insertRows('src', { name: 'parents', type: 'table' }, ['id', 'label'], [[1, 'Alpha'], [2, "O'Brien & Sons"]])
            const rows = TRICKY.map((t, i) => [(i % 2) + 1, `${t ?? 'NULL'}#${i}`, i === 1 ? null : i, `${i}.25`, t, i === 0 ? Buffer.from([0, 1, 2, 255]) : null, '2025-09-17 13:39:18', JSON.stringify([{ i, s: t }, 'a string', 42, true, [1, 2], { i, s: t }][i % 6]), '9007199254740993'])
            for (let i = 0; i < 1100; i++) rows.push([1, `bulk ${i}`, i, '0.50', `note ${i}`, null, null, null, null])
            await source.insertRows('src', { name: 'items', type: 'table' }, ['parent_id', 'title', 'qty', 'price', 'note', 'bin', 'created', 'meta', 'big'], rows)
          },
          async close() {
            await source.close()
            await target.close()
          }
        }
      })
      await admin.end()
    } finally {
      my.stop()
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true }) // the dump files of this run
  console.log('ALL DUMP / SCRIPT TESTS PASSED')
})().catch((e) => {
  console.error('FAIL', e)
  process.exit(1)
})
