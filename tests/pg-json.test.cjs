// PostgreSQL json vs jsonb survive a transfer and a dump/restore: json keeps its exact text (spacing, key
// order), jsonb keeps its value, and bare strings / numbers / booleans / arrays are valid JSON values.
// Found by running the transfer against a real production-shaped database.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Env } = require('./helpers/engines.cjs')
const { transferTables } = require('./.build/transfer.cjs')
const { dumpSql } = require('./.build/dump.cjs')
const { runScript } = require('./.build/script.cjs')
const { splitSql } = require('./.build/sqlSplit.cjs')

const hooks = { isCancelled: () => false, onProgress() {} }
const VALUES = ['{"b": 1,  "a": [1, 2]}', '[ 1,2 , 3 ]', '"just a string"', '  42  ', 'true', 'null', '{"nested": {"z": 1, "y": [ {"k":"ünï 😀 \\"q\\""} ]}}']

;(async () => {
  const env = await new Env().init(['postgres'])
  if (!env.pg) {
    console.log('SKIPPED: PostgreSQL not available')
    await env.stop()
    return
  }
  try {
    const src = await env.container('postgres', 's')
    const q = (c) => `"${c.container}"`
    await src.driver.query(`CREATE TABLE ${q(src)}.docs (id serial PRIMARY KEY, j json, jb jsonb)`, null)
    for (const v of VALUES) await src.driver.query(`INSERT INTO ${q(src)}.docs (j, jb) VALUES ($1::json, $1::jsonb)`.replace(/\$1/g, `'${v.replace(/'/g, "''")}'`), null)
    await src.driver.query(`INSERT INTO ${q(src)}.docs (j, jb) VALUES (NULL, NULL)`, null)

    const texts = async (c, col) => (await c.driver.query(`SELECT ${col}::text FROM ${q(c)}.docs ORDER BY id`, null)).rows.map((r) => r[0])
    const expectedJson = await texts(src, 'j')
    const expectedJsonb = await texts(src, 'jb')
    assert.ok(expectedJson.includes('{"b": 1,  "a": [1, 2]}'), 'the fixture really keeps json spacing')

    const tbl = [{ name: 'docs', type: 'table', schema: src.container }]
    const ep = (c) => ({ driver: c.driver, kind: 'postgres', container: c.container })

    // ── transfer ──
    const dst = await env.container('postgres', 'd')
    const res = await transferTables(ep(src), ep(dst), tbl, { createTables: true, ifExists: 'append', copyData: true }, hooks)
    assert.deepEqual([res[0].status, res[0].rows, res[0].error], ['ok', VALUES.length + 1, undefined])
    assert.deepEqual(await texts(dst, 'j'), expectedJson, 'json text is preserved exactly by a transfer')
    assert.deepEqual(await texts(dst, 'jb'), expectedJsonb, 'jsonb values are preserved by a transfer')
    const types = (await dst.driver.designInfo(dst.container, { name: 'docs', type: 'table', schema: dst.container })).columns.map((c) => [c.name, c.type])
    assert.deepEqual(types.slice(1), [['j', 'json'], ['jb', 'jsonb']], 'json stays json and jsonb stays jsonb')
    console.log('transfer: json text exact, jsonb equal, column types kept OK')

    // ── dump → restore ──
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zivar-json-'))
    const file = path.join(dir, 'docs.sql')
    await dumpSql(src.driver, 'postgres', src.container, tbl, { structure: true, data: true, dropExisting: false, qualified: false }, file, hooks)
    const dst2 = await env.container('postgres', 'e')
    const run = await runScript(dst2.driver, 'postgres', dst2.container, splitSql(fs.readFileSync(file, 'utf8'), 'postgres'), { stopOnError: true, transaction: false }, hooks)
    assert.deepEqual(run.failures, [], run.failures.map((f) => f.error).join('|'))
    assert.deepEqual(await texts(dst2, 'j'), expectedJson, 'json text is preserved exactly by a dump')
    assert.deepEqual(await texts(dst2, 'jb'), expectedJsonb, 'jsonb values are preserved by a dump')
    console.log('dump → restore: json text exact, jsonb equal OK')

    // ── serial columns become identity in the copy, so inserts keep working ──
    await dst.driver.insertRows(dst.container, { name: 'docs', type: 'table', schema: dst.container }, ['j'], [['{"after": true}']])
    assert.equal((await dst.driver.query(`SELECT count(*) FROM ${q(dst)}.docs`, null)).rows[0][0], String(VALUES.length + 2))
    console.log('serial -> identity: inserting after the transfer works OK')
    fs.rmSync(dir, { recursive: true, force: true })
    console.log('ALL PG-JSON TESTS PASSED')
  } finally {
    await env.stop()
  }
})().catch((e) => {
  console.error('FAIL', e)
  process.exit(1)
})
