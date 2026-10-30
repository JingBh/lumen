import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promptKey, responseSummary, toolSummary } from './ledger'
import { clip } from './redact'
import { type Parsed, readLines } from './transcript'
import type { LedgerEntry } from './types'

// A Codex rollout is JSONL too. The thread's items (prompts, replies, commands, file changes, MCP calls) each arrive once,
// when done, as an `item_completed` event under the id its hooks use; a compaction leaves the summary that replaced the past.
type Item = {
  type?: string
  id?: string
  content?: { text?: string }[]
  command?: string[]
  aggregated_output?: string
  exit_code?: number
  duration?: { secs?: number; nanos?: number }
  changes?: Record<string, unknown>
  stdout?: string
  stderr?: string
  server?: string
  tool?: string
  arguments?: Record<string, unknown>
  result?: unknown
  error?: unknown
  status?: string
}
interface Line {
  timestamp?: string
  type?: string
  payload?: { type?: string; turn_id?: string; item?: Item; message?: string; cwd?: string; started_at_ms?: number; completed_at_ms?: number }
}

const WANTED = /"type":"(session_meta|compacted|item_completed)"/
const INDEX = join(homedir(), '.codex', 'session_index.jsonl')

/** The call an item made, as its hook named it, and what came back. */
const called = (it: Item): { tool: string; text: string; response: unknown; err: boolean } | undefined => {
  const failed = it.status === 'failed' || it.status === 'declined'
  switch (it.type) {
    case 'CommandExecution': {
      const argv = it.command ?? [], command = argv.length === 3 && /^-l?c$/.test(argv[1]) ? argv[2] : argv.join(' ')
      return { tool: 'Bash', text: toolSummary('Bash', { command }), response: it.aggregated_output ?? '', err: failed || !!it.exit_code }
    }
    case 'FileChange':
      return { tool: 'apply_patch', text: Object.keys(it.changes ?? {}).join(' '), response: it.stderr || it.stdout || '', err: failed }
    case 'McpToolCall': {
      const tool = `mcp__${it.server}__${it.tool}`
      return { tool, text: toolSummary(tool, it.arguments), response: it.error ?? it.result, err: failed || !!it.error }
    }
  }
}

/** Read a Codex rollout from a byte offset, as `parseTranscript` reads a Claude Code transcript. */
export const parseRollout = async (path: string, from = 0, known?: (key: string) => LedgerEntry | undefined): Promise<Parsed> => {
  const out: Parsed = { entries: [], done: [], offset: from }
  out.offset = await readLines(path, from, (raw) => {
    if (!WANTED.test(raw.slice(0, 160))) return
    let d: Line
    try {
      d = JSON.parse(raw) as Line
    } catch {
      return
    }
    const ts = Date.parse(d.timestamp ?? '') || Date.now(), p = d.payload ?? {}, it = p.item
    if (d.type === 'session_meta' && p.cwd) out.cwd ??= p.cwd
    if (d.type === 'compacted' && p.message) out.entries.push({ ts, kind: 'summary', text: clip(p.message, 6000) })
    if (!it?.id) return
    const text = (it.content ?? []).map((c) => c.text ?? '').join(' ').trim()
    if (it.type === 'UserMessage') {
      const key = p.turn_id && promptKey(p.turn_id, text)
      if (text && !(key && known?.(key))) out.entries.push({ ts, kind: 'prompt', text: clip(text, 1200), key: key || undefined })
      return
    }
    if (it.type === 'AgentMessage') {
      if (text) out.entries.push({ ts, kind: 'assistant', text: clip(text, 1500) })
      return
    }
    const call = called(it), earlier = known?.(it.id)
    const ms = it.duration ? (it.duration.secs ?? 0) * 1000 + (it.duration.nanos ?? 0) / 1e6 : (p.completed_at_ms ?? 0) - (p.started_at_ms ?? 0)
    const r = call ? responseSummary(call.tool, call.response) : { text: '', err: false }
    const state = call?.err || r.err || it.status === 'failed' ? 'err' : 'ok'
    if (earlier?.kind === 'tool' && earlier.state === 'running') {
      Object.assign(earlier, { state, ms: ms || ts - earlier.ts })
      if (r.text) earlier.text = `${earlier.text} → ${r.text}`
      out.done.push(earlier)
    } else if (call && !earlier) out.entries.push({ ts, kind: 'tool', tool: call.tool, state, ms: ms || undefined, text: r.text ? `${call.text} → ${r.text}` : call.text, key: it.id })
  })
  return out
}

/** The name Codex gave a thread, from its index of them. */
export const codexTitle = (id: string): string | undefined => {
  try {
    const index = readFileSync(INDEX, 'utf8'), at = index.lastIndexOf(`"id":"${id}"`)
    if (at < 0) return undefined
    const end = index.indexOf('\n', at)
    return (JSON.parse(index.slice(index.lastIndexOf('\n', at) + 1, end < 0 ? undefined : end)) as { thread_name?: string }).thread_name || undefined
  } catch {
    return undefined
  }
}
