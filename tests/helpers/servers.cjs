// Throwaway PostgreSQL / MySQL servers for integration tests. Each start*() creates its own data
// directory in the OS temp folder on a free port (never reading the user's config), and returns
// { target, stop } — or null when the server binaries are not installed.
const { execFileSync, spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const win = process.platform === 'win32'
const exe = (dir, name) => path.join(dir, win ? `${name}.exe` : name)

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

function removeDir(dir) {
  const until = Date.now() + 10000
  while (Date.now() < until) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      if (!fs.existsSync(dir)) return
    } catch {
      /* still locked */
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300)
  }
}

const running = new Set()
process.on('exit', () => [...running].forEach((stop) => stop()))

function findDir(candidates, exeName) {
  return candidates.filter(Boolean).find((d) => fs.existsSync(exe(d, exeName)))
}

// ZIVAR_TEST_SKIP_SERVERS=1 skips the server-backed suites (CI machines where a throwaway server cannot be started).
const skipServers = () => !!process.env.ZIVAR_TEST_SKIP_SERVERS

async function startPg() {
  if (skipServers()) return null
  const bin = findDir([process.env.PG_BIN, 'C:/Program Files/PostgreSQL/17/bin', 'C:/Program Files/PostgreSQL/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin'], 'initdb')
  if (!bin) return null
  const port = await freePort()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zivar-pg-'))
  const data = path.join(root, 'data')
  const log = path.join(root, 'pg.log')
  execFileSync(exe(bin, 'initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-sync'], { stdio: 'pipe' })
  // stdio must be 'ignore': the server inherits pipes and would keep them open, hanging a piped call.
  const started = spawnSync(exe(bin, 'pg_ctl'), ['-D', data, '-l', log, '-w', '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off`, 'start'], { stdio: 'ignore' })
  if (started.status !== 0) throw new Error(`PostgreSQL did not start:\n${fs.existsSync(log) ? fs.readFileSync(log, 'utf8').slice(-1500) : ''}`)
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    running.delete(stop)
    spawnSync(exe(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' })
    removeDir(root)
  }
  running.add(stop)
  return { target: { host: '127.0.0.1', port, user: 'postgres', database: 'postgres' }, stop }
}

async function startMysql() {
  if (skipServers()) return null
  const bin = findDir([process.env.MYSQL_BIN, 'C:/laragon/bin/mysql/mysql-8.0.30-winx64/bin', '/usr/sbin', '/usr/local/mysql/bin'], 'mysqld')
  if (!bin) return null
  const mysql = require('mysql2/promise')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zivar-my-'))
  const data = path.join(root, 'data')
  const log = path.join(root, 'mysqld.log')
  // --no-defaults: never read the user's my.ini, so this instance cannot interfere with theirs.
  execFileSync(exe(bin, 'mysqld'), ['--no-defaults', '--initialize-insecure', `--datadir=${data}`, '--console'], { stdio: 'pipe' })
  const port = await freePort()
  const out = fs.openSync(log, 'a')
  const child = spawn(exe(bin, 'mysqld'), ['--no-defaults', `--datadir=${data}`, `--port=${port}`, '--bind-address=127.0.0.1', '--mysqlx=OFF', '--skip-log-bin', '--innodb-buffer-pool-size=64M', '--console'], { stdio: ['ignore', out, out], windowsHide: true })
  let exited = false
  child.once('exit', () => (exited = true))
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    running.delete(stop)
    try {
      if (win) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
    removeDir(root)
  }
  running.add(stop)
  for (let i = 0; i < 120; i++) {
    if (exited) {
      stop()
      throw new Error(`mysqld exited early:\n${fs.readFileSync(log, 'utf8').slice(-1500)}`)
    }
    try {
      const c = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root' })
      await c.end()
      return { target: { host: '127.0.0.1', port, user: 'root' }, stop }
    } catch {
      await sleep(500)
    }
  }
  stop()
  throw new Error('mysqld did not accept connections')
}

module.exports = { startPg, startMysql, sleep }
