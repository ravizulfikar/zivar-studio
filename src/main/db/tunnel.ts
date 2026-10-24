import { app } from 'electron'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { join } from 'node:path'
import { Client } from 'ssh2'
import type {
  ColumnInfo,
  ConnectionConfig,
  DbObject,
  QueryResult,
  RowChange,
  SshConfig,
  TableDataOptions,
  TableDataResult,
  TableDesign
} from '@shared/types'
import type { Driver, InsertOptions } from './driver'

const knownHostsFile = (): string => join(app.getPath('userData'), 'known_hosts.json')

function readKnownHosts(): Record<string, string> {
  return existsSync(knownHostsFile()) ? (JSON.parse(readFileSync(knownHostsFile(), 'utf8')) as Record<string, string>) : {}
}

interface Tunnel {
  localPort: number
  close(): Promise<void>
}

/**
 * Open an SSH connection and a loopback listener that forwards to dstHost:dstPort
 * through it. Host keys are pinned on first use; a changed key aborts the connection.
 */
async function openTunnel(ssh: SshConfig, dstHost: string, dstPort: number): Promise<Tunnel> {
  const conn = new Client()
  const id = `${ssh.host}:${ssh.port}`
  let hostKeyError: string | null = null

  await new Promise<void>((resolve, reject) => {
    conn.once('ready', resolve)
    conn.once('error', (e) => reject(hostKeyError ? new Error(hostKeyError) : e))
    conn.connect({
      host: ssh.host,
      port: ssh.port,
      username: ssh.user,
      password: ssh.authType === 'password' ? ssh.password : undefined,
      privateKey: ssh.authType === 'key' && ssh.keyPath ? readFileSync(ssh.keyPath) : undefined,
      passphrase: ssh.authType === 'key' ? ssh.passphrase : undefined,
      readyTimeout: 15000,
      hostHash: 'sha256',
      hostVerifier: (fingerprint: string) => {
        const known = readKnownHosts()
        if (!known[id]) {
          writeFileSync(knownHostsFile(), JSON.stringify({ ...known, [id]: fingerprint }, null, 2))
          return true
        }
        if (known[id] === fingerprint) return true
        hostKeyError = `SSH host key for ${id} has CHANGED (expected sha256:${known[id].slice(0, 16)}…, got ${fingerprint.slice(0, 16)}…). Refusing to connect — this could be a man-in-the-middle attack. If the server was reinstalled, remove its entry from known_hosts.json in the app data folder.`
        return false
      }
    })
  })

  const server: Server = createServer((sock) => {
    conn.forwardOut('127.0.0.1', 0, dstHost, dstPort, (err, stream) => {
      if (err) return void sock.destroy()
      sock.on('error', () => stream.destroy())
      stream.on('error', () => sock.destroy())
      sock.pipe(stream).pipe(sock)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not open a local tunnel port')

  return {
    localPort: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        conn.end()
        server.close(() => resolve())
      })
  }
}

/** Wraps a driver so its SSH tunnel lives and dies with the connection. */
export class TunneledDriver implements Driver {
  private tunnel: Tunnel | null = null

  constructor(
    private cfg: ConnectionConfig,
    private make: (cfg: ConnectionConfig) => Driver
  ) {}

  private inner!: Driver

  async connect(): Promise<void> {
    const ssh = this.cfg.ssh!
    this.tunnel = await openTunnel(ssh, this.cfg.host ?? 'localhost', this.cfg.port ?? 0)
    this.inner = this.make({ ...this.cfg, host: '127.0.0.1', port: this.tunnel.localPort, ssh: undefined })
    try {
      await this.inner.connect()
    } catch (e) {
      await this.tunnel.close()
      this.tunnel = null
      throw e
    }
  }

  async close(): Promise<void> {
    try {
      await this.inner?.close()
    } finally {
      await this.tunnel?.close()
      this.tunnel = null
    }
  }

  containers = (): Promise<string[]> => this.inner.containers()
  objects = (c: string): Promise<DbObject[]> => this.inner.objects(c)
  describe = (c: string, o: DbObject): Promise<ColumnInfo[]> => this.inner.describe(c, o)
  definition = (c: string, o: DbObject): Promise<string> => this.inner.definition(c, o)
  designInfo = (c: string, o: DbObject): Promise<TableDesign> => this.inner.designInfo(c, o)
  executeDdl = (c: string, s: string[]): Promise<void> => this.inner.executeDdl(c, s)
  previewSql = (c: string, o: DbObject): string => this.inner.previewSql(c, o)
  query = (sql: string, c: string | null): Promise<QueryResult> => this.inner.query(sql, c)
  cancel = (): Promise<void> => this.inner.cancel()
  tableData = (c: string, o: DbObject, opts: TableDataOptions): Promise<TableDataResult> => this.inner.tableData(c, o, opts)
  applyChanges = (c: string, o: DbObject, ch: RowChange[]): Promise<void> => this.inner.applyChanges(c, o, ch)
  tableDdl = (c: string, o: DbObject): Promise<string[] | null> => this.inner.tableDdl(c, o)
  insertRows = (c: string, o: DbObject, cols: string[], rows: unknown[][], opts?: InsertOptions): Promise<number> => this.inner.insertRows(c, o, cols, rows, opts)
  schemaCompletion = (c: string): Promise<Record<string, string[]>> => this.inner.schemaCompletion(c)
}
