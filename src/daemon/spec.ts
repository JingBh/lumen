import { components } from '../catalog'
import type { Element, Patch, Spec } from './types'

// The screen is a json-render spec. The daemon owns the frame (`window`, `shell`, `/state/presence`);
// the model edits what is inside the shell, one validated JSON Patch operation at a time.

export const ALLOWED_ACTIONS = new Set(['send', 'open_url', 'copy', 'setState', 'pushState', 'removeState'])
const PROTECTED = new Set(['window', 'shell'])
const MAX_ELEMENTS = 180
const MAX_STRING = 4000
const MAX_ARRAY = 400
const MAX_BYTES = 160_000
const FORBIDDEN_KEY = new Set(['__proto__', 'constructor', 'prototype'])

export const createSpec = (): Spec => ({
  root: 'window',
  elements: {
    window: { type: 'Window', props: { label: 'Lumen', presence: { $state: '/presence' }, status: '等待 Claude Code', collapsed: true }, children: ['shell'] },
    shell: { type: 'Shell', props: {}, children: [] }
  },
  state: { presence: 'idle' }
})

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isExpr = (v: unknown): boolean => isObj(v) && Object.keys(v).some((k) => k.startsWith('$'))
const clone = <T>(v: T): T => structuredClone(v)

/** Bound what a model can put on the screen: string length, array length, depth, prototype keys. */
const sanitize = (v: unknown, depth = 0): unknown => {
  if (typeof v === 'string') return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}…` : v
  if (Array.isArray(v)) return depth > 8 ? [] : v.slice(0, MAX_ARRAY).map((x) => sanitize(x, depth + 1))
  if (isObj(v)) {
    if (depth > 8) return {}
    return Object.fromEntries(Object.entries(v).filter(([k]) => !FORBIDDEN_KEY.has(k)).map(([k, x]) => [k, sanitize(x, depth + 1)]))
  }
  return v
}

const lookup = (root: unknown, path: (string | number)[]): unknown => path.reduce<unknown>((o, k) => (o as Record<string | number, unknown> | undefined)?.[k], root)

/** zod, except that props bound to an expression ({$state…}) are not checked: their value only exists at render time. */
export const checkProps = (type: string, props: Record<string, unknown>): string | null => {
  const def = components[type as keyof typeof components]
  if (!def) return `unknown component ${type}`
  const r = def.props.safeParse(props)
  if (r.success) return null
  const real = r.error.issues.filter((i) => !i.path.some((_, n) => isExpr(lookup(props, i.path.slice(0, n + 1) as (string | number)[]))))
  return real.length ? real.slice(0, 3).map((i) => `${[type, ...i.path].join('.')}: ${i.message}`).join('; ') : null
}

const cleanOn = (on: unknown): Element['on'] | undefined => {
  if (!isObj(on)) return undefined
  const out: Record<string, unknown> = {}
  for (const [event, binding] of Object.entries(on)) {
    const list = (Array.isArray(binding) ? binding : [binding]).filter((b) => isObj(b) && typeof b.action === 'string' && ALLOWED_ACTIONS.has(b.action))
    if (list.length) out[event] = list.length === 1 ? list[0] : list
  }
  return Object.keys(out).length ? out : undefined
}

/** Normalise an element the model wrote; null with a reason when it cannot be used. */
export const cleanElement = (id: string, value: unknown): { el: Element } | { error: string } => {
  if (!isObj(value)) return { error: `${id}: not an object` }
  const type = value.type
  if (typeof type !== 'string' || !(type in components)) return { error: `${id}: unknown component ${String(type)}` }
  const props = sanitize(isObj(value.props) ? value.props : {}) as Record<string, unknown>
  const children = Array.isArray(value.children) ? value.children.filter((c): c is string => typeof c === 'string').slice(0, 80) : []
  const def = components[type as keyof typeof components]
  if (!def.slots.length && children.length) return { error: `${id}: ${type} cannot have children` }
  for (const k of Object.keys(props)) if (!(k in def.props.shape)) delete props[k]
  const error = checkProps(type, props)
  if (error) return { error }
  const el: Element = { type, props, children }
  const on = cleanOn(value.on)
  if (on) el.on = on
  if (value.visible !== undefined) el.visible = sanitize(value.visible)
  if (isObj(value.repeat)) el.repeat = sanitize(value.repeat)
  return { el }
}

const segments = (path: string): string[] | null => {
  if (!path.startsWith('/')) return null
  const keys = path.split('/').slice(1).map((k) => k.replace(/~1/g, '/').replace(/~0/g, '~'))
  return keys.some((k) => FORBIDDEN_KEY.has(k)) ? null : keys
}

const setIn = (root: Record<string, unknown>, keys: string[], op: Patch['op'], value: unknown): boolean => {
  const last = keys[keys.length - 1]
  let target: unknown = root
  for (const k of keys.slice(0, -1)) {
    if (!isObj(target) && !Array.isArray(target)) return false
    const t = target as Record<string, unknown>
    if (t[k] === undefined) {
      if (op === 'remove') return false
      t[k] = {}
    }
    target = t[k]
  }
  if (Array.isArray(target)) {
    const i = last === '-' ? target.length : Number(last)
    if (!Number.isInteger(i) || i < 0 || i > target.length) return false
    if (op === 'add') target.splice(i, 0, value)
    else if (op === 'replace') target[i] = value
    else target.splice(i, 1)
    return true
  }
  if (!isObj(target)) return false
  if (op === 'remove') delete target[last]
  else target[last] = value
  return true
}

export type Verdict = { ok: true; patch: Patch } | { ok: false; reason: string }

/** Apply one model patch to `spec` if it is allowed; the returned patch is what to forward to the window. */
export const applyModelPatch = (spec: Spec, raw: unknown): Verdict => {
  if (!isObj(raw) || (raw.op !== 'add' && raw.op !== 'replace' && raw.op !== 'remove') || typeof raw.path !== 'string') return { ok: false, reason: 'not a patch' }
  const op = raw.op as Patch['op']
  const keys = segments(raw.path)
  if (!keys) return { ok: false, reason: `bad path ${raw.path}` }
  const value = op === 'remove' ? undefined : sanitize(raw.value)

  if (keys[0] === 'state') {
    if (keys.length < 2) return { ok: false, reason: 'cannot replace the whole state' }
    if (keys[1] === 'presence') return { ok: false, reason: 'state key presence is reserved' }
    const next = clone(spec.state)
    if (!setIn(next, keys.slice(1), op, value)) return { ok: false, reason: `cannot apply ${op} ${raw.path}` }
    spec.state = next
    return { ok: true, patch: { op, path: raw.path, value } }
  }

  if (keys[0] !== 'elements' || keys.length < 2) return { ok: false, reason: `path ${raw.path} is not editable` }
  const id = keys[1]
  if (id === 'shell' && keys.length === 2 && op !== 'remove' && isObj(value) && Array.isArray(value.children)) return applyModelPatch(spec, { op: 'replace', path: '/elements/shell/children', value: value.children })
  if (PROTECTED.has(id) && !(id === 'shell' && keys[2] === 'children')) return { ok: false, reason: `${id} is part of the frame` }

  if (keys.length === 2) {
    if (op === 'remove') {
      delete spec.elements[id]
      return { ok: true, patch: { op, path: raw.path } }
    }
    const r = cleanElement(id, value)
    if ('error' in r) return { ok: false, reason: r.error }
    if (!spec.elements[id] && Object.keys(spec.elements).length >= MAX_ELEMENTS) return { ok: false, reason: 'too many elements' }
    spec.elements[id] = r.el
    return { ok: true, patch: { op: 'add', path: raw.path, value: r.el } }
  }

  // Inside an element: edit a copy, re-validate the whole element, keep it only if it still holds together.
  const current = spec.elements[id]
  if (!current) return { ok: false, reason: `${id} does not exist` }
  if (!['props', 'children', 'on', 'visible', 'repeat'].includes(keys[2])) return { ok: false, reason: `cannot edit ${keys[2]}` }
  const draft = clone(current) as unknown as Record<string, unknown>
  if (!setIn(draft, keys.slice(2), op, value)) return { ok: false, reason: `cannot apply ${op} ${raw.path}` }
  if (id === 'shell') {
    const kids = draft.children
    if (!Array.isArray(kids) || kids.some((c) => typeof c !== 'string')) return { ok: false, reason: 'shell.children must be strings' }
    spec.elements.shell = { ...current, children: (kids as string[]).slice(0, 40) }
    return { ok: true, patch: { op, path: raw.path, value } }
  }
  const r = cleanElement(id, draft)
  if ('error' in r) return { ok: false, reason: r.error }
  spec.elements[id] = r.el
  return { ok: true, patch: { op, path: raw.path, value } }
}

/** Drop what the screen can no longer reach or draw, and references to what does not exist. Returns the patches that did it. */
export const collectGarbage = (spec: Spec): Patch[] => {
  const patches: Patch[] = []
  // A screen saved by an older version can hold components that are gone.
  for (const [id, el] of Object.entries(spec.elements)) if (!PROTECTED.has(id) && !(el.type in components)) delete spec.elements[id]
  for (const [id, el] of Object.entries(spec.elements)) {
    const kids = el.children.filter((c) => c in spec.elements && c !== id)
    if (kids.length !== el.children.length) {
      el.children = kids
      patches.push({ op: 'replace', path: `/elements/${id}/children`, value: kids })
    }
  }
  const live = new Set<string>()
  const walk = (id: string): void => {
    if (live.has(id) || !spec.elements[id]) return
    live.add(id)
    spec.elements[id].children.forEach(walk)
  }
  walk(spec.root)
  for (const id of Object.keys(spec.elements)) {
    if (live.has(id)) continue
    delete spec.elements[id]
    patches.push({ op: 'remove', path: `/elements/${id}` })
  }
  return patches
}

export const specBytes = (spec: Spec): number => JSON.stringify(spec).length
export const overBudget = (spec: Spec): boolean => specBytes(spec) > MAX_BYTES || Object.keys(spec.elements).length > MAX_ELEMENTS
