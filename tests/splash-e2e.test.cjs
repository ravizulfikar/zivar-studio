// The real app, started with the splash: it appears, it is animated, the main window stays hidden until it is done,
// and then the window shows. And without the splash (how every other test starts the app) nothing changes.
//   SPLASH_SHOTS_DIR=<folder> node tests/splash-e2e.test.cjs   also saves frames of the animation there
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const VERSION = require('../package.json').version
const SPLASH_TITLE = 'Zivar Database Studio — starting'
const MIN_MS = 6000
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zivar-splash-'))
const shotsDir = process.env.SPLASH_SHOTS_DIR
let port = 9390

/** Starts the app with a throwaway profile (never the real one) and returns helpers to look at its windows. */
function launch(extraEnv) {
  const p = port++
  const env = { ...process.env, ...extraEnv }
  delete env.ELECTRON_RUN_AS_NODE
  const dir = fs.mkdtempSync(path.join(root, 'profile-'))
  const app = spawn(require('electron'), [path.join(__dirname, '..', 'out/main/index.js'), `--remote-debugging-port=${p}`, `--user-data-dir=${dir}`], { env, stdio: 'ignore' })
  const targets = async () => {
    try {
      return (await (await fetch(`http://127.0.0.1:${p}/json`)).json()).filter((t) => t.type === 'page')
    } catch {
      return []
    }
  }
  /** Runs fn(ev, send) against one window. */
  const on = async (target, fn) => {
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
    try {
      return await fn(ev, send)
    } finally {
      ws.close()
    }
  }
  const stop = async () => {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
    else app.kill('SIGKILL')
    await sleep(600)
  }
  return { pid: app.pid, targets, on, stop }
}

/**
 * The title of the window the user can actually see, asked of the operating system (Windows only; null elsewhere).
 * document.visibilityState cannot tell: Electron reports a window that was never shown as "visible" too.
 */
function visibleWindowTitle(pid) {
  if (process.platform !== 'win32') return null
  return spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).MainWindowTitle`], { encoding: 'utf8' }).stdout.trim()
}
async function waitForVisibleTitle(pid, wanted, what) {
  if (process.platform !== 'win32') return
  let last = ''
  for (let i = 0; i < 60; i++) {
    last = visibleWindowTitle(pid)
    if (wanted(last)) return
    await sleep(150)
  }
  assert.fail(`${what} (the visible window was "${last}")`)
}
const isSplash = (t) => t.title === SPLASH_TITLE
const isMain = (t) => !t.url.startsWith('data:') && t.title !== SPLASH_TITLE

;(async () => {
  // ── 1) with the splash ──
  {
    const app = launch({ ZIVAR_SPLASH: '1', ZIVAR_SPLASH_MIN_MS: String(MIN_MS) })
    try {
      let splash
      let main
      let seenAt = 0
      for (let i = 0; i < 120 && !splash; i++) {
        const ts = await app.targets()
        splash = ts.find(isSplash)
        main = ts.find(isMain)
        if (!splash) await sleep(100)
      }
      assert.ok(splash, 'the splash window opened')
      seenAt = Date.now()
      console.log('splash seen after start-up')

      // what it shows, and that it is animated
      await app.on(splash, async (ev, send) => {
        assert.equal(await ev(`document.querySelector('h1').textContent`), 'Zivar Database Studio')
        assert.equal(await ev(`document.querySelector('.ver').textContent`), `Version ${VERSION}`)
        assert.ok((await ev(`document.getAnimations().length`)) >= 8, 'many animations are running')
        assert.ok(await ev(`document.getAnimations().some(a => a.animationName === 'draw')`), 'the Z draws itself')
        assert.ok(await ev(`document.getAnimations().some(a => a.animationName === 'slide')`), 'the loading bar slides')
        if (shotsDir) {
          fs.mkdirSync(shotsDir, { recursive: true })
          for (const [i, at] of [300, 900, 1700, 3200].entries()) {
            await sleep(Math.max(0, seenAt + at - Date.now()))
            fs.writeFileSync(path.join(shotsDir, `splash-${i + 1}-${at}ms.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
          }
        }
      })

      // the main window is loading, but hidden
      for (let i = 0; i < 100 && !main; i++) {
        await sleep(100)
        main = (await app.targets()).find(isMain)
      }
      assert.ok(main, 'the main window page exists')
      await waitForVisibleTitle(app.pid, (t) => t.endsWith('starting'), 'only the splash is visible while the app loads') // (the console turns the dash of its title into a hyphen: match on the last word)

      // later in the animation the Z is fully drawn and the nodes are in place
      await sleep(Math.max(0, seenAt + 2800 - Date.now()))
      assert.ok((await app.targets()).some(isSplash), 'the splash is still up for its minimum time')
      await app.on((await app.targets()).find(isSplash), async (ev) => {
        assert.ok(Number.parseFloat(await ev(`getComputedStyle(document.querySelector('.z')).strokeDashoffset`)) < 0.01, 'the Z is completely drawn')
        assert.equal(await ev(`new DOMMatrix(getComputedStyle(document.querySelector('.n2')).transform).a`), 1, 'the second node has popped into place')
      })

      // it leaves after its minimum time, and then the window is shown
      let gone = false
      for (let i = 0; i < 200 && !gone; i++) {
        gone = !(await app.targets()).some(isSplash)
        if (!gone) await sleep(100)
      }
      const shownFor = Date.now() - seenAt
      assert.ok(gone, 'the splash closed')
      assert.ok(shownFor >= MIN_MS - 1500, `it stayed for its minimum time (about ${shownFor} ms after first seen)`)
      main = (await app.targets()).find(isMain)
      await waitForVisibleTitle(app.pid, (t) => t === 'Zivar Database Studio', 'the main window is shown once the splash is gone')
      await app.on(main, async (ev) => {
        assert.equal(await ev(`document.title`), 'Zivar Database Studio')
        assert.ok(await ev(`typeof window.api === 'object' && document.getElementById('root').children.length > 0`), 'and the app is loaded')
      })
      console.log('with splash: appears, animates, keeps the window hidden for its minimum time, then hands over OK')
    } finally {
      await app.stop()
    }
  }

  // ── 2) the way tests start the app: no splash, window shown straight away ──
  {
    const app = launch({})
    try {
      let main
      for (let i = 0; i < 120 && !main; i++) {
        main = (await app.targets()).find(isMain)
        if (!main) await sleep(100)
      }
      assert.ok(main, 'the window opened')
      await waitForVisibleTitle(app.pid, (t) => t === 'Zivar Database Studio', 'the window is shown straight away, without any splash')
      assert.ok(!(await app.targets()).some(isSplash), 'no splash when the app is driven by a debugger')
      console.log('without splash (automated start): nothing changes OK')
    } finally {
      await app.stop()
    }
  }
  console.log('ALL SPLASH E2E TESTS PASSED')
})()
  .then(() => (fs.rmSync(root, { recursive: true, force: true }), process.exit(0)))
  .catch((e) => {
    console.error('SPLASH E2E FAILED:', e.message)
    try { fs.rmSync(root, { recursive: true, force: true }) } catch {}
    process.exit(1)
  })
