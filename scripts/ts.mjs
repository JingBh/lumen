// Run a TypeScript file under Node: node scripts/ts.mjs scripts/foo.ts [args…]
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [file, ...args] = process.argv.slice(2)
const out = join(mkdtempSync(join(tmpdir(), 'lumen-ts-')), 'run.mjs')
await build({ entryPoints: [file], outfile: out, bundle: true, platform: 'node', format: 'esm', banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url)" }, target: 'node22', logLevel: 'error', external: ['electron'] })
process.exit(spawnSync(process.execPath, [out, ...args], { stdio: 'inherit' }).status ?? 1)
