import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConnectionConfig, SshConfig } from '@shared/types'

/** On disk, secrets are replaced by OS-encrypted blobs (DPAPI on Windows). */
type StoredSsh = Omit<SshConfig, 'password' | 'passphrase'> & { passwordEnc?: string; passphraseEnc?: string }
type StoredConnection = Omit<ConnectionConfig, 'password' | 'ssh'> & { passwordEnc?: string; ssh?: StoredSsh }

const file = (): string => join(app.getPath('userData'), 'connections.json')

function encrypt(plain: string | undefined): string | undefined {
  if (!plain) return undefined
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is unavailable; refusing to save a secret in plain text')
  }
  return safeStorage.encryptString(plain).toString('base64')
}

function decrypt(enc?: string): string | undefined {
  if (!enc) return undefined
  return safeStorage.decryptString(Buffer.from(enc, 'base64'))
}

function readAll(): StoredConnection[] {
  if (!existsSync(file())) return []
  return JSON.parse(readFileSync(file(), 'utf8')) as StoredConnection[]
}

export function listConnections(): ConnectionConfig[] {
  return readAll().map(({ passwordEnc, ssh, ...rest }) => ({
    ...rest,
    password: decrypt(passwordEnc),
    ssh: ssh ? { ...stripEnc(ssh), password: decrypt(ssh.passwordEnc), passphrase: decrypt(ssh.passphraseEnc) } : undefined
  }))
}

function stripEnc({ passwordEnc: _p, passphraseEnc: _s, ...rest }: StoredSsh): Omit<StoredSsh, 'passwordEnc' | 'passphraseEnc'> {
  return rest
}

export function getConnection(id: string): ConnectionConfig {
  const found = listConnections().find((c) => c.id === id)
  if (!found) throw new Error(`Unknown connection: ${id}`)
  return found
}

export function saveConnection(cfg: ConnectionConfig): void {
  const { password, ssh, ...rest } = cfg
  const stored: StoredConnection = {
    ...rest,
    passwordEnc: encrypt(password),
    ssh: ssh
      ? {
          enabled: ssh.enabled,
          host: ssh.host,
          port: ssh.port,
          user: ssh.user,
          authType: ssh.authType,
          keyPath: ssh.keyPath,
          passwordEnc: encrypt(ssh.password),
          passphraseEnc: encrypt(ssh.passphrase)
        }
      : undefined
  }
  const all = readAll().filter((c) => c.id !== cfg.id)
  all.push(stored)
  writeFileSync(file(), JSON.stringify(all, null, 2))
}

export function deleteConnection(id: string): void {
  writeFileSync(file(), JSON.stringify(readAll().filter((c) => c.id !== id), null, 2))
}
