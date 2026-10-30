import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promptKey, responseSummary, toolSummary } from './ledger'
import { clip } from './redact'
import type { Parsed } from './transcript'
import type { LedgerEntry } from './types'

// ZCode hands its hooks only a stand-in transcript and keeps sessions in an OpenCode-style SQLite database: messages, and
// parts of them (text, tool calls) whose JSON is rewritten in place as they stream and finish, stamped with when.
const DB = join(homedir(), '.zcode', 'cli', 'db', 'db.sqlite')

type Part = {
  type?: string
  text?: string
  synthetic?: boolean
  time?: { start?: number; end?: number }
  callID?: string
  tool?: string
  state?: { status?: string; input?: Record<string, unknown>; output?: unknown; error?: string; time?: { start?: number; end?: number } }
}
type Message = { role?: string; semantics?: { origin?: string }; anchor?: { turnId?: string } }

let db: DatabaseSync | undefined
const open = (): DatabaseSync | undefined => (db ??= existsSync(DB) ? new DatabaseSync(DB, { readOnly: true }) : undefined)

/** A ZCode session's folder and title, and for a subagent's the session it works for. */
export const zcodeSession = (id: string): { directory: string; title: string; parent?: string } | undefined => {
  try {
    const row = open()?.prepare('SELECT directory, title, parent_id, task_type FROM session WHERE id = ?').get(id) as { directory: string; title: string; parent_id: string | null; task_type: string } | undefined
    return row && { directory: row.directory, title: row.title, parent: row.task_type === 'subagent_child' ? (row.parent_id ?? undefined) : undefined }
  } catch {
    return undefined
  }
}

/**
 * Read what a ZCode session gained since `from`, the last update time seen, as `parseTranscript` reads a Claude Code
 * transcript. Text is taken once it has finished; a call shows when it starts and gets its result when it ends.
 */
export const readZcode = (id: string, from = 0, known?: (key: string) => LedgerEntry | undefined): Parsed => {
  const out: Parsed = { entries: [], done: [], offset: from }
  const rows = (open()
    ?.prepare('SELECT p.time_updated AS updated, p.data, m.data AS message FROM part p JOIN message m ON m.id = p.message_id WHERE p.session_id = ? AND p.time_updated > ? ORDER BY m.time_created, m.id, p.sequence')
    .all(id, from) ?? []) as { updated: number; data: string; message: string }[]
  const session = zcodeSession(id)
  Object.assign(out, { title: session?.title, cwd: session?.directory })
  const calls = new Map<string, Omit<LedgerEntry, 'seq'>>()
  for (const row of rows) {
    out.offset = Math.max(out.offset, row.updated)
    let p: Part, m: Message
    try {
      p = JSON.parse(row.data) as Part
      m = JSON.parse(row.message) as Message
    } catch {
      continue
    }
    const ts = p.time?.start ?? p.state?.time?.start ?? row.updated
    if (p.type === 'text' && p.text?.trim() && !p.synthetic) {
      if (m.role === 'user') {
        // Reminders and hook context reach the model as user messages too; only what the user wrote is a prompt.
        const key = m.anchor?.turnId && promptKey(m.anchor.turnId, p.text)
        if ((m.semantics?.origin ?? 'real_user') === 'real_user' && !(key && known?.(key))) out.entries.push({ ts, kind: 'prompt', text: clip(p.text.trim(), 1200), key: key || undefined })
      } else if (p.time?.end) out.entries.push({ ts, kind: 'assistant', text: clip(p.text, 1500) })
    } else if (p.type === 'tool' && p.callID && p.tool) {
      const st = p.state ?? {}
      const earlier = calls.has(p.callID) ? undefined : known?.(p.callID)
      let call = calls.get(p.callID) ?? earlier
      if (!call) {
        call = { ts, kind: 'tool', tool: p.tool, state: 'running', text: toolSummary(p.tool, st.input), key: p.callID }
        out.entries.push(call)
        calls.set(p.callID, call)
      }
      if (call.state !== 'running' || (st.status !== 'completed' && st.status !== 'error')) continue
      const r = responseSummary(p.tool, st.status === 'error' ? st.error : st.output)
      call.state = st.status === 'error' || r.err ? 'err' : 'ok'
      call.ms = (st.time?.end ?? row.updated) - (st.time?.start ?? call.ts)
      if (r.text) call.text = `${call.text} → ${r.text}`
      if (earlier) out.done.push(earlier)
    }
  }
  return out
}
