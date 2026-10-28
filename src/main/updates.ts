import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { describeHttpError, isNewer, linuxFlavorOf, parseRelease, pickAsset, RELEASES_API, REPO_URL_PREFIX, type UpdateResult } from '@shared/updates'

const TIMEOUT_MS = 10_000

/**
 * Asks GitHub for the latest release and compares it with this version. It sends nothing about you or your databases:
 * an ordinary request for a public page, whose only identifying part is the program name and version in User-Agent.
 *
 * ZIVAR_UPDATE_URL points the check at another server (the tests of the app use a local one).
 * `auto` marks the check the app makes by itself on start-up: it is skipped while a debugger drives the app.
 */
export async function checkForUpdates(current: string, auto: boolean): Promise<UpdateResult> {
  const override = process.env['ZIVAR_UPDATE_URL']
  if (auto && !override && app.commandLine.hasSwitch('remote-debugging-port')) return { ok: false, error: 'Automatic checks are off while the app is driven by a debugger.' }
  const endpoint = override ?? RELEASES_API
  const allowed = override ? `${new URL(override).origin}/` : REPO_URL_PREFIX

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(endpoint, {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': `ZivarDatabaseStudio/${current}` }
    })
    if (!res.ok) return { ok: false, error: describeHttpError(res.status) }
    const latest = parseRelease(await res.json().catch(() => null), allowed)
    if (!latest) return { ok: false, error: 'The answer from GitHub could not be understood.' }

    let osRelease: string | undefined
    if (process.platform === 'linux') {
      try {
        osRelease = readFileSync('/etc/os-release', 'utf8')
      } catch {
        /* an unusual system: the AppImage is the fallback */
      }
    }
    const flavor = process.platform === 'linux' ? linuxFlavorOf(osRelease, !!process.env['APPIMAGE']) : null
    const portable = !!process.env['PORTABLE_EXECUTABLE_FILE']
    return { ok: true, current, latest, newer: isNewer(latest.version, current), recommended: pickAsset(latest.assets, process.platform, flavor, portable), checkedAt: Date.now() }
  } catch (e) {
    if (controller.signal.aborted) return { ok: false, error: 'GitHub did not answer in time. Check your connection and try again.' }
    const why = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e)
    return { ok: false, error: `Could not reach GitHub (${why}).` }
  } finally {
    clearTimeout(timer)
  }
}
