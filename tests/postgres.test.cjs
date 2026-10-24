// Integration test against a REAL PostgreSQL, in one of two modes:
//
//  1. default: a throwaway cluster (initdb) in a temp folder on a free port, deleted afterwards.
//     Skipped when PostgreSQL binaries are not installed (set PG_BIN to point at them).
//  2. ZIVAR_TEST_PG_URL=postgres://user:pass@host:port/db : an existing database. SAFETY RULES:
//       - every write/DDL happens inside a scratch schema named zivar_test_<random>, created here;
//       - the only DROP issued is `DROP SCHEMA <that scratch schema> CASCADE` (guarded by its prefix);
//       - the database itself and all pre-existing objects are only ever READ.
const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const EXTERNAL = process.env.ZIVAR_TEST_PG_URL
const SCRATCH_PREFIX = 'zivar_test_'
const S = EXTERNAL ? `${SCRATCH_PREFIX}${crypto.randomBytes(4).toString('hex')}` : 'app'

let cluster = null // only in throwaway mode
let PORT = 0
let target = null // connection settings of the server under test

function locateBin() {
  const candidates = [process.env.PG_BIN, 'C:/Program Files/PostgreSQL/17/bin', 'C:/Program Files/PostgreSQL/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin'].filter(Boolean)
  return candidates.find((d) => fs.existsSync(path.join(d, process.platform === 'win32' ? 'initdb.exe' : 'initdb')))
}
const exe = (bin, n) => path.join(bin, process.platform === 'win32' ? `${n}.exe` : n)

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = require('node:net').createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

async function startCluster(bin) {
  PORT = await freePort()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zivar-pg-'))
  const data = path.join(root, 'data')
  const log = path.join(root, 'pg.log')
  execFileSync(exe(bin, 'initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-sync'], { stdio: 'pipe' })
  // stdio must be 'ignore': the server inherits pipes and would keep them open, hanging a piped call.
  const started = spawnSync(exe(bin, 'pg_ctl'), ['-D', data, '-l', log, '-w', '-o', `-p ${PORT} -c listen_addresses=127.0.0.1 -c fsync=off`, 'start'], { stdio: 'ignore' })
  if (started.status !== 0) {
    const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '(no log written)'
    throw new Error(`PostgreSQL did not start:\n${text.slice(-1500)}`)
  }
  cluster = { bin, root, data }
  return { host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres' }
}

function stopCluster() {
  if (!cluster) return
  const c = cluster
  cluster = null
  spawnSync(exe(c.bin, 'pg_ctl'), ['-D', c.data, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' })
  try {
    fs.rmSync(c.root, { recursive: true, force: true })
  } catch {
    /* Windows may still hold a handle for a moment; the OS temp cleaner gets it */
  }
}
// Even if the test crashes, never leave a server running.
process.on('exit', () => stopCluster())

const { PostgresDriver } = require('./.build/postgres.cjs')
const { planDdl } = require('./.build/ddl.cjs')
const pg = require('pg')

const clone = (d) => JSON.parse(JSON.stringify(d))
let n = 0
const col = (name, type, o = {}) => ({ id: 'c' + ++n, originalName: null, name, type, nullable: true, primaryKey: false, defaultValue: null, autoIncrement: false, ...o })
const byName = (design, name) => design.columns.find((c) => c.name === name)

/** Read-only audit of a real database: the designer must round-trip every existing table with no DDL. */
async function auditExisting(d) {
  const schemas = (await d.containers()).filter((s) => !s.startsWith(SCRATCH_PREFIX))
  const totals = { schemas: schemas.length, tables: 0, views: 0, matviews: 0, functions: 0, roundTripped: 0, lockedIndexes: 0, indexes: 0, pages: 0 }
  const problems = []
  for (const schema of schemas) {
    const objs = await d.objects(schema)
    for (const o of objs) {
      if (o.type === 'view') totals.views++
      else if (o.type === 'matview') totals.matviews++
      else if (o.type === 'function') totals.functions++
      else totals.tables++
    }
    for (const t of objs.filter((o) => o.type === 'table').slice(0, 150)) {
      try {
        const design = await d.designInfo(schema, t)
        const plan = planDdl({ kind: 'postgres', container: schema }, design, clone(design))
        if (plan.statements.length || plan.errors.length) problems.push(`${schema}.${t.name}: no-op diff produced ${JSON.stringify(plan.statements.concat(plan.errors)).slice(0, 200)}`)
        else totals.roundTripped++
        totals.indexes += design.indexes.length
        totals.lockedIndexes += design.indexes.filter((i) => i.locked).length
        // Loading a page proves the generated SELECT works on this table; contents are never printed.
        const page = await d.tableData(schema, t, { limit: 5, offset: 0 })
        assert.ok(Array.isArray(page.rows))
        totals.pages++
      } catch (e) {
        problems.push(`${schema}.${t.name}: ${e.message}`)
      }
    }
  }
  return { totals, problems }
}

;(async () => {
  if (EXTERNAL) {
    const u = new URL(EXTERNAL)
    target = { host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) }
  } else {
    const bin = locateBin()
    if (!bin) {
      console.log('SKIPPED: PostgreSQL binaries not found (set PG_BIN) and ZIVAR_TEST_PG_URL not set')
      process.exit(0)
    }
    target = await startCluster(bin)
    console.log(`throwaway cluster up on port ${PORT}`)
  }

  const admin = new pg.Client(target)
  await admin.connect()
  const version = (await admin.query('SHOW server_version')).rows[0].server_version
  console.log(`${EXTERNAL ? 'EXISTING database' : 'throwaway cluster'}: ${target.database} @ ${target.host}:${target.port}, PostgreSQL ${version}`)
  if (EXTERNAL) console.log(`all writes confined to scratch schema "${S}"`)

  const dropScratch = async () => {
    // The only destructive statement this suite ever issues, and only for a schema it created.
    if (EXTERNAL && S.startsWith(SCRATCH_PREFIX)) await admin.query(`DROP SCHEMA IF EXISTS "${S}" CASCADE`)
  }

  const d = new PostgresDriver({ id: 'x', name: 'x', kind: 'postgres', ...target })
  const ctx = { kind: 'postgres', container: S }

  try {
    await admin.query(`
      CREATE SCHEMA ${S};
      CREATE TABLE ${S}.users (
        id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        email text NOT NULL,
        age integer DEFAULT 18,
        created timestamp DEFAULT '2025-09-17 13:39:18',
        nick varchar(20),
        UNIQUE (email)
      );
      CREATE INDEX ix_age ON ${S}.users (age);
      CREATE INDEX ix_lower_nick ON ${S}.users (lower(nick));
      CREATE INDEX ix_partial ON ${S}.users (age) WHERE age > 50;
      INSERT INTO ${S}.users (email, age) SELECT 'u' || g || '@x', g % 7 FROM generate_series(1, 25) g;
      CREATE VIEW ${S}.v_users AS SELECT id, email FROM ${S}.users;
      CREATE MATERIALIZED VIEW ${S}.mv_users AS SELECT id, email FROM ${S}.users;
      CREATE FUNCTION ${S}.f_add(a integer, b integer) RETURNS integer LANGUAGE sql AS 'SELECT a + b';
      CREATE FUNCTION ${S}.f_add(a text) RETURNS text LANGUAGE sql AS 'SELECT a';
      CREATE PROCEDURE ${S}.p_noop() LANGUAGE sql AS 'SELECT 1';
    `)
    console.log('fixtures created')

    await d.connect()

    // ── browsing ──
    const containers = await d.containers()
    assert.ok(containers.includes(S) && containers.includes('public'))
    assert.ok(!containers.some((c) => c.startsWith('pg_') || c === 'information_schema'))

    const objs = await d.objects(S)
    const brief = objs.map((o) => `${o.type}:${o.name}${o.args !== undefined ? `(${o.args})` : ''}${o.routine ? `/${o.routine}` : ''}`).sort()
    assert.deepEqual(brief, ['function:f_add(a integer, b integer)/function', 'function:f_add(a text)/function', 'function:p_noop()/procedure', 'matview:mv_users', 'table:users', 'view:v_users'])
    console.log('containers / objects (table, view, matview, overloaded functions, procedure) OK')

    const users = objs.find((o) => o.name === 'users')
    const mv = objs.find((o) => o.type === 'matview')
    assert.deepEqual((await d.describe(S, mv)).map((c) => c.name), ['id', 'email'])
    assert.equal((await d.describe(S, users)).find((c) => c.name === 'id').primaryKey, true)

    assert.match(await d.definition(S, objs.find((o) => o.type === 'view')), new RegExp(`CREATE OR REPLACE VIEW "${S}"\\."v_users" AS`))
    assert.match(await d.definition(S, mv), new RegExp(`CREATE MATERIALIZED VIEW "${S}"\\."mv_users" AS`))
    const f1 = objs.find((o) => o.args === 'a integer, b integer')
    const f2 = objs.find((o) => o.args === 'a text')
    assert.match(await d.definition(S, f1), /RETURNS integer/)
    assert.match(await d.definition(S, f2), /RETURNS text/)
    console.log('describe (incl. matview) / definition (overloads told apart) OK')

    // ── data editor ──
    let p = await d.tableData(S, users, { limit: 10, offset: 0, orderBy: { column: 'id', dir: 'asc' } })
    assert.equal(p.rows.length, 10)
    assert.equal(p.hasNext, true)
    assert.equal(p.rows[0][p.columns.indexOf('created')], '2025-09-17 13:39:18', 'timestamps must stay as stored text')
    p = await d.tableData(S, users, { limit: 100, offset: 20, orderBy: { column: 'id', dir: 'desc' } })
    assert.equal(p.rows.length, 5)
    assert.equal(p.hasNext, false)
    p = await d.tableData(S, users, { limit: 100, offset: 0, where: 'age = 0' })
    assert.ok(p.rows.length > 0 && p.rows.every((r) => r[p.columns.indexOf('age')] === 0))
    console.log('tableData paging / sort / where / timestamp text OK')

    await d.applyChanges(S, users, [
      { type: 'update', key: { id: 1 }, values: { email: "o'brien@x", age: null } },
      { type: 'insert', values: { email: 'new@x' } },
      { type: 'delete', key: { id: 2 } }
    ])
    let r = await d.query(`SELECT email, age FROM ${S}.users WHERE id IN (1,2) OR email = 'new@x' ORDER BY id`, null)
    assert.deepEqual(r.rows, [["o'brien@x", null], ['new@x', 18]])
    await assert.rejects(
      d.applyChanges(S, users, [
        { type: 'update', key: { id: 3 }, values: { email: 'changed@x' } },
        { type: 'update', key: { id: 4 }, values: { email: null } }
      ]),
      /null value|not-null/i
    )
    assert.equal((await d.query(`SELECT email FROM ${S}.users WHERE id = 3`, null)).rows[0][0], 'u3@x')
    await assert.rejects(d.applyChanges(S, users, [{ type: 'update', key: { id: 99999 }, values: { email: 'x' } }]), /No row matched/)
    console.log('applyChanges: update / insert / delete / rollback / missing row OK')

    const sc = await d.schemaCompletion(S)
    assert.deepEqual(sc.users, ['id', 'email', 'age', 'created', 'nick'])

    // ── cancel ──
    const started = Date.now()
    // Capture the outcome immediately: the rejection lands while we are still awaiting cancel().
    const slow = d.query('SELECT pg_sleep(30)', null).then(() => null, (err) => err)
    await new Promise((res) => setTimeout(res, 400))
    await d.cancel()
    const cancelled = await slow
    assert.match(String(cancelled && cancelled.message), /cancel/i)
    assert.ok(Date.now() - started < 8000, 'cancel must interrupt the sleep')
    assert.deepEqual((await d.query('SELECT 1', null)).rows, [[1]], 'connection must stay usable after cancel')
    console.log('cancel interrupts a running query and keeps the connection OK')

    // ── designer ──
    let loaded = await d.designInfo(S, users)
    assert.equal(byName(loaded, 'id').autoIncrement, true)
    assert.equal(byName(loaded, 'id').primaryKey, true)
    assert.equal(byName(loaded, 'id').defaultValue, null)
    assert.equal(byName(loaded, 'email').nullable, false)
    assert.equal(byName(loaded, 'age').defaultValue, '18')
    assert.equal(byName(loaded, 'nick').type, 'character varying(20)')
    assert.ok(loaded.pkName)
    const ix = Object.fromEntries(loaded.indexes.map((i) => [i.name, i]))
    assert.deepEqual([ix.ix_age.columns, !!ix.ix_age.locked], [['age'], false])
    assert.equal(ix.ix_lower_nick.locked, true, 'expression index must be locked')
    assert.equal(ix.ix_partial.locked, true, 'partial index must be locked')
    assert.ok(Object.values(ix).some((i) => i.columns[0] === 'email' && i.locked), 'unique-constraint index must be locked')
    assert.deepEqual(planDdl(ctx, loaded, clone(loaded)).statements, [], 'untouched design must produce no DDL')
    console.log('designInfo (identity, pk, defaults, locked indexes) + no-op round trip OK')

    const run = async (orig, edited) => {
      const plan = planDdl(ctx, orig, edited)
      assert.deepEqual(plan.errors, [], plan.errors.join('|'))
      await d.executeDdl(S, plan.statements)
      return plan
    }

    let e = clone(loaded)
    e.columns.push(col('score', 'numeric(10,2)', { nullable: false, defaultValue: '0' }))
    byName(e, 'email').name = 'mail'
    byName(e, 'nick').type = 'varchar(50)'
    byName(e, 'age').defaultValue = null
    byName(e, 'age').nullable = false
    e.indexes.find((i) => i.name === 'ix_age').columns = ['age', 'mail']
    e.indexes.push({ id: 'n1', originalName: null, name: 'ix_mail', columns: ['mail'], unique: true })
    // age has NULLs after the earlier update, so clear them first to let SET NOT NULL succeed
    await d.query(`UPDATE ${S}.users SET age = 0 WHERE age IS NULL`, null)
    const plan = await run(loaded, e)
    console.log('  alter statements:\n    ' + plan.statements.join('\n    '))
    loaded = await d.designInfo(S, users)
    assert.equal(byName(loaded, 'score').defaultValue, '0')
    assert.equal(byName(loaded, 'nick').type, 'character varying(50)')
    assert.equal(byName(loaded, 'age').nullable, false)
    assert.equal(byName(loaded, 'age').defaultValue, null)
    assert.deepEqual(loaded.indexes.find((i) => i.name === 'ix_age').columns, ['age', 'mail'])
    assert.equal(loaded.indexes.find((i) => i.name === 'ix_mail').unique, true)
    // 25 rows seeded, one deleted, one inserted
    assert.equal((await d.query(`SELECT count(*) FROM ${S}.users`, null)).rows[0][0], '25')
    console.log('alter: add/rename/type/null/default/index on populated table OK')

    // type change with USING cast; and a failing change must roll everything back
    e = clone(loaded)
    byName(e, 'mail').name = 'mail2'
    e.indexes.forEach((i) => (i.columns = i.columns.map((c) => (c === 'mail' ? 'mail2' : c))))
    byName(e, 'age').type = 'bigint'
    await run(loaded, e)
    loaded = await d.designInfo(S, users)
    assert.equal(byName(loaded, 'age').type, 'bigint')
    assert.equal(byName(loaded, 'mail2').type, 'text')

    // (a) a view depends on mail2: the engine's refusal must surface, and nothing may be applied
    let before = await d.designInfo(S, users)
    e = clone(before)
    e.columns.push(col('extra_ok', 'integer'))
    byName(e, 'mail2').type = 'integer'
    let failing = planDdl(ctx, before, e)
    assert.deepEqual(failing.errors, [])
    await assert.rejects(d.executeDdl(S, failing.statements), /used by a view/i)
    assert.equal((await d.designInfo(S, users)).columns.some((c) => c.name === 'extra_ok'), false, 'whole DDL must roll back')

    // (b) a cast that fails on real data (text -> integer), also rolled back as a whole
    await d.query(`ALTER TABLE ${S}.users ADD COLUMN note text DEFAULT 'abc'`, null)
    before = await d.designInfo(S, users)
    e = clone(before)
    e.columns.push(col('extra_ok', 'integer'))
    byName(e, 'note').type = 'integer'
    failing = planDdl(ctx, before, e)
    assert.deepEqual(failing.errors, [])
    await assert.rejects(d.executeDdl(S, failing.statements), /invalid input syntax/i)
    assert.equal((await d.designInfo(S, users)).columns.some((c) => c.name === 'extra_ok'), false, 'whole DDL must roll back')
    console.log('type change with USING; view dependency and failed cast both rolled back as a whole OK')

    // primary key swap + drop column (indexes on it go first)
    e = clone(loaded)
    byName(e, 'id').primaryKey = false
    byName(e, 'mail2').primaryKey = true
    byName(e, 'mail2').nullable = false
    e.columns = e.columns.filter((c) => c.name !== 'nick')
    await run(loaded, e)
    loaded = await d.designInfo(S, users)
    assert.deepEqual(loaded.columns.filter((c) => c.primaryKey).map((c) => c.name), ['mail2'])
    assert.equal(byName(loaded, 'nick'), undefined)
    console.log('primary key change + drop column OK')

    // new table from a design
    const fresh = {
      name: 'orders',
      columns: [
        col('id', 'bigint', { primaryKey: true, nullable: false, autoIncrement: true }),
        col('user_id', 'integer', { nullable: false }),
        col('total', 'numeric(12,2)', { defaultValue: '0' }),
        col('placed', 'timestamptz', { defaultValue: 'now()' })
      ],
      indexes: [{ id: 'o1', originalName: null, name: 'ix_orders_user', columns: ['user_id'], unique: false }]
    }
    await run(null, fresh)
    await d.query(`INSERT INTO ${S}.orders (user_id) VALUES (1), (2)`, null)
    assert.deepEqual((await d.query(`SELECT id, user_id, total FROM ${S}.orders ORDER BY id`, null)).rows, [['1', 1, '0.00'], ['2', 2, '0.00']])
    const o = await d.designInfo(S, { name: 'orders', type: 'table' })
    assert.deepEqual(planDdl(ctx, o, clone(o)).statements, [])
    console.log('create table from design + identity works OK')

    // ── foreign keys ──
    const fkn = (name, columns, refTable, o = {}) => ({ id: 'f' + ++n, originalName: null, name, columns, refTable, refColumns: ['id'], onDelete: 'NO ACTION', onUpdate: 'NO ACTION', ...o })
    await run(null, { name: 'parents', indexes: [], columns: [col('id', 'integer', { primaryKey: true, nullable: false }), col('label', 'text')] })
    await run(null, {
      name: 'kids',
      indexes: [],
      columns: [col('id', 'integer', { primaryKey: true, nullable: false }), col('parent_id', 'integer'), col('buddy_id', 'integer')],
      foreignKeys: [fkn('fk_kids_parent', ['parent_id'], 'parents', { onDelete: 'CASCADE' })]
    })
    const kidsObj = { name: 'kids', type: 'table' }
    let kd = await d.designInfo(S, kidsObj)
    assert.equal(kd.foreignKeys.length, 1)
    assert.deepEqual(
      [kd.foreignKeys[0].name, kd.foreignKeys[0].columns, kd.foreignKeys[0].refSchema, kd.foreignKeys[0].refTable, kd.foreignKeys[0].refColumns, kd.foreignKeys[0].onDelete, kd.foreignKeys[0].onUpdate, !!kd.foreignKeys[0].locked],
      ['fk_kids_parent', ['parent_id'], S, 'parents', ['id'], 'CASCADE', 'NO ACTION', false]
    )
    assert.deepEqual(planDdl(ctx, kd, clone(kd)).statements, [], 'FK round trip must be a no-op')

    // the database really enforces what the designer created (cascade deletes the child)
    await d.query(`INSERT INTO ${S}.parents VALUES (1, 'a'), (2, 'b')`, null)
    await d.query(`INSERT INTO ${S}.kids (id, parent_id) VALUES (10, 1)`, null)
    await assert.rejects(d.query(`INSERT INTO ${S}.kids (id, parent_id) VALUES (11, 999)`, null), /foreign key/i)
    await d.query(`DELETE FROM ${S}.parents WHERE id = 1`, null)
    assert.equal((await d.query(`SELECT count(*) FROM ${S}.kids`, null)).rows[0][0], '0')

    // change actions + add a self-referencing FK; rename a referencing column (its FK must follow, silently)
    e = clone(kd)
    e.foreignKeys[0].onDelete = 'SET NULL'
    e.foreignKeys[0].onUpdate = 'CASCADE'
    e.foreignKeys.push(fkn('fk_kids_buddy', ['buddy_id'], 'kids', { onDelete: 'SET NULL' }))
    byName(e, 'parent_id').name = 'owner_id'
    e.foreignKeys[0].columns = ['owner_id']
    const fkPlan = await run(kd, e)
    console.log('  FK statements:\n    ' + fkPlan.statements.join('\n    '))
    kd = await d.designInfo(S, kidsObj)
    const byFk = Object.fromEntries(kd.foreignKeys.map((f) => [f.name, f]))
    assert.deepEqual([byFk.fk_kids_parent.columns, byFk.fk_kids_parent.onDelete, byFk.fk_kids_parent.onUpdate], [['owner_id'], 'SET NULL', 'CASCADE'])
    assert.deepEqual([byFk.fk_kids_buddy.refTable, byFk.fk_kids_buddy.onDelete], ['kids', 'SET NULL'])

    // pure column rename must not touch the FK at all
    e = clone(kd)
    byName(e, 'owner_id').name = 'parent_ref'
    e.foreignKeys.find((f) => f.name === 'fk_kids_parent').columns = ['parent_ref']
    const renamePlan = planDdl(ctx, kd, e)
    assert.deepEqual(renamePlan.statements, [`ALTER TABLE "${S}"."kids" RENAME COLUMN "owner_id" TO "parent_ref"`])
    await run(kd, e)
    kd = await d.designInfo(S, kidsObj)

    // drop one FK
    e = clone(kd)
    e.foreignKeys = e.foreignKeys.filter((f) => f.name !== 'fk_kids_buddy')
    await run(kd, e)
    kd = await d.designInfo(S, kidsObj)
    assert.deepEqual(kd.foreignKeys.map((f) => f.name), ['fk_kids_parent'])
    await d.query(`INSERT INTO ${S}.kids (id, buddy_id) VALUES (20, 12345)`, null) // no FK on buddy_id any more
    console.log('foreign keys: create, enforce, change actions, self-reference, rename column, drop OK')

    // ── bulk insert (import) ──
    const bulkObj = { name: 'orders', type: 'table' }
    const orderRows = Array.from({ length: 3500 }, (_, i) => [1, `${i}.50`])
    assert.equal(await d.insertRows(S, bulkObj, ['user_id', 'total'], orderRows), 3500)
    assert.equal((await d.query(`SELECT count(*) FROM ${S}.orders`, null)).rows[0][0], '3502')
    const badRows = Array.from({ length: 2100 }, (_, i) => [1, `${i}`])
    badRows[2050][1] = 'not-a-number'
    await assert.rejects(d.insertRows(S, bulkObj, ['user_id', 'total'], badRows), /rows 1001–2000 of the data|rows 2001–2100 of the data/)
    assert.equal((await d.query(`SELECT count(*) FROM ${S}.orders`, null)).rows[0][0], '3502', 'failed import must leave no rows')
    console.log('insertRows: 3500 rows in chunks, strings cast by the server, atomic rollback OK')

    // ── read-only audit of a real database ──
    if (EXTERNAL) {
      const { totals, problems } = await auditExisting(d)
      console.log(`AUDIT (read-only) of existing objects: ${JSON.stringify(totals)}`)
      if (problems.length) console.log('  problems:\n    ' + problems.slice(0, 15).join('\n    '))
      assert.deepEqual(problems, [], 'every existing table must load and round-trip with no DDL')
    }

    console.log(`ALL POSTGRES TESTS PASSED (${EXTERNAL ? 'existing database, scratch schema' : 'throwaway cluster'})`)
  } finally {
    await d.close().catch(() => undefined)
    await dropScratch().catch((e) => console.error('cleanup of scratch schema failed:', e.message))
    await admin.end().catch(() => undefined)
    if (EXTERNAL) {
      const check = new pg.Client(target)
      await check.connect()
      const left = (await check.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1', [S])).rows[0].n
      const db = (await check.query('SELECT current_database() AS db')).rows[0].db
      await check.end()
      console.log(`cleanup: scratch schema left behind = ${left}; database "${db}" still exists`)
    }
    stopCluster()
  }
})().catch((e) => {
  console.error('FAIL', e)
  stopCluster()
  process.exit(1)
})
