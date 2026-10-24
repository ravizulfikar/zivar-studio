// Manual check against an EXISTING PostgreSQL database (not part of `npm test`):
//   ZIVAR_TEST_PG_URL=postgres://user:pass@host:port/db node tests/live-pg-transfer.cjs
//
// Copies the database's tables into a scratch schema (zivar_test_<random>) on the same server with the
// data-transfer code, then proves the copy matches — row counts and a per-table fingerprint computed on the
// server, so no row content is ever printed or written to disk. Safety rules:
//   - the real tables are only READ;
//   - every write goes into the scratch schema this script creates;
//   - the only DROP is `DROP SCHEMA <that scratch schema> CASCADE`, guarded by its prefix;
//   - tables above MAX_ROWS (estimated) are skipped.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const pg = require('pg')
const { PostgresDriver } = require('./.build/postgres.cjs')
const { transferTables } = require('./.build/transfer.cjs')

const URL_ = process.env.ZIVAR_TEST_PG_URL
if (!URL_) {
  console.log('SKIPPED: set ZIVAR_TEST_PG_URL')
  process.exit(0)
}
const MAX_ROWS = 50000
const PREFIX = 'zivar_test_'
const SCRATCH = `${PREFIX}${crypto.randomBytes(4).toString('hex')}`
const u = new URL(URL_)
const target = { host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) }
const q = (id) => `"${id.replace(/"/g, '""')}"`

;(async () => {
  const admin = new pg.Client(target)
  await admin.connect()
  const src = new PostgresDriver({ id: 's', name: 's', kind: 'postgres', ...target })
  const dst = new PostgresDriver({ id: 'd', name: 'd', kind: 'postgres', ...target })
  console.log(`database "${target.database}" @ ${target.host}:${target.port}; scratch schema "${SCRATCH}"`)
  try {
    await src.connect()
    await dst.connect()
    const all = (await src.objects('public')).filter((o) => o.type === 'table')
    const est = new Map((await admin.query(`SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname = 'public'`)).rows.map((r) => [r.relname, Number(r.n_live_tup)]))
    const tables = all.filter((t) => (est.get(t.name) ?? 0) <= MAX_ROWS)
    const skipped = all.filter((t) => !tables.includes(t)).map((t) => `${t.name} (~${est.get(t.name)} rows)`)
    console.log(`${all.length} tables; copying ${tables.length}, skipping ${skipped.length} above ${MAX_ROWS} rows: ${skipped.join(', ') || '-'}`)

    await admin.query(`CREATE SCHEMA ${q(SCRATCH)}`)
    const started = Date.now()
    const results = await transferTables(
      { driver: src, kind: 'postgres', container: 'public' },
      { driver: dst, kind: 'postgres', container: SCRATCH },
      tables,
      { createTables: true, ifExists: 'append', copyData: true },
      { isCancelled: () => false, onProgress() {} }
    )
    const secs = ((Date.now() - started) / 1000).toFixed(1)
    const failed = results.filter((r) => r.status !== 'ok')
    console.log(`transferred in ${secs}s: ${results.filter((r) => r.status === 'ok').length} ok, ${failed.length} not ok; ${results.reduce((n, r) => n + r.rows, 0).toLocaleString()} rows copied`)
    for (const r of failed) console.log(`  NOT OK ${r.table}: ${r.error}`)

    // Fingerprint of a whole table, computed on the server: md5 over every row's text form, in a fixed order.
    const fingerprint = async (schema, table) =>
      (await admin.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM ${q(schema)}.${q(table)} t`)).rows[0]

    let identical = 0
    const differences = []
    const approximated = []
    for (const r of results.filter((x) => x.status === 'ok')) {
      const a = await fingerprint('public', r.table)
      const b = await fingerprint(SCRATCH, r.table)
      assert.equal(b.n, a.n, `${r.table}: row count`)
      if (a.h === b.h) identical++
      else if (r.notes.some((n) => /no equivalent|not carried|was copied without|text/i.test(n))) approximated.push(r.table)
      else differences.push(r.table)
    }
    console.log(`row counts match for all ${results.filter((x) => x.status === 'ok').length} copied tables`)
    console.log(`byte-for-byte identical content: ${identical} tables; changed on purpose by a reported type translation: ${approximated.length}${approximated.length ? ` (${approximated.join(', ')})` : ''}; UNEXPLAINED differences: ${differences.length}${differences.length ? ` (${differences.join(', ')})` : ''}`)
    const withNotes = results.filter((r) => r.notes.length)
    for (const r of withNotes.slice(0, 12)) console.log(`  notes ${r.table}: ${r.notes.join(' | ').slice(0, 220)}`)
    assert.deepEqual(failed.map((r) => r.table), [], 'every table must transfer')
    assert.deepEqual(differences, [], 'any content difference must be explained by a reported type translation')
    console.log('LIVE TRANSFER CHECK PASSED')
  } finally {
    await src.close().catch(() => undefined)
    await dst.close().catch(() => undefined)
    if (SCRATCH.startsWith(PREFIX)) await admin.query(`DROP SCHEMA IF EXISTS ${q(SCRATCH)} CASCADE`).catch((e) => console.error('cleanup failed:', e.message))
    const left = (await admin.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1', [SCRATCH])).rows[0].n
    const db = (await admin.query('SELECT current_database() AS d')).rows[0].d
    console.log(`cleanup: scratch schema left behind = ${left}; database "${db}" still exists`)
    await admin.end()
  }
})().catch((e) => {
  console.error('FAIL', e)
  process.exit(1)
})
