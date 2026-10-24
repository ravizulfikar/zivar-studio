import { join } from 'node:path'

/** Folders (inside %APPDATA%) that earlier builds of this app stored their data in. */
export const LEGACY_PROFILE_NAMES = ['zivar-navicat', 'Zivar DB']

/** Files that mean "someone already uses this profile". */
const MARKERS = ['connections.json', 'saved-queries.json', 'history.json']

/**
 * The app was renamed, and Electron derives its data folder from the app name, so a plain rename would make
 * every saved connection, query and setting seem to vanish. The passwords cannot simply be copied elsewhere
 * either: they are encrypted with a key kept in the profile ("Local State"). So an existing profile is kept
 * where it is, and used as-is. Returns that folder, or null when the current folder should be used (a fresh
 * install, or one that already has data).
 */
export function legacyProfile(appData: string, current: string, exists: (path: string) => boolean): string | null {
  const used = (dir: string): boolean => MARKERS.some((m) => exists(join(dir, m)))
  if (used(current)) return null
  return LEGACY_PROFILE_NAMES.map((n) => join(appData, n)).find(used) ?? null
}
