// Check for updates, the pure parts: versions, GitHub's answer, the file to offer, and when to ask.
const assert = require('node:assert/strict')
const U = require('./.build/updates.cjs')

// ── versions ──
assert.deepEqual(U.parseVersion('v1.2.3'), { nums: [1, 2, 3], pre: [] })
assert.deepEqual(U.parseVersion('1.2.3-beta.1+build5'), { nums: [1, 2, 3], pre: ['beta', '1'] })
for (const bad of ['', 'latest', '1.2', '1.2.3.4', 'v1.x.3', '2026-10-28', '1.2.3-', ' ']) assert.equal(U.parseVersion(bad), null, `"${bad}" is not a version`)
const order = ['0.9.9', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '1.10.0', '2.0.0']
for (let i = 0; i < order.length; i++) for (let j = 0; j < order.length; j++) assert.equal(Math.sign(U.compareVersions(order[i], order[j])), Math.sign(i - j), `${order[i]} vs ${order[j]}`)
assert.equal(U.compareVersions('v1.2.0', '1.2.0'), 0, 'a leading v does not matter')
assert.equal(U.compareVersions('1.2.0', 'oops'), null)
assert.equal(U.isNewer('1.2.1', '1.2.0'), true)
assert.equal(U.isNewer('1.2.0', '1.2.0'), false)
assert.equal(U.isNewer('1.1.9', '1.2.0'), false, 'an older release is not an update')
assert.equal(U.isNewer('1.10.0', '1.9.0'), true, 'compared as numbers, not text')
assert.equal(U.isNewer('1.3.0-beta.1', '1.2.0'), true)
assert.equal(U.isNewer('1.2.0', '1.2.0-rc.1'), true, 'the final release follows its release candidate')
assert.equal(U.isNewer('garbage', '1.2.0'), false, 'something that is not a version never counts as newer')
console.log('versions OK')

// ── GitHub's answer ──
const P = U.REPO_URL_PREFIX
const answer = (over = {}) => ({
  tag_name: 'v1.3.0',
  name: 'Zivar Database Studio v1.3.0',
  html_url: `${P}releases/tag/v1.3.0`,
  body: 'What is new\r\n- one\r\n- two\r\n',
  published_at: '2026-11-01T10:00:00Z',
  draft: false,
  prerelease: false,
  assets: [
    { name: 'ZivarDatabaseStudio-Setup-1.3.0.exe', browser_download_url: `${P}releases/download/v1.3.0/ZivarDatabaseStudio-Setup-1.3.0.exe`, size: 120000000 },
    { name: 'ZivarDatabaseStudio-Portable-1.3.0.exe', browser_download_url: `${P}releases/download/v1.3.0/ZivarDatabaseStudio-Portable-1.3.0.exe`, size: 119000000 },
    { name: 'ZivarDatabaseStudio-1.3.0-linux-amd64.deb', browser_download_url: `${P}releases/download/v1.3.0/ZivarDatabaseStudio-1.3.0-linux-amd64.deb`, size: 100000000 },
    { name: 'ZivarDatabaseStudio-1.3.0-linux-x86_64.rpm', browser_download_url: `${P}releases/download/v1.3.0/ZivarDatabaseStudio-1.3.0-linux-x86_64.rpm`, size: 90000000 },
    { name: 'ZivarDatabaseStudio-1.3.0-linux-x86_64.AppImage', browser_download_url: `${P}releases/download/v1.3.0/ZivarDatabaseStudio-1.3.0-linux-x86_64.AppImage`, size: 130000000 },
    { name: 'SHA256SUMS.txt', browser_download_url: `${P}releases/download/v1.3.0/SHA256SUMS.txt`, size: 600 }
  ],
  ...over
})
const rel = U.parseRelease(answer())
assert.equal(rel.version, '1.3.0')
assert.equal(rel.tag, 'v1.3.0')
assert.equal(rel.name, 'Zivar Database Studio v1.3.0')
assert.equal(rel.notes, 'What is new\n- one\n- two', 'line endings normalised, edges trimmed')
assert.equal(rel.publishedAt, '2026-11-01T10:00:00Z')
assert.equal(rel.assets.length, 6)
assert.equal(rel.url, `${P}releases/tag/v1.3.0`)
// what is not acceptable
assert.equal(U.parseRelease(null), null)
assert.equal(U.parseRelease('text'), null)
assert.equal(U.parseRelease({}), null)
assert.equal(U.parseRelease(answer({ tag_name: 'nightly' })), null, 'a tag that is not a version')
assert.equal(U.parseRelease(answer({ draft: true })), null, 'a draft is not a release')
assert.equal(U.parseRelease(answer({ tag_name: 42 })), null)
// links that lead out of the repository are dropped, and never reach a button
const evil = U.parseRelease(
  answer({
    html_url: 'https://evil.example/releases/tag/v1.3.0',
    assets: [
      { name: 'ok.exe', browser_download_url: `${P}releases/download/v1.3.0/ok.exe`, size: 1 },
      { name: 'bad.exe', browser_download_url: 'https://evil.example/bad.exe', size: 1 },
      { name: 'sneaky.exe', browser_download_url: 'https://github.com/ravizulfikar/zivar-studio-evil/releases/download/x/sneaky.exe', size: 1 },
      { name: 'js.exe', browser_download_url: 'javascript:alert(1)', size: 1 },
      { name: 'file.exe', browser_download_url: 'file:///c:/windows/system32/cmd.exe', size: 1 },
      { browser_download_url: `${P}x` },
      'junk',
      null
    ]
  })
)
assert.deepEqual(evil.assets.map((a) => a.name), ['ok.exe'])
assert.equal(evil.url, U.RELEASES_PAGE, 'a release page outside the repository is replaced by the repository releases page')
assert.equal(U.parseRelease(answer({ assets: 'nope' })).assets.length, 0, 'assets that are not a list')
assert.equal(U.parseRelease(answer({ body: null })).notes, '')
assert.equal(U.parseRelease(answer({ name: '' })).name, 'v1.3.0', 'a release without a title is named by its tag')
// a different allowed prefix (the tests of the app point it at a local server)
assert.equal(U.parseRelease(answer({ html_url: 'http://127.0.0.1:9/x' }), 'http://127.0.0.1:9/').url, 'http://127.0.0.1:9/x')
console.log("GitHub's answer OK")

// ── which file ──
const assets = rel.assets
const name = (a) => a?.name ?? null
assert.equal(name(U.pickAsset(assets, 'win32', null)), 'ZivarDatabaseStudio-Setup-1.3.0.exe')
assert.equal(name(U.pickAsset(assets, 'win32', null, true)), 'ZivarDatabaseStudio-Portable-1.3.0.exe', 'the portable build gets the portable file')
assert.equal(name(U.pickAsset(assets, 'linux', 'deb')), 'ZivarDatabaseStudio-1.3.0-linux-amd64.deb')
assert.equal(name(U.pickAsset(assets, 'linux', 'rpm')), 'ZivarDatabaseStudio-1.3.0-linux-x86_64.rpm')
assert.equal(name(U.pickAsset(assets, 'linux', 'appimage')), 'ZivarDatabaseStudio-1.3.0-linux-x86_64.AppImage')
assert.equal(name(U.pickAsset(assets.filter((a) => !/\.deb$/.test(a.name)), 'linux', 'deb')), 'ZivarDatabaseStudio-1.3.0-linux-x86_64.AppImage', 'falls back when the best fit is missing')
assert.equal(U.pickAsset(assets, 'darwin', null), null, 'no file for a system the release does not cover')
assert.equal(U.pickAsset([], 'win32', null), null)
assert.equal(U.linuxFlavorOf('ID=ubuntu\nID_LIKE=debian\n', false), 'deb')
assert.equal(U.linuxFlavorOf('ID=debian\n', false), 'deb')
assert.equal(U.linuxFlavorOf('NAME="Linux Mint"\nID=linuxmint\nID_LIKE="ubuntu debian"\n', false), 'deb')
assert.equal(U.linuxFlavorOf('ID=fedora\n', false), 'rpm')
assert.equal(U.linuxFlavorOf('ID="rocky"\nID_LIKE="rhel centos fedora"\n', false), 'rpm')
assert.equal(U.linuxFlavorOf('ID=opensuse-leap\nID_LIKE="suse opensuse"\n', false), 'rpm')
assert.equal(U.linuxFlavorOf('ID=arch\n', false), 'appimage', 'a distribution with neither package format')
assert.equal(U.linuxFlavorOf(undefined, false), 'appimage')
assert.equal(U.linuxFlavorOf('ID=ubuntu\n', true), 'appimage', 'running as an AppImage means updating the AppImage')
assert.match(U.installHint('x-linux-amd64.deb'), /sudo apt install \.\/x-linux-amd64\.deb/)
assert.match(U.installHint('x-linux-x86_64.rpm'), /sudo dnf install/)
assert.match(U.installHint('x.AppImage'), /chmod \+x x\.AppImage/)
assert.match(U.installHint('ZivarDatabaseStudio-Portable-1.0.0.exe'), /replace/)
assert.match(U.installHint('ZivarDatabaseStudio-Setup-1.0.0.exe'), /settings are kept/)
console.log('which file OK')

// ── when to ask ──
const DAY = U.AUTO_CHECK_INTERVAL_MS
assert.equal(U.shouldAutoCheck(false, null, 1000), false, 'switched off')
assert.equal(U.shouldAutoCheck(true, null, 1000), true, 'never asked')
assert.equal(U.shouldAutoCheck(true, 1000, 1000 + DAY - 1), false, 'asked less than a day ago')
assert.equal(U.shouldAutoCheck(true, 1000, 1000 + DAY), true, 'a day later')
assert.equal(U.shouldAutoCheck(true, 5000, 1000), true, 'a last check "in the future" (clock set back) does not silence it')
assert.equal(U.shouldAutoCheck(true, NaN, 1000), true)
console.log('when to ask OK')

// ── wording ──
assert.match(U.describeHttpError(404), /No release has been published/)
assert.match(U.describeHttpError(403), /limiting requests/)
assert.match(U.describeHttpError(429), /limiting requests/)
assert.match(U.describeHttpError(503), /HTTP 503/)
assert.match(U.describeHttpError(418), /HTTP 418/)
console.log('ALL UPDATE TESTS PASSED')
