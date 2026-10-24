// Which data folder the app uses after the rename: an existing profile is kept, a fresh install gets the default.
const assert = require('node:assert/strict')
const path = require('node:path')
const { legacyProfile, LEGACY_PROFILE_NAMES } = require('./.build/userData.cjs')

const appData = path.join('C:', 'Users', 'x', 'AppData', 'Roaming')
const current = path.join(appData, 'zivar-studio')
const at = (...names) => new Set(names.map((n) => path.join(appData, ...n.split('/'))))
const exists = (files) => (p) => files.has(p)

assert.deepEqual(LEGACY_PROFILE_NAMES, ['zivar-navicat', 'Zivar DB'])

// fresh install: nothing anywhere
assert.equal(legacyProfile(appData, current, exists(at())), null)
// an upgrade: the old folder has the user's connections
assert.equal(legacyProfile(appData, current, exists(at('zivar-navicat/connections.json'))), path.join(appData, 'zivar-navicat'))
// any one of the data files is enough (history only, saved queries only)
assert.equal(legacyProfile(appData, current, exists(at('zivar-navicat/history.json'))), path.join(appData, 'zivar-navicat'))
assert.equal(legacyProfile(appData, current, exists(at('Zivar DB/saved-queries.json'))), path.join(appData, 'Zivar DB'))
// Chromium's own files (caches, preferences) are not user data
assert.equal(legacyProfile(appData, current, exists(at('zivar-navicat/Preferences', 'zivar-navicat/Cache/data_0'))), null)
// both old folders exist: the first name wins
assert.equal(legacyProfile(appData, current, exists(at('Zivar DB/connections.json', 'zivar-navicat/connections.json'))), path.join(appData, 'zivar-navicat'))
// the current folder already has data: never switch away from it
assert.equal(legacyProfile(appData, current, exists(at('zivar-studio/connections.json', 'zivar-navicat/connections.json'))), null)
console.log('profile folder selection OK')
console.log('ALL PROFILE TESTS PASSED')
