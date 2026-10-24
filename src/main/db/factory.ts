import type { ConnectionConfig } from '@shared/types'
import type { Driver } from './driver'
import { MsSqlDriver } from './mssql'
import { MySqlDriver } from './mysql'
import { PostgresDriver } from './postgres'
import { SqliteDriver } from './sqlite'
import { TunneledDriver } from './tunnel'

function createPlainDriver(cfg: ConnectionConfig): Driver {
  switch (cfg.kind) {
    case 'postgres':
      return new PostgresDriver(cfg)
    case 'mysql':
      return new MySqlDriver(cfg)
    case 'sqlite':
      return new SqliteDriver(cfg)
    case 'mssql':
      return new MsSqlDriver(cfg)
  }
}

/** Build a driver, routing it through an SSH tunnel when the connection asks for one. */
export function createDriver(cfg: ConnectionConfig): Driver {
  if (cfg.ssh?.enabled && cfg.kind !== 'sqlite') return new TunneledDriver(cfg, createPlainDriver)
  return createPlainDriver(cfg)
}
