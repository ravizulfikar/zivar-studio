import type { DbKind, ScriptFailure, ScriptOptions, ScriptResult, ScriptStatement } from '@shared/types'
import type { Driver } from './db/driver'

const BEGIN: Record<DbKind, string> = { postgres: 'BEGIN', mysql: 'START TRANSACTION', sqlite: 'BEGIN', mssql: 'BEGIN TRANSACTION' }
/** Failures kept in the result; a broken 100k-line file should not produce 100k entries. */
const MAX_REPORTED_FAILURES = 50

export interface ScriptHooks {
  isCancelled(): boolean
  onProgress(done: number, total: number): void
}

/**
 * Run statements one after another on a single connection. In transaction mode the first error
 * rolls everything back (PostgreSQL would refuse further statements anyway); otherwise the caller
 * chooses between stopping at the first error and carrying on.
 */
export async function runScript(
  d: Driver,
  kind: DbKind,
  container: string | null,
  statements: ScriptStatement[],
  opts: ScriptOptions,
  hooks: ScriptHooks
): Promise<ScriptResult> {
  const started = Date.now()
  const failures: ScriptFailure[] = []
  const stopOnError = opts.stopOnError || opts.transaction
  let executed = 0
  let cancelled = false
  let rolledBack = false
  let scope = container // the scope sticks to the connection, so it only needs setting once
  let lastReport = 0

  if (opts.transaction) await d.query(BEGIN[kind], scope)
  scope = null

  for (let i = 0; i < statements.length; i++) {
    if (hooks.isCancelled()) {
      cancelled = true
      break
    }
    const st = statements[i]
    try {
      await d.query(st.text, i === 0 && !opts.transaction ? container : scope)
      executed++
    } catch (e) {
      if (hooks.isCancelled()) cancelled = true
      if (failures.length < MAX_REPORTED_FAILURES) {
        failures.push({ index: i, line: st.line, statement: st.text.length > 300 ? `${st.text.slice(0, 300)}…` : st.text, error: e instanceof Error ? e.message : String(e) })
      }
      if (stopOnError || cancelled) break
    }
    const now = Date.now()
    if (now - lastReport > 150) {
      lastReport = now
      hooks.onProgress(i + 1, statements.length)
    }
  }

  if (opts.transaction) {
    if (failures.length > 0 || cancelled) {
      await d.query('ROLLBACK', null).catch(() => undefined)
      rolledBack = true
    } else {
      try {
        await d.query('COMMIT', null)
      } catch (e) {
        await d.query('ROLLBACK', null).catch(() => undefined)
        rolledBack = true
        failures.push({ index: statements.length, line: statements.at(-1)?.line ?? 0, statement: 'COMMIT', error: e instanceof Error ? e.message : String(e) })
      }
    }
  }
  hooks.onProgress(statements.length, statements.length)
  return { total: statements.length, executed: rolledBack ? 0 : executed, failures, cancelled, rolledBack, durationMs: Date.now() - started }
}
