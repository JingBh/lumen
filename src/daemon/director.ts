import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Config } from './config'
import { LUMEN_DIR } from './config'
import { foldHistory } from './fold'
import { Ledger, applyHook } from './ledger'
import { costOf, spent, streamChat, type Usage } from './llm'
import { type Briefing, systemPrompt, userPrompt } from './prompt'
import { applyModelPatch, collectGarbage, createSpec, overBudget } from './spec'
import { codexTitle, parseRollout } from './rollout'
import { parseTranscript } from './transcript'
import type { App, Element, HookPayload, LedgerEntry, Patch, PendingAction, Presence, Spec } from './types'
import { readZcode, zcodeSession } from './zcode'

export interface DirectorEvents {
  /** The whole screen: restored, reset, or for a window that has just connected. */
  load(spec: Spec): void
  /** Validated patches, in order. */
  patch(ops: Patch[]): void
  log(message: string): void
}

export interface Session {
  id: string
  /** The app it runs in. */
  app: App
  /** Short key the model and the screen use for it. */
  key: string
  /** The folder it works in, by name. */
  name: string
  /** The title its app gave it, if any. */
  title?: string
  cwd?: string
  transcript?: string
  presence: Presence
  lastEvent: number
  /** How far its history has been read: bytes of the transcript or rollout, or ZCode's last update time. */
  offset: number
  inbox: PendingAction[]
  ended?: boolean
  /** How many of the QUIET notices it has had since its last event. */
  quiet: number
}

interface Saved {
  savedAt?: number
  notes: string
  spec: Spec
  sessions?: (Pick<Session, 'id' | 'key' | 'cwd' | 'title' | 'transcript' | 'offset' | 'lastEvent'> & { app?: App })[]
  touched?: Record<string, number>
}

const SAVE_FILE = join(LUMEN_DIR, 'screen.json')
const QUIET_MS = 10 * 60_000
// A session quiet for longer is forgotten at the next save; if it comes back it is read in from the start.
const KEEP_MS = 24 * 3_600_000
const MAX_EVENTS_PER_RUN = 80
// The transcript is written a moment after the turn ends; Stop waits for its last lines.
const SETTLE_MS = 1000
// A session is read in from its last hour only: what came before is often settled elsewhere, and an old thread would
// draw the model's attention away from what is happening now.
const HISTORY_MS = 60 * 60_000
// A session that goes quiet is news too: the model hears of it after these silences, so that work can fade from the screen.
const QUIET = [30 * 60_000, 3 * 3_600_000]
// A panel nothing has updated for this long is about the past: it goes, whatever the model would keep.
const PANEL_MS = 60 * 60_000
// A screen saved longer ago than this is out of date: Lumen starts blank instead.
const STALE_MS = 2 * 3_600_000
const RANK: Record<Presence, number> = { idle: 0, thinking: 1, acting: 2, alert: 3 }
const span = (ms: number): string => (ms < 7_200_000 ? `${Math.round(ms / 60_000)} 分钟` : `${Math.round(ms / 3_600_000)} 小时`)

/**
 * One screen for every agent session, in Claude Code, Codex or ZCode. Hooks only say that something changed; the director keeps a ledger of what
 * happened in each session and every so often asks the small model to bring the screen up to date with all of them.
 */
export class Director {
  readonly ledger = new Ledger()
  readonly sessions = new Map<string, Session>()
  spec: Spec = createSpec()
  notes = ''
  presence: Presence = 'idle'
  status: 'idle' | 'loading' | 'running' | 'error' = 'idle'
  visible = false
  paused = false

  private seen = 0
  private running = false
  private timer?: NodeJS.Timeout
  private clock?: NodeJS.Timeout
  private dirty = false
  private majorPending = false
  private due = 0
  private lastRun = 0
  private hiddenAt = Date.now()
  private hourFrom = Date.now()
  /** When the model last wrote each element, so the screen can say how old a panel is. */
  private touched: Record<string, number> = {}
  private failures = 0
  private rejected: string[] = []
  private abort?: AbortController
  private loading?: Promise<void>
  private held: HookPayload[] = []
  private reads = Promise.resolve()
  private disposed = false

  constructor(
    private config: Config,
    private events: DirectorEvents
  ) {}

  // ---------- sessions ----------

  private session(id: string, app: App, transcript?: string, cwd?: string): Session {
    let s = this.sessions.get(id)
    if (!s) {
      // Codex's ids begin with the time and ZCode's with a prefix: their ends tell sessions apart.
      s = { id, app, key: id.slice(-6), name: cwd ? basename(cwd) : id.slice(-6), cwd, transcript, presence: 'idle', lastEvent: Date.now(), offset: 0, inbox: [], quiet: 0 }
      this.sessions.set(id, s)
    }
    s.transcript ??= transcript
    if (cwd && !s.cwd) Object.assign(s, { cwd, name: basename(cwd) })
    return s
  }

  /** What the model calls each session: its folder, with its title when another session works in the same folder. */
  private labels(): Map<string, string> {
    const all = [...this.sessions.values()], out = new Map<string, string>(), used = new Set<string>()
    for (const s of all) {
      const base = s.title && all.some((x) => x !== s && x.name === s.name) ? `${s.name} · ${s.title}` : s.name
      let label = base
      for (let n = 2; used.has(label); n++) label = `${base} (${n})`
      used.add(label)
      out.set(s.key, label)
    }
    return out
  }

  private latest(): Session | undefined {
    return [...this.sessions.values()].filter((s) => !s.ended).sort((a, b) => b.lastEvent - a.lastEvent)[0]
  }

  /** The window's orb shows the busiest of the sessions that are still around. */
  private setPresence(s: Session, next: Presence): void {
    s.presence = next
    const now = Date.now()
    const top = [...this.sessions.values()].filter((x) => !x.ended && now - x.lastEvent < QUIET_MS).reduce<Presence>((a, x) => (RANK[x.presence] > RANK[a] ? x.presence : a), 'idle')
    if (top === this.presence) return
    this.presence = top
    this.spec.state.presence = top
    this.events.patch([{ op: 'replace', path: '/state/presence', value: top }])
  }

  // ---------- input ----------

  /** A hook fired in `app`. Returns at once; the history is read and the ledger updated right after, the model asked later. */
  ingest(p: HookPayload, app: App): void {
    if (!p.session_id) return
    // A ZCode subagent runs as a session of its own: it is told as part of its parent's, as Claude Code's are.
    const parent = app === 'zcode' ? zcodeSession(p.session_id)?.parent : undefined
    if (parent) p = { ...p, session_id: parent, agent_id: p.session_id }
    const known = this.sessions.has(p.session_id)
    // ZCode's transcript_path is a stand-in that is gone once the hook has run.
    const s = this.session(p.session_id, app, app === 'zcode' ? undefined : p.transcript_path, p.cwd)
    s.lastEvent = Date.now()
    s.quiet = 0
    // First sight of a session: its history says how it got here.
    if (this.loading || !known) {
      this.held.push(p)
      if (!this.loading) void this.track(this.catchUp([s]))
      return
    }
    // What the agent said and what its tools returned since the last hook are in its history, not in the payload.
    this.reads = this.reads
      .then(async () => {
        if (p.hook_event_name === 'Stop') await new Promise((r) => setTimeout(r, SETTLE_MS))
        for (const e of await this.read(s)) this.ledger.add(e)
      })
      .catch((e) => this.events.log(`read ${s.name}: ${e instanceof Error ? e.message : String(e)}`))
      .then(() => this.apply(s, p))
  }

  private apply(s: Session, p: HookPayload): void {
    const effect = applyHook(this.ledger, p, s.key)
    if (p.hook_event_name === 'SessionEnd') s.ended = true
    if (effect.presence && !p.agent_id) this.setPresence(s, effect.presence)
    if (effect.presence === 'idle' && !p.agent_id) this.unask(s)
    if (effect.changed) this.schedule(effect.urgent)
  }

  /** Take an element off the screen, with any container it leaves empty. */
  private drop(id: string): Patch[] {
    if (!this.spec.elements[id] || id === 'window' || id === 'shell') return []
    let gone = id
    for (;;) {
      const parent = Object.keys(this.spec.elements).find((k) => this.spec.elements[k].children.includes(gone))
      if (!parent || parent === 'shell' || this.spec.elements[parent].children.length > 1) break
      gone = parent
    }
    delete this.spec.elements[gone]
    return [{ op: 'remove', path: `/elements/${gone}` }, ...collectGarbage(this.spec)]
  }

  /** The user closed something on the screen. It goes, and no agent hears of it. */
  dismiss(id: string, label: string): void {
    const ops = this.drop(id)
    if (!ops.length) return
    this.events.patch(ops)
    this.ledger.add({ ts: Date.now(), kind: 'note', text: `用户关闭了界面上的「${label}」，不作回答，也不要再问` })
    this.save()
    this.schedule(true)
  }

  /** An answer reaches an agent only through its hooks, so one that stops working can take none: its questions go. */
  private unask(s: Session): void {
    const label = this.labels().get(s.key)
    const asks = (on: Element['on']): boolean =>
      Object.values(on ?? {}).flat().some((b) => (b as { action?: string; params?: { to?: string } }).action === 'send' && [label, s.name].includes((b as { params?: { to?: string } }).params?.to ?? ''))
    const ops = Object.keys(this.spec.elements).filter((id) => asks(this.spec.elements[id]?.on)).flatMap((id) => this.drop(id))
    if (!ops.length) return
    this.events.patch(ops)
    this.save()
  }

  /** A click in the window that should reach an agent: the session the action names, else the one that was active last. */
  addAction(label: string, text: string, typed: boolean, target?: string): Session | undefined {
    const labels = this.labels(), named = [...this.sessions.values()].filter((x) => target && (labels.get(x.key) === target || x.name === target))
    const s = named.sort((a, b) => b.lastEvent - a.lastEvent)[0] ?? this.latest()
    if (!s) return undefined
    s.inbox = [...s.inbox, { id: `a${Date.now().toString(36)}`, label, text, ts: Date.now(), typed, session: s.key }].slice(-12)
    this.schedule(true)
    return s
  }

  /** What a hook response should carry back to its agent: the messages the user sent it from the window. */
  deliveries(p: HookPayload): string | undefined {
    if (!['UserPromptSubmit', 'PreToolUse'].includes(p.hook_event_name) || p.agent_id) return undefined
    const items = this.sessions.get(p.session_id)?.inbox.filter((a) => !a.delivered) ?? []
    if (!items.length) return undefined
    for (const a of items) a.delivered = true
    this.schedule(false)
    const lines = items.map((a) => (a.typed ? `[Lumen 界面消息] 用户在 Lumen 的输入框里输入：${a.text}` : `[Lumen 界面消息] 用户在 Lumen 界面上点击了「${a.label}」，要发送的内容是：${a.text}`))
    if (items.some((a) => !a.typed)) lines.push('（按钮文案由界面摘要模型生成。若这与用户此前的意图不符，请先向用户确认再执行。）')
    return lines.join('\n')
  }

  /** Whether anyone can see the screen: the window is open and the screen not locked. */
  setVisible(visible: boolean): void {
    if (this.visible && !visible) this.hiddenAt = Date.now()
    this.visible = visible
    if (visible && this.dirty) this.schedule(true)
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    if (!paused && this.dirty) this.schedule(true)
  }

  /** A window that has just connected gets the whole screen. */
  connect(): void {
    this.events.load(structuredClone(this.spec))
  }

  // ---------- history ----------

  private track(work: Promise<void>): Promise<void> {
    this.status = 'loading'
    this.loading = work
      .catch((e) => this.events.log(`catch-up: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        this.loading = undefined
        this.status = 'idle'
        for (const p of this.held.splice(0)) {
          const s = this.sessions.get(p.session_id)
          if (s) this.apply(s, p)
        }
        this.save()
        this.schedule(true)
      })
    return this.loading
  }

  /**
   * At start-up: restore the last screen unless it is out of date, and tell the model it may be. A session is read in
   * when it next fires a hook, however long it was quiet.
   */
  start(): void {
    this.clock = setInterval(() => this.tick(), 60_000)
    const saved = this.restore()
    if (!saved?.savedAt || Date.now() - saved.savedAt > STALE_MS) return
    this.notes = saved.notes
    this.spec = saved.spec
    this.touched = saved.touched ?? {}
    collectGarbage(this.spec)
    for (const x of saved.sessions ?? []) this.sessions.set(x.id, { ...x, app: x.app ?? 'claude-code', name: x.cwd ? basename(x.cwd) : x.key, presence: 'idle', inbox: [], quiet: 0 })
    this.connect()
    if (!this.spec.elements.shell.children.length) return
    this.ledger.add({ ts: Date.now(), kind: 'note', text: `Lumen 重启了：屏幕和笔记停在 ${new Date(saved.savedAt).toTimeString().slice(0, 5)}，此后的事还不知道` })
    this.schedule(true)
  }

  /** Every minute: tell the model about sessions that have gone quiet, forget the ones long gone, and clear old panels. */
  private tick(): void {
    const now = Date.now()
    if (now - this.hourFrom >= 3_600_000) {
      if (spent.calls) this.events.log(`hour: ${spent.calls} calls, ${this.tokens(spent)}`)
      Object.assign(spent, { calls: 0, input: 0, cached: 0, output: 0 })
      this.hourFrom = now
    }
    for (const s of this.sessions.values()) {
      const due = QUIET.filter((t) => now - s.lastEvent > t).length
      if (now - s.lastEvent > KEEP_MS) this.sessions.delete(s.id)
      else if (!s.ended && due > s.quiet) {
        s.quiet = due
        this.ledger.add({ ts: now, kind: 'note', text: `已经 ${span(now - s.lastEvent)}没有新动静`, session: s.key })
        this.schedule(false)
      }
    }
    const old = this.spec.elements.shell.children.filter((id) => now - this.updated(id) > PANEL_MS)
    if (!old.length) return
    this.events.patch(old.flatMap((id) => this.drop(id)))
    this.save()
  }

  /** When anything in an element's subtree was last written by the model; 0 for a screen saved before that was kept. */
  private updated(id: string): number {
    return Math.max(this.touched[id] ?? 0, ...(this.spec.elements[id]?.children ?? []).map((c) => this.updated(c)))
  }

  /** What a session's history gained since it was last read: Claude Code's transcript, Codex's rollout or ZCode's database. */
  private async read(s: Session): Promise<LedgerEntry[]> {
    const known = (key: string): LedgerEntry | undefined => this.ledger.byKey(key)
    const parsed = s.app === 'zcode' ? readZcode(s.id, s.offset, known) : s.transcript ? await (s.app === 'codex' ? parseRollout : parseTranscript)(s.transcript, s.offset, known) : undefined
    if (!parsed) return []
    s.offset = parsed.offset
    const title = s.app === 'codex' ? codexTitle(s.id) : parsed.title
    if (title) s.title = title
    if (parsed.cwd && !s.cwd) Object.assign(s, { cwd: parsed.cwd, name: basename(parsed.cwd) })
    for (const e of parsed.done) this.ledger.touch(e)
    return parsed.entries.map((e) => ({ ...e, session: s.key }) as LedgerEntry)
  }

  /** Read every session in the list from where it was left. A long past is condensed in the background, not waited for. */
  private async catchUp(list: Session[]): Promise<void> {
    const fresh: LedgerEntry[] = []
    for (const s of list) {
      const first = s.offset === 0
      const since = Date.now() - HISTORY_MS
      const entries = (await this.read(s)).filter((e) => e.ts >= since)
      const older = entries.slice(0, -30)
      if (first && older.reduce((n, e) => n + e.text.length, 0) > 2500) {
        void this.fold(s, older)
        fresh.push(...entries.slice(-30))
      } else fresh.push(...entries.slice(-MAX_EVENTS_PER_RUN))
    }
    for (const e of fresh.sort((a, b) => a.ts - b.ts)) this.ledger.add(e)
  }

  /** The condensed past reaches the model as one more event, dated where it ends. */
  private async fold(s: Session, older: LedgerEntry[]): Promise<void> {
    const started = Date.now()
    try {
      const text = await foldHistory(this.config, older, s.name)
      this.events.log(`folded ${older.length} earlier entries of ${s.name} in ${((Date.now() - started) / 1000).toFixed(1)}s`)
      if (!text) return
      this.ledger.add({ ts: older[older.length - 1].ts, kind: 'summary', text: `Lumen 接入之前的经过：${text}`, session: s.key })
      this.schedule(true)
    } catch (e) {
      this.events.log(`fold ${s.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** Forget the screen and the notes, then read the sessions still around again from the start. */
  reset(): Promise<void> {
    this.abort?.abort()
    this.spec = createSpec()
    this.spec.state.presence = this.presence
    this.notes = ''
    this.touched = {}
    this.seen = 0
    this.ledger.entries = []
    this.rejected = []
    for (const s of this.sessions.values()) s.offset = 0
    this.connect()
    return this.track(this.catchUp([...this.sessions.values()].filter((s) => !s.ended)))
  }

  private restore(): Saved | undefined {
    try {
      return JSON.parse(readFileSync(SAVE_FILE, 'utf8')) as Saved
    } catch {
      return undefined
    }
  }

  private save(): void {
    try {
      mkdirSync(LUMEN_DIR, { recursive: true })
      const now = Date.now()
      const sessions = [...this.sessions.values()].filter((s) => !s.ended && now - s.lastEvent < KEEP_MS).map(({ id, app, key, cwd, title, transcript, offset, lastEvent }) => ({ id, app, key, cwd, title, transcript, offset, lastEvent }))
      const touched = Object.fromEntries(Object.entries(this.touched).filter(([id]) => id in this.spec.elements))
      writeFileSync(SAVE_FILE, JSON.stringify({ savedAt: now, notes: this.notes, spec: this.spec, sessions, touched } satisfies Saved))
    } catch {
      // the screen is rebuilt from the sessions' histories next time
    }
  }

  // ---------- scheduling ----------

  /** Tokens as the log shows them, with what they cost when a price is set. */
  private tokens(u: Usage): string {
    const k = (n: number): string => `${(n / 1000).toFixed(1)}k`
    const cost = costOf(this.config, u)
    return `${k(u.input)} in (${k(u.cached)} cached), ${k(u.output)} out${cost != null ? `, cost ${cost.toFixed(4)}` : ''}`
  }

  /** Nobody has been able to see the screen for a while: the window is folded into the orb, or the screen is locked. */
  private away(): boolean {
    return !this.visible && Date.now() - this.hiddenAt > this.config.pauseAfterMs
  }

  /** An important event is shown within seconds; tool calls and other small ones wait for the next interval. */
  private schedule(major: boolean): void {
    if (this.disposed) return
    this.dirty = true
    if (major) this.majorPending = true
    if (this.paused || this.loading || this.away()) return
    const now = Date.now()
    const backoff = this.failures ? Math.min(60_000, 4000 * 2 ** (this.failures - 1)) : 0
    const want = Math.max(major ? now + this.config.majorDelayMs : this.lastRun + this.config.minorIntervalMs, now, this.lastRun + backoff)
    this.due = this.due ? Math.min(this.due, want) : want
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.run(), this.due - now)
  }

  private async run(): Promise<void> {
    this.due = 0
    if (this.running || this.paused || this.disposed || this.away()) return
    const fresh = this.ledger.entries.filter((e) => e.seq > this.seen)
    const actions = [...this.sessions.values()].flatMap((s) => s.inbox)
    this.dirty = this.majorPending = false
    if (!fresh.length && !actions.some((a) => a.ts > this.lastRun)) return
    this.running = true
    this.lastRun = Date.now()
    const started = this.lastRun
    this.status = 'running'
    const upto = this.ledger.seq
    const events = fresh.slice(-MAX_EVENTS_PER_RUN)
    this.abort = new AbortController()
    const now = Date.now()
    const labels = this.labels()
    const briefing: Briefing = {
      notes: this.notes,
      spec: this.spec,
      events,
      actions,
      sessions: [...this.sessions.values()].map((s) => ({ key: s.key, app: s.app, label: labels.get(s.key) ?? s.name, title: s.title, state: s.ended ? 'exited' : s.presence, idleMs: now - s.lastEvent })),
      rejected: this.rejected,
      ages: Object.fromEntries(this.spec.elements.shell.children.map((id) => [id, now - this.updated(id)])),
      first: !this.notes && this.seen === 0 && !this.spec.elements.shell.children.length
    }
    const rejected: string[] = []
    let ops = 0
    let used: Usage | undefined
    const apply = (obj: { op?: string; path?: string; value?: unknown }): void => {
      if (obj.path === '/notes' && typeof obj.value === 'string') this.notes = obj.value.slice(0, 2400)
      else if (obj.path === '/status' && typeof obj.value === 'string') {
        const status = obj.value.slice(0, 160)
        this.spec.elements.window.props.status = status
        this.events.patch([{ op: 'replace', path: '/elements/window/props/status', value: status }])
        ops++
      } else {
        const v = applyModelPatch(this.spec, obj)
        const id = obj.path?.startsWith('/elements/') ? obj.path.split('/')[2] : undefined
        if (v.ok && id && id !== 'shell') this.touched[id] = Date.now()
        if (v.ok) {
          ops++
          this.events.patch([v.patch])
        } else rejected.push(`${obj.op} ${obj.path}: ${v.reason}`)
      }
    }
    // One operation per line is the contract; an operation spread over several lines is still accepted.
    let partial = ''
    const handle = (raw: string): void => {
      const t = raw.trim()
      if (!t || /^```/.test(t)) return
      if (partial && t.startsWith('{"op"')) {
        rejected.push(`not valid JSON: ${partial.slice(0, 80)}`)
        partial = ''
      }
      partial = partial ? partial + t : t.startsWith('{') ? t : ''
      if (!partial) return
      try {
        const obj = JSON.parse(partial)
        partial = ''
        apply(obj)
      } catch {
        if (partial.length > 30_000) {
          rejected.push(`not valid JSON: ${partial.slice(0, 80)}`)
          partial = ''
        }
      }
    }
    try {
      let buf = ''
      const user = userPrompt(briefing, this.config)
      if (process.env.LUMEN_DEBUG) writeFileSync(join(LUMEN_DIR, 'last-prompt.txt'), user)
      for await (const delta of streamChat(this.config, { maxTokens: 3500, signal: this.abort.signal, onUsage: (u) => (used = u), messages: [{ role: 'system', content: systemPrompt() }, { role: 'user', content: user }] })) {
        buf += delta
        let i: number
        while ((i = buf.indexOf('\n')) >= 0) {
          handle(buf.slice(0, i))
          buf = buf.slice(i + 1)
        }
      }
      handle(buf)
      if (partial) rejected.push(`incomplete JSON at the end: ${partial.slice(0, 80)}`)
      // Only Panels sit in the shell: a wrapper around panels gives way to them, anything else goes, and the model hears why.
      const shell = this.spec.elements.shell
      const panels = (id: string): string[] => (this.spec.elements[id]?.type === 'Panel' ? [id] : (this.spec.elements[id]?.children ?? []).flatMap(panels))
      const loose = shell.children.filter((id) => this.spec.elements[id] && this.spec.elements[id].type !== 'Panel')
      if (loose.length) {
        shell.children = shell.children.flatMap(panels)
        this.events.patch([{ op: 'replace', path: '/elements/shell/children', value: shell.children }])
        rejected.push(`the children of shell must be Panels; ${loose.join(', ')} gave way to the panels inside or went`)
      }
      const gc = collectGarbage(this.spec)
      if (gc.length) this.events.patch(gc)
      if (overBudget(this.spec)) rejected.push('the screen is too large: remove obsolete panels')
      this.seen = upto
      this.failures = 0
      this.rejected = rejected.slice(0, 6)
      this.status = 'idle'
      this.events.log(`run: ${events.length} events → ${ops} ops in ${((Date.now() - started) / 1000).toFixed(1)}s${used ? `, ${this.tokens(used)}` : ''}${rejected.length ? `, ${rejected.length} rejected: ${rejected.slice(0, 3).map((r) => r.slice(0, 160)).join(' | ')}` : ''}`)
      this.ledger.trim(60, this.seen)
      this.save()
    } catch (e) {
      if (this.disposed) return
      this.failures++
      this.status = 'error'
      this.events.log(`run failed (${this.failures}): ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      this.running = false
      if (!this.disposed && (this.ledger.seq > this.seen || this.failures)) this.schedule(this.majorPending)
    }
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
    clearInterval(this.clock)
    this.abort?.abort()
  }
}
