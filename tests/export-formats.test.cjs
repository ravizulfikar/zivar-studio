// JSON / SQL export, JSON import. The SQL export is proven by loading it into a real SQLite.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

globalThis.DOMParser = require('@xmldom/xmldom').DOMParser

let captured
URL.createObjectURL = (b) => ((captured = b), 'blob:test')
URL.revokeObjectURL = () => {}
let downloadName = ''
globalThis.document = { createElement: () => ({ click() {}, set download(v) { downloadName = v }, get download() { return downloadName } }) }

const { exportResult } = require('./.build/exportData.cjs')
const { parseJson } = require('./.build/importParse.cjs')
const { splitSql } = require('./.build/sqlSplit.cjs')
const { runScript } = require('./.build/script.cjs')
const { SqliteDriver } = require('./.build/sqlite.cjs')

const text = async (format, result, opts) => {
  exportResult(result, 'out', format, opts)
  return new TextDecoder().decode(await captured.arrayBuffer())
}

;(async () => {
  const result = {
    columns: ['id', 'name', 'name', 'when', 'blob', 'big', 'flag', 'nothing'],
    rows: [
      [1, "O'Brien", 'dup', new Date(Date.UTC(2025, 8, 17, 13, 39, 18)), Uint8Array.from([0, 255]), 9007199254740993n, true, null],
      [2, 'line1\nline2', '"q" \\ ;', '2025-01-02', null, '12', false, null]
    ],
    durationMs: 0
  }

  // ── JSON ──
  const json = JSON.parse(await text('json', result))
  assert.equal(downloadName, 'out.json')
  assert.deepEqual(json[0], { id: 1, name: "O'Brien", name_2: 'dup', when: '2025-09-17 13:39:18', blob: '0x00ff', big: '9007199254740993', flag: true, nothing: null }, 'duplicate columns get suffixes; bytes as hex; bigint as string')
  assert.equal(json[1].name, 'line1\nline2')
  console.log('JSON export OK')

  // JSON export imports back
  const back = parseJson(await text('json', result))
  assert.deepEqual(back[0], ['id', 'name', 'name_2', 'when', 'blob', 'big', 'flag', 'nothing'])
  assert.deepEqual(back[1].slice(0, 3), [1, "O'Brien", 'dup'])
  console.log('JSON export → import round trip OK')

  // ── SQL INSERT, loaded into a real SQLite ──
  const sql = await text('sql', { columns: ['id', 'name', 'note', 'blob', 'flag', 'n'], rows: [[1, "O'Brien", 'back\\slash ; -- x', Uint8Array.from([1, 2, 255]), true, null], [2, 'Ünï 😀', 'line1\nline2', null, false, 3.5]], durationMs: 0 }, { kind: 'sqlite', table: 'people' })
  assert.equal(downloadName, 'out.sql')
  assert.match(sql, /INSERT INTO "people" \("id", "name", "note", "blob", "flag", "n"\) VALUES/)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zivar-exp-'))
  const d = new SqliteDriver({ id: 'x', name: 'x', kind: 'sqlite', database: path.join(dir, 't.db') })
  await d.connect()
  await d.query('CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, note TEXT, blob BLOB, flag INT, n REAL)')
  const res = await runScript(d, 'sqlite', 'main', splitSql(sql.replace(/^﻿/, ''), 'sqlite'), { stopOnError: true, transaction: false }, { isCancelled: () => false, onProgress() {} })
  assert.deepEqual(res.failures, [])
  const rows = (await d.query('SELECT id, name, note, hex(blob), flag, n FROM people ORDER BY id')).rows
  assert.deepEqual(rows, [[1, "O'Brien", 'back\\slash ; -- x', '0102FF', 1, null], [2, 'Ünï 😀', 'line1\nline2', '', 0, 3.5]]) // hex(NULL) is '' in SQLite
  await d.close()
  console.log('SQL INSERT export loads into SQLite and reproduces every value OK')

  // 450 rows -> three INSERT batches of 200/200/50
  const many = { columns: ['a'], rows: Array.from({ length: 450 }, (_, i) => [i]), durationMs: 0 }
  assert.equal((await text('sql', many, { kind: 'postgres', table: 't' })).match(/INSERT INTO/g).length, 3)
  assert.match(await text('sql', many, { kind: 'mssql' }), /INSERT INTO \[exported_data\]/, 'default table name')
  await assert.rejects(async () => exportResult(many, 'x', 'sql'), /database type/)
  console.log('SQL INSERT batching, default table name, missing-kind guard OK')

  // ── JSON import shapes ──
  assert.deepEqual(parseJson('[{"a":1,"b":"x"},{"a":2,"c":true}]'), [['a', 'b', 'c'], [1, 'x', null], [2, null, true]], 'union of keys in first-seen order')
  assert.deepEqual(parseJson('{"data":[{"a":1},{"a":2}]}'), [['a'], [1], [2]], 'wrapper object')
  assert.deepEqual(parseJson('{"a":1,"b":2}'), [['a', 'b'], [1, 2]], 'a single object is one row')
  assert.deepEqual(parseJson('[[1,"x"],[2,"y"]]'), [[1, 'x'], [2, 'y']], 'array of arrays has no header')
  assert.deepEqual(parseJson('{"a":1}\n{"a":2,"b":"z"}\n'), [['a', 'b'], [1, null], [2, 'z']], 'NDJSON')
  assert.deepEqual(parseJson('﻿[{"a":{"n":1},"b":[1,2],"c":null}]'), [['a', 'b', 'c'], ['{"n":1}', '[1,2]', null]], 'nested values become JSON text; BOM ignored')
  assert.deepEqual(parseJson('[]'), [])
  assert.throws(() => parseJson('not json'), /Not valid JSON/)
  assert.throws(() => parseJson('[1,2,3]'), /must be an object/)
  assert.throws(() => parseJson('[{"a":1}, 5]'), /must be an object/)
  console.log('JSON import shapes OK')
  console.log('ALL EXPORT-FORMAT TESTS PASSED')
})().catch((e) => {
  console.error('FAIL', e)
  process.exit(1)
})
