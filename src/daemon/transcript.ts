import { createReadStream, existsSync, statSync } from 'node:fs'
import { toolSummary, responseSummary } from './ledger'
import { clip } from './redact'
import type { LedgerEntry } from './types'

// Claude Code's transcript is an internal JSONL format (typed lines, content blocks); read it defensively.
type Block = { type?: string; text?: string; name?: string; input?: Record<string, unknown>; id?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }
interface Line {
  type?: string
  timestamp?: string
  isSidechain?: boolean
  isMeta?: boolean
  isCompactSummary?: boolean
  customTitle?: string
  cwd?: string
  promptId?: string
  message?: { content?: string | Block[] }
}

const NOISE = /^\{"type":"(api-request|api-request-blob|api-request-shape|file-history-snapshot|queue-operation|attachment|last-prompt|mode|atis-latch|progress)/

const stripReminders = (s: string): string => s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/<(local-command-[a-z]+|command-[a-z]+)>[\s\S]*?<\/\1>/g, '').trim()
const blockText = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b: Block) => b?.text ?? '').join(' ') : '')

export interface Parsed {
  entries: Omit<LedgerEntry, 'seq'>[]
  /** Entries read before (looked up through `known`) that this read completed with a tool result. */
  done: LedgerEntry[]
  title?: string
  cwd?: string
  /** Byte offset reached, so the next read can start there. */
  offset: number
}

/**
 * Hand each complete line of a file from a byte offset to `line`. Streams, so a 50 MB file is fine, and stops before a
 * last line that is still being written. Returns the offset reached.
 */
export const readLines = async (path: string, from: number, line: (raw: string) => void): Promise<number> => {
  const size = existsSync(path) ? statSync(path).size : 0
  if (size <= from) return from
  let rest: Buffer = Buffer.alloc(0)
  for await (const chunk of createReadStream(path, { start: from, end: size - 1, highWaterMark: 1 << 20 }) as AsyncIterable<Buffer>) {
    const buf = rest.length ? Buffer.concat([rest, chunk]) : chunk
    const cut = buf.lastIndexOf(10) + 1
    rest = buf.subarray(cut)
    for (const raw of buf.subarray(0, cut).toString('utf8').split('\n')) if (raw) line(raw)
  }
  return size - rest.length
}

/**
 * Read a transcript from a byte offset into ledger entries. Calls and prompts that `known` finds were already reported by a
 * hook and are not repeated.
 */
export const parseTranscript = async (path: string, from = 0, known?: (key: string) => LedgerEntry | undefined): Promise<Parsed> => {
  const out: Parsed = { entries: [], done: [], offset: from }
  const calls = new Map<string, Omit<LedgerEntry, 'seq'>>()
  out.offset = await readLines(path, from, (raw) => {
    if (NOISE.test(raw)) return
    let d: Line
    try {
      d = JSON.parse(raw) as Line
    } catch {
      return
    }
    if (d.customTitle) out.title = d.customTitle
    if (d.cwd) out.cwd ??= d.cwd
    if (d.isSidechain || (d.type !== 'user' && d.type !== 'assistant')) return
    const ts = Date.parse(d.timestamp ?? '') || Date.now()
    const content = d.message?.content
    if (d.type === 'user') {
      if (typeof content === 'string' || content?.some((b) => b.type === 'text')) {
        const text = stripReminders(blockText(content))
        if (text && !d.isMeta && !(d.promptId && known?.(d.promptId)))
          out.entries.push({ ts, kind: d.isCompactSummary || /^This session is being continued/.test(text) ? 'summary' : 'prompt', text: clip(text, d.isCompactSummary ? 6000 : 1200), key: d.promptId })
      }
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b.type !== 'tool_result' || !b.tool_use_id) continue
          const earlier = calls.has(b.tool_use_id) ? undefined : known?.(b.tool_use_id)
          const call = calls.get(b.tool_use_id) ?? earlier
          if (!call) continue
          const r = responseSummary(call.tool ?? '', typeof b.content === 'string' ? b.content : { content: b.content })
          call.state = b.is_error || r.err ? 'err' : 'ok'
          call.ms = ts - call.ts
          if (r.text) call.text = `${call.text} → ${r.text}`
          if (earlier) out.done.push(earlier)
        }
      }
    } else if (Array.isArray(content)) {
      for (const b of content) {
        if (b.type === 'text' && b.text?.trim()) out.entries.push({ ts, kind: 'assistant', text: clip(b.text, 1500) })
        else if (b.type === 'tool_use' && b.name && !(b.id && known?.(b.id))) {
          const e: Omit<LedgerEntry, 'seq'> = { ts, kind: 'tool', tool: b.name, state: 'running', text: toolSummary(b.name, b.input), key: b.id }
          out.entries.push(e)
          if (b.id) calls.set(b.id, e)
        }
      }
    }
  })
  return out
}
