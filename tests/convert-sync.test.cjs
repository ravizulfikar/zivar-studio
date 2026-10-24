// Cross-engine type conversion and structure-sync planning: pure logic, no database needed.
const assert = require('node:assert/strict')
const { convertDesign, convertValue } = require('./.build/convert.cjs')
const { alignDesign, planSyncTable, planNewTable, orderByDependencies } = require('./.build/sync.cjs')

let n = 0
const col = (name, type, o = {}) => ({ id: 'c' + ++n, originalName: name, name, type, nullable: true, primaryKey: false, defaultValue: null, autoIncrement: false, ...o })
const fk = (name, columns, refTable, o = {}) => ({ id: 'f' + ++n, originalName: name, name, columns, refTable, refColumns: ['id'], onDelete: 'NO ACTION', onUpdate: 'NO ACTION', ...o })
const idx = (name, columns, o = {}) => ({ id: 'i' + ++n, originalName: name, name, columns, unique: false, ...o })
const clone = (d) => JSON.parse(JSON.stringify(d))

const types = (src, dst, list) => {
  const d = { name: 't', indexes: [], columns: list.map((t, i) => col(`c${i}`, t, { originalName: null })) }
  const r = convertDesign(src, dst, d, 'src')
  return r.design.columns.map((c) => c.type)
}

// ── type mapping ──
assert.deepEqual(
  types('postgres', 'mysql', ['smallint', 'integer', 'bigint', 'numeric(10,2)', 'real', 'double precision', 'boolean', 'text', 'character varying(100)', 'character(3)', 'date', 'timestamp without time zone', 'timestamp with time zone', 'bytea', 'jsonb', 'uuid']),
  ['smallint', 'int', 'bigint', 'decimal(10,2)', 'float', 'double', 'tinyint(1)', 'longtext', 'varchar(100)', 'char(3)', 'date', 'datetime', 'timestamp', 'longblob', 'json', 'char(36)']
)
assert.deepEqual(
  types('mysql', 'postgres', ['tinyint(1)', 'tinyint', 'int unsigned', 'bigint', 'decimal(8,3)', 'varchar(50)', 'text', 'longtext', 'datetime', 'timestamp', 'json', 'blob', 'enum(\'a\',\'b\')', 'year']),
  ['boolean', 'smallint', 'integer', 'bigint', 'numeric(8,3)', 'varchar(50)', 'text', 'text', 'timestamp', 'timestamp', 'jsonb', 'bytea', 'text', 'smallint']
)
assert.deepEqual(
  types('mssql', 'postgres', ['bit', 'int', 'bigint', 'decimal(18,2)', 'money', 'nvarchar(100)', 'nvarchar(max)', 'varchar(max)', 'datetime2', 'datetimeoffset', 'uniqueidentifier', 'varbinary(max)', 'float', 'real', 'xml']),
  ['boolean', 'integer', 'bigint', 'numeric(18,2)', 'numeric(19,4)', 'varchar(100)', 'text', 'text', 'timestamp', 'timestamptz', 'uuid', 'bytea', 'double precision', 'real', 'text']
)
assert.deepEqual(
  types('postgres', 'mssql', ['integer', 'text', 'varchar(5000)', 'varchar(20)', 'boolean', 'timestamp', 'uuid', 'bytea', 'jsonb', 'numeric']),
  ['int', 'nvarchar(max)', 'nvarchar(max)', 'nvarchar(20)', 'bit', 'datetime2', 'uniqueidentifier', 'varbinary(max)', 'nvarchar(max)', 'decimal(38,10)']
)
assert.deepEqual(
  types('sqlite', 'postgres', ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'VARCHAR(40)', 'BOOLEAN', 'DATETIME', 'NUMERIC(10,2)', '']),
  ['bigint', 'text', 'double precision', 'bytea', 'varchar(40)', 'boolean', 'timestamp', 'numeric(10,2)', 'text']
)
assert.deepEqual(types('postgres', 'sqlite', ['integer', 'text', 'numeric(10,2)', 'timestamp', 'bytea', 'boolean', 'uuid']), ['integer', 'text', 'numeric', 'text', 'blob', 'boolean', 'text'])
assert.deepEqual(types('postgres', 'mysql', ['point', 'tsvector']), ['longtext', 'longtext'], 'unknown types fall back to text')
console.log('type mapping OK')

// ── notes, defaults, keys, generated columns ──
{
  const d = {
    name: 't',
    columns: [
      col('id', 'integer', { primaryKey: true, nullable: false, autoIncrement: true }),
      col('code', 'text', { nullable: false }),
      col('qty', 'integer', { defaultValue: '0' }),
      col('name', 'character varying(20)', { defaultValue: "'abc'::character varying" }),
      col('flag', 'boolean', { defaultValue: 'true' }),
      col('created', 'timestamp without time zone', { defaultValue: 'now()' }),
      col('uid', 'uuid', { defaultValue: 'gen_random_uuid()' }),
      col('seq', 'integer', { defaultValue: "nextval('t_seq'::regclass)" }),
      col('twice', 'integer', { generated: { expr: 'qty * 2', stored: true }, locked: true })
    ],
    indexes: [idx('ix_code', ['code'], { unique: true }), idx('ix_lower', ['code'], { locked: true }), idx('ix_twice', ['twice'])],
    foreignKeys: [fk('fk_p', ['qty'], 'parents', { refSchema: 'src', onDelete: 'CASCADE' }), fk('fk_x', ['qty'], 'x', { refSchema: 'elsewhere' })]
  }
  const m = convertDesign('postgres', 'mysql', d, 'src')
  const by = (name) => m.design.columns.find((c) => c.name === name)
  assert.equal(by('code').type, 'varchar(255)', 'a key column cannot be unbounded TEXT in MySQL')
  assert.equal(by('qty').defaultValue, '0')
  assert.equal(by('name').defaultValue, "'abc'", 'the ::cast suffix is stripped')
  assert.equal(by('flag').defaultValue, '1')
  assert.equal(by('created').defaultValue, 'CURRENT_TIMESTAMP')
  assert.equal(by('uid').defaultValue, '(uuid())')
  assert.equal(by('seq').defaultValue, null, 'sequence defaults cannot move across engines')
  assert.equal(by('seq').autoIncrement, false, 'MySQL allows one auto-increment column: the primary key keeps it')
  assert.equal(by('id').defaultValue, null)
  assert.equal(by('id').autoIncrement, true)
  assert.equal(by('twice'), undefined, 'generated column is left out')
  assert.deepEqual(m.design.indexes.map((i) => i.name), ['ix_code'], 'locked index and the index on a dropped column are not carried')
  assert.deepEqual(m.design.foreignKeys.map((f) => [f.name, f.refSchema]), [['fk_p', undefined], ['fk_x', 'elsewhere']], 'refs into the source container are rebased')
  const text = m.notes.join('\n')
  assert.match(text, /"twice" is generated/)
  assert.match(text, /"seq" lost its auto-increment: MySQL allows only one per table/)
  assert.match(text, /"code" is part of a key, so it became varchar\(255\)/)
  assert.match(text, /ix_lower/)

  // SQLite: auto-increment only survives on a single integer primary key
  const s = convertDesign('postgres', 'sqlite', { name: 't', indexes: [], columns: [col('a', 'integer', { primaryKey: true, nullable: false, autoIncrement: true }), col('b', 'integer', { primaryKey: true, nullable: false })] }, 'src')
  assert.equal(s.design.columns[0].autoIncrement, false)
  assert.match(s.notes.join('\n'), /lost its auto-increment/)
  const s2 = convertDesign('mysql', 'sqlite', { name: 't', indexes: [], columns: [col('id', 'int', { primaryKey: true, nullable: false, autoIncrement: true })] }, 'src')
  assert.equal(s2.design.columns[0].autoIncrement, true)
  // SQL Server wraps defaults in parentheses
  const ms = convertDesign('mssql', 'postgres', { name: 't', indexes: [], columns: [col('a', 'int', { defaultValue: '((0))' }), col('b', 'nvarchar(10)', { defaultValue: "(N'x')" }), col('c', 'datetime', { defaultValue: '(getdate())' }), col('d', 'int', { defaultValue: '(abs((1)))' })] }, 'dbo')
  assert.deepEqual(ms.design.columns.map((c) => c.defaultValue), ['0', "'x'", 'now()', null])
  console.log('defaults, keys, generated columns, notes OK')
}

// ── found by running against a real database: json vs jsonb, serial columns, unique constraints ──
{
  const d = {
    name: 't',
    columns: [
      col('id', 'integer', { primaryKey: true, nullable: false, defaultValue: "nextval('t_id_seq'::regclass)" }),
      col('big', 'bigint', { defaultValue: "nextval('t_big_seq'::regclass)" }),
      col('j', 'json'),
      col('jb', 'jsonb'),
      col('note', 'text', { defaultValue: "'nextval(x)'::text" })
    ],
    indexes: [idx('uq_j', ['j'], { unique: true, locked: true, constraint: true }), idx('ix_expr', ['j'], { locked: true })],
    foreignKeys: []
  }
  const pgToPg = convertDesign('postgres', 'postgres', d, 'src')
  assert.deepEqual(pgToPg.design.columns.map((c) => c.type), ['integer', 'bigint', 'json', 'jsonb', 'text'], 'json stays json and jsonb stays jsonb between PostgreSQL servers')
  assert.deepEqual(pgToPg.design.columns.slice(0, 2).map((c) => [c.autoIncrement, c.defaultValue]), [[true, null], [true, null]], 'a serial column becomes auto-increment')
  assert.equal(pgToPg.design.columns[4].defaultValue, "'nextval(x)'", 'only a real sequence default counts as serial')
  assert.deepEqual(pgToPg.design.indexes.map((i) => [i.name, i.unique]), [['uq_j', true]], 'a UNIQUE constraint is copied as a unique index; an expression index is not')
  assert.ok(!pgToPg.notes.some((x) => /nextval/.test(x)), 'no "default not carried over" note for a serial column')
  assert.ok(pgToPg.notes.some((x) => /ix_expr/.test(x)) && !pgToPg.notes.some((x) => /uq_j/.test(x)))
  assert.deepEqual(convertDesign('postgres', 'mysql', d, 'src').design.columns.slice(2, 4).map((c) => c.type), ['json', 'json'])
  assert.equal(convertDesign('mysql', 'postgres', { name: 't', indexes: [], columns: [col('j', 'json')] }, 'src').design.columns[0].type, 'jsonb', 'MySQL JSON has no json/jsonb distinction; jsonb is the usual choice')
  assert.equal(convertDesign('postgres', 'sqlite', d, 'src').design.columns[0].autoIncrement, true, 'a serial integer primary key keeps auto-increment in SQLite')
  const np = planNewTable({ kind: 'postgres', container: 'dst' }, d, { sourceContainer: 'src' })
  assert.ok(np.statements.some((s) => /CREATE UNIQUE INDEX "uq_j"/.test(s)), 'sync of a new table also carries the unique constraint')
  console.log('json/jsonb, serial -> auto-increment, unique constraints OK')
}

// ── value conversion ──
assert.equal(convertValue(null, 'postgres', 'mysql'), null)
assert.equal(convertValue({ a: 1 }, 'postgres', 'mysql'), '{"a":1}', 'objects become JSON text')
assert.deepEqual(convertValue(['a', 'b'], 'postgres', 'postgres'), ['a', 'b'], 'pg arrays stay arrays between PostgreSQL servers')
assert.equal(convertValue(['a', 'b'], 'postgres', 'mysql'), '["a","b"]')
assert.equal(convertValue(new Date(Date.UTC(2025, 8, 17, 13, 39, 18, 45)), 'mssql', 'postgres'), '2025-09-17 13:39:18.045')
assert.equal(convertValue(9007199254740993n, 'mysql', 'postgres'), '9007199254740993')
const bytes = Uint8Array.from([1, 2])
assert.equal(convertValue(bytes, 'mysql', 'postgres'), bytes)
assert.equal(convertValue(true, 'postgres', 'mysql'), true)
console.log('value conversion OK')

// ── structure sync ──
const ctx = { kind: 'postgres', container: 'dst' }
const opts = { dropExtras: false, sourceContainer: 'src' }
const target = () => ({ name: 'users', pkName: 'users_pkey', columns: [col('id', 'integer', { primaryKey: true, nullable: false }), col('email', 'text', { nullable: false }), col('legacy', 'integer')], indexes: [idx('ix_email', ['email'])], foreignKeys: [] })
const source = () => ({ name: 'users', columns: [col('id', 'integer', { primaryKey: true, nullable: false }), col('email', 'varchar(200)', { nullable: false }), col('age', 'integer', { defaultValue: '0', nullable: false })], indexes: [idx('ix_email', ['email'], { unique: true }), idx('ix_age', ['age'])], foreignKeys: [fk('fk_boss', ['age'], 'users', { refSchema: 'src' })] })

assert.deepEqual(planSyncTable(ctx, target(), clone(target()), opts).statements, [], 'identical tables need no DDL')

let plan = planSyncTable(ctx, target(), source(), opts)
assert.deepEqual(plan.errors, [])
const joined = plan.statements.join('\n')
assert.match(joined, /ALTER COLUMN "email" TYPE varchar\(200\)/)
assert.match(joined, /ADD COLUMN "age" integer NOT NULL DEFAULT 0/)
assert.match(joined, /DROP INDEX "dst"\."ix_email"/)
assert.match(joined, /CREATE UNIQUE INDEX "ix_email" ON "dst"\."users" \("email"\)/)
assert.match(joined, /CREATE INDEX "ix_age"/)
assert.match(joined, /ADD CONSTRAINT "fk_boss" FOREIGN KEY \("age"\) REFERENCES "dst"\."users"/, 'the FK into the source schema is rebased onto the target schema')
assert.ok(!/DROP COLUMN/.test(joined), 'columns only in the target are kept unless dropExtras')
console.log('sync plan: type change, new column, index change, rebased FK; extras kept OK')

plan = planSyncTable(ctx, target(), source(), { ...opts, dropExtras: true })
assert.match(plan.statements.join('\n'), /DROP COLUMN "legacy"/)
assert.ok(plan.warnings.some((w) => /legacy.*deleted/.test(w)))
console.log('sync plan: dropExtras removes target-only columns and warns OK')

// SQLite targets cannot change column types: the planner says so instead of producing bad SQL
plan = planSyncTable({ kind: 'sqlite', container: 'main' }, target(), source(), opts)
assert.ok(plan.errors.some((e) => /cannot change the type/.test(e)))
console.log('sync plan: SQLite limits reported OK')

// ── new tables ──
const np = planNewTable(ctx, source(), { sourceContainer: 'src' })
assert.deepEqual(np.errors, [])
assert.match(np.statements[0], /^CREATE TABLE "dst"\."users"/)
assert.ok(!/FOREIGN KEY/.test(np.statements[0]), 'foreign keys are added after every table exists')
assert.equal(np.foreignKeys.length, 1)
assert.match(np.foreignKeys[0], /ADD CONSTRAINT "fk_boss"/)
const lite = planNewTable({ kind: 'sqlite', container: 'main' }, source(), { sourceContainer: 'src' })
assert.match(lite.statements[0], /FOREIGN KEY \("age"\) REFERENCES "users" \("id"\)/, 'SQLite needs them inline')
assert.deepEqual(lite.foreignKeys, [])
console.log('new table plans (deferred vs inline foreign keys) OK')

// ── dependency order ──
const t = (name, ...refs) => ({ name, refs })
let o = orderByDependencies([t('items', 'orders'), t('orders', 'users'), t('users')], (x) => x.refs)
assert.deepEqual(o.ordered.map((x) => x.name), ['users', 'orders', 'items'])
assert.deepEqual(o.cyclic, [])
o = orderByDependencies([t('a', 'a'), t('b', 'a'), t('c', 'outside')], (x) => x.refs)
assert.deepEqual(o.ordered.map((x) => x.name), ['a', 'c', 'b'], 'self references and unknown tables do not block')
o = orderByDependencies([t('x', 'y'), t('y', 'x'), t('z')], (x) => x.refs)
assert.deepEqual(o.ordered.map((x) => x.name), ['z', 'x', 'y'])
assert.deepEqual(o.cyclic, ['x', 'y'])
console.log('dependency ordering OK')
console.log('ALL CONVERT / SYNC TESTS PASSED')
