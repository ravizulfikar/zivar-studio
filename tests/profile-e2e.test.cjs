// The renamed app finds the data of an older build, including connections whose passwords are encrypted
// with the profile's own key. Runs the real app twice against a throwaway %APPDATA% folder (ZIVAR_APPDATA_DIR).
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// The real profile must stay untouched: remember its state, and check it again at the end.
const realProfile = path.join(process.env.APPDATA || '', 'zivar-navicat')
const snapshot = () => ['connections.json', 'saved-queries.json', 'history.json'].map((f) => { try { return fs.readFileSync(path.join(realProfile, f), 'utf8') } catch { return null } })
const before = snapshot()
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zivar-profile-'))
const env = (appdata) => {
  const e = { ...process.env, APPDATA: appdata, ZIVAR_APPDATA_DIR: appdata }
  delete e.ELECTRON_RUN_AS_NODE
  return e
}
let port = 9370

/** Starts the app with the given APPDATA (and optional --user-data-dir), runs fn(ev), closes it. */
async function withApp({ appdata, userDataDir }, fn) {
  const p = port++
  const args = [path.join(__dirname, '..', 'out/main/index.js'), `--remote-debugging-port=${p}`]
  if (userDataDir) args.push(`--user-data-dir=${userDataDir}`)
  const app = spawn(require('electron'), args, { env: env(appdata), stdio: 'ignore' })
  let ws
  let id = 1
  const pending = new Map()
  let ev0 = null
  try {
    let targets
    for (let i = 0; i < 80; i++) {
      try {
        targets = await (await fetch(`http://127.0.0.1:${p}/json`)).json()
        if (targets.find((t) => t.type === 'page')) break
      } catch {}
      await sleep(250)
    }
    ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
    await new Promise((r) => (ws.onopen = r))
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
    ev0 = ev
    for (let i = 0; i < 100 && !(await ev(`typeof window.api === 'object'`).catch(() => false)); i++) await sleep(150)
    return await fn(ev)
  } finally {
    // close the window like a user would, so the profile (including its encryption key) is flushed to disk
    const exited = new Promise((r) => app.once('exit', r))
    try { await Promise.race([sleep(500), ws && ev0('window.close()').catch(() => {})]) } catch {}
    await Promise.race([exited, sleep(15000)])
    try { ws?.close() } catch {}
    spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
    await sleep(500)
  }
}

;(async () => {
  const SECRET = 's3cret-ñ-密码'
  const conn = { id: 'c1', name: 'Old server', kind: 'postgres', host: 'db.example.test', port: 5432, user: 'app', password: SECRET, database: 'main' }

  // 1) an "old build": its data folder is %APPDATA%\zivar-navicat
  const appdata = path.join(root, 'roaming')
  const legacyDir = path.join(appdata, 'zivar-navicat')
  fs.mkdirSync(legacyDir, { recursive: true })
  await withApp({ appdata, userDataDir: legacyDir }, async (ev) => {
    assert.equal(await ev(`window.api.saveConnection(${JSON.stringify(conn)}).then(r => r.ok)`), true)
    assert.equal(await ev(`window.api.savedSave(${JSON.stringify({ name: 'Old query', sql: 'select 1', connId: 'c1', connName: 'Old server', container: null })}).then(r => r.ok)`), true)
  })
  assert.ok(fs.existsSync(path.join(legacyDir, 'connections.json')) && fs.existsSync(path.join(legacyDir, 'Local State')), 'the old profile holds the connection and its encryption key; found: ' + fs.readdirSync(legacyDir).join(', '))
  assert.ok(!fs.readFileSync(path.join(legacyDir, 'connections.json'), 'utf8').includes(SECRET), 'the password is not stored in plain text')

  // 2) the renamed app, started the normal way, picks that folder up and can still decrypt the password
  await withApp({ appdata }, async (ev) => {
    const list = JSON.parse(await ev(`window.api.listConnections().then(r => JSON.stringify(r))`))
    assert.equal(list.ok, true, JSON.stringify(list))
    assert.equal(list.data.length, 1, 'the saved connection is there')
    assert.equal(list.data[0].name, 'Old server')
    assert.equal(list.data[0].password, SECRET, 'the encrypted password still decrypts')
    const saved = JSON.parse(await ev(`window.api.savedList().then(r => JSON.stringify(r))`))
    assert.deepEqual(saved.data.map((q) => q.name), ['Old query'], 'saved queries are there')
  })
  for (const name of ['zivar-studio', 'Zivar Studio', 'zivar-database-studio', 'Zivar Database Studio']) assert.ok(!fs.existsSync(path.join(appdata, name, 'connections.json')), `no second profile (${name}) was started`)
  console.log('upgrade: connections, encrypted password and saved queries carried over OK')

  // (A fresh install, with no old folder anywhere, keeps the default folder: covered by profile.test.cjs. It is not run
  // here because without --user-data-dir the app would write into the real %APPDATA%.)
  assert.deepEqual(snapshot(), before, "the user's real profile was not touched")
  console.log('ALL PROFILE E2E TESTS PASSED')
})()
  .then(() => (fs.rmSync(root, { recursive: true, force: true }), process.exit(0)))
  .catch((e) => {
    console.error('PROFILE E2E FAILED:', e.message)
    if (process.env.KEEP) console.error('kept:', root); else try { fs.rmSync(root, { recursive: true, force: true }) } catch {}
    process.exit(1)
  })
