// Integration test against a REAL MySQL, in one of two modes:
//
//  1. default: a throwaway instance (mysqld --initialize-insecure) in a temp folder on a free port,
//     deleted afterwards. Skipped when mysqld is not found (set MYSQL_BIN to the folder with mysqld).
//  2. ZIVAR_TEST_MYSQL_URL=mysql://user:pass@host:port : an existing server. SAFETY RULES:
//       - every write/DDL happens inside a scratch database named zivar_test_<random>, created here;
//       - the only DROP issued is `DROP DATABASE <that scratch database>` (guarded by its prefix);
//       - everything else on the server is left alone.
const assert = require('node:assert/strict')
const { execFileSync, spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const EXTERNAL = process.env.ZIVAR_TEST_MYSQL_URL
const SCRATCH_PREFIX = 'zivar_test_'
const S = EXTERNAL ? `${SCRATCH_PREFIX}${crypto.randomBytes(4).toString('hex')}` : 'app'

let inst = null // throwaway instance: { child, root }
let target = null

function locateBin() {
  const exeName = process.platform === 'win32' ? 'mysqld.exe' : 'mysqld'
  const candidates = [process.env.MYSQL_BIN, 'C:/laragon/bin/mysql/mysql-8.0.30-winx64/bin', '/usr/sbin', '/usr/local/mysql/bin'].filter(Boolean)
  return candidates.find((d) => fs.existsSync(path.join(d, exeName)))
}

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function startInstance(bin) {
  const mysql = require('mysql2/promise')
  const exe = path.join(bin, process.platform === 'win32' ? 'mysqld.exe' : 'mysqld')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zivar-my-'))
  const data = path.join(root, 'data')
  const log = path.join(root, 'mysqld.log')
  // --no-defaults: never read the user's my.ini, so this instance cannot interfere with theirs.
  execFileSync(exe, ['--no-defaults', '--initialize-insecure', `--datadir=${data}`, '--console'], { stdio: 'pipe' })
  const port = await freePort()
  const out = fs.openSync(log, 'a')
  const child = spawn(
    exe,
    ['--no-defaults', `--datadir=${data}`, `--port=${port}`, '--bind-address=127.0.0.1', '--mysqlx=OFF', '--skip-log-bin', '--innodb-buffer-pool-size=64M', '--console'],
    { stdio: ['ignore', out, out], windowsHide: true }
  )
  inst = { child, root }
  let exited = false
  child.once('exit', () => (exited = true))

  for (let i = 0; i < 120; i++) {
    if (exited) throw new Error(`mysqld exited early:\n${fs.readFileSync(log, 'utf8').slice(-1500)}`)
    try {
      const c = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root' })
      await c.end()
      return { host: '127.0.0.1', port, user: 'root' }
    } catch {
      await sleep(500)
    }
  }
  throw new Error(`mysqld did not accept connections:\n${fs.readFileSync(log, 'utf8').slice(-1500)}`)
}

function stopInstance() {
  if (!inst) return
  const { child, root } = inst
  inst = null
  // child.kill() does not reliably end mysqld on Windows, so kill the process tree explicitly.
  try {
    if (process.platform === 'win32') require('node:child_process').spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGKILL')
  } catch {
    /* already gone */
  }
  // Give the process a moment to release its files, then remove the data directory.
  const until = Date.now() + 10000
  while (Date.now() < until) {
    try {
      fs.rmSync(root, { recursive: true, force: true })
      if (!fs.existsSync(root)) return
    } catch {
      /* still locked */
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300)
  }
}
process.on('exit', () => stopInstance())

const { MySqlDriver } = require('./.build/mysql.cjs')
const { planDdl } = require('./.build/ddl.cjs')
const mysql = require('mysql2/promise')

const clone = (d) => JSON.parse(JSON.stringify(d))
let n = 0
const col = (name, type, o = {}) => ({ id: 'c' + ++n, originalName: null, name, type, nullable: true, primaryKey: false, defaultValue: null, autoIncrement: false, ...o })
const byName = (design, name) => design.columns.find((c) => c.name === name)

async function auditExisting(d) {
  const dbs = (await d.containers()).filter((s) => !s.startsWith(SCRATCH_PREFIX) && !['mysql', 'sys', 'information_schema', 'performance_schema'].includes(s))
  const totals = { databases: dbs.length, tables: 0, views: 0, functions: 0, roundTripped: 0, indexes: 0, lockedIndexes: 0, pages: 0 }
  const problems = []
  for (const db of dbs) {
    const objs = await d.objects(db)
    for (const o of objs) o.type === 'view' ? totals.views++ : o.type === 'function' ? totals.functions++ : totals.tables++
    for (const t of objs.filter((o) => o.type === 'table').slice(0, 150)) {
      try {
        const design = await d.designInfo(db, t)
        const plan = planDdl({ kind: 'mysql', container: db }, design, clone(design))
        if (plan.statements.length || plan.errors.length) problems.push(`${db}.${t.name}: ${JSON.stringify(plan.statements.concat(plan.errors)).slice(0, 220)}`)
        else totals.roundTripped++
        totals.indexes += design.indexes.length
        totals.lockedIndexes += design.indexes.filter((i) => i.locked).length
        await d.tableData(db, t, { limit: 5, offset: 0 })
        totals.pages++
      } catch (e) {
        problems.push(`${db}.${t.name}: ${e.message}`)
      }
    }
  }
  return { totals, problems }
}

;(async () => {
  if (EXTERNAL) {
    const u = new URL(EXTERNAL)
    target = { host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) }
  } else {
    const bin = locateBin()
    if (!bin) {
      console.log('SKIPPED: mysqld not found (set MYSQL_BIN) and ZIVAR_TEST_MYSQL_URL not set')
      process.exit(0)
    }
    target = await startInstance(bin)
  }

  const admin = await mysql.createConnection({ ...target, multipleStatements: true })
  const version = (await admin.query('SELECT VERSION() v'))[0][0].v
  console.log(`${EXTERNAL ? 'EXISTING server' : 'throwaway instance'}: ${target.host}:${target.port}, MySQL ${version}`)
  if (EXTERNAL) console.log(`all writes confined to scratch database "${S}"`)

  const dropScratch = async () => {
    // The only destructive statement this suite issues, and only for a database it created.
    if (EXTERNAL && S.startsWith(SCRATCH_PREFIX)) await admin.query(`DROP DATABASE IF EXISTS \`${S}\``)
  }

  const d = new MySqlDriver({ id: 'x', name: 'x', kind: 'mysql', ...target })
  const ctx = { kind: 'mysql', container: S }

  try {
    await admin.query(`
      CREATE DATABASE \`${S}\`;
      USE \`${S}\`;
      CREATE TABLE users (
        id INT NOT NULL AUTO_INCREMENT,
        email VARCHAR(100) NOT NULL,
        age INT DEFAULT 18,
        status VARCHAR(10) NOT NULL DEFAULT 'new',
        created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP COMMENT 'touch time',
        code VARCHAR(20) CHARACTER SET latin1 COLLATE latin1_bin NULL,
        token VARCHAR(36) DEFAULT (UUID()),
        bio TEXT,
        total INT GENERATED ALWAYS AS (age * 2) VIRTUAL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_email (email),
        KEY ix_age (age),
        KEY ix_prefix (email(10)),
        FULLTEXT KEY ft_bio (bio)
      ) ENGINE=InnoDB;
      INSERT INTO users (email, age) SELECT CONCAT('u', seq, '@x'), seq % 7 FROM (
        SELECT a.n + b.n * 10 + 1 AS seq FROM (SELECT 0 n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a,
                                              (SELECT 0 n UNION SELECT 1 UNION SELECT 2) b) t WHERE seq <= 25 ORDER BY seq;
      CREATE VIEW v_users AS SELECT id, email FROM users;
      CREATE FUNCTION f_add(a INT, b INT) RETURNS INT DETERMINISTIC RETURN a + b;
      CREATE PROCEDURE p_noop() SELECT 1;
      CREATE TABLE parents (id INT NOT NULL, label VARCHAR(20), PRIMARY KEY (id)) ENGINE=InnoDB;
    `)
    console.log('fixtures created')
    await d.connect()

    // ── browsing ──
    assert.ok((await d.containers()).includes(S))
    const objs = await d.objects(S)
    const brief = objs.map((o) => `${o.type}:${o.name}${o.routine ? `/${o.routine}` : ''}`).sort()
    assert.deepEqual(brief, ['function:f_add/function', 'function:p_noop/procedure', 'table:parents', 'table:users', 'view:v_users'])
    console.log('containers / objects (tables, view, function, procedure) OK')

    const users = objs.find((o) => o.name === 'users')
    assert.equal((await d.describe(S, users)).find((c) => c.name === 'id').primaryKey, true)
    assert.match(await d.definition(S, objs.find((o) => o.type === 'view')), /CREATE .*VIEW .*v_users/is)
    assert.match(await d.definition(S, objs.find((o) => o.name === 'f_add')), /CREATE .*FUNCTION .*f_add.*RETURN/is)
    assert.match(await d.definition(S, objs.find((o) => o.name === 'p_noop')), /CREATE .*PROCEDURE .*p_noop/is)
    console.log('describe / definition (view, function, procedure) OK')

    // ── data editor ──
    let p = await d.tableData(S, users, { limit: 10, offset: 0, orderBy: { column: 'id', dir: 'asc' } })
    assert.equal(p.rows.length, 10)
    assert.equal(p.hasNext, true)
    assert.match(String(p.rows[0][p.columns.indexOf('created')]), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'timestamps arrive as text')
    p = await d.tableData(S, users, { limit: 100, offset: 20, orderBy: { column: 'id', dir: 'desc' } })
    assert.equal(p.rows.length, 5)
    assert.equal(p.hasNext, false)
    p = await d.tableData(S, users, { limit: 100, offset: 0, where: 'age = 0' })
    assert.ok(p.rows.length > 0)
    console.log('tableData paging / sort / where OK')

    await d.applyChanges(S, users, [
      { type: 'update', key: { id: 1 }, values: { email: "o'brien@x", age: null } },
      { type: 'insert', values: { email: 'new@x' } },
      { type: 'delete', key: { id: 2 } }
    ])
    let r = await d.query(`SELECT email, age FROM \`${S}\`.users WHERE id = 1 OR email = 'new@x' ORDER BY id`, null)
    assert.deepEqual(r.rows, [["o'brien@x", null], ['new@x', 18]])
    await assert.rejects(
      d.applyChanges(S, users, [
        { type: 'update', key: { id: 3 }, values: { email: 'changed@x' } },
        { type: 'update', key: { id: 4 }, values: { email: null } }
      ]),
      /cannot be null/i
    )
    assert.equal((await d.query(`SELECT email FROM \`${S}\`.users WHERE id = 3`, null)).rows[0][0], 'u3@x')
    await assert.rejects(d.applyChanges(S, users, [{ type: 'update', key: { id: 99999 }, values: { email: 'x' } }]), /No row matched/)
    console.log('applyChanges: update / insert / delete / rollback / missing row OK')

    assert.deepEqual((await d.schemaCompletion(S)).parents, ['id', 'label'])

    // ── cancel (KILL QUERY makes SLEEP return early rather than fail) ──
    const t0 = Date.now()
    const slow = d.query('SELECT SLEEP(30)', null).then(() => 'finished', (e) => `error:${e.message}`)
    await sleep(500)
    await d.cancel()
    await slow
    assert.ok(Date.now() - t0 < 8000, 'cancel must cut the sleep short')
    assert.deepEqual((await d.query('SELECT 1', null)).rows, [[1]], 'connection must stay usable after cancel')
    console.log('cancel (KILL QUERY) interrupts a running query and keeps the connection OK')

    // ── designer: loading ──
    let loaded = await d.designInfo(S, users)
    const c = (name) => byName(loaded, name)
    assert.deepEqual([c('id').autoIncrement, c('id').primaryKey, c('id').type, c('id').nullable], [true, true, 'int', false])
    assert.equal(c('status').defaultValue, "'new'")
    assert.equal(c('age').defaultValue, '18')
    assert.equal(c('created').defaultValue, 'CURRENT_TIMESTAMP')
    assert.match(c('updated').extra, /ON UPDATE CURRENT_TIMESTAMP/i)
    assert.match(c('updated').extra, /COMMENT 'touch time'/)
    assert.equal(c('code').collation, 'latin1_bin', 'column collation that differs from the table is kept')
    assert.match(c('token').defaultValue, /^\(.*uuid\(\).*\)$/i, 'expression defaults are wrapped in parentheses')
    assert.equal(c('total').locked, true, 'generated column is locked')
    const ix = Object.fromEntries(loaded.indexes.map((i) => [i.name, i]))
    assert.deepEqual([ix.uq_email.unique, !!ix.uq_email.locked], [true, false])
    assert.deepEqual([ix.ix_age.columns, !!ix.ix_age.locked], [['age'], false])
    assert.equal(ix.ix_prefix.locked, true, 'prefix index is locked')
    assert.equal(ix.ft_bio.locked, true, 'FULLTEXT index is locked')
    assert.deepEqual(planDdl(ctx, loaded, clone(loaded)).statements, [], 'untouched design must produce no DDL')
    console.log('designInfo (auto_increment, defaults, ON UPDATE, comment, collation, generated, locked indexes) + no-op OK')

    // ── designer: altering ──
    const run = async (orig, edited) => {
      const plan = planDdl(ctx, orig, edited)
      assert.deepEqual(plan.errors, [], plan.errors.join('|'))
      await d.executeDdl(S, plan.statements)
      return plan
    }
    let e = clone(loaded)
    byName(e, 'age').type = 'bigint'
    byName(e, 'status').name = 'state'
    byName(e, 'updated').name = 'touched' // rename restates the column: ON UPDATE + COMMENT must survive
    byName(e, 'code').name = 'code2' //         ...and so must its collation
    e.columns.push(col('score', 'decimal(10,2)', { nullable: false, defaultValue: '0' }))
    e.indexes.find((i) => i.name === 'ix_age').columns = ['age', 'email']
    e.indexes.push({ id: 'n1', originalName: null, name: 'ix_state', columns: ['state'], unique: false })
    const plan = await run(loaded, e)
    console.log('  alter statements:\n    ' + plan.statements.join('\n    '))
    loaded = await d.designInfo(S, users)
    assert.equal(byName(loaded, 'age').type, 'bigint')
    assert.equal(byName(loaded, 'state').defaultValue, "'new'")
    assert.match(byName(loaded, 'touched').extra, /ON UPDATE CURRENT_TIMESTAMP/i)
    assert.match(byName(loaded, 'touched').extra, /COMMENT 'touch time'/)
    assert.equal(byName(loaded, 'code2').collation, 'latin1_bin')
    // MySQL normalises a DECIMAL default to the column's scale: typed 0, read back 0.00
    assert.match(byName(loaded, 'score').defaultValue, /^0(\.00)?$/)
    assert.deepEqual(loaded.indexes.find((i) => i.name === 'ix_age').columns, ['age', 'email'])
    assert.ok(loaded.indexes.some((i) => i.name === 'ix_state'))
    assert.equal(loaded.indexes.find((i) => i.name === 'ft_bio').locked, true, 'untouched locked index survives')
    assert.equal((await d.query(`SELECT count(*) FROM \`${S}\`.users`, null)).rows[0][0], 25)
    assert.deepEqual(planDdl(ctx, loaded, clone(loaded)).statements, [])
    console.log('alter: type / rename (CHANGE keeps extras) / add column / index changes on populated table OK')

    // drop a column + its index
    e = clone(loaded)
    e.columns = e.columns.filter((x) => x.name !== 'score')
    e.indexes = e.indexes.filter((i) => i.name !== 'ix_state')
    await run(loaded, e)
    loaded = await d.designInfo(S, users)
    assert.equal(byName(loaded, 'score'), undefined)
    console.log('drop column / index OK')

    // MySQL cannot roll DDL back: the error must say how far it got
    e = clone(loaded)
    e.columns.push(col('half_done', 'int'))
    e.columns.push(col('email', 'int')) // duplicate name -> blocked by our own validation first
    assert.ok(planDdl(ctx, loaded, e).errors.some((x) => /Duplicate column/.test(x)))
    await assert.rejects(d.executeDdl(S, [`ALTER TABLE \`${S}\`.users ADD COLUMN half_done int`, `ALTER TABLE \`${S}\`.users ADD COLUMN email int`]), /Statement 2 of 2 failed.*already applied/is)
    assert.ok(byName(await d.designInfo(S, users), 'half_done'), 'the first statement stays applied, as the message says')
    console.log('non-transactional DDL failure reports the statement and what stayed applied OK')

    // primary key change on a table without auto_increment
    await d.query(`CREATE TABLE \`${S}\`.pk2 (a INT NOT NULL, b INT NOT NULL, PRIMARY KEY (a)) ENGINE=InnoDB`, null)
    const pk2 = { name: 'pk2', type: 'table' }
    let pd = await d.designInfo(S, pk2)
    e = clone(pd)
    byName(e, 'b').primaryKey = true
    const pkPlan = await run(pd, e)
    assert.deepEqual(pkPlan.statements.filter((x) => /PRIMARY/.test(x)), [`ALTER TABLE \`${S}\`.\`pk2\` DROP PRIMARY KEY`, `ALTER TABLE \`${S}\`.\`pk2\` ADD PRIMARY KEY (\`a\`, \`b\`)`])
    pd = await d.designInfo(S, pk2)
    assert.deepEqual(pd.columns.filter((x) => x.primaryKey).map((x) => x.name), ['a', 'b'])
    console.log('primary key change OK')

    // new table from a design (auto_increment, defaults, index)
    await run(null, {
      name: 'orders',
      columns: [
        col('id', 'bigint', { primaryKey: true, nullable: false, autoIncrement: true }),
        col('user_id', 'int', { nullable: false }),
        col('total', 'decimal(12,2)', { defaultValue: '0' }),
        col('placed', 'datetime', { defaultValue: 'CURRENT_TIMESTAMP' })
      ],
      indexes: [{ id: 'o1', originalName: null, name: 'ix_orders_user', columns: ['user_id'], unique: false }]
    })
    await d.query(`INSERT INTO \`${S}\`.orders (user_id) VALUES (1), (2)`, null)
    assert.deepEqual((await d.query(`SELECT id, user_id, total FROM \`${S}\`.orders ORDER BY id`, null)).rows, [[1, 1, '0.00'], [2, 2, '0.00']])
    const od = await d.designInfo(S, { name: 'orders', type: 'table' })
    assert.deepEqual(planDdl(ctx, od, clone(od)).statements, [])
    console.log('create table from design OK')

    // ── foreign keys ──
    const fkn = (name, columns, refTable, o = {}) => ({ id: 'f' + ++n, originalName: null, name, columns, refTable, refColumns: ['id'], onDelete: 'NO ACTION', onUpdate: 'NO ACTION', ...o })
    await run(null, {
      name: 'kids',
      indexes: [],
      columns: [col('id', 'int', { primaryKey: true, nullable: false }), col('parent_id', 'int')],
      foreignKeys: [fkn('fk_kids_parent', ['parent_id'], 'parents', { onDelete: 'CASCADE' })]
    })
    const kidsObj = { name: 'kids', type: 'table' }
    let kd = await d.designInfo(S, kidsObj)
    assert.deepEqual(
      [kd.foreignKeys[0].name, kd.foreignKeys[0].columns, kd.foreignKeys[0].refSchema, kd.foreignKeys[0].refTable, kd.foreignKeys[0].refColumns, kd.foreignKeys[0].onDelete, kd.foreignKeys[0].onUpdate],
      ['fk_kids_parent', ['parent_id'], S, 'parents', ['id'], 'CASCADE', 'NO ACTION']
    )
    assert.deepEqual(planDdl(ctx, kd, clone(kd)).statements, [], 'FK round trip must be a no-op')
    await d.query(`INSERT INTO \`${S}\`.parents VALUES (1, 'a')`, null)
    await d.query(`INSERT INTO \`${S}\`.kids VALUES (10, 1)`, null)
    await assert.rejects(d.query(`INSERT INTO \`${S}\`.kids VALUES (11, 999)`, null), /foreign key/i)
    await d.query(`DELETE FROM \`${S}\`.parents WHERE id = 1`, null)
    assert.equal((await d.query(`SELECT count(*) FROM \`${S}\`.kids`, null)).rows[0][0], 0, 'cascade deleted the child')

    e = clone(kd)
    e.foreignKeys[0].onDelete = 'SET NULL'
    e.foreignKeys[0].onUpdate = 'CASCADE'
    await run(kd, e)
    kd = await d.designInfo(S, kidsObj)
    assert.deepEqual([kd.foreignKeys[0].onDelete, kd.foreignKeys[0].onUpdate], ['SET NULL', 'CASCADE'])
    e = clone(kd)
    e.foreignKeys = []
    await run(kd, e)
    kd = await d.designInfo(S, kidsObj)
    assert.equal(kd.foreignKeys.length, 0)
    await d.query(`INSERT INTO \`${S}\`.kids VALUES (20, 4242)`, null) // no FK any more
    console.log('foreign keys: create, enforce, change actions, drop OK')

    // ── bulk insert ──
    await d.query(`CREATE TABLE \`${S}\`.bulk (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(10) NOT NULL) ENGINE=InnoDB`, null)
    const bulk = { name: 'bulk', type: 'table' }
    assert.equal(await d.insertRows(S, bulk, ['name'], Array.from({ length: 2500 }, (_, i) => [`n${i}`])), 2500)
    const bad = Array.from({ length: 2100 }, (_, i) => [`m${i}`])
    bad[2050][0] = null
    await assert.rejects(d.insertRows(S, bulk, ['name'], bad), /rows 2001–2100 of the data/)
    assert.equal((await d.query(`SELECT count(*) FROM \`${S}\`.bulk`, null)).rows[0][0], 2500, 'failed import must leave no rows')
    console.log('insertRows: chunks, atomic rollback, failing row range OK')

    if (EXTERNAL) {
      const { totals, problems } = await auditExisting(d)
      console.log(`AUDIT (read-only) of existing objects: ${JSON.stringify(totals)}`)
      if (problems.length) console.log('  problems:\n    ' + problems.slice(0, 15).join('\n    '))
      assert.deepEqual(problems, [], 'every existing table must load and round-trip with no DDL')
    }
    console.log(`ALL MYSQL TESTS PASSED (${EXTERNAL ? 'existing server, scratch database' : 'throwaway instance'})`)
  } finally {
    await d.close().catch(() => undefined)
    await dropScratch().catch((err) => console.error('cleanup of scratch database failed:', err.message))
    await admin.end().catch(() => undefined)
    stopInstance()
  }
})().catch((e) => {
  console.error('FAIL', e)
  stopInstance()
  process.exit(1)
})
