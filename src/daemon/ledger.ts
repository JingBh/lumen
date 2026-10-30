import type { Config } from './config'
import { clip, redact } from './redact'
import type { HookPayload, LedgerEntry, Presence } from './types'

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v))
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** One line that says what a tool call is about. */
export const toolSummary = (tool: string, input: Record<string, unknown> = {}): string => {
  const pick = (...keys: string[]): string => keys.map((k) => str(input[k])).find(Boolean) ?? ''
  switch (tool) {
    case 'Bash':
      return clip(oneLine(pick('command')), 220)
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return pick('file_path', 'notebook_path')
    case 'Grep':
    case 'Glob':
      return clip(`${pick('pattern')} ${pick('path')}`.trim(), 160)
    case 'WebFetch':
      return pick('url')
    case 'WebSearch':
      return pick('query')
    case 'Task':
    case 'Agent':
      return clip(`${pick('subagent_type')} ${pick('description', 'prompt')}`.trim(), 200)
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? (input.todos as { content?: string; status?: string }[]) : []
      const mark = { completed: 'x', in_progress: '~', pending: ' ' } as Record<string, string>
      return todos.map((t) => `[${mark[t.status ?? ''] ?? ' '}] ${t.content ?? ''}`).join(' / ')
    }
    default:
      return clip(oneLine(JSON.stringify(input)), 200)
  }
}

/** What came back, boiled down. `err` is a best guess from the shape of the response. */
export const responseSummary = (tool: string, response: unknown): { text: string; err: boolean } => {
  if (tool === 'TodoWrite') return { text: '', err: false }
  if (typeof response === 'string') return { text: clip(oneLine(response), 320), err: false }
  if (!response || typeof response !== 'object') return { text: '', err: false }
  const r = response as Record<string, unknown>
  const err = !!(r.is_error || r.error || r.interrupted)
  if ('stdout' in r || 'stderr' in r) {
    const out = [str(r.stdout), str(r.stderr)].filter(Boolean).join('\n')
    return { text: clip(oneLine(out), 320), err: err || (!!str(r.stderr) && !str(r.stdout)) }
  }
  const file = r.file as { content?: string; numLines?: number } | undefined
  if (file) return { text: `${file.numLines ?? file.content?.split('\n').length ?? '?'} 行`, err }
  if (Array.isArray(r.content)) return { text: clip(oneLine(r.content.map((c: { text?: string }) => c?.text ?? '').join(' ')), 320), err }
  return { text: clip(oneLine(JSON.stringify(r)), 240), err }
}

export class Ledger {
  entries: LedgerEntry[] = []
  seq = 0

  add(entry: Omit<LedgerEntry, 'seq'>): LedgerEntry {
    const e = { ...entry, seq: ++this.seq }
    this.entries.push(e)
    return e
  }

  byKey(key: string): LedgerEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0 && i > this.entries.length - 80; i--) if (this.entries[i].key === key) return this.entries[i]
  }

  /** An entry the model may have read already changed (a call got its result): make it news again. */
  touch(e: LedgerEntry): void {
    e.seq = ++this.seq
  }

  /** Entries the model has already folded into its notes can go. */
  trim(keep: number, seen: number): void {
    const drop = this.entries.findIndex((e, i) => i >= this.entries.length - keep || e.seq > seen)
    if (drop > 0) this.entries.splice(0, drop)
  }
}

export interface HookEffect {
  /** Skip the debounce: something the user should see right away. */
  urgent: boolean
  presence?: Presence
  /** The ledger changed in a way the model should look at. */
  changed: boolean
}

/**
 * What a hook adds on its own: the prompt and the call just made, so they show at once, and what the transcript never
 * holds (a turn's end, notifications). The agent's text and the tools' results are read from the transcript instead.
 */
export const applyHook = (ledger: Ledger, p: HookPayload, session?: string): HookEffect => {
  const ts = Date.now()
  const add = (e: Omit<LedgerEntry, 'seq'>): LedgerEntry => (e.key && ledger.byKey(e.key)) || ledger.add({ ...e, session })
  const agent = p.agent_id ? str(p.agent_type) || 'subagent' : undefined
  const tool = str(p.tool_name)
  switch (p.hook_event_name) {
    case 'UserPromptSubmit':
      add({ ts, kind: 'prompt', text: clip(str(p.prompt), 1200), key: str(p.prompt_id) || undefined })
      return { urgent: true, presence: 'thinking', changed: true }
    case 'PreToolUse':
      // A sub-agent's results stay in its own transcript, so its calls are told as plain steps.
      add({ ts, kind: 'tool', tool, state: agent ? undefined : 'running', text: toolSummary(tool, p.tool_input as Record<string, unknown>), key: str(p.tool_use_id) || undefined, agent })
      return { urgent: false, presence: 'acting', changed: true }
    case 'Stop': {
      const last = str(p.last_assistant_message)
      const tail = ledger.entries.findLast((e) => e.kind === 'assistant' && e.session === session)
      if (last && !(tail && tail.text.includes(last.slice(0, 60)))) add({ ts, kind: 'assistant', text: clip(last, 1500) })
      add({ ts, kind: 'note', text: '本轮结束，智能体在等待用户' })
      return { urgent: true, presence: 'idle', changed: true }
    }
    case 'Notification':
      add({ ts, kind: 'note', text: `通知：${clip(str(p.message), 300)}` })
      return { urgent: true, presence: 'alert', changed: true }
    case 'SessionEnd':
      add({ ts, kind: 'note', text: `智能体已退出（${str(p.reason)}）` })
      return { urgent: true, presence: 'idle', changed: true }
    default:
      return { urgent: false, changed: false }
  }
}

const hms = (ts: number): string => new Date(ts).toTimeString().slice(0, 8)

/** One entry as the model reads it, after `where` it happened: redacted, and blind to anything on the deny lists. */
export const renderEntry = (e: LedgerEntry, config: Config, where?: string): string => {
  let text = e.text
  if (e.kind === 'tool' && (config.denyTools.includes(e.tool ?? '') || config.denyPaths.some((frag) => text.includes(frag)))) text = `${text.split(' → ')[0]} → [内容未发送]`
  const who = { prompt: '用户', assistant: '智能体', tool: `工具 ${e.tool}`, note: '事件', summary: '摘要' }[e.kind]
  const mark = e.state === 'running' ? ' …进行中' : e.state === 'err' ? ' ✗' : e.state === 'ok' ? ' ✓' : ''
  const cost = e.ms ? ` ${e.ms >= 1000 ? `${(e.ms / 1000).toFixed(1)}s` : `${Math.round(e.ms)}ms`}` : ''
  return `[${hms(e.ts)}]${where ? ` ${where}` : ''} ${who}${e.agent ? `(${e.agent})` : ''}${mark}${cost}: ${redact(text)}`
}
