// Dry-run the director on a real transcript: node scripts/ts.mjs scripts/try-director.ts <transcript.jsonl>
import { basename } from 'node:path'
import { loadConfig } from '../src/daemon/config'
import { Director } from '../src/daemon/director'
import { screenForPrompt } from '../src/daemon/prompt'

const path = process.argv[2]
let ops = 0
const d = new Director(loadConfig(), {
  load: () => {},
  patch: (p) => { ops += p.length; for (const x of p) console.log('  patch', JSON.stringify(x).slice(0, 170)) },
  log: (m) => console.log('[log]', m)
})
d.setVisible(true)
d.ingest({ hook_event_name: 'SessionStart', source: 'resume', session_id: basename(path, '.jsonl'), transcript_path: path }, 'claude-code')
await new Promise<void>((resolve) => {
  const t = setInterval(() => { if (d.status === 'idle' && ops > 0) { clearInterval(t); resolve() } }, 500)
  setTimeout(() => { clearInterval(t); resolve() }, 120_000)
})
console.log('\nNOTES', d.notes)
console.log('\nSCREEN\n' + screenForPrompt(d.spec, 6000))
process.exit(0)
