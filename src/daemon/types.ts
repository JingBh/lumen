export interface Element {
  type: string
  props: Record<string, unknown>
  children: string[]
  on?: Record<string, unknown>
  visible?: unknown
  repeat?: unknown
}

export interface Spec {
  root: string
  elements: Record<string, Element>
  state: Record<string, unknown>
}

export interface Patch {
  op: 'add' | 'replace' | 'remove'
  path: string
  value?: unknown
}

export type Presence = 'idle' | 'thinking' | 'acting' | 'alert'

/** The coding agent apps whose plugins report to Lumen; each forwards its hooks naming itself. */
export const APPS = ['claude-code', 'codex', 'zcode'] as const
export type App = (typeof APPS)[number]

export interface LedgerEntry {
  seq: number
  ts: number
  kind: 'prompt' | 'assistant' | 'tool' | 'note' | 'summary'
  text: string
  tool?: string
  state?: 'running' | 'ok' | 'err'
  ms?: number
  /** tool_use_id or prompt id, so the hook and the transcript report it once */
  key?: string
  agent?: string
  /** The session's short key, when several sessions share the screen. */
  session?: string
}

export interface PendingAction {
  id: string
  text: string
  label: string
  ts: number
  delivered?: boolean
  /** Typed by the user (an Input), as opposed to a button whose text the summarizer wrote. */
  typed?: boolean
  /** Key of the session it goes to. */
  session: string
}

export interface HookPayload {
  hook_event_name: string
  session_id: string
  transcript_path?: string
  cwd?: string
  agent_id?: string
  agent_type?: string
  [key: string]: unknown
}

/** What the daemon sends to the window. */
export interface Outbox {
  load(spec: Spec): void
  patch(ops: Patch[]): void
  toast(text: string): void
}
