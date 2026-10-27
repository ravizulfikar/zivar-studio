// Smoke test for a PACKAGED app (the unpacked folder electron-builder produces): it must start, show the
// window title, render the built-in manual with all its screenshots, and show the right About box.
//   node tests/packaged-smoke.cjs <path to the executable> <expected version> <expected product name>
// On Linux, run it under a virtual display:  xvfb-run -a node tests/packaged-smoke.cjs ...
// ZIVAR_SPLASH=1 makes the app show its splash first, so the packaged splash path is exercised too.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

const [exe, version, name] = process.argv.slice(2)
if (!exe || !version || !name) {
  console.error('usage: node tests/packaged-smoke.cjs <executable> <version> <product name>')
  process.exit(2)
}
const PORT = 9355
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zivar-pkg-'))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
// --user-data-dir: this run must never touch a real profile.
// --no-sandbox on Linux: a freshly unpacked build has no setuid sandbox helper, and CI machines restrict user namespaces.
const args = [`--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])]
const app = spawn(exe, args, { env, stdio: 'ignore' })
let failedToStart = null
app.once('error', (e) => (failedToStart = e))

let ws
let id = 1
const pending = new Map()
const send = (method, params = {}) => new Promise((res, rej) => { const i = id++; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}
const waitFor = async (expr, what, ms = 20000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    try { if (await ev(expr)) return } catch {}
    await sleep(150)
  }
  throw new Error('timeout waiting for: ' + what)
}

;(async () => {
  let targets
  for (let i = 0; i < 120; i++) {
    if (failedToStart) throw failedToStart
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      if (targets.find((t) => t.type === 'page' && !t.url.startsWith('data:'))) break // not the splash page
    } catch {}
    await sleep(250)
  }
  if (!targets) throw new Error('the app did not open a window')
  ws = new WebSocket(targets.find((t) => t.type === 'page' && !t.url.startsWith('data:')).webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.onmessage = (m) => { const d = JSON.parse(m.data); const p = pending.get(d.id); if (p) { pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result) } }
  await send('Runtime.enable')
  await waitFor(`typeof window.api === 'object' && document.getElementById('root').children.length > 0`, 'the UI to load')
  assert.equal(await ev('document.title'), name, 'window title')

  const help = async (label) => {
    await ev(`[...document.querySelectorAll('.menu-btn')].find(b => b.textContent === 'Help').click()`)
    await waitFor(`!![...document.querySelectorAll('.popup-item')].find(b => b.textContent.includes(${JSON.stringify(label)}))`, 'menu item ' + label)
    await ev(`[...document.querySelectorAll('.popup-item')].find(b => b.textContent.includes(${JSON.stringify(label)})).click()`)
  }
  await help('Documentation')
  await waitFor(`!!document.querySelector('.docs')`, 'the manual')
  const shots = await ev(`(() => { const l = [...document.querySelectorAll('.docs img')]; l.forEach((i) => (i.loading = 'eager')); return l.length })()`)
  await waitFor(`[...document.querySelectorAll('.docs img')].every((i) => i.complete && i.naturalWidth > 100)`, 'every screenshot to decode')
  assert.ok(shots >= 20, `the manual has its screenshots (${shots})`)
  assert.match(await ev(`document.querySelector('.docs').innerText`), new RegExp(name), 'the manual uses the product name')

  await help('About ' + name)
  await waitFor(`!!document.querySelector('.about')`, 'the About box')
  const about = await ev(`document.querySelector('.about').innerText`)
  assert.ok(about.includes(name), 'About shows the name')
  assert.ok(about.includes('Version ' + version), 'About shows the version: ' + JSON.stringify(about))
  assert.ok(about.includes('zivar.my.id'), 'About shows the website')
  console.log(`PACKAGED APP OK (${process.platform}): "${await ev('document.title')}", ${shots} screenshots decoded, About = ${JSON.stringify(about.replace(/\n+/g, ' | '))}`)
})()
  .then(() => finish(0))
  .catch((e) => { console.error('PACKAGED SMOKE FAILED:', e.message); finish(1) })

function finish(code) {
  try { ws?.close() } catch {}
  try { app.kill() } catch {}
  setTimeout(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
    process.exit(code)
  }, 1000)
}
