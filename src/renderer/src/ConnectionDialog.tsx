import type { JSX } from 'react'
import { useState } from 'react'
import type { ConnectionConfig, DbKind, SshConfig } from '@shared/types'
import { errMsg, unwrap } from './api'

const DEFAULT_PORT: Record<DbKind, number | undefined> = {
  postgres: 5432,
  mysql: 3306,
  mssql: 1433,
  sqlite: undefined
}

const NEW_SSH: SshConfig = { enabled: true, host: '', port: 22, user: '', authType: 'password' }

const COLORS = ['', '#e5484d', '#f5a524', '#f2d94e', '#46a758', '#12a594', '#3e63dd', '#8e4ec6']

interface Props {
  groups: string[]
  initial: ConnectionConfig | null
  onClose: () => void
  onSaved: () => void
}

export function ConnectionDialog({ groups, initial, onClose, onSaved }: Props): JSX.Element {
  const [cfg, setCfg] = useState<ConnectionConfig>(
    initial ?? { id: crypto.randomUUID(), name: '', kind: 'postgres', host: 'localhost', port: 5432 }
  )
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof ConnectionConfig>(k: K, v: ConnectionConfig[K]): void =>
    setCfg((c) => ({ ...c, [k]: v }))

  const changeKind = (kind: DbKind): void =>
    setCfg((c) => ({ ...c, kind, port: DEFAULT_PORT[kind], host: kind === 'sqlite' ? undefined : c.host ?? 'localhost' }))

  const test = async (): Promise<void> => {
    setBusy(true)
    try {
      await unwrap(window.api.testConnection(cfg))
      setStatus({ ok: true, text: 'Connection successful' })
    } catch (e) {
      setStatus({ ok: false, text: errMsg(e) })
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    try {
      await unwrap(window.api.saveConnection({ ...cfg, name: cfg.name || cfg.database || cfg.host || 'Untitled' }))
      onSaved()
    } catch (e) {
      setStatus({ ok: false, text: errMsg(e) })
    }
  }

  const setSsh = (patch: Partial<SshConfig>): void =>
    setCfg((c) => ({ ...c, ssh: { ...(c.ssh ?? NEW_SSH), ...patch } }))

  const pickKey = async (): Promise<void> => {
    const p = await window.api.pickFile('Select SSH private key')
    if (p) setSsh({ keyPath: p })
  }

  const pickFile = async (): Promise<void> => {
    const p = await window.api.pickSqliteFile()
    if (p) set('database', p)
  }

  const isFile = cfg.kind === 'sqlite'

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{initial ? 'Edit connection' : 'New connection'}</h3>
        <label>
          Type
          <select value={cfg.kind} onChange={(e) => changeKind(e.target.value as DbKind)}>
            <option value="postgres">PostgreSQL</option>
            <option value="mysql">MySQL / MariaDB</option>
            <option value="mssql">SQL Server</option>
            <option value="sqlite">SQLite</option>
          </select>
        </label>
        <label>
          Name
          <input value={cfg.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <div className="row">
          <label className="grow">
            Group (folder)
            <input list="conn-groups" value={cfg.group ?? ''} onChange={(e) => set('group', e.target.value || undefined)} />
            <datalist id="conn-groups">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </label>
          <div className="swatches" role="radiogroup" aria-label="Color">
            {COLORS.map((c) => (
              <button
                key={c || 'none'}
                type="button"
                role="radio"
                aria-checked={(cfg.color ?? '') === c}
                title={c || 'No color'}
                className={`swatch ${(cfg.color ?? '') === c ? 'on' : ''} ${c ? '' : 'none'}`}
                style={c ? { background: c } : undefined}
                onClick={() => set('color', c || undefined)}
              />
            ))}
          </div>
        </div>
        {isFile ? (
          <label>
            File
            <div className="row">
              <input value={cfg.database ?? ''} onChange={(e) => set('database', e.target.value)} />
              <button onClick={() => void pickFile()}>Browse…</button>
            </div>
          </label>
        ) : (
          <>
            <div className="row">
              <label className="grow">
                Host
                <input value={cfg.host ?? ''} onChange={(e) => set('host', e.target.value)} />
              </label>
              <label className="port">
                Port
                <input
                  type="number"
                  value={cfg.port ?? ''}
                  onChange={(e) => set('port', e.target.value ? Number(e.target.value) : undefined)}
                />
              </label>
            </div>
            <label>
              User
              <input value={cfg.user ?? ''} onChange={(e) => set('user', e.target.value)} />
            </label>
            <label>
              Password
              <input
                type="password"
                value={cfg.password ?? ''}
                onChange={(e) => set('password', e.target.value)}
              />
            </label>
            <label>
              Database (optional)
              <input value={cfg.database ?? ''} onChange={(e) => set('database', e.target.value)} />
            </label>
            <label className="check">
              <input type="checkbox" checked={!!cfg.ssl} onChange={(e) => set('ssl', e.target.checked)} />
              Use SSL/TLS
            </label>
            <label className="check">
              <input type="checkbox" checked={!!cfg.ssh?.enabled} onChange={(e) => setSsh({ enabled: e.target.checked })} />
              Connect through an SSH tunnel
            </label>
            {cfg.ssh?.enabled && (
              <fieldset className="ssh">
                <legend>SSH tunnel</legend>
                <div className="row">
                  <label className="grow">
                    SSH host
                    <input value={cfg.ssh.host} onChange={(e) => setSsh({ host: e.target.value })} />
                  </label>
                  <label className="port">
                    Port
                    <input type="number" value={cfg.ssh.port} onChange={(e) => setSsh({ port: Number(e.target.value) || 22 })} />
                  </label>
                </div>
                <label>
                  SSH user
                  <input value={cfg.ssh.user} onChange={(e) => setSsh({ user: e.target.value })} />
                </label>
                <label>
                  Authentication
                  <select value={cfg.ssh.authType} onChange={(e) => setSsh({ authType: e.target.value as SshConfig['authType'] })}>
                    <option value="password">Password</option>
                    <option value="key">Private key</option>
                  </select>
                </label>
                {cfg.ssh.authType === 'password' ? (
                  <label>
                    SSH password
                    <input type="password" value={cfg.ssh.password ?? ''} onChange={(e) => setSsh({ password: e.target.value })} />
                  </label>
                ) : (
                  <>
                    <label>
                      Private key file
                      <div className="row">
                        <input value={cfg.ssh.keyPath ?? ''} onChange={(e) => setSsh({ keyPath: e.target.value })} />
                        <button onClick={() => void pickKey()}>Browse…</button>
                      </div>
                    </label>
                    <label>
                      Passphrase (if the key has one)
                      <input type="password" value={cfg.ssh.passphrase ?? ''} onChange={(e) => setSsh({ passphrase: e.target.value })} />
                    </label>
                  </>
                )}
                <div className="muted small-note">Database host and port above are as seen from the SSH server (e.g. localhost).</div>
              </fieldset>
            )}
          </>
        )}
        {status && <div className={`msg ${status.ok ? 'ok' : 'error'}`}>{status.text}</div>}
        <div className="row end">
          <button disabled={busy} onClick={() => void test()}>
            {busy ? 'Testing…' : 'Test'}
          </button>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
