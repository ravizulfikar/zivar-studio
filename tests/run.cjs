// Bundles the TypeScript under test with esbuild, then runs each *.test.cjs in order.
//   npm test          -> unit + SQLite integration tests (no Electron needed)
//   npm run test:ui   -> also drives the real app over the DevTools protocol (needs `npm run build` first)
const { buildSync } = require('esbuild')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.join(__dirname, '..')
const out = path.join(__dirname, '.build')
const common = { bundle: true, platform: 'node', format: 'cjs', logLevel: 'error', alias: { '@shared': path.join(root, 'src/shared') } }

buildSync({ ...common, entryPoints: [path.join(root, 'src/shared/ddl.ts')], outfile: path.join(out, 'ddl.cjs') })
buildSync({ ...common, entryPoints: [path.join(root, 'src/main/db/sqlite.ts')], outfile: path.join(out, 'sqlite.cjs'), external: ['node-sqlite3-wasm'] })
buildSync({ ...common, entryPoints: [path.join(root, 'src/main/db/postgres.ts')], outfile: path.join(out, 'postgres.cjs'), external: ['pg'] })
buildSync({ ...common, entryPoints: [path.join(root, 'src/main/db/mysql.ts')], outfile: path.join(out, 'mysql.cjs'), external: ['mysql2', 'mysql2/promise'] })

buildSync({ ...common, entryPoints: [path.join(root, 'src/renderer/src/importParse.ts')], outfile: path.join(out, 'importParse.cjs') })
buildSync({ ...common, entryPoints: [path.join(root, 'src/renderer/src/exportData.ts')], outfile: path.join(out, 'exportData.cjs'), jsx: 'automatic', external: ['react', 'react/jsx-runtime'] })

buildSync({ ...common, entryPoints: [path.join(root, 'src/shared/sqlLiteral.ts')], outfile: path.join(out, 'sqlLiteral.cjs') })
buildSync({ ...common, entryPoints: [path.join(root, 'src/shared/sqlSplit.ts')], outfile: path.join(out, 'sqlSplit.cjs') })
buildSync({ ...common, entryPoints: [path.join(root, 'src/main/script.ts')], outfile: path.join(out, 'script.cjs') })
buildSync({ ...common, entryPoints: [path.join(root, 'src/main/dump.ts')], outfile: path.join(out, 'dump.cjs') })
buildSync({ ...common, entryPoints: [path.join(root, 'src/main/queue.ts')], outfile: path.join(out, 'queue.cjs') })
buildSync({ ...common, entryPoints: [path.join(root, 'src/shared/convert.ts')], outfile: path.join(out, 'convert.cjs') })
buildSync({ ...common, entryPoints: [path.join(root, 'src/shared/sync.ts')], outfile: path.join(out, 'sync.cjs') })
buildSync({ ...common, entryPoints: [path.join(root, 'src/main/transfer.ts')], outfile: path.join(out, 'transfer.cjs') })
buildSync({ ...common, entryPoints: [path.join(root, 'src/shared/erLayout.ts')], outfile: path.join(out, 'erLayout.cjs') })
buildSync({ ...common, entryPoints: [path.join(root, 'src/main/userData.ts')], outfile: path.join(out, 'userData.cjs') })
buildSync({ ...common, entryPoints: [path.join(root, 'src/shared/sidebarSearch.ts')], outfile: path.join(out, 'sidebarSearch.cjs') })
buildSync({ ...common, entryPoints: [path.join(root, 'src/main/splashContent.ts')], outfile: path.join(out, 'splashContent.cjs') })
buildSync({ ...common, entryPoints: [path.join(root, 'src/shared/filter.ts')], outfile: path.join(out, 'filter.cjs') })
buildSync({ ...common, entryPoints: [path.join(root, 'src/shared/updates.ts')], outfile: path.join(out, 'updates.cjs') })
buildSync({ ...common, entryPoints: [path.join(root, 'src/shared/jsonModel.ts')], outfile: path.join(out, 'jsonModel.cjs') })

const suites = ['ddl.test.cjs', 'queue.test.cjs', 'convert-sync.test.cjs', 'er-layout.test.cjs', 'json-model.test.cjs', 'updates.test.cjs', 'splash.test.cjs', 'sidebar-search.test.cjs', 'profile.test.cjs', 'sql-text.test.cjs', 'import-parse.test.cjs', 'export-formats.test.cjs', 'sqlite-driver.test.cjs', 'designer-sqlite.test.cjs', 'postgres.test.cjs', 'mysql.test.cjs', 'dump.test.cjs', 'transfer.test.cjs', 'pg-json.test.cjs', 'filter.test.cjs', 'sync.test.cjs', ...(process.argv.includes('--ui') ? ['ui.test.cjs', 'profile-e2e.test.cjs', 'splash-e2e.test.cjs', 'updates-e2e.test.cjs'] : [])]
// npm test -- --only=dump   runs just the suites whose file name contains "dump"
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7)
let failed = 0
for (const s of suites.filter((x) => !only || x.includes(only))) {
  console.log(`\n▶ ${s}`)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit', cwd: root, env })
  if (r.status !== 0) failed++
}
console.log(failed ? `\n✗ ${failed} suite(s) failed` : '\n✓ all suites passed')
process.exit(failed ? 1 : 0)
