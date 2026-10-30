import { defineSchema, type PromptContext } from '@json-render/core'
import type { ComponentDef } from './common'

interface CatalogData {
  components: Record<string, ComponentDef>
  actions: Record<string, { params?: unknown; description: string }>
}

// The parts of a zod 4 schema the prompt reads.
interface Zod {
  description?: string
  minValue?: number | null
  maxValue?: number | null
  _zod: { def: { type: string; innerType?: Zod; element?: Zod; shape?: Record<string, Zod>; options?: Zod[]; checks?: { _zod: { def: { check: string; maximum?: number } } }[] } }
}

const bound = (v: number | null | undefined): number | undefined => (v != null && Math.abs(v) < 1e9 ? v : undefined)

/** What each prop means, its unit and its range, one line per prop, nested ones included: the type line alone loses them. */
const propNotes = (z: Zod, path = '', out: string[] = []): string[] => {
  let s = z, desc = z.description
  while (['optional', 'nullable', 'default'].includes(s._zod.def.type) && s._zod.def.innerType) {
    s = s._zod.def.innerType
    desc ??= s.description
  }
  const def = s._zod.def
  const num = def.type === 'number' ? s : def.type === 'union' ? def.options?.find((o) => o._zod.def.type === 'number') : undefined
  const [lo, hi] = [bound(num?.minValue), bound(num?.maxValue)]
  const most = def.type === 'array' ? def.checks?.find((c) => c._zod.def.check === 'max_length')?._zod.def.maximum : undefined
  const bits = [desc, lo != null && hi != null ? `${lo}–${hi}` : lo != null ? `≥ ${lo}` : hi != null ? `≤ ${hi}` : '', most != null ? `at most ${most}` : ''].filter(Boolean)
  if (path && bits.length) out.push(`    ${path}: ${bits.join('; ')}`)
  if (def.type === 'object') for (const [k, v] of Object.entries(def.shape ?? {})) propNotes(v, path ? `${path}.${k}` : k, out)
  if (def.type === 'array' && def.element) propNotes(def.element, `${path}[]`, out)
  return out
}

// Only the reference part of the prompt: the daemon writes the instructions around it.
const promptTemplate = ({ catalog, formatZodType, options }: PromptContext<CatalogData>): string => {
  const components = Object.entries(catalog.components).map(([name, def]) => {
    const lines = [`- ${name}${def.slots.length ? ' (container: children render inside)' : ''}: ${def.description}`, `  props: ${formatZodType(def.props)}`, ...propNotes(def.props as unknown as Zod)]
    if (def.example) lines.push(`  example props: ${JSON.stringify(def.example)}`)
    return lines.join('\n')
  })
  const actions = Object.entries(catalog.actions).map(([name, def]) => `- ${name}: ${def.description}`)
  return [`${options.system ?? ''}`, 'COMPONENTS:', ...components, '', 'ACTIONS (used in an element\'s `on`):', ...actions, '', ...(options.customRules ?? [])].join('\n')
}

// The flat spec of json-render, plus `on` (event bindings) and top-level `state`.
export const schema = defineSchema(
  (s) => ({
    spec: s.object({
      root: s.string(),
      elements: s.record(
        s.object({
          type: s.ref('catalog.components'),
          props: s.propsOf('catalog.components'),
          children: s.array(s.string()),
          visible: { ...s.any(), ...s.optional() },
          repeat: { ...s.any(), ...s.optional() },
          on: { ...s.any(), ...s.optional() }
        })
      )
    }),
    catalog: s.object({
      components: s.map({
        props: s.zod(),
        slots: s.array(s.string()),
        description: s.string(),
        example: s.any()
      }),
      actions: s.map({
        params: s.zod(),
        description: s.string()
      })
    })
  }),
  {
    builtInActions: [
      { name: 'setState', description: 'Update a value in the state model. Params: { statePath: string, value: any }' },
      { name: 'pushState', description: 'Append an item to an array in state. Params: { statePath: string, value: any }' },
      { name: 'removeState', description: 'Remove an item from an array in state. Params: { statePath: string, index: number }' }
    ],
    defaultRules: [],
    promptTemplate: promptTemplate as never
  }
)
