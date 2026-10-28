// "Check for updates" in the real app, against a small local server that plays GitHub (the app is pointed at it with
// ZIVAR_UPDATE_URL). Nothing here touches the internet or the user's real profile.
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const VERSION = require('../package.json').version
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zivar-upd-'))
let port = 9410

// ── a pretend GitHub ──
let mode = 'newer'
const hits = []
let origin = ''
const asset = (name) => ({ name, browser_download_url: `${origin}/releases/download/v99.0.0/${name}`, size: 123456789 })
const ANSWERS = {
  newer: () => ({
    tag_name: 'v99.0.0',
    name: 'Zivar Database Studio v99.0.0',
    html_url: `${origin}/releases/tag/v99.0.0`,
    body: '## What is new\n- the first thing\n- the second thing',
    published_at: '2030-01-02T03:04:05Z',
    assets: ['ZivarDatabaseStudio-Setup-99.0.0.exe', 'ZivarDatabaseStudio-Portable-99.0.0.exe', 'ZivarDatabaseStudio-99.0.0-linux-amd64.deb', 'ZivarDatabaseStudio-99.0.0-linux-x86_64.rpm', 'ZivarDatabaseStudio-99.0.0-linux-x86_64.AppImage', 'SHA256SUMS.txt'].map(asset)
  }),
  same: () => ({ tag_name: `v${VERSION}`, name: `v${VERSION}`, html_url: `${origin}/releases/tag/v${VERSION}`, body: '', published_at: '2026-01-01T00:00:00Z', assets: [] }),
  // a release whose links lead elsewhere: none of them may become a button
  evil: () => ({ tag_name: 'v99.0.0', name: 'v99', html_url: 'https://evil.example/x', body: 'x', published_at: null, assets: [{ name: 'ZivarDatabaseStudio-Setup-99.0.0.exe', browser_download_url: 'https://evil.example/setup.exe', size: 1 }] })
}
const server = http.createServer((req, res) => {
  hits.push({ url: req.url, ua: req.headers['user-agent'], accept: req.headers['accept'] })
  if (mode === 'error500') return (res.writeHead(500), res.end('boom'))
  if (mode === 'limited') return (res.writeHead(403, { 'x-ratelimit-remaining': '0' }), res.end('{"message":"API rate limit exceeded"}'))
  if (mode === 'garbage') return (res.writeHead(200, { 'content-type': 'application/json' }), res.end('<html>not json'))
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(ANSWERS[mode]()))
})

/** Starts the app with a throwaway profile; returns helpers to drive its window. */
async function launch(extraEnv) {
  const p = port++
  const env = { ...process.env, ...extraEnv }
  delete env.ELECTRON_RUN_AS_NODE
  const dir = fs.mkdtempSync(path.join(root, 'profile-'))
  const app = spawn(require('electron'), [path.join(__dirname, '..', 'out/main/index.js'), `--remote-debugging-port=${p}`, `--user-data-dir=${dir}`], { env, stdio: 'ignore' })
  let target
  for (let i = 0; i < 120 && !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${p}/json`)).json()).find((t) => t.type === 'page' && !t.url.startsWith('data:'))
    } catch {}
    if (!target) await sleep(250)
  }
  assert.ok(target, 'the app opened a window')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 1
  const pending = new Map()
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    const q = pending.get(d.id)
    if (q) (pending.delete(d.id), d.error ? q.rej(new Error(d.error.message)) : q.res(d.result))
  }
  const send = (method, params = {}) => new Promise((res, rej) => ((pending.set(id, { res, rej }), ws.send(JSON.stringify({ id: id++, method, params })))))
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }
  const waitFor = async (expr, what, ms = 12000) => {
    const t = Date.now()
    while (Date.now() - t < ms) {
      try {
        if (await ev(expr)) return
      } catch {}
      await sleep(120)
    }
    const text = await ev('document.body.innerText.slice(0, 500)').catch(() => '')
    assert.fail(`timeout waiting for: ${what} | page: ${JSON.stringify(text)}`)
  }
  for (let i = 0; i < 100 && !(await ev(`typeof window.api === 'object' && !!document.querySelector('.menubar')`).catch(() => false)); i++) await sleep(150)
  const stop = async () => {
    try { ws.close() } catch {}
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
    else app.kill('SIGKILL')
    await sleep(600)
  }
  return { ev, waitFor, stop }
}

/** Removes the throwaway folder; Windows releases the files of a killed app a moment late, so try again before giving up (a leftover temp folder must not fail a test). */
async function cleanup(dir) {
  for (let i = 0; i < 20; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}

;(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  origin = `http://127.0.0.1:${server.address().port}`
  const env = { ZIVAR_UPDATE_URL: `${origin}/latest` }
  const dialog = `document.querySelector('.update-dialog')`
  const button = (label) => `[...document.querySelectorAll('.update-dialog button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`

  // ── 1) the automatic check on start-up: a note in the status bar ──
  let a = await launch(env)
  try {
    assert.equal(hits.length, 0, 'nothing is asked before the app has been up for a moment')
    await a.waitFor(`!!document.querySelector('.update-chip')`, 'the status-bar note about the new version', 20000)
    assert.match(await a.ev(`document.querySelector('.update-chip').textContent`), /99\.0\.0/)
    assert.equal(hits.length, 1, 'exactly one request')
    assert.equal(hits[0].url, '/latest')
    assert.equal(hits[0].ua, `ZivarDatabaseStudio/${VERSION}`, 'it says only which program and version it is')
    assert.match(hits[0].accept, /github/)
    console.log('automatic check: one quiet request, a note in the status bar OK')

    // ── 2) the dialog behind the note ──
    await a.ev(`document.querySelector('.update-chip').click()`)
    await a.waitFor(`!!${dialog}`, 'the update dialog')
    assert.match(await a.ev(`${dialog}.textContent`), /Version 99\.0\.0 is available/)
    assert.match(await a.ev(`${dialog}.querySelector('.update-notes').textContent`), /the first thing[\s\S]*the second thing/, 'the release notes')
    assert.match(await a.ev(`${dialog}.textContent`), new RegExp(`Installed: version ${VERSION.replace(/\./g, '\\.')}`))
    assert.equal(hits.length, 1, 'opening the dialog from the note does not ask again')
    const offered = await a.ev(`${dialog}.querySelector('.small-note').textContent`)
    if (process.platform === 'win32') assert.match(offered, /Setup-99\.0\.0\.exe/, 'the installer for Windows is the one offered')
    else assert.match(offered, /99\.0\.0/)
    assert.ok(await a.ev(`!!${button('Download')}`), 'a Download button')
    // the buttons ask the main process to open the link (captured here: no browser is started)
    await a.ev(`window.__opened = []; window.open = (u) => { window.__opened.push(u); return null }`)
    await a.ev(`${button('Download')}.click(); ${button('Release page')}.click()`)
    const opened = await a.ev(`window.__opened`)
    assert.equal(opened[1], `${origin}/releases/tag/v99.0.0`, 'Release page leads to the release')
    assert.ok(opened[0].startsWith(`${origin}/releases/download/v99.0.0/`), 'Download leads to a file of the release')
    console.log('dialog: version, notes, the right file for this system, buttons OK')

    // ── 3) every way a check can end ──
    const again = async (m, expectation, what) => {
      mode = m
      await a.ev(`${button('Check again')}.click()`)
      await a.waitFor(`/${expectation}/.test(${dialog}.textContent)`, what)
    }
    await again('same', 'You have the latest version', 'up to date')
    await a.waitFor(`!document.querySelector('.update-chip')`, 'the note disappears when there is nothing newer')
    assert.ok(await a.ev(`!${button('Download')}`), 'no Download button when up to date')
    await again('error500', 'HTTP 500', 'a server error')
    assert.ok(await a.ev(`!!${dialog}.querySelector('.msg.error')`), 'shown as an error')
    await again('limited', 'limiting requests', 'rate limiting')
    await again('garbage', 'could not be understood', 'an answer that is not JSON')
    await again('evil', 'no file for your system', 'links that lead out of the repository are dropped')
    assert.ok(await a.ev(`!${button('Download')}`), 'and so no Download button for them')
    assert.equal(await a.ev(`${button('Release page')}.click() || window.__opened.at(-1)`), 'https://github.com/ravizulfikar/zivar-studio/releases', 'a release page outside the repository is replaced by the real one')
    mode = 'newer'
    await again('newer', '99\\.0\\.0 is available', 'back to a new version')
    server.closeAllConnections?.()
    await new Promise((r) => server.close(r))
    await a.ev(`${button('Check again')}.click()`)
    await a.waitFor(`/Could not reach GitHub/.test(${dialog}.textContent)`, 'a server that cannot be reached')
    console.log('outcomes: up to date, server error, rate limit, garbage, hostile links, unreachable OK')
    await a.ev(`${button('Close')}.click()`)
    await a.waitFor(`!${dialog}`, 'the dialog closes')

    // ── 4) the menu, and the switch ──
    await a.ev(`[...document.querySelectorAll('.menu-btn')].find(b => b.textContent === 'Help').click()`)
    await a.waitFor(`[...document.querySelectorAll('.popup-item')].some(b => b.textContent.includes('Check for updates…'))`, 'Check for updates… in the Help menu')
    assert.ok(await a.ev(`[...document.querySelectorAll('.popup-item')].some(b => b.textContent.includes('✓') && b.textContent.includes('Check for updates automatically'))`), 'the automatic check is on by default (ticked)')
    await a.ev(`[...document.querySelectorAll('.popup-item')].find(b => b.textContent.includes('Check for updates automatically')).click()`)
    assert.equal(await a.ev(`localStorage.getItem('zivar-update-auto')`), '0', 'switched off, and remembered')
    console.log('menu: check on demand, automatic check can be switched off OK')
  } finally {
    await a.stop()
  }

  // ── 5) switched off: it never asks ──
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  origin = `http://127.0.0.1:${server.address().port}`
  mode = 'newer'
  hits.length = 0
  a = await launch({ ZIVAR_UPDATE_URL: `${origin}/latest` })
  try {
    await a.ev(`localStorage.setItem('zivar-update-auto', '0'); location.reload()`)
    await sleep(9500) // longer than the start-up delay of the automatic check
    assert.equal(hits.length, 0, 'with the automatic check switched off nothing is asked')
    assert.ok(await a.ev(`!document.querySelector('.update-chip')`))
    console.log('switched off: no request OK')
  } finally {
    await a.stop()
  }

  // ── 6) a debugger-driven app (every other test) must not reach out by itself ──
  a = await launch({}) // no ZIVAR_UPDATE_URL: the real endpoint would be GitHub
  try {
    const r = JSON.parse(await a.ev(`window.api.checkForUpdates(true).then(r => JSON.stringify(r))`))
    assert.equal(r.ok, true)
    assert.equal(r.data.ok, false)
    assert.match(r.data.error, /driven by a debugger/, 'the automatic check refuses while the app is automated')
    console.log('automated app: the automatic check stays off OK')
  } finally {
    await a.stop()
  }
  console.log('ALL UPDATE E2E TESTS PASSED')
})()
  .then(async () => (await cleanup(root), process.exit(0)))
  .catch(async (e) => {
    console.error('UPDATE E2E FAILED:', e.message)
    await cleanup(root)
    process.exit(1)
  })
