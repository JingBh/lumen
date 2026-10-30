import { z } from 'zod'

// Status tones carry meaning (see the design system); `accent` is the palette colour, `muted` is neutral.
export const tone = z.enum(['ok', 'warn', 'serious', 'err', 'accent', 'muted'])

export interface ComponentDef {
  props: z.ZodObject<z.ZodRawShape>
  /** [] for a leaf, ['default'] when the element's `children` are rendered inside it. */
  slots: string[]
  /** What it shows and when to pick it, written for the model that composes the UI. */
  description: string
  example?: Record<string, unknown>
}

export const defineComponents = <T extends Record<string, ComponentDef>>(components: T): T => components
