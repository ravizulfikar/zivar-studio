// "Check for updates": comparing versions, reading what GitHub says about the latest release, and choosing the right file
// to download. Pure (no network here), so it is unit-tested; src/main/updates.ts does the asking.

export const REPO = 'ravizulfikar/zivar-studio'
export const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`
/** Every link taken from GitHub's answer must lead into this repository. */
export const REPO_URL_PREFIX = `https://github.com/${REPO}/`

/** How often the automatic check is allowed to ask. */
export const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface ReleaseAsset {
  name: string
  url: string
  size: number
}

export interface ReleaseInfo {
  /** As tagged, e.g. "v1.2.0". */
  tag: string
  /** Without the "v". */
  version: string
  name: string
  /** The release page. */
  url: string
  notes: string
  publishedAt: string | null
  assets: ReleaseAsset[]
}

export type UpdateResult =
  | { ok: true; current: string; latest: ReleaseInfo; newer: boolean; recommended: ReleaseAsset | null; checkedAt: number }
  | { ok: false; error: string }

interface Parsed {
  nums: [number, number, number]
  pre: string[]
}

/** "1.2.3", "v1.2.3", "1.2.3-beta.1"; null for anything else (a build number, a date, text). */
export function parseVersion(v: string): Parsed | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim())
  if (!m) return null
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] }
}

/** Semantic-version precedence: negative when a is older than b, positive when newer, 0 when the same; null when either is not a version. */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return null
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1
  // a version with a pre-release part is older than the same version without one
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1
    if (pn !== qn) return pn ? -1 : 1 // numbers come before words
    return p < q ? -1 : 1
  }
  return 0
}

export const isNewer = (latest: string, current: string): boolean => (compareVersions(latest, current) ?? 0) > 0

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/**
 * The parts of GitHub's "latest release" answer that matter, checked: a draft or a malformed answer gives null, and a
 * link that does not lead into the repository is dropped (a download button must never lead somewhere else).
 */
export function parseRelease(json: unknown, allowedPrefix: string = REPO_URL_PREFIX): ReleaseInfo | null {
  if (typeof json !== 'object' || json === null) return null
  const j = json as Record<string, unknown>
  const tag = str(j.tag_name)
  if (!tag || !parseVersion(tag) || j.draft === true) return null
  const inside = (u: string | null): u is string => !!u && u.toLowerCase().startsWith(allowedPrefix.toLowerCase())
  const page = str(j.html_url)
  const assets: ReleaseAsset[] = []
  if (Array.isArray(j.assets)) {
    for (const a of j.assets) {
      if (typeof a !== 'object' || a === null) continue
      const name = str((a as Record<string, unknown>).name)
      const url = str((a as Record<string, unknown>).browser_download_url)
      const size = (a as Record<string, unknown>).size
      if (name && inside(url)) assets.push({ name, url, size: typeof size === 'number' ? size : 0 })
    }
  }
  return {
    tag,
    version: tag.replace(/^v/, ''),
    name: str(j.name) || tag,
    url: inside(page) ? page : RELEASES_PAGE,
    notes: (str(j.body) ?? '').replace(/\r\n/g, '\n').trim(),
    publishedAt: str(j.published_at),
    assets
  }
}

export type LinuxFlavor = 'deb' | 'rpm' | 'appimage'

/** Which Linux package fits this system: the AppImage if that is what is running, else by the distribution family. */
export function linuxFlavorOf(osRelease: string | undefined, runningAppImage: boolean): LinuxFlavor {
  if (runningAppImage) return 'appimage'
  const fields = Object.fromEntries(
    (osRelease ?? '')
      .split(/\r?\n/)
      .map((l) => /^([A-Z_]+)=(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => [m[1], m[2].replace(/^"|"$/g, '').toLowerCase()])
  )
  const family = `${fields.ID ?? ''} ${fields.ID_LIKE ?? ''}`.split(/\s+/)
  if (family.some((f) => ['debian', 'ubuntu'].includes(f))) return 'deb'
  if (family.some((f) => ['fedora', 'rhel', 'centos', 'suse', 'opensuse', 'opensuse-leap', 'sles'].includes(f))) return 'rpm'
  return 'appimage'
}

/** The file to offer for this system, or null when the release has none for it. */
export function pickAsset(assets: ReleaseAsset[], platform: string, flavor: LinuxFlavor | null, portable = false): ReleaseAsset | null {
  const find = (re: RegExp): ReleaseAsset | null => assets.find((a) => re.test(a.name)) ?? null
  if (platform === 'win32') return portable ? (find(/Portable.*\.exe$/i) ?? find(/Setup.*\.exe$/i)) : (find(/Setup.*\.exe$/i) ?? find(/\.exe$/i))
  if (platform === 'linux') {
    const order: LinuxFlavor[] = flavor === 'deb' ? ['deb', 'appimage', 'rpm'] : flavor === 'rpm' ? ['rpm', 'appimage', 'deb'] : ['appimage', 'deb', 'rpm']
    for (const f of order) {
      const hit = find(f === 'deb' ? /\.deb$/i : f === 'rpm' ? /\.rpm$/i : /\.AppImage$/i)
      if (hit) return hit
    }
  }
  return null
}

/** A short instruction for installing the downloaded file. */
export function installHint(assetName: string): string {
  if (/\.deb$/i.test(assetName)) return `Install it with:  sudo apt install ./${assetName}`
  if (/\.rpm$/i.test(assetName)) return `Install it with:  sudo dnf install ./${assetName}`
  if (/\.AppImage$/i.test(assetName)) return `Make it executable (chmod +x ${assetName}) and run it.`
  if (/Portable/i.test(assetName)) return 'The portable build is a single file: replace the old one with it.'
  if (/\.exe$/i.test(assetName)) return 'Run the installer: it updates the installed program, and your connections and settings are kept.'
  return ''
}

/** The automatic check runs when it is switched on and the last check is old enough (or never happened). */
export function shouldAutoCheck(enabled: boolean, lastCheckMs: number | null, nowMs: number, intervalMs = AUTO_CHECK_INTERVAL_MS): boolean {
  if (!enabled) return false
  if (lastCheckMs === null || !Number.isFinite(lastCheckMs)) return true
  return nowMs - lastCheckMs >= intervalMs || lastCheckMs > nowMs // a clock set back must not silence the check forever
}

/** The sentence that says what happened to a failed request, in terms a user can act on. */
export function describeHttpError(status: number): string {
  if (status === 404) return 'No release has been published yet.'
  if (status === 403 || status === 429) return 'GitHub is limiting requests from this network right now. Try again in a while.'
  if (status >= 500) return `GitHub is having trouble (HTTP ${status}). Try again later.`
  return `GitHub answered with an unexpected status (HTTP ${status}).`
}
