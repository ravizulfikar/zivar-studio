// CSV / XLSX parsing used by the import dialog.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// The renderer has DOMParser; Node needs a stand-in.
globalThis.DOMParser = require('@xmldom/xmldom').DOMParser

const { parseCsv, detectDelimiter, decodeText, parseXlsx } = require('./.build/importParse.cjs')

// ── CSV ──
assert.deepEqual(parseCsv('a,b,c\n1,2,3\n', ','), [['a', 'b', 'c'], ['1', '2', '3']])
assert.deepEqual(parseCsv('a,b\r\n1,2\r\n', ','), [['a', 'b'], ['1', '2']], 'CRLF')
assert.deepEqual(parseCsv('a,b\r1,2', ','), [['a', 'b'], ['1', '2']], 'bare CR, no trailing newline')
assert.deepEqual(parseCsv('"a,1","he said ""hi""",x\n', ','), [['a,1', 'he said "hi"', 'x']], 'quotes and doubled quotes')
assert.deepEqual(parseCsv('"line1\nline2",b\n"c\r\nd",e\n', ','), [['line1\nline2', 'b'], ['c\r\nd', 'e']], 'newlines inside quotes')
assert.deepEqual(parseCsv('﻿id,name\n1,Ana\n', ','), [['id', 'name'], ['1', 'Ana']], 'BOM stripped')
assert.deepEqual(parseCsv('a,b,\n,,\n', ','), [['a', 'b', ''], ['', '', '']], 'empty fields kept')
assert.deepEqual(parseCsv('a,b\n\n1,2\n', ','), [['a', 'b'], [''], ['1', '2']], 'blank line kept as a row (caller drops it)')
assert.deepEqual(parseCsv('', ','), [])
assert.deepEqual(parseCsv('x"y,z\n', ','), [['x"y', 'z']], 'a quote inside an unquoted field is literal')
console.log('CSV parsing OK')

assert.equal(detectDelimiter('a,b,c\n1,2,3\n4,5,6'), ',')
assert.equal(detectDelimiter('a;b;c\n1;2;3\n4;5;6'), ';')
assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t')
assert.equal(detectDelimiter('a|b|c\n1|2|3'), '|')
assert.equal(detectDelimiter('"a;b",c\n"1;2",3\n"4;5",6'), ',', 'delimiters inside quotes are not counted')
assert.equal(detectDelimiter('single\ncolumn\nonly'), ',')
const euro = 'nama;harga\nkopi;1,5\nteh;2,0\n'
assert.deepEqual(parseCsv(euro, detectDelimiter(euro)), [['nama', 'harga'], ['kopi', '1,5'], ['teh', '2,0']], 'decimal commas survive a ; file')
console.log('delimiter detection OK')

assert.equal(decodeText(new TextEncoder().encode('﻿café').buffer, 'utf-8'), 'café')
assert.equal(decodeText(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]).buffer, 'windows-1252'), 'café')
console.log('text decoding OK')

// ── XLSX produced by a real spreadsheet library (openpyxl): shared strings, dates, booleans, gaps ──
const sheets = parseXlsx(new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.xlsx'))))
assert.deepEqual(sheets.map((s) => s.name), ['People', 'Second'])
const people = sheets[0].rows
assert.deepEqual(people[0], ['id', 'name', 'joined', 'score', 'active', 'note'])
assert.deepEqual(people[1], [1, 'Ana', '2025-09-17', 3.5, true, 'rich "quoted" & <xml>'])
assert.deepEqual(people[2].slice(0, 5), [2, 'Budi Ünïcode', '2026-01-02 13:45:30', 10, false], 'datetime keeps its time')
assert.equal(people[2][5] ?? null, null, 'trailing empty cells are simply absent')
assert.equal(people[3][0], 3)
assert.equal(people[3][1] ?? null, null)
assert.deepEqual(people[4] ?? [], [], 'empty row')
assert.deepEqual(people[5].slice(0, 4), [5, 'Eka', '2024-02-29', '007'], 'text stays text, leap day survives')
assert.equal(people[5][5], '=1+1', 'a formula-looking string is just text')
assert.deepEqual(sheets[1].rows, [['a', 'b'], ['x', 1]])
console.log('XLSX from openpyxl OK (shared strings, dates, booleans, gaps, 2 sheets)')

// ── round trip with our own XLSX writer ──
let captured
URL.createObjectURL = (b) => ((captured = b), 'blob:test')
URL.revokeObjectURL = () => {}
globalThis.document = { createElement: () => ({ click() {}, set download(v) {}, get download() { return '' } }) }
const { exportResult } = require('./.build/exportData.cjs')
const rows = [['=1+1', 42, true, null, 'Ünï & <t> "q"'], ['  padded  ', 3.14, false, 'a', 'line1\nline2']]
exportResult({ columns: ['f', 'n', 'b', 'x', 't'], rows, durationMs: 0 }, 'rt', 'xlsx')
captured.arrayBuffer().then((ab) => {
  const back = parseXlsx(new Uint8Array(ab))[0].rows
  assert.deepEqual(back[0], ['f', 'n', 'b', 'x', 't'])
  assert.deepEqual(back[1], ['=1+1', 42, true, null, 'Ünï & <t> "q"'], 'embedded null is padded back to null')
  assert.deepEqual(back[2], ['  padded  ', 3.14, false, 'a', 'line1\nline2'])
  console.log('XLSX round trip (export -> import) OK')

  assert.throws(() => parseXlsx(new Uint8Array([1, 2, 3, 4])), /./)
  assert.throws(() => parseXlsx(require('fflate').zipSync({ 'hello.txt': new TextEncoder().encode('x') })), /does not look like an .xlsx/)
  console.log('bad input rejected OK')
  console.log('ALL IMPORT-PARSE TESTS PASSED')
})
