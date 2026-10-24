// Drives the real Electron app through the DevTools protocol (no extra dependencies).
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { Database } = require('../node_modules/node-sqlite3-wasm')

const SCRATCH = process.env.UI_TEST_DIR || require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'zivar-ui-'))
const DB = path.join(SCRATCH, 'ui.db')
const PORT = 9333
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

fs.rmSync(path.join(SCRATCH, 'userdata'), { recursive: true, force: true })
fs.rmSync(DB, { force: true })
{
  const d = new Database(DB)
  d.run('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, age INT DEFAULT 18)')
  d.run("INSERT INTO users (email) VALUES ('a@x'), ('b@x')")
  d.run('CREATE INDEX ix_age ON users (age)')
  d.run('CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, joined TEXT, score REAL, active INT, note TEXT)')
  d.run('CREATE TABLE docs (id INTEGER PRIMARY KEY, body TEXT, pic BLOB)')
  const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  d.run('INSERT INTO docs (body, pic) VALUES (?, ?)', ['{"a":1,"b":[1,2]}', PNG_1X1])
  d.run("INSERT INTO docs (body) VALUES ('hello world'), ('say hello'), ('bye')")
  d.close()
}

const DB_TRANSFER = path.join(SCRATCH, 'transfer-target.db')
const DB_SYNC = path.join(SCRATCH, 'sync-target.db')
fs.rmSync(DB_TRANSFER, { force: true })
fs.rmSync(DB_SYNC, { force: true })
{
  new Database(DB_TRANSFER).close()
  const t = new Database(DB_SYNC)
  t.run('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, mail TEXT NOT NULL, legacy INTEGER)')
  t.run("INSERT INTO users (mail, legacy) VALUES ('old@x', 1)")
  t.close()
}
const SCRIPT = path.join(SCRATCH, 'script.sql')
fs.writeFileSync(SCRIPT, "-- test script\nCREATE TABLE from_script (id INTEGER PRIMARY KEY, v TEXT);\nINSERT INTO from_script VALUES (1, 'a;b');\nINSERT INTO from_script VALUES (2, 'it''s');\n")
const CSV = path.join(SCRATCH, 'import.csv')
fs.writeFileSync(CSV, '\uFEFFMail;AGE;Nick\r\nc@x;30;"Quote; ""Q"""\r\nd@x;;plain\r\n\r\ne@x;41;  spaced  \r\n')
const XLSX = path.join(__dirname, 'fixtures', 'sample.xlsx')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const electron = require('electron')
const app = spawn(electron, [path.join(__dirname, '..', 'out/main/index.js'), `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(SCRATCH, 'userdata')}`], { env, stdio: 'ignore' })

let ws, nextId = 1
const pending = new Map()
const send = (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })) })
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
  return r.result.value
}
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(SCRATCH, name), Buffer.from(r.data, 'base64'))
}

// Helpers evaluated in the page.
const HELPERS = `
  window.__fire = (el, type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  window.__pane = () => document.querySelector('.pane:not([hidden])');
  window.__byText = (sel, text) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null).find((e) => e.textContent.includes(text));
  window.__setInput = (el, value) => {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    // React listens for change on select and input on text fields.
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  };
  window.confirm = () => true;
`
const waitFor = async (expr, what, ms = 8000) => {
  const t = Date.now()
  while (Date.now() - t < ms) { try { if (await ev(expr)) return } catch {} await sleep(100) }
  let body = ''
  try { body = await ev('document.body.innerText.slice(0, 400)'); await shot('fail.png') } catch {}
  throw new Error('timeout waiting for: ' + what + ' | page text: ' + JSON.stringify(body))
}

;(async () => {
  let targets
  for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.find((t) => t.type === 'page')) break } catch {} await sleep(250) }
  const page = targets.find((t) => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.onmessage = (m) => { const d = JSON.parse(m.data); const p = pending.get(d.id); if (p) { pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result) } }
  await send('Runtime.enable'); await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })

  await waitFor(`typeof window.api === 'object' && document.getElementById('root').children.length > 0`, 'app to load', 20000)
  // seed a connection through the real IPC, then reload so the sidebar shows it
  await ev(`window.api.saveConnection({ id: 't1', name: 'Test SQLite', kind: 'sqlite', database: ${JSON.stringify(DB)} }).then(r => r.ok)`)
  await ev(`window.api.saveConnection({ id: 't2', name: 'Transfer target', kind: 'sqlite', database: ${JSON.stringify(DB_TRANSFER)} }).then(r => r.ok)`)
  await ev(`window.api.saveConnection({ id: 't3', name: 'Sync target', kind: 'sqlite', database: ${JSON.stringify(DB_SYNC)} }).then(r => r.ok)`)
  await ev('location.reload()'); await sleep(1200)
  await ev(HELPERS)

  // open connection -> container -> Tables folder -> select users
  await waitFor(`!!__byText('.node.conn', 'Test SQLite')`, 'connection node')
  await ev(`__fire(__byText('.node.conn', 'Test SQLite'), 'dblclick')`)
  await waitFor(`!!__byText('.node .label', 'main')`, 'container node')
  await ev(`__fire(__byText('.node .label', 'main').parentElement, 'click')`)
  await waitFor(`!!__byText('.node.folder .label', 'Tables')`, 'Tables folder')
  await ev(`__fire(__byText('.node.folder .label', 'Tables').parentElement, 'click')`)
  await waitFor(`!!__byText('.node.leaf .label', 'users')`, 'users table node')
  await ev(`__fire(__byText('.node.leaf .label', 'users').parentElement, 'click')`)
  console.log('tree: connection > main > Tables > users OK')
  {
    // a table sits one indent step to the right of the folder that holds it (the icons, not the boxes, line up)
    const folderIcon = await ev(`__byText('.node.folder .label', 'Tables').parentElement.querySelector('svg').getBoundingClientRect().left`)
    const leafIcon = await ev(`__byText('.node.leaf .label', 'users').parentElement.querySelector('svg').getBoundingClientRect().left`)
    assert.ok(leafIcon - folderIcon >= 10, `tables are indented under their folder (folder icon x=${folderIcon}, table icon x=${leafIcon})`)
    console.log('tree: tables are indented under the Tables folder OK')
  }

  // Design
  await ev(`__byText('button.tool', 'Design').click()`)
  await waitFor(`__pane().querySelectorAll('table.designer tbody tr').length === 3`, 'designer with 3 columns')
  const first = await ev(`[...__pane().querySelectorAll('table.designer tbody tr')].map(r => { const i = r.querySelectorAll('input'); return [i[0].value, i[1].value, i[2].checked, i[3].checked, i[4].checked, i[5].value] })`)
  console.log('  loaded columns:', JSON.stringify(first))
  assert.deepEqual(first[0], ['id', 'INTEGER', false, true, true, ''])
  assert.deepEqual(first[2], ['age', 'INT', true, false, false, '18'])
  assert.equal(await ev(`!!__byText('button.run', '✓ Apply changes') && __byText('button.run', '✓ Apply changes').disabled`), true)
  console.log('designer loads real column metadata; Apply disabled with no changes OK')
  await shot('designer-columns.png')

  // edit: add a column, rename email, add index
  await ev(`__byText('.subtoolbar button', '+ Column') ? __byText('.subtoolbar button', '+ Column').click() : [...__pane().querySelectorAll('.subtoolbar button')].find(b => b.textContent.includes('Column') && !b.textContent.includes('Delete')).click()`)
  await waitFor(`__pane().querySelectorAll('table.designer tbody tr').length === 4`, '4th column row')
  await ev(`__setInput(__pane().querySelectorAll('table.designer tbody tr')[3].querySelectorAll('input')[0], 'nick'); __setInput(__pane().querySelectorAll('table.designer tbody tr')[3].querySelectorAll('input')[5], "'anon'")`)
  await ev(`__setInput(__pane().querySelectorAll('table.designer tbody tr')[1].querySelectorAll('input')[0], 'mail')`)
  await ev(`[...__pane().querySelectorAll('.subtabs button')].find(b => b.textContent.startsWith('Indexes')).click()`)
  await ev(`[...__pane().querySelectorAll('.subtoolbar button')].find(b => b.textContent.includes('Index') && !b.textContent.includes('Delete')).click()`)
  await waitFor(`__pane().querySelectorAll('table.designer tbody tr').length === 2`, 'second index row')
  await ev(`__setInput(__pane().querySelectorAll('table.designer tbody tr')[1].querySelectorAll('input')[1], 'mail')`)
  await ev(`[...__pane().querySelectorAll('.subtabs button')].find(b => b.textContent.startsWith('DDL')).click()`)
  await waitFor(`!!__pane().querySelector('pre.ddl')`, 'ddl preview')
  const ddl = await ev(`__pane().querySelector('pre.ddl').textContent`)
  console.log('--- DDL preview ---\n' + ddl + '\n-------------------')
  assert.match(ddl, /RENAME COLUMN "email" TO "mail"/)
  assert.match(ddl, /ADD COLUMN "nick" text DEFAULT 'anon'/)
  assert.match(ddl, /CREATE INDEX "ix_users_2" ON "users" \("mail"\)/)
  await shot('designer-ddl.png')

  // apply
  await ev(`__byText('button.run', '✓ Apply changes').click()`)
  await waitFor(`!!__byText('.msg.ok', 'Applied')`, 'success message')
  await waitFor(`__pane().querySelector('.statusline').textContent.includes('No pending changes')`, 'plan empty after reload')
  console.log('apply from UI OK; designer reloaded with nothing pending')

  // validation surfaces in UI: blank name
  await ev(`[...__pane().querySelectorAll('.subtabs button')].find(b => b.textContent.startsWith('Columns')).click()`)
  await ev(`__setInput(__pane().querySelectorAll('table.designer tbody tr')[0].querySelectorAll('input')[0], '')`)
  await waitFor(`!!__pane().querySelector('.banner.err')`, 'validation banner')
  assert.equal(await ev(`__byText('button.run', '✓ Apply changes').disabled`), true)
  console.log('validation error disables Apply OK')
  await shot('designer-error.png')

  // New table flow
  await ev(`[...__pane().querySelectorAll('.subtoolbar button')].find(b => b.textContent.includes('Reset')).click()`)
  await ev(`__fire(__byText('.node .label', 'main').parentElement, 'click')`)
  await ev(`__byText('button.tool', 'New Table').click()`)
  await waitFor(`!!__pane().querySelector('.table-name input')`, 'new table designer')
  await ev(`__setInput(__pane().querySelector('.table-name input'), 'orders')`)
  await ev(`[...__pane().querySelectorAll('.subtoolbar button')].find(b => b.textContent.includes('Column') && !b.textContent.includes('Delete')).click()`)
  await ev(`__setInput(__pane().querySelectorAll('table.designer tbody tr')[1].querySelectorAll('input')[0], 'total')`)
  await ev(`__setInput(__pane().querySelectorAll('table.designer tbody tr')[1].querySelectorAll('input')[1], 'real')`)
  await ev(`__byText('button.run', '✓ Create table').click()`)
  await waitFor(`!!__byText('.msg.ok', 'Applied')`, 'table created')
  await shot('designer-new.png')
  console.log('new table created from UI OK')

  // New table with a foreign key, through the Foreign keys tab
  await ev(`__fire(__byText('.node .label', 'main').parentElement, 'click')`)
  await ev(`__byText('button.tool', 'New Table').click()`)
  await waitFor(`__pane().querySelector('.table-name input') && __pane().querySelector('.table-name input').value === 'new_table'`, 'second new-table designer')
  await ev(`__setInput(__pane().querySelector('.table-name input'), 'items')`)
  await ev(`[...__pane().querySelectorAll('.subtoolbar button')].find(b => b.textContent.includes('Column') && !b.textContent.includes('Delete')).click()`)
  await ev(`__setInput(__pane().querySelectorAll('table.designer tbody tr')[1].querySelectorAll('input')[0], 'user_ref'); __setInput(__pane().querySelectorAll('table.designer tbody tr')[1].querySelectorAll('input')[1], 'integer')`)
  await ev(`[...__pane().querySelectorAll('.subtabs button')].find(b => b.textContent.startsWith('Foreign keys')).click()`)
  await ev(`[...__pane().querySelectorAll('.subtoolbar button')].find(b => b.textContent.includes('Foreign key')).click()`)
  await waitFor(`__pane().querySelectorAll('table.designer tbody tr').length === 1`, 'foreign key row')
  const fkRow = () => `__pane().querySelectorAll('table.designer tbody tr')[0]`
  await ev(`__setInput(${fkRow()}.querySelectorAll('input')[1], 'user_ref')`) // columns
  await ev(`__setInput(${fkRow()}.querySelectorAll('input')[3], 'users')`) // referenced table
  await ev(`__setInput(${fkRow()}.querySelectorAll('input')[4], 'id')`) // referenced columns
  await ev(`__setInput(${fkRow()}.querySelectorAll('select')[0], 'CASCADE')`)
  await ev(`[...__pane().querySelectorAll('.subtabs button')].find(b => b.textContent.startsWith('DDL')).click()`)
  const fkDdl = await ev(`__pane().querySelector('pre.ddl').textContent`)
  assert.match(fkDdl, /CONSTRAINT "fk_items_1" FOREIGN KEY \("user_ref"\) REFERENCES "users" \("id"\) ON DELETE CASCADE/)
  await ev(`__byText('button.run', '✓ Create table').click()`)
  await waitFor(`!!__byText('.msg.ok', 'Applied')`, 'items table created')
  await waitFor(`[...__pane().querySelectorAll('.subtabs button')].some(b => b.textContent.startsWith('Foreign keys (1)'))`, 'FK reloaded after create')
  await shot('designer-fk.png')
  console.log('new table with foreign key created from UI OK')

  // ── import: CSV into users ──
  const setFile = async (file) => {
    const doc = await send('DOM.getDocument', { depth: -1 })
    const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' })
    await send('DOM.setFileInputFiles', { files: [file], nodeId: node.nodeId })
  }
  await send('DOM.enable')
  await ev(`__fire(__byText('.node.leaf .label', 'users').parentElement, 'click')`)
  await ev(`__byText('button.tool', 'Import').click()`)
  await waitFor(`!!document.querySelector('.import-dialog input[type=file]')`, 'import dialog')
  await setFile(CSV)
  await waitFor(`document.querySelectorAll('.import-dialog .map-wrap select').length >= 4`, 'column mapping')
  const mapped = await ev(`[...document.querySelectorAll('.import-dialog .map-wrap')[0].querySelectorAll('tbody tr')].map(r => [r.cells[0].textContent.trim(), r.querySelector('select').selectedOptions[0].textContent])`)
  console.log('  auto mapping:', JSON.stringify(mapped))
  assert.deepEqual(mapped.map((m) => m[1]), ['— don’t import —', 'Mail', 'AGE', 'Nick'], 'columns matched by name, ignoring case; id left unmapped')
  assert.match(await ev(`document.querySelector('.import-dialog').textContent`), /3 data row\(s\), 3 column\(s\)/, 'blank line dropped, semicolon detected')
  await shot('import-dialog.png')
  await ev(`[...document.querySelectorAll('.import-dialog button')].find(b => b.textContent.startsWith('Import ')).click()`)
  await waitFor(`!!__byText('.import-dialog .msg.ok', 'Imported 3 row')`, 'CSV import done')
  await ev(`[...document.querySelectorAll('.import-dialog button')].find(b => b.textContent === 'Close').click()`)
  await waitFor(`!document.querySelector('.import-dialog')`, 'dialog closed')
  console.log('CSV import through the UI OK')

  // ── import: real XLSX into people ──
  await ev(`__fire(__byText('.node.leaf .label', 'people').parentElement, 'click')`)
  await ev(`__byText('button.tool', 'Import').click()`)
  await waitFor(`!!document.querySelector('.import-dialog input[type=file]')`, 'import dialog 2')
  await setFile(XLSX)
  await waitFor(`document.querySelectorAll('.import-dialog .map-wrap select').length >= 6`, 'xlsx mapping')
  assert.match(await ev(`document.querySelector('.import-dialog').textContent`), /4 data row\(s\), 6 column\(s\)/)
  await ev(`[...document.querySelectorAll('.import-dialog button')].find(b => b.textContent.startsWith('Import ')).click()`)
  await waitFor(`!!__byText('.import-dialog .msg.ok', 'Imported 4 row')`, 'XLSX import done')
  await ev(`[...document.querySelectorAll('.import-dialog button')].find(b => b.textContent === 'Close').click()`)
  await waitFor(`!document.querySelector('.import-dialog')`, 'import dialog closed')
  console.log('XLSX import through the UI OK')

  // ── Run SQL file (right-click the database) ──
  const clickMenu = (label) => ev(`[...document.querySelectorAll('.popup-item')].find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`)
  await ev(`__fire(__byText('.node .label', 'main').parentElement, 'contextmenu')`)
  await waitFor(`!!document.querySelector('.popup.context')`, 'database context menu')
  await clickMenu('Run SQL file…')
  await waitFor(`!!document.querySelector('.import-dialog input[type=file]')`, 'run-script dialog')
  await setFile(SCRIPT)
  await waitFor(`/3 statement\\(s\\)/.test(document.querySelector('.import-dialog').textContent)`, 'script parsed into 3 statements (semicolons inside strings kept)')
  await ev(`[...document.querySelectorAll('.import-dialog button')].find(b => b.textContent === 'Run').click()`)
  await waitFor(`!!__byText('.import-dialog .msg.ok', '3 of 3 statements ran with no errors')`, 'script finished')
  await ev(`[...document.querySelectorAll('.import-dialog button')].find(b => b.textContent === 'Close').click()`)
  console.log('Run SQL file through the UI OK')

  // ── dark mode: the app starts in the OS theme, so toggle from whichever it is, and back ──
  const bodyBg = () => ev(`getComputedStyle(document.body).backgroundColor`)
  const startTheme = await ev(`document.documentElement.dataset.theme`)
  const other = startTheme === 'dark' ? 'light' : 'dark'
  const labelFor = (t) => (t === 'dark' ? 'Dark' : 'Light') // the button is named after the theme it switches to
  const startBg = await bodyBg()
  await shot(`theme-${startTheme}.png`)
  await ev(`__byText('button.tool', ${JSON.stringify(labelFor(other))}).click()`)
  await waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(other)}`, 'theme switched')
  assert.notEqual(await bodyBg(), startBg)
  await shot(`theme-${other}.png`)
  await ev(`__byText('button.tool', ${JSON.stringify(labelFor(startTheme))}).click()`)
  await waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(startTheme)}`, 'theme restored')
  assert.equal(await bodyBg(), startBg)
  // the rest of this test (and its screenshots) is written against the light theme
  if (startTheme === 'dark') await ev(`__byText('button.tool', 'Light').click()`) // in dark now, so the button offers Light
  await waitFor(`document.documentElement.dataset.theme === 'light'`, 'light theme for the remaining checks')
  console.log('dark / light theme toggle OK')

  // ── cell viewer: JSON, image ──
  await ev(`__fire(__byText('.node.leaf .label', 'docs').parentElement, 'dblclick')`)
  await waitFor(`__pane().querySelectorAll('table.grid tbody tr').length === 4`, 'docs data grid')
  const cell = (r, c) => `__pane().querySelectorAll('table.grid tbody tr')[${r}].cells[${c}]`
  await ev(`__fire(${cell(0, 2)}, 'contextmenu')`) // body of row 1
  await waitFor(`!!document.querySelector('.cell-viewer')`, 'cell viewer')
  assert.match(await ev(`document.querySelector('.cell-viewer').textContent`), /Valid JSON/, 'JSON cell opens on the JSON tab')
  await ev(`[...document.querySelectorAll('.cell-viewer button')].find(b => b.textContent === 'Format').click()`)
  assert.match(await ev(`document.querySelector('.cell-viewer textarea').value`), /"a": 1,\n  "b": \[/, 'Format pretty-prints')
  await ev(`[...document.querySelectorAll('.cell-viewer button')].find(b => b.textContent === 'Apply to cell').click()`)
  await waitFor(`!document.querySelector('.cell-viewer')`, 'viewer closed')
  assert.ok(await ev(`${cell(0, 2)}.classList.contains('dirty')`), 'applied text stages a pending edit')
  await ev(`__fire(${cell(0, 3)}, 'contextmenu')`) // pic of row 1
  await waitFor(`!!document.querySelector('.cell-viewer img')`, 'image tab')
  await waitFor(`document.querySelector('.cell-viewer img').complete && document.querySelector('.cell-viewer img').naturalWidth === 1`, 'PNG decoded by the browser')
  console.log('cell viewer: JSON format/apply and PNG preview OK')
  await ev(`[...document.querySelectorAll('.cell-viewer button')].find(b => b.textContent === 'Close').click()`)

  // ── Objects tab: Open / Structure work without clicking a row first ──
  await ev(`__fire(__byText('.node .label', 'main').parentElement, 'dblclick')`)
  await waitFor(`!!__pane().querySelector('table.grid.objects')`, 'objects tab')
  const objBtn = (name) => `[...__pane().querySelectorAll('.subtoolbar button')].find(b => b.textContent.trim() === '${name}')`
  assert.equal(await ev(`${objBtn('Open')}.disabled || ${objBtn('Structure')}.disabled`), false, 'Open and Structure are enabled straight away')
  await ev(`__fire(__pane().querySelectorAll('table.grid.objects tbody tr')[1], 'click')`)
  assert.equal(await ev(`__pane().querySelectorAll('table.grid.objects tbody tr.sel').length`), 1, 'exactly one row is highlighted')
  const picked = await ev(`__pane().querySelector('table.grid.objects tbody tr.sel td').textContent.trim()`)
  await ev(`${objBtn('Structure')}.click()`)
  await waitFor(`!!__pane().querySelector('table.designer')`, 'designer opened by the Structure button')
  assert.ok(await ev(`!!__byText('.tab.active .tab-title', ${JSON.stringify(picked)})`), 'the picked table is the one that opened')
  console.log('objects tab: Open / Structure usable without a prior click OK')

  // ── JSON editor tab: tree, big numbers, search, inline edit, delete, syntax errors ──
  await ev(`__byText('button.tool', 'JSON').click()`)
  await waitFor(`!!__pane().querySelector('.jed')`, 'json tab')
  const setJson = (text) => ev(`(() => { const t = __pane().querySelector('textarea.jed-text'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  const jsonText = () => ev(`__pane().querySelector('textarea.jed-text').value`)
  await setJson('{"id":9007199254740993,"users":[{"name":"ann"},{"name":"bob"}],"tags":["a","b"],"ok":true,"none":null}')
  await waitFor(`__pane().querySelectorAll('.jt-row').length >= 8`, 'tree rows')
  assert.equal(await ev(`__pane().querySelector('.jt-val.number').textContent`), '9007199254740993', 'a number JavaScript cannot hold is shown exactly')
  assert.match(await ev(`__pane().querySelector('.jed').textContent`), /Valid JSON/)
  await ev(`[...__pane().querySelectorAll('.jed-bar button')].find(b => b.textContent === 'Collapse all').click()`)
  await waitFor(`__pane().querySelectorAll('.jt-row').length === 1`, 'only the root row after Collapse all')
  await ev(`[...__pane().querySelectorAll('.jed-bar button')].find(b => b.textContent === 'Expand all').click()`)
  await waitFor(`__pane().querySelectorAll('.jt-row').length === 12`, 'every node after Expand all')
  await ev(`__setInput(__pane().querySelector('.jed-search'), 'bob')`)
  await waitFor(`/1 \\/ 1/.test(__pane().querySelector('.jed-bar').textContent)`, 'one search hit')
  assert.match(await ev(`__pane().querySelector('.jt-row.cur').textContent`), /bob/)
  await ev(`__setInput(__pane().querySelector('.jed-search'), '')`)
  // inline edit: a string stays a string, and the big number is not touched by the rewrite
  await ev(`__fire([...__pane().querySelectorAll('.jt-val.string')].find(e => e.textContent === '"ann"'), 'dblclick')`)
  await waitFor(`!!__pane().querySelector('.jt-row input.jt-input')`, 'inline editor')
  await ev(`__setInput(__pane().querySelector('.jt-row input.jt-input'), 'zed')`)
  await ev(`__pane().querySelector('.jt-row input.jt-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
  await waitFor(`/"name": "zed"/.test(__pane().querySelector('textarea.jed-text').value)`, 'edit written back to the text')
  assert.match(await jsonText(), /"id": 9007199254740993,/, 'the large number survives an edit through the tree')
  // delete the tags property
  const tagsRow = `[...__pane().querySelectorAll('.jt-row')].find(r => r.querySelector('.jt-key')?.textContent === 'tags')`
  await ev(`${tagsRow}.querySelector('button.danger').click()`)
  await waitFor(`!/"tags"/.test(__pane().querySelector('textarea.jed-text').value)`, 'tags removed')
  // sort keys, minify
  await ev(`[...__pane().querySelectorAll('.jed-bar button')].find(b => b.textContent === 'Sort keys').click()`)
  await waitFor(`__pane().querySelector('textarea.jed-text').value.indexOf('"none"') < __pane().querySelector('textarea.jed-text').value.indexOf('"ok"')`, 'keys sorted')
  assert.ok((await jsonText()).indexOf('"none"') < (await jsonText()).indexOf('"ok"') && (await jsonText()).indexOf('"ok"') < (await jsonText()).indexOf('"users"'), 'keys are in alphabetical order')
  await ev(`[...__pane().querySelectorAll('.jed-bar button')].find(b => b.textContent === 'Minify').click()`)
  await waitFor(`!/\\n/.test(__pane().querySelector('textarea.jed-text').value)`, 'minified to one line')
  assert.match(await jsonText(), /9007199254740993/)
  // a syntax error is located, and the tree keeps the last valid version
  await setJson('{"a": 1,\n  "b": }')
  await waitFor(`/line 2, column 8/.test(__pane().querySelector('.jed').textContent)`, 'error position shown')
  assert.ok(await ev(`__pane().querySelectorAll('.jt-row').length > 1 && !!__pane().querySelector('.jed-tree.stale')`), 'last valid tree stays visible, dimmed')
  await shot('json-editor.png')
  console.log('json editor: tree, exact big numbers, search, edit, delete, sort, minify, error position OK')
  await ev(`__fire(__byText('.tab .tab-title', 'docs').parentElement, 'click')`) // back to the data grid for the next section
  await waitFor(`__pane().querySelectorAll('table.grid tbody tr').length === 4`, 'docs data grid again')

  // ── find & replace in the grid, then Apply ──
  await ev(`[...__pane().querySelectorAll('.subtoolbar button')].find(b => b.textContent.trim() === 'Find').click()`)
  await waitFor(`!!__pane().querySelector('.find-bar')`, 'find bar')
  await ev(`__setInput(__pane().querySelectorAll('.find-bar input')[0], 'hello')`)
  await waitFor(`/1 \\/ 2/.test(__pane().querySelector('.find-bar').textContent)`, '2 matches counted')
  await ev(`__setInput(__pane().querySelectorAll('.find-bar input')[1], 'howdy')`)
  await ev(`[...__pane().querySelectorAll('.find-bar button')].find(b => b.textContent.startsWith('Replace all')).click()`)
  await waitFor(`${cell(1, 2)}.textContent === 'howdy world' && ${cell(2, 2)}.textContent === 'say howdy'`, 'replaced in both cells')
  await ev(`[...__pane().querySelectorAll('.subtoolbar button')].find(b => b.textContent.includes('Apply')).click()`)
  await waitFor(`!__pane().querySelector('td.dirty')`, 'edits written')
  console.log('find & replace in the grid, written with Apply OK')

  // ── SQL editor: Beautify, Minify, snippets, Ctrl+F ──
  await ev(`__fire(__byText('.node .label', 'main').parentElement, 'click')`)
  await ev(`__byText('button.tool', 'New Query').click()`)
  await waitFor(`!!__pane().querySelector('.cm-content')`, 'query editor')
  const editorText = () => ev(`[...__pane().querySelectorAll('.cm-line')].map(l => l.textContent).join('\\n')`)
  const ctrl = (key, code, vk) => send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key, code, windowsVirtualKeyCode: vk })
  await ev(`__pane().querySelector('.cm-content').focus()`)
  await send('Input.insertText', { text: 'select id,mail from users where age>1 and mail like \'%x\' order by id' })
  await ev(`[...__pane().querySelectorAll('.subtoolbar button')].find(b => b.textContent.trim() === 'Beautify').click()`)
  await waitFor(`__pane().querySelectorAll('.cm-line').length > 3`, 'beautified over several lines')
  let formatted = await editorText()
  assert.match(formatted, /^SELECT\n\s+id,\n\s+mail\nFROM\n\s+users\nWHERE\n/, 'keywords uppercased and broken onto lines')
  await ev(`[...__pane().querySelectorAll('.subtoolbar button')].find(b => b.textContent.trim() === 'Minify').click()`)
  await waitFor(`[...__pane().querySelectorAll('.cm-line')].length === 1`, 'minified onto one line')
  assert.equal(await editorText(), "SELECT id, mail FROM users WHERE age > 1 AND mail like '%x' ORDER BY id") // the formatter leaves the LIKE operator as typed
  console.log('Beautify and Minify OK')

  // snippets: insert a built-in, then save the selection as one of your own
  await ev(`__pane().querySelector('.cm-content').focus()`)
  await ctrl('a', 'KeyA', 65)
  await send('Input.insertText', { text: '' }) // replace the selection with nothing
  await ev(`[...__pane().querySelectorAll('.subtoolbar button')].find(b => b.textContent.startsWith('Snippets')).click()`)
  await waitFor(`!!document.querySelector('.snippet-popup')`, 'snippet menu')
  await ev(`[...document.querySelectorAll('.snippet-popup .popup-item')].find(b => b.textContent.trim() === 'SELECT').click()`)
  await waitFor(`/FROM table_name/.test([...__pane().querySelectorAll('.cm-line')].map(l => l.textContent).join('\\n'))`, 'built-in snippet inserted')
  await ev(`__pane().querySelector('.cm-content').focus()`)
  await ctrl('a', 'KeyA', 65)
  await ev(`[...__pane().querySelectorAll('.subtoolbar button')].find(b => b.textContent.startsWith('Snippets')).click()`)
  await ev(`[...document.querySelectorAll('.snippet-popup .popup-item')].find(b => b.textContent.startsWith('Save selection')).click()`)
  await waitFor(`!!document.querySelector('.dialog input')`, 'snippet name prompt')
  await ev(`__setInput(document.querySelector('.dialog input'), 'my select')`)
  await ev(`[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Save').click()`)
  await ev(`[...__pane().querySelectorAll('.subtoolbar button')].find(b => b.textContent.startsWith('Snippets')).click()`)
  await waitFor(`!!__byText('.snippet-popup .snippet-mine', 'my select')`, 'saved snippet listed under Yours')
  await ev(`[...document.querySelectorAll('.snippet-popup .snippet-mine .lib-del')][0].click()`)
  await waitFor(`!__byText('.snippet-popup .snippet-mine', 'my select')`, 'snippet deleted')
  console.log('snippets: built-in insert, save selection, list, delete OK')

  // Ctrl+F opens the editor's own find/replace panel
  await ev(`__pane().querySelector('.cm-content').focus()`)
  await ctrl('f', 'KeyF', 70)
  await waitFor(`!!__pane().querySelector('.cm-search')`, 'editor search panel')
  await shot('editor-search.png')
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitFor(`!__pane().querySelector('.cm-search')`, 'Escape closes the search panel')
  console.log('editor Ctrl+F search panel OK')

  // ── Data transfer: right-click the database → Transfer data to… ──
  await ev(`__fire(__byText('.node .label', 'main').parentElement, 'contextmenu')`)
  await waitFor(`!!document.querySelector('.popup.context')`, 'context menu for transfer')
  await clickMenu('Transfer data to…')
  await waitFor(`!!document.querySelector('.transfer-dialog')`, 'transfer dialog')
  await waitFor(`document.querySelectorAll('.transfer-dialog .pick-row').length >= 6`, 'source tables listed')
  await waitFor(`document.querySelectorAll('.transfer-dialog .endpoint')[1].querySelectorAll('select')[1].options.length > 0`, 'target database list')
  assert.match(await ev(`document.querySelectorAll('.transfer-dialog .endpoint')[1].querySelector('select').selectedOptions[0].textContent`), /Transfer target/, 'the first other connection is the default target')
  await ev(`[...document.querySelectorAll('.transfer-dialog button')].find(b => b.textContent === 'Start').click()`)
  await waitFor(`document.querySelectorAll('.transfer-dialog td.status-ok').length >= 6`, 'transfer finished for every table', 30000)
  assert.equal(await ev(`document.querySelectorAll('.transfer-dialog td.status-failed').length`), 0, 'no table failed')
  await shot('transfer-done.png')
  await ev(`[...document.querySelectorAll('.transfer-dialog button')].find(b => b.textContent === 'Close').click()`)
  console.log('Data transfer through the UI OK')

  // ── Structure sync into a database that already has an old `users` ──
  await ev(`__fire(__byText('.node .label', 'main').parentElement, 'contextmenu')`)
  await waitFor(`!!document.querySelector('.popup.context')`, 'context menu for sync')
  await clickMenu('Synchronize structure…')
  await waitFor(`!!document.querySelector('.sync-dialog')`, 'sync dialog')
  await ev(`__setInput(document.querySelectorAll('.sync-dialog .endpoint')[1].querySelector('select'), 't3')`)
  await waitFor(`document.querySelectorAll('.sync-dialog .endpoint')[1].querySelectorAll('select')[1].options.length > 0`, 'sync target database list')
  await ev(`[...document.querySelectorAll('.sync-dialog button')].find(b => b.textContent === 'Compare').click()`)
  await waitFor(`document.querySelectorAll('.sync-dialog .sync-row').length >= 5`, 'comparison rows')
  const chips = await ev(`Object.fromEntries([...document.querySelectorAll('.sync-dialog .sync-row')].map(r => [r.querySelector('.sync-name').textContent, r.querySelector('.chip').textContent]))`)
  console.log('  comparison:', JSON.stringify(chips))
  assert.equal(chips.users, 'differs')
  assert.equal(chips.items, 'new')
  await ev(`[...document.querySelectorAll('.sync-dialog .sync-row')].find(r => r.querySelector('.sync-name').textContent === 'users').click()`)
  await waitFor(`/ADD COLUMN "age"/.test(document.querySelector('.sync-dialog pre.ddl').textContent)`, 'users diff shown as SQL')
  await shot('sync-dialog.png')
  await ev(`[...document.querySelectorAll('.sync-dialog button')].find(b => b.textContent === 'Apply to target').click()`)
  await waitFor(`!!__byText('.sync-dialog .msg.ok', 'Applied')`, 'sync applied')
  await waitFor(`[...document.querySelectorAll('.sync-dialog .sync-row')].every(r => r.querySelector('.chip').textContent === 'identical')`, 'after applying, every table is identical', 15000)
  console.log('Structure sync through the UI OK')
  await ev(`[...document.querySelectorAll('.sync-dialog button')].find(b => b.textContent === 'Close').click()`)
  await waitFor(`!document.querySelector('.sync-dialog')`, 'sync dialog closed')

  // ── ER diagram ──
  await ev(`__fire(__byText('.node .label', 'main').parentElement, 'contextmenu')`)
  await waitFor(`!!document.querySelector('.popup.context')`, 'context menu for diagram')
  await clickMenu('ER diagram')
  await waitFor(`__pane().querySelectorAll('g.er-table').length === 6`, 'one box per table (loaded through designInfo)', 20000)
  const names = await ev(`[...__pane().querySelectorAll('g.er-table')].map(g => g.dataset.name).sort()`)
  assert.deepEqual(names, ['docs', 'from_script', 'items', 'orders', 'people', 'users'])
  const edges = await ev(`[...__pane().querySelectorAll('g.er-edge')].map(g => g.dataset.from + '>' + g.dataset.to)`)
  assert.deepEqual(edges, ['items>users'], 'the items.user_ref foreign key is drawn')
  assert.match(await ev(`__pane().querySelector('.statusline').textContent`), /6 table\(s\), 1 relation\(s\)/)
  await shot('er-diagram.png')

  // drag the users table by its title: its position changes and is remembered
  const rectOf = (name) => ev(`(() => { const r = __pane().querySelector('g.er-table[data-name="${name}"] .er-head').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  const posOf = (name) => ev(`__pane().querySelector('g.er-table[data-name="${name}"]').getAttribute('transform')`)
  const before = await posOf('users')
  const c = await rectOf('users')
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x + 60, y: c.y + 40, button: 'left' })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x + 60, y: c.y + 40, button: 'left', clickCount: 1 })
  const after = await posOf('users')
  assert.notEqual(after, before, 'dragging the title moves the table')
  const saved = await ev(`Object.keys(localStorage).filter(k => k.startsWith('zivar-er:')).map(k => JSON.parse(localStorage.getItem(k)).users)`)
  assert.equal(saved.length, 1, 'the new position is saved for next time')
  console.log('ER diagram: tables, relation, drag + remembered position OK')

  // zoom with the wheel, then Fit
  const zoomText = () => ev(`__pane().querySelector('.zoom-label').textContent`)
  const z0 = await zoomText()
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 400, deltaX: 0, deltaY: -240 })
  await waitFor(`__pane().querySelector('.zoom-label').textContent !== ${JSON.stringify(z0)}`, 'wheel zoom changed the zoom level')
  await ev(`[...__pane().querySelectorAll('.subtoolbar button')].find(b => b.textContent === 'Fit').click()`)
  console.log('ER diagram: wheel zoom and Fit OK')

  // keys only: fewer rows are drawn
  const textCount = () => ev(`__pane().querySelectorAll('g.er-table text').length`)
  const allText = await textCount()
  await ev(`__pane().querySelector('.subtoolbar input[type=checkbox]').click()`)
  await waitFor(`__pane().querySelectorAll('g.er-table text').length < ${allText}`, 'keys-only draws fewer columns')
  await ev(`__pane().querySelector('.subtoolbar input[type=checkbox]').click()`)

  // search highlights
  await ev(`__setInput(__pane().querySelector('.subtoolbar input.lib-filter'), 'item')`)
  await waitFor(`/1 match/.test(__pane().querySelector('.statusline').textContent)`, 'search finds one table')
  await ev(`__setInput(__pane().querySelector('.subtoolbar input.lib-filter'), '')`)

  // export: capture the download instead of letting the OS open a save dialog
  // The page's CSP forbids fetch() of blob: URLs, so capture the Blob object itself.
  await ev(`window.__dl = null; window.__blob = null; URL.createObjectURL = (b) => ((window.__blob = b), 'blob:captured'); URL.revokeObjectURL = () => {}; HTMLAnchorElement.prototype.click = function () { window.__dl = { name: this.download } }`)
  await ev(`[...__pane().querySelectorAll('.subtoolbar button')].find(b => b.textContent === 'SVG').click()`)
  await waitFor(`window.__dl && /diagram\\.svg$/.test(window.__dl.name)`, 'SVG export')
  const svg = await ev(`window.__blob.text()`)
  assert.match(svg, /<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*viewBox="/)
  assert.ok(svg.includes('>items<') && svg.includes('>users<') && svg.includes('items.user_ref → users.id'), 'the exported SVG holds the tables and the relation')
  assert.ok(!/class="er-root"[^>]*transform=/.test(svg), 'the export shows the whole diagram, not the current pan and zoom')
  await ev(`window.__dl = null; window.__blob = null`)
  await ev(`[...__pane().querySelectorAll('.subtoolbar button')].find(b => b.textContent === 'PNG').click()`)
  await waitFor(`window.__dl && /diagram\\.png$/.test(window.__dl.name)`, 'PNG export', 15000)
  const png = await ev(`window.__blob.arrayBuffer().then(b => [...new Uint8Array(b).slice(0, 8)])`)
  assert.deepEqual(png, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'a real PNG file')
  console.log('ER diagram: keys-only, search, SVG and PNG export OK')

  // ── Help: documentation page and About ──
  const VERSION = require('../package.json').version
  const helpItem = async (label) => {
    await ev(`[...document.querySelectorAll('.menu-btn')].find(b => b.textContent === 'Help').click()`)
    await waitFor(`!!__byText('.popup-item', ${JSON.stringify(label)})`, 'Help menu item ' + label)
    await ev(`__byText('.popup-item', ${JSON.stringify(label)}).click()`)
  }
  await helpItem('Documentation')
  await waitFor(`!!__pane().querySelector('.docs')`, 'documentation tab')
  const sections = await ev(`__pane().querySelectorAll('.docs-body section').length`)
  assert.ok(sections >= 20, `the manual has its sections (${sections})`)
  assert.ok(await ev(`__pane().querySelectorAll('.docs-toc a').length === ${sections}`), 'every section is in the contents list')
  // screenshots are bundled and load under the app's CSP (they are lazy, so ask for all of them now)
  const imgCount = await ev(`(() => { const l = [...__pane().querySelectorAll('.docs img')]; l.forEach((i) => (i.loading = 'eager')); return l.length })()`)
  assert.ok(imgCount >= 20, `the manual shows screenshots (${imgCount})`)
  await waitFor(`[...__pane().querySelectorAll('.docs img')].every((i) => i.complete && i.naturalWidth > 100)`, 'every screenshot decoded', 20000)
  assert.equal(await ev(`__pane().querySelectorAll('.doc-missing').length`), 0, 'no screenshot is missing')
  // contents list scrolls to a section
  // (the ER export test above replaced HTMLAnchorElement.prototype.click, so dispatch the event instead)
  await ev(`__fire([...__pane().querySelectorAll('.docs-toc a')].find(a => a.textContent === 'Desain tabel'), 'click')`)
  await waitFor(`(() => { const t = document.getElementById('doc-desain-tabel').getBoundingClientRect().top - __pane().querySelector('.docs-body').getBoundingClientRect().top; return Math.abs(t) < 40 })()`, 'scrolled to the section')
  assert.ok(await ev(`[...__pane().querySelectorAll('.docs-toc a.on')].map(a => a.textContent).includes('Desain tabel')`), 'the contents list highlights where you are')
  // search narrows the list
  await ev(`__setInput(__pane().querySelector('.docs-search input'), 'transaksi')`)
  await waitFor(`__pane().querySelectorAll('.docs-body section').length > 0 && __pane().querySelectorAll('.docs-body section').length < ${sections}`, 'search narrows the sections')
  await ev(`__setInput(__pane().querySelector('.docs-search input'), 'zzqqxx')`)
  await waitFor(`/Tidak ada bagian/.test(__pane().querySelector('.docs-toc').textContent)`, 'no-match message')
  await ev(`__setInput(__pane().querySelector('.docs-search input'), '')`)
  await waitFor(`__pane().querySelectorAll('.docs-body section').length === ${sections}`, 'search cleared')
  // a screenshot opens full size and closes with Esc
  await ev(`__pane().querySelector('.docs img').click()`)
  await waitFor(`!!__pane().querySelector('.docs-zoom')`, 'enlarged screenshot')
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitFor(`!__pane().querySelector('.docs-zoom')`, 'Esc closes it')
  await shot('docs.png')
  // F1 focuses the existing tab instead of opening a second one
  await ev(`[...document.querySelectorAll('.tab')].find(t => !t.textContent.includes('Dokumentasi')).click()`)
  await waitFor(`!__pane().querySelector('.docs')`, 'another tab is active')
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 })
  await waitFor(`!!__pane().querySelector('.docs')`, 'F1 shows the documentation')
  assert.equal(await ev(`[...document.querySelectorAll('.tab-title')].filter(t => t.textContent === 'Dokumentasi').length`), 1, 'only one documentation tab')
  console.log('documentation: sections, screenshots load, contents, search, zoom, F1 OK')

  // About: just the name, the version and the website (the link goes to the system browser, so capture it)
  await helpItem('About Zivar Studio')
  await waitFor(`!!document.querySelector('.about')`, 'about dialog')
  const about = await ev(`document.querySelector('.about').innerText`)
  assert.match(about, /Zivar Studio/)
  assert.match(about, new RegExp('Version ' + VERSION.replace(/\./g, '\\.')), 'shows the version from package.json')
  assert.match(about, /zivar\.my\.id/)
  assert.doesNotMatch(await ev(`document.querySelector('.about').closest('.dialog').innerText`), /multi-database client/, 'no marketing text')
  assert.equal(await ev(`document.querySelector('.about a').getAttribute('href')`), 'https://zivar.my.id')
  await ev(`window.__opened = null; window.open = (u) => { window.__opened = u; return null }`)
  await ev(`__fire(document.querySelector('.about a'), 'click')`)
  assert.equal(await ev(`window.__opened`), 'https://zivar.my.id', 'the link asks the main process to open the website')
  await shot('about.png')
  await ev(`[...document.querySelectorAll('.backdrop button')].find(b => b.textContent.trim() === 'Close').click()`)
  console.log('about: name, version, website link OK')

  ws.close()
  app.kill()
  await sleep(1000)

  // verify the database file itself
  const d = new Database(DB)
  const cols = d.all('PRAGMA table_info(users)').map((c) => c.name)
  const idx = d.all("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='users'").map((r) => r.name).sort()
  const rows = d.all('SELECT id, mail, age, nick FROM users ORDER BY id')
  const peopleRows = d.all('SELECT * FROM people ORDER BY id')
  const scripted = d.all('SELECT id, v FROM from_script ORDER BY id')
  const docs = d.all('SELECT id, body, length(pic) AS pic FROM docs ORDER BY id')
  const orders = d.all('PRAGMA table_info(orders)').map((c) => c.name)
  const itemFks = d.all('PRAGMA foreign_key_list(items)')
  d.close()
  assert.deepEqual(cols, ['id', 'mail', 'age', 'nick'])
  assert.deepEqual(idx, ['ix_age', 'ix_users_2'])
  assert.deepEqual(rows.slice(0, 2), [{ id: 1, mail: 'a@x', age: 18, nick: 'anon' }, { id: 2, mail: 'b@x', age: 18, nick: 'anon' }])
  // imported CSV rows: quotes/newlines parsed, empty -> NULL (so the column default does NOT apply to an explicit NULL), spaces trimmed
  assert.deepEqual(rows.slice(2), [
    { id: 3, mail: 'c@x', age: 30, nick: 'Quote; "Q"' },
    { id: 4, mail: 'd@x', age: null, nick: 'plain' },
    { id: 5, mail: 'e@x', age: 41, nick: 'spaced' }
  ])
  const people = peopleRows
  assert.deepEqual(people.map((r) => [r.id, r.name, r.joined, r.score, r.active]), [
    [1, 'Ana', '2025-09-17', 3.5, 1],
    [2, 'Budi Ünïcode', '2026-01-02 13:45:30', 10, 0],
    [3, null, null, null, null],
    [5, 'Eka', '2024-02-29', 7, null]
  ])
  assert.equal(people[3].note, '=1+1')
  assert.deepEqual(scripted, [{ id: 1, v: 'a;b' }, { id: 2, v: "it's" }], 'script file ran, including a semicolon inside a string')
  assert.deepEqual(docs.map((r) => r.body), [JSON.stringify({ a: 1, b: [1, 2] }, null, 2), 'howdy world', 'say howdy', 'bye'], 'the viewer-formatted JSON and the replace-all edits were all written by one Apply')
  assert.equal(docs[0].pic > 50, true)
  assert.deepEqual(orders, ['id', 'total'])
  assert.equal(itemFks.length, 1)
  assert.deepEqual([itemFks[0].table, itemFks[0].from, itemFks[0].to, itemFks[0].on_delete], ['users', 'user_ref', 'id', 'CASCADE'])
  {
    const counts = (file, names) => {
      const x = new Database(file)
      const out = Object.fromEntries(names.map((n) => [n, x.get(`SELECT count(*) AS n FROM "${n}"`).n]))
      x.close()
      return out
    }
    const names = ['users', 'docs', 'people', 'items', 'orders', 'from_script']
    const a = new Database(DB)
    const sourceCounts = Object.fromEntries(names.map((n) => [n, a.get(`SELECT count(*) AS n FROM "${n}"`).n]))
    a.close()
    assert.deepEqual(counts(DB_TRANSFER, names), sourceCounts, 'every table was transferred with all its rows')
    const t = new Database(DB_TRANSFER)
    assert.equal(t.get('SELECT mail FROM users WHERE id = 3').mail, 'c@x')
    assert.equal(t.all('PRAGMA foreign_key_list(items)').length, 1, 'the foreign key came across')
    t.close()
    const sy = new Database(DB_SYNC)
    const cols = sy.all('PRAGMA table_info(users)').map((c) => c.name).sort()
    assert.deepEqual(cols, ['age', 'id', 'legacy', 'mail', 'nick'], 'users gained the source columns and kept its own')
    assert.equal(sy.get('SELECT count(*) AS n FROM users').n, 1, 'the existing user row survived')
    assert.ok(sy.all("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name).includes('items'), 'missing tables were created')
    sy.close()
  }
  console.log('DATABASE FILE VERIFIED: columns, indexes, data preserved, new table exists')
  console.log('ALL UI TESTS PASSED')
  process.exit(0)
})().catch((e) => { console.error('UI TEST FAILED:', e.message); try { app.kill() } catch {} process.exit(1) })
