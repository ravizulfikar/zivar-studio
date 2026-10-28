// Takes the screenshots used by the in-app documentation (Help > Documentation) from the real app,
// running against a made-up demo database. Output: src/renderer/src/docs/img/*.png
//   npm run docs:shots
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Database } = require('../node_modules/node-sqlite3-wasm')

const OUT = path.join(__dirname, '..', 'src', 'renderer', 'src', 'docs', 'img')
const SCRATCH = path.join(path.parse(os.tmpdir()).root, 'zivar-demo')
fs.rmSync(SCRATCH, { recursive: true, force: true })
fs.mkdirSync(SCRATCH, { recursive: true })
const PORT = 9344
const W = 1360
const H = 860
let VH = H
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })

// ── demo data: a small coffee shop ──────────────────────────────────────────────────────────────
let seed = 7
const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), (seed >>> 8) % n)
const pick = (a) => a[rnd(a.length)]
const FILES = { shop: path.join(SCRATCH, 'toko-kopi.db'), archive: path.join(SCRATCH, 'arsip.db'), staging: path.join(SCRATCH, 'staging.db') }
{
  const d = new Database(FILES.shop)
  d.run('CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT, city TEXT, joined TEXT, active INTEGER DEFAULT 1)')
  d.run('CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT NOT NULL, name TEXT NOT NULL, category TEXT, price REAL NOT NULL, stock INTEGER DEFAULT 0, attrs TEXT)')
  d.run('CREATE UNIQUE INDEX ux_products_sku ON products (sku)')
  d.run("CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE, ordered_at TEXT NOT NULL, status TEXT DEFAULT 'waiting', total REAL DEFAULT 0)")
  d.run('CREATE INDEX ix_orders_customer ON orders (customer_id)')
  d.run('CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id), qty INTEGER NOT NULL DEFAULT 1, unit_price REAL NOT NULL)')
  const first = ['Budi', 'Siti', 'Andi', 'Dewi', 'Rizky', 'Putri', 'Agus', 'Maya', 'Fajar', 'Lestari', 'Hendra', 'Ayu', 'Bayu', 'Rina', 'Dimas', 'Wulan']
  const last = ['Santoso', 'Wijaya', 'Pratama', 'Kusuma', 'Hidayat', 'Saputra', 'Lestari', 'Nugroho', 'Rahayu', 'Setiawan']
  const cities = ['Jakarta', 'Bandung', 'Surabaya', 'Yogyakarta', 'Medan', 'Makassar', 'Denpasar', 'Semarang']
  for (let i = 0; i < 40; i++) {
    const n = `${first[i % first.length]} ${pick(last)}`
    d.run('INSERT INTO customers (name, email, city, joined, active) VALUES (?, ?, ?, ?, ?)', [n, `${n.toLowerCase().replace(' ', '.')}@contoh.id`, pick(cities), `2025-${String(1 + rnd(12)).padStart(2, '0')}-${String(1 + rnd(28)).padStart(2, '0')}`, rnd(10) ? 1 : 0])
  }
  const products = [
    ['KOP-001', 'Arabika Gayo 250g', 'Biji kopi', 85000, 42, { origin: 'Aceh Gayo', roast: 'medium', notes: ['floral', 'citrus', 'brown sugar'], organic: true, weight_g: 250 }],
    ['KOP-002', 'Arabika Toraja 250g', 'Biji kopi', 92000, 18, { origin: 'Sulawesi Selatan', roast: 'medium-dark', notes: ['dark chocolate', 'spice'], organic: false, weight_g: 250 }],
    ['KOP-003', 'Robusta Lampung 500g', 'Biji kopi', 70000, 75, { origin: 'Lampung', roast: 'dark', notes: ['nutty', 'earthy'], organic: false, weight_g: 500 }],
    ['KOP-004', 'Arabika Kintamani 250g', 'Biji kopi', 88000, 9, { origin: 'Bali Kintamani', roast: 'light', notes: ['orange', 'honey'], organic: true, weight_g: 250 }],
    ['KOP-005', 'Arabika Flores Bajawa 250g', 'Biji kopi', 95000, 30, { origin: 'NTT Flores', roast: 'medium', notes: ['caramel', 'tobacco'], organic: true, weight_g: 250 }],
    ['KOP-006', 'Kopi Luwak Premium 100g', 'Biji kopi', 350000, 5, { origin: 'Jawa', roast: 'medium', notes: ['smooth', 'sweet'], organic: false, weight_g: 100 }],
    ['ALT-001', 'V60 Dripper Keramik', 'Alat seduh', 145000, 25, { material: 'ceramic', size: '02', colors: ['putih', 'hitam'] }],
    ['ALT-002', 'Teko Leher Angsa 600ml', 'Alat seduh', 320000, 14, { material: 'stainless', volume_ml: 600, thermometer: true }],
    ['ALT-003', 'Grinder Manual', 'Alat seduh', 410000, 11, { burr: 'steel conical', adjustable: true, capacity_g: 30 }],
    ['ALT-004', 'French Press 350ml', 'Alat seduh', 185000, 33, { material: 'glass', volume_ml: 350 }],
    ['AKS-001', 'Filter Kertas V60 (100)', 'Aksesori', 38000, 120, { pack: 100, bleached: false }],
    ['AKS-002', 'Timbangan Digital 0,1 g', 'Aksesori', 130000, 7, { max_g: 3000, timer: true, usb: true }],
    ['AKS-003', 'Gelas Takar Kopi', 'Aksesori', 45000, 60, { volume_ml: 250 }],
    ['AKS-004', 'Tote Bag Zivar Coffee', 'Aksesori', 65000, 3, null]
  ]
  for (const p of products) d.run('INSERT INTO products (sku, name, category, price, stock, attrs) VALUES (?, ?, ?, ?, ?, ?)', [p[0], p[1], p[2], p[3], p[4], p[5] ? JSON.stringify(p[5]) : null])
  for (let i = 0; i < 70; i++) {
    const status = pick(['paid', 'paid', 'paid', 'shipped', 'shipped', 'waiting', 'cancelled'])
    d.run('INSERT INTO orders (customer_id, ordered_at, status, total) VALUES (?, ?, ?, 0)', [1 + rnd(40), `2026-${String(1 + rnd(9)).padStart(2, '0')}-${String(1 + rnd(28)).padStart(2, '0')} ${String(8 + rnd(12)).padStart(2, '0')}:${String(rnd(60)).padStart(2, '0')}:00`, status])
    const id = d.get('SELECT last_insert_rowid() AS id').id
    let total = 0
    for (let k = 0; k < 1 + rnd(3); k++) {
      const pid = 1 + rnd(products.length)
      const qty = 1 + rnd(3)
      total += qty * products[pid - 1][3]
      d.run('INSERT INTO order_items (order_id, product_id, qty, unit_price) VALUES (?, ?, ?, ?)', [id, pid, qty, products[pid - 1][3]])
    }
    d.run('UPDATE orders SET total = ? WHERE id = ?', [total, id])
  }
  d.run("CREATE VIEW v_penjualan_per_kota AS SELECT c.city, COUNT(o.id) AS pesanan, SUM(o.total) AS omzet FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.status <> 'cancelled' GROUP BY c.city")
  d.close()
  new Database(FILES.archive).close()
  // staging: an older copy of the structure, to show structure synchronisation
  const s = new Database(FILES.staging)
  s.run('CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT, legacy_code TEXT)')
  s.run("INSERT INTO customers (name, email, legacy_code) VALUES ('Contoh Lama', 'lama@contoh.id', 'L-001')")
  s.run('CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT NOT NULL, name TEXT NOT NULL, price REAL NOT NULL)')
  s.close()
}
const CSV = path.join(SCRATCH, 'pelanggan-baru.csv')
fs.writeFileSync(CSV, 'name;email;city;joined\r\nAnisa Rahma;anisa@contoh.id;Bandung;2026-09-02\r\nJoko Susilo;joko@contoh.id;Semarang;2026-09-10\r\nMelati Putri;melati@contoh.id;Denpasar;2026-09-18\r\n')
const SQLFILE = path.join(SCRATCH, 'promo.sql')
fs.writeFileSync(SQLFILE, "-- Tabel promo akhir tahun\nCREATE TABLE promo (id INTEGER PRIMARY KEY, kode TEXT NOT NULL, diskon INTEGER);\nINSERT INTO promo VALUES (1, 'NATAL25', 25);\nINSERT INTO promo VALUES (2, 'TAHUNBARU', 15);\nUPDATE products SET stock = stock + 10 WHERE category = 'Biji kopi';\n")

// ── drive the app ──────────────────────────────────────────────────────────────────────────────
const UPDATE_PORT = 9347
const fakeGithub = require('node:http').createServer((req, res) => {
  const base = `http://127.0.0.1:${UPDATE_PORT}`
  const asset = (name, size) => ({ name, size, browser_download_url: `${base}/releases/download/v2.0.0/${name}` })
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(
    JSON.stringify({
      tag_name: 'v2.0.0',
      name: 'Zivar Database Studio v2.0.0',
      html_url: `${base}/releases/tag/v2.0.0`,
      published_at: '2027-01-15T08:00:00Z',
      body: "## What's new\n- An example: this is where the notes of a new release are shown.\n- Each change of the release is listed here.\n- Nothing on this screen is a real release.",
      assets: [asset('ZivarDatabaseStudio-Setup-2.0.0.exe', 120400000), asset('ZivarDatabaseStudio-Portable-2.0.0.exe', 120200000), asset('ZivarDatabaseStudio-2.0.0-linux-amd64.deb', 108000000)]
    })
  )
})
fakeGithub.listen(UPDATE_PORT, '127.0.0.1')
const env = { ...process.env, ZIVAR_UPDATE_URL: `http://127.0.0.1:${UPDATE_PORT}/latest` }
delete env.ELECTRON_RUN_AS_NODE
const app = spawn(require('electron'), [path.join(__dirname, '..', 'out/main/index.js'), `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(SCRATCH, 'userdata')}`], { env, stdio: 'ignore' })

let ws
let nextId = 1
const pending = new Map()
const send = (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })) })
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + '\n  in: ' + expression.slice(0, 160))
  return r.result.value
}
const waitFor = async (expr, what, ms = 10000) => {
  const t = Date.now()
  while (Date.now() - t < ms) { try { if (await ev(expr)) return } catch {} await sleep(100) }
  let body = ''
  try { body = await ev("(document.querySelector('.backdrop') || document.body).innerText.slice(0, 700)") } catch {}
  throw new Error('timeout waiting for: ' + what + ' | page text: ' + JSON.stringify(body))
}
const write = (name, data) => {
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
  console.log('  saved', name)
}
const full = async (name) => write(name, (await send('Page.captureScreenshot', { format: 'png' })).data)
/** A screenshot of one element (plus padding), clamped to the window. */
const of = async (name, selector, pad = 0) => {
  const r = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((x) => x.offsetParent !== null || getComputedStyle(x).position === 'fixed').pop(); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } })()`)
  if (!r) throw new Error('no element for ' + selector)
  const x = Math.max(0, r.x - pad)
  const y = Math.max(0, r.y - pad)
  write(name, (await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: Math.min(W - x, r.w + 2 * pad), height: Math.min(VH - y, r.h + 2 * pad), scale: 1 } })).data)
}
const region = async (name, x, y, width, height) => write(name, (await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width, height, scale: 1 } })).data)

const HELPERS = `
  window.__fire = (el, type, init) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...(init || {}) }));
  window.__pane = () => document.querySelector('.pane:not([hidden])');
  window.__byText = (sel, text) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null).find((e) => e.textContent.includes(text));
  window.__btn = (root, text) => { const all = [...root.querySelectorAll('button')]; return all.find((b) => b.textContent.trim() === text) || all.find((b) => b.textContent.includes(text)); };
  window.__setInput = (el, value) => {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  };
  window.confirm = () => true;
`
const click = (js) => ev(`(${js}).click()`)
const tool = (label) => click(`__byText('button.tool', ${JSON.stringify(label)})`)
const sub = (label) => click(`__btn(__pane().querySelector('.subtoolbar'), ${JSON.stringify(label)})`)
const subtab = (label) => click(`[...__pane().querySelectorAll('.subtabs button')].find(b => b.textContent.startsWith(${JSON.stringify(label)}))`)
const menuAt = (selector, label, x = 150, y = 200) => ev(`__fire(__byText('${selector}', ${JSON.stringify(label)}).parentElement, 'contextmenu', { clientX: ${x}, clientY: ${y} })`)
const clickMenu = (label) => click(`[...document.querySelectorAll('.popup-item')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`)
const dismiss = async () => {
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); document.body.click()`)
  await sleep(150)
}
const closeDialog = (text = 'Close') => ev(`(() => { const b = [...document.querySelectorAll('.backdrop button')].find(x => x.textContent.trim() === ${JSON.stringify(text)}) || [...document.querySelectorAll('.backdrop button')].find(x => x.textContent.trim() === 'Cancel'); b.click() })()`)
const view = (w, h) => ((VH = h), send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }))

async function setFile(file) {
  const doc = await send('DOM.getDocument', { depth: -1 })
  const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' })
  await send('DOM.setFileInputFiles', { files: [file], nodeId: node.nodeId })
}

;(async () => {
  let targets
  for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.find((t) => t.type === 'page')) break } catch {} await sleep(250) }
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.onmessage = (m) => { const d = JSON.parse(m.data); const p = pending.get(d.id); if (p) { pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result) } }
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable')
  await view(W, H)
  await waitFor(`typeof window.api === 'object' && document.getElementById('root').children.length > 0`, 'app', 20000)

  const save = (c) => ev(`window.api.saveConnection(${JSON.stringify(c)}).then(r => r.ok)`)
  await save({ id: 't1', name: 'Toko Kopi', kind: 'sqlite', database: FILES.shop })
  await save({ id: 't2', name: 'Arsip', kind: 'sqlite', database: FILES.archive, color: '#2f9e6a' })
  await save({ id: 't3', name: 'Staging', kind: 'sqlite', database: FILES.staging, color: '#e08a1f' })
  const saved = (name, sql) => ev(`window.api.savedSave(${JSON.stringify({ name, sql, connId: 't1', connName: 'Toko Kopi', container: 'main' })}).then(r => r.ok)`)
  await saved('Stok menipis', 'SELECT sku, name, stock FROM products WHERE stock < 15 ORDER BY stock')
  await saved('Omzet per kota', 'SELECT * FROM v_penjualan_per_kota ORDER BY omzet DESC')
  await saved('Pesanan terbaru', 'SELECT * FROM orders ORDER BY ordered_at DESC LIMIT 20')
  await ev(`localStorage.setItem('zivar-theme', 'light'); localStorage.setItem('zivar-update-auto', '0'); location.reload()`)
  await sleep(1500)
  await ev(HELPERS)

  // ── tree ──
  await waitFor(`!!__byText('.node.conn', 'Toko Kopi')`, 'connection node')
  await ev(`__fire(__byText('.node.conn', 'Toko Kopi'), 'dblclick')`)
  await waitFor(`!!__byText('.node .label', 'main')`, 'container')
  await ev(`__fire(__byText('.node .label', 'main').parentElement, 'click')`)
  for (const f of ['Tables', 'Views', 'Queries']) {
    await waitFor(`!!__byText('.node.folder .label', ${JSON.stringify(f)})`, f + ' folder')
    await ev(`__fire(__byText('.node.folder .label', ${JSON.stringify(f)}).parentElement, 'click')`)
  }
  await waitFor(`!!__byText('.node.leaf .label', 'products') && !!__byText('.node.leaf .label', 'Stok menipis')`, 'tables and saved queries listed')
  await ev(`__fire(__byText('.node.leaf .label', 'products').parentElement, 'click')`)
  console.log('tree ready')

  // right-click menu on the database
  await menuAt('.node .label', 'main', 120, 190)
  await waitFor(`!!document.querySelector('.popup.context')`, 'context menu')
  await region('tree-menu', 0, 92, 520, 560)
  await dismiss()

  // sidebar search: tables and saved queries found together
  await ev(`__setInput(document.querySelector('.search input'), 'kota')`)
  await waitFor(`document.querySelectorAll('.sr-item').length >= 2`, 'search results')
  await sleep(300)
  await region('sidebar-search', 0, 92, 302, 440)
  await ev(`__setInput(document.querySelector('.search input'), '')`)
  await waitFor(`!document.querySelector('.sr')`, 'search cleared')

  // ── objects tab ──
  await ev(`__fire(__byText('.node .label', 'main').parentElement, 'dblclick')`)
  await waitFor(`!!__pane().querySelector('table.grid.objects')`, 'objects tab')
  await ev(`__fire([...__pane().querySelectorAll('table.grid.objects tbody tr')].find(r => r.cells[0].textContent.includes('orders')), 'click')`)
  await of('objects-tab', '.main')

  // ── table data ──
  await ev(`__fire(__byText('.node.leaf .label', 'products').parentElement, 'dblclick')`)
  await waitFor(`__pane().querySelectorAll('table.grid tbody tr').length >= 14`, 'products grid')
  await full('overview')
  const whereBox = `__pane().querySelector('.inline-search.wide input')`
  await ev(`__setInput(${whereBox}, 'stock < 40')`)
  await ev(`${whereBox}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
  await waitFor(`__pane().querySelectorAll('table.grid tbody tr').length > 0 && __pane().querySelectorAll('table.grid tbody tr').length < 14`, 'filter applied')
  // one edited cell and one new row, left pending
  await ev(`__fire(__pane().querySelectorAll('table.grid tbody tr')[1].cells[5], 'dblclick')`)
  await waitFor(`!!__pane().querySelector('table.grid td input')`, 'cell editor')
  await ev(`(() => { const i = __pane().querySelector('table.grid td input'); i.focus(); __setInput(i, '98000'); i.blur() })()`)
  await sub('Row')
  await waitFor(`!!__pane().querySelector('table.grid td.dirty')`, 'pending edit shown')
  await of('table-data', '.main')
  await sub('Discard')
  await waitFor(`!__pane().querySelector('table.grid td.dirty')`, 'discarded')
  await ev(`__setInput(${whereBox}, '')`)
  await ev(`${whereBox}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
  await waitFor(`__pane().querySelectorAll('table.grid tbody tr').length >= 14`, 'filter cleared')

  // find & replace
  await sub('Find')
  await waitFor(`!!__pane().querySelector('.find-bar')`, 'find bar')
  await ev(`__setInput(__pane().querySelectorAll('.find-bar input')[0], 'Arabika')`)
  await ev(`__setInput(__pane().querySelectorAll('.find-bar input')[1], 'Arabica')`)
  await waitFor(`/1 \\/ \\d+/.test(__pane().querySelector('.find-bar').textContent)`, 'matches counted')
  await of('find-replace', '.main')
  await sub('Find') // close the bar

  // structured filter, sort and the Text panel
  const vbtn = (label) => click(`[...__pane().querySelectorAll('.view-bar button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(label)}))`)
  const crit = (label) => click(`[...__pane().querySelectorAll('.crit-foot button')].find(b => b.textContent.includes(${JSON.stringify(label)}))`)
  await vbtn('Filter')
  await waitFor(`!!__pane().querySelector('[data-testid=filter-panel] .crit-row')`, 'filter panel')
  await ev(`__setInput(__pane().querySelector('.crit-col'), 'stock'); __setInput(__pane().querySelector('.crit-op'), 'lt')`)
  await ev(`__setInput(__pane().querySelector('.crit-val'), '40')`)
  await crit('Condition')
  await ev(`(() => { const r = __pane().querySelectorAll('.crit-row')[1]; __setInput(r.querySelector('.crit-col'), 'category'); __setInput(r.querySelector('.crit-op'), 'contains') })()`)
  await ev(`__setInput(__pane().querySelectorAll('.crit-row')[1].querySelector('.crit-val'), 'Biji')`)
  await crit('Apply')
  await waitFor(`__pane().querySelectorAll('table.grid tbody tr').length === 4`, 'four rows match both conditions')
  await sleep(300)
  await of('grid-filter', '.main')
  await vbtn('Filter') // close the panel; the filter stays
  await vbtn('Sort')
  await waitFor(`!!__pane().querySelector('[data-testid=sort-panel] .crit-row')`, 'sort panel')
  await ev(`__setInput(__pane().querySelector('[data-testid=sort-panel] .crit-col'), 'category')`)
  await crit('Sort column')
  await ev(`(() => { const r = __pane().querySelectorAll('[data-testid=sort-panel] .crit-row')[1]; __setInput(r.querySelector('.crit-col'), 'price'); __setInput(r.querySelector('.crit-op'), 'desc') })()`)
  await crit('Apply')
  await waitFor(`/category ▲1/.test([...__pane().querySelectorAll('th')].map(t => t.textContent).join('|'))`, 'sorted')
  await sleep(300)
  await of('grid-sort', '.main')
  await crit('Clear') // no sort
  await vbtn('Sort')
  await vbtn('Filter')
  await crit('Clear') // no filter
  await vbtn('Filter')
  await waitFor(`__pane().querySelectorAll('table.grid tbody tr').length >= 14`, 'all rows again')
  await vbtn('Text')
  await waitFor(`!!__pane().querySelector('[data-testid=cell-panel]')`, 'text panel')
  await ev(`__fire(__pane().querySelectorAll('table.grid tbody tr')[0].cells[7], 'click')`)
  await ev(`__setInput(__pane().querySelector('.cell-panel-head select'), 'json')`)
  await waitFor(`!!__pane().querySelector('[data-testid=cell-panel] .jed .jt-row')`, 'json view of the cell')
  await sleep(300)
  await of('grid-text', '.main')
  await vbtn('Text') // close it again

  // cell viewer on the JSON column
  await ev(`__fire(__pane().querySelectorAll('table.grid tbody tr')[0].cells[7], 'contextmenu')`)
  await waitFor(`!!document.querySelector('.cell-viewer .jed')`, 'cell viewer with JSON tree')
  await ev(`__btn(document.querySelector('.cell-viewer'), 'Expand all').click()`)
  await sleep(300)
  await of('cell-viewer', '.cell-viewer', 3)
  await closeDialog('Close')

  // ── SQL editor ──
  await tool('New Query')
  await waitFor(`!!__pane().querySelector('.cm-content')`, 'editor')
  const ctrl = (key, code, vk) => send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key, code, windowsVirtualKeyCode: vk })
  const focusEditor = () => ev(`__pane().querySelector('.cm-content').focus()`)
  await focusEditor()
  // autocomplete first, on an empty editor
  await send('Input.insertText', { text: 'SELECT * FROM cus' })
  await ctrl(' ', 'Space', 32)
  await waitFor(`!!document.querySelector('.cm-tooltip-autocomplete')`, 'autocomplete popup')
  await of('query-autocomplete', '.main')
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await ctrl('a', 'KeyA', 65)
  await send('Input.insertText', { text: "select c.city, count(distinct o.id) as pesanan, sum(o.total) as omzet from orders o join customers c on c.id = o.customer_id where o.status <> 'cancelled' group by c.city order by omzet desc" })
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitFor(`!document.querySelector('.cm-tooltip-autocomplete')`, 'autocomplete closed')
  await sub('Beautify')
  await waitFor(`__pane().querySelectorAll('.cm-line').length > 6`, 'beautified')
  await sub('Run')
  await waitFor(`__pane().querySelectorAll('table.grid tbody tr').length > 0`, 'query results')
  await of('query-editor', '.main')
  await sub('Explain')
  await waitFor(`/SCAN|SEARCH/i.test(__pane().innerText)`, 'explain plan', 15000)
  await of('query-explain', '.main')
  await sub('Snippets')
  await waitFor(`!!document.querySelector('.snippet-popup')`, 'snippet menu')
  await of('query-snippets', '.main')
  await dismiss()
  await sub('History')
  await waitFor(`!!document.querySelector('.backdrop .dialog')`, 'history dialog')
  await of('query-library', '.backdrop .dialog', 3)
  await closeDialog('Close')

  // ── table designer ──
  await ev(`__fire(__byText('.node.leaf .label', 'orders').parentElement, 'click')`)
  await tool('Design')
  await waitFor(`__pane().querySelectorAll('table.designer tbody tr').length >= 5`, 'designer')
  await of('designer-columns', '.main')
  await subtab('Indexes')
  await waitFor(`__pane().querySelectorAll('table.designer tbody tr').length >= 1`, 'indexes')
  await of('designer-indexes', '.main')
  await subtab('Foreign keys')
  await waitFor(`__pane().querySelectorAll('table.designer tbody tr').length >= 1`, 'foreign keys')
  await of('designer-fk', '.main')
  await subtab('Columns')
  await sleep(300)
  await sub('Column')
  await waitFor(`__pane().querySelectorAll('table.designer tbody tr').length >= 6`, 'new column row')
  const rows = `__pane().querySelectorAll('table.designer tbody tr')`
  await ev(`(() => { const r = [...${rows}].pop().querySelectorAll('input'); __setInput(r[0], 'catatan'); __setInput(r[1], 'text') })()`)
  await ev(`__setInput([...${rows}][2].querySelectorAll('input')[0], 'waktu_pesan')`) // rename ordered_at
  await subtab('DDL')
  await waitFor(`!!__pane().querySelector('pre.ddl') && /catatan/.test(__pane().querySelector('pre.ddl').textContent)`, 'DDL preview')
  await of('designer-ddl', '.main')
  await sub('Reset')

  // ── export menu, import dialog ──
  await ev(`__fire(__byText('.node.leaf .label', 'products').parentElement, 'dblclick')`)
  await waitFor(`!!__pane().querySelector('table.grid tbody tr')`, 'products again')
  await ev(`[...document.querySelectorAll('.tab')].find(t => t.textContent.includes('products')).click()`)
  await tool('Export')
  await waitFor(`!!document.querySelector('.popup-item')`, 'export menu')
  const eb = await ev(`(() => { const b = __byText('button.tool', 'Export').getBoundingClientRect(); return { x: b.x, y: b.y } })()`)
  await region('export-menu', Math.max(0, eb.x - 60), eb.y - 6, 330, 250)
  await dismiss()
  await ev(`__fire(__byText('.node.leaf .label', 'customers').parentElement, 'click')`)
  await tool('Import')
  await waitFor(`!!document.querySelector('.import-dialog input[type=file]')`, 'import dialog')
  await setFile(CSV)
  await waitFor(`document.querySelectorAll('.import-dialog .map-wrap select').length >= 4`, 'mapping')
  await sleep(300)
  await of('import-dialog', '.import-dialog', 3)
  await closeDialog('Cancel')

  // ── run SQL file, dump ──
  await menuAt('.node .label', 'main')
  await clickMenu('Run SQL file…')
  await waitFor(`!!document.querySelector('.import-dialog input[type=file]')`, 'script dialog')
  await setFile(SQLFILE)
  await waitFor(`/4 statement\\(s\\)/.test(document.querySelector('.import-dialog').textContent)`, 'script parsed')
  await of('run-script', '.import-dialog', 3)
  await closeDialog('Cancel')
  await menuAt('.node .label', 'main')
  await clickMenu('Dump SQL file…')
  await waitFor(`document.querySelectorAll('.backdrop .dialog input[type=checkbox]').length >= 3`, 'dump dialog')
  await sleep(300)
  await of('dump-dialog', '.backdrop .dialog', 3)
  await closeDialog('Cancel')

  // ── transfer, structure sync ──
  await menuAt('.node .label', 'main')
  await clickMenu('Transfer data to…')
  await waitFor(`document.querySelectorAll('.transfer-dialog .pick-row').length >= 4`, 'transfer dialog')
  await waitFor(`document.querySelectorAll('.transfer-dialog .endpoint')[1].querySelectorAll('select')[1].options.length > 0`, 'target list')
  // Arsip is already the default target; re-selecting it would only clear the database choice.
  await waitFor(`!__btn(document.querySelector('.transfer-dialog'), 'Start').disabled`, 'Start enabled once the target database is chosen')
  await ev(`__btn(document.querySelector('.transfer-dialog'), 'Start').click()`)
  await waitFor(`document.querySelectorAll('.transfer-dialog td.status-ok').length >= 4`, 'transfer finished', 30000)
  await of('transfer', '.transfer-dialog', 3)
  await closeDialog('Close')
  await menuAt('.node .label', 'main')
  await clickMenu('Synchronize structure…')
  await waitFor(`!!document.querySelector('.sync-dialog')`, 'sync dialog')
  await ev(`__setInput(document.querySelectorAll('.sync-dialog .endpoint')[1].querySelector('select'), 't3')`)
  await waitFor(`document.querySelectorAll('.sync-dialog .endpoint')[1].querySelectorAll('select')[1].options.length > 0`, 'sync target database')
  await waitFor(`!__btn(document.querySelector('.sync-dialog'), 'Compare').disabled`, 'Compare enabled')
  await ev(`__btn(document.querySelector('.sync-dialog'), 'Compare').click()`)
  await waitFor(`document.querySelectorAll('.sync-dialog .sync-row').length >= 4`, 'comparison')
  await ev(`[...document.querySelectorAll('.sync-dialog .sync-row')].find(r => r.querySelector('.sync-name').textContent === 'customers').click()`)
  await waitFor(`!!document.querySelector('.sync-dialog pre.ddl') && /ADD COLUMN/.test(document.querySelector('.sync-dialog pre.ddl').textContent)`, 'diff as SQL')
  await of('sync', '.sync-dialog', 3)
  await closeDialog('Close')

  // ── ER diagram ──
  await menuAt('.node .label', 'main')
  await clickMenu('ER diagram')
  await waitFor(`__pane().querySelectorAll('g.er-table').length >= 4`, 'er tables', 20000)
  await sleep(500)
  await sub('Fit')
  await sleep(400)
  {
    const head = await ev(`(() => { const r = __pane().querySelector('g.er-table[data-name="products"] .er-head').getBoundingClientRect(); const o = __pane().querySelector('g.er-table[data-name="orders"] .er-head').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, dx: o.x - r.x, } })()`)
    const tr = () => ev(`__pane().querySelector('g.er-table[data-name="products"]').getAttribute('transform')`)
    console.log('  products before drag:', await tr(), JSON.stringify(head))
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: head.x, y: head.y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: head.x + head.dx, y: head.y + 30, button: 'left' })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: head.x + head.dx, y: head.y + 30, button: 'left', clickCount: 1 })
    console.log('  products after drag:', await tr())
    await sleep(300)
  }
  await of('er-focus', '.main') // the dragged table is selected: its relations stand out
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 340, y: 700, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 340, y: 700, button: 'left', clickCount: 1 })
  await waitFor(`[...__pane().querySelectorAll('g.er-table')].every(g => g.getAttribute('opacity') === '1')`, 'selection cleared')
  await sleep(300)
  await of('er-diagram', '.main')

  // ── JSON editor ──
  await tool('JSON')
  await waitFor(`!!__pane().querySelector('textarea.jed-text')`, 'json tab')
  const doc = { toko: 'Zivar Coffee', buka: { senin_jumat: '08:00–21:00', akhir_pekan: '09:00–22:00' }, cabang: [{ kota: 'Bandung', karyawan: 12, wifi: true }, { kota: 'Yogyakarta', karyawan: 9, wifi: true }, { kota: 'Denpasar', karyawan: 7, wifi: false }], menu_favorit: ['Kopi Susu Gula Aren', 'V60 Gayo', 'Cold Brew'], rating: 4.8, id_gerai: 9007199254740993, promo: null }
  await ev(`(() => { const t = __pane().querySelector('textarea.jed-text'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(JSON.stringify(doc, null, 2).replace('9007199254740992', '9007199254740993'))}); t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await waitFor(`__pane().querySelectorAll('.jt-row').length >= 8`, 'tree')
  await ev(`__btn(__pane().querySelector('.jed-bar'), 'Expand all').click()`)
  await ev(`__setInput(__pane().querySelector('.jed-search'), 'kota')`)
  await waitFor(`/1 \\/ 3/.test(__pane().querySelector('.jed-bar').textContent)`, 'search hits')
  await sleep(300)
  await of('json-editor', '.main')

  // ── connection dialog (taller window so the whole dialog fits) ──
  await view(W, 1260)
  await tool('Connection')
  await waitFor(`!!document.querySelector('.backdrop .dialog select')`, 'connection dialog')
  const dlg = `document.querySelector('.backdrop .dialog')`
  const field = (label) => `[...${dlg}.querySelectorAll('label')].find(l => l.firstChild && l.firstChild.textContent.trim().startsWith(${JSON.stringify(label)})).querySelector('input')`
  await ev(`__setInput(${dlg}.querySelector('select'), 'postgres')`)
  await ev(`__setInput(${field('Name')}, 'Server Produksi')`)
  await ev(`__setInput(${field('Group')}, 'Perusahaan')`)
  await ev(`__setInput(${field('Host')}, 'db.contoh.id')`)
  await ev(`__setInput(${field('User')}, 'aplikasi')`)
  await ev(`__setInput(${field('Database')}, 'penjualan')`)
  await sleep(200)
  await of('connection-dialog', '.backdrop .dialog', 3)
  await ev(`${dlg}.querySelectorAll('input[type=checkbox]')[1].click()`)
  await waitFor(`!!${dlg}.querySelector('fieldset.ssh')`, 'ssh section')
  await ev(`__setInput(${field('SSH host')}, 'bastion.contoh.id')`)
  await ev(`__setInput(${field('SSH user')}, 'deploy')`)
  await ev(`__setInput(${dlg}.querySelector('fieldset.ssh select'), 'key')`)
  await sleep(200)
  await of('connection-ssh', '.backdrop .dialog', 3)
  await closeDialog('Cancel')
  await view(W, H)

  // ── dark mode ──
  await ev(`__byText('button.tool', 'Dark').click()`)
  await waitFor(`document.documentElement.dataset.theme === 'dark'`, 'dark theme')
  await ev(`[...document.querySelectorAll('.tab')].find(t => t.textContent.includes('products')).click()`)
  await sleep(500)
  await full('dark-mode')
  await ev(`__byText('button.tool', 'Light').click()`)

  // check for updates (against the pretend GitHub above)
  await ev(`[...document.querySelectorAll('.menu-btn')].find(b => b.textContent === 'Help').click()`)
  await waitFor(`[...document.querySelectorAll('.popup-item')].some(b => b.textContent.includes('Check for updates…'))`, 'Help menu')
  await ev(`[...document.querySelectorAll('.popup-item')].find(b => b.textContent.includes('Check for updates…')).click()`)
  await waitFor(`/is available/.test(document.querySelector('.update-dialog')?.textContent ?? '')`, 'update dialog', 15000)
  await sleep(300)
  await of('update-dialog', '.update-dialog', 3)
  await closeDialog('Close')

  ws.close()
  app.kill()
  await sleep(800)
  fs.rmSync(SCRATCH, { recursive: true, force: true })
  console.log('DONE ->', OUT)
  fakeGithub.close()
  process.exit(0)
})().catch((e) => {
  console.error('SHOTS FAILED:', e.message)
  try { app.kill() } catch {}
  setTimeout(() => { fs.rmSync(SCRATCH, { recursive: true, force: true }); process.exit(1) }, 800)
})
