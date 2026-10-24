// JSON tree model: lossless numbers, key order, error positions, path-based edits, search, sorting.
const assert = require('node:assert/strict')
const J = require('./.build/jsonModel.cjs')

const parse = (t) => {
  const r = J.parseJson(t)
  assert.ok(r.ok, r.ok ? '' : `${t} -> ${r.error.message}`)
  return r.node
}
const bad = (t) => {
  const r = J.parseJson(t)
  assert.ok(!r.ok, `expected a syntax error for: ${t}`)
  return r.error
}

// ── agrees with JSON.parse on valid documents ──
const docs = ['{}', '[]', '0', '-1.5e+10', '"x"', 'true', 'false', 'null', '{"a":[1,2,{"b":null}],"c":"d\\n\\u00e9\\"q\\""}', '  [ 1 , 2 ]  ', '{"nested":{"z":1,"y":[[],{}]}}', '"😀 日本語"']
for (const d of docs) assert.deepEqual(JSON.parse(J.stringifyJson(parse(d), 0)), JSON.parse(d), d)
console.log('valid documents round-trip OK')

// ── what JSON.parse gets wrong ──
assert.equal(J.stringifyJson(parse('{"id":9007199254740993,"f":1.10,"e":1E5}'), 0), '{"id":9007199254740993,"f":1.10,"e":1E5}', 'numbers keep their exact text')
assert.equal(J.stringifyJson(parse('{"b":1,"a":2,"b":3}'), 0), '{"b":1,"a":2,"b":3}', 'order and duplicate keys are kept')
assert.equal(J.stringifyJson(parse('{"a":[1,{"b":2}]}'), 2), '{\n  "a": [\n    1,\n    {\n      "b": 2\n    }\n  ]\n}', 'pretty printing')
assert.equal(J.stringifyJson(parse('{"a":{},"b":[]}'), 2), '{\n  "a": {},\n  "b": []\n}', 'empty containers stay on one line')
console.log('lossless numbers / key order OK')

// ── errors tell you where ──
let e = bad('{"a": 1,\n  "b": }')
assert.deepEqual([e.line, e.column], [2, 8], 'line and column of the stray token')
assert.match(e.message, /Unexpected "\}"/)
e = bad('{"a": 1,}')
assert.match(e.message, /property name/)
e = bad('[1, 2')
assert.match(e.message, /end of input/)
e = bad('{"a": "unterminated')
assert.match(e.message, /Unterminated string/)
for (const t of ['', '   ', "{'a':1}", '[1 2]', '01', '1.', '.5', '+1', 'nul', '{"a":1} x', '"a\tb"', '"\\x"', '"\\u12"', '[,1]', '{"a" 1}']) bad(t)
bad('['.repeat(2000) + ']'.repeat(2000)) // deep nesting is an error, not a stack overflow
console.log('syntax errors reported with position OK')

// ── path-based editing ──
const doc = parse('{"users":[{"name":"ann","age":30},{"name":"bob"}],"tags":["a","b"]}')
const usersIdx = 0
const ann = J.getAt(doc, [usersIdx, 0])
assert.equal(ann.t, 'object')
assert.equal(J.pathLabel(doc, [0, 1, 0]), '$.users[1].name')
assert.equal(J.pathLabel(doc, []), '$')
assert.equal(J.pathLabel(parse('{"a b":{"c":1}}'), [0, 0]), '$["a b"].c')

let next = J.setAt(doc, [0, 0, 1], { t: 'number', raw: '31' })
assert.equal(J.stringifyJson(next, 0), '{"users":[{"name":"ann","age":31},{"name":"bob"}],"tags":["a","b"]}')
assert.equal(J.stringifyJson(doc, 0).includes('"age":30'), true, 'the original is not mutated')
next = J.removeAt(doc, [0, 0, 1])
assert.equal(J.stringifyJson(next, 0), '{"users":[{"name":"ann"},{"name":"bob"}],"tags":["a","b"]}')
next = J.removeAt(doc, [1, 0])
assert.equal(J.stringifyJson(next, 0), '{"users":[{"name":"ann","age":30},{"name":"bob"}],"tags":["b"]}')
next = J.renameKeyAt(doc, [1], 'labels')
assert.equal(J.stringifyJson(next, 0), '{"users":[{"name":"ann","age":30},{"name":"bob"}],"labels":["a","b"]}')
next = J.addChildAt(doc, [1], { t: 'string', v: 'c' })
assert.equal(J.stringifyJson(J.getAt(next, [1]), 0), '["a","b","c"]')
next = J.addChildAt(doc, [0, 1], { t: 'null' }, 'extra')
assert.equal(J.stringifyJson(J.getAt(next, [0, 1]), 0), '{"name":"bob","extra":null}')
assert.equal(J.removeAt(doc, []), doc, 'the root cannot be removed')
assert.equal(J.setAt(doc, [9, 9], { t: 'null' }), doc, 'a missing path changes nothing')
// duplicate keys are addressed by position, so editing the second one leaves the first alone
const dup = parse('{"k":1,"k":2}')
assert.equal(J.stringifyJson(J.setAt(dup, [1], { t: 'number', raw: '9' }), 0), '{"k":1,"k":9}')
console.log('path edits OK')

// ── sorting, stats, search ──
assert.equal(J.stringifyJson(J.sortKeys(parse('{"b":1,"a":{"z":1,"y":2},"c":[{"q":1,"p":2}]}')), 0), '{"a":{"y":2,"z":1},"b":1,"c":[{"p":2,"q":1}]}')
assert.equal(J.stringifyJson(J.sortKeys(parse('{"a":1,"b":2}'), 'desc'), 0), '{"b":2,"a":1}')
assert.equal(J.stringifyJson(J.sortKeys(parse('{"k10":1,"k2":2}')), 0), '{"k2":2,"k10":1}', 'natural order')
assert.deepEqual(J.statsOf(parse('{"a":[1,2],"b":{"c":null}}')), { nodes: 6, depth: 2 })
const hits = J.searchJson(parse('{"name":"Ann","list":[{"nick":"anna"},{"x":"zzz"}]}'), 'ann')
assert.deepEqual(hits, [[0], [1, 0, 0]])
assert.deepEqual(J.searchJson(parse('{"Name":1}'), 'name'), [[0]], 'keys are searched too, case-insensitively')
assert.deepEqual(J.searchJson(parse('[1,2]'), ''), [])
console.log('sort / stats / search OK')

// ── conversion ──
assert.equal(J.stringifyJson(J.fromJs({ a: [1, 'x', null, true] }), 0), '{"a":[1,"x",null,true]}')
console.log('ALL JSON MODEL TESTS PASSED')
