import { z } from 'zod'
import { defineComponents, tone } from './common'

export const components = defineComponents({
  Tabs: {
    props: z.object({
      tabs: z
        .array(
          z.object({
            label: z.string().describe('Short tab title'),
            badge: z.string().optional().describe('Small count or word next to the title, e.g. "3"'),
            tone: tone.optional().describe('Colours the badge; use err/warn for tabs that need attention')
          })
        )
        .max(12),
      active: z.number().int().min(0).max(11).optional().describe('Index of the open tab (default 0). Bind it with {"$bindState":"/tab"} to read or drive it from state')
    }),
    slots: ['default'],
    description:
      'Tabbed container: its children are the panes, in the same order as `tabs` (the first child belongs to the first tab), and only the active pane is shown. Use it to keep a panel compact when it has several parallel views (e.g. 计划 / 事件 / 详情). Put exactly one child per tab, usually a Stack. Fires change with { index }. Do not use it for sequential steps (use Steps) or for a single collapsible block (use Accordion).',
    example: { tabs: [{ label: '计划' }, { label: '事件', badge: '3', tone: 'warn' }], active: 0 }
  },
  Accordion: {
    props: z.object({
      title: z.string().describe('Always visible heading, one line'),
      meta: z.string().optional().describe('Small right-aligned note in the header, e.g. a count'),
      open: z.boolean().optional().describe('Initial open state (default closed). Bind it with {"$bindState":"/open"} to control it from state; the user can still toggle it'),
      tone: tone.optional().describe('Marks the section with a status glyph and edge colour')
    }),
    slots: ['default'],
    description:
      'A collapsible section whose children are shown when it is open. Use it for detail the user does not need at a glance (full logs, a long list of changed files, secondary diagnostics); keep it closed unless the content is what the user must read now. Stack several to make a list of sections. Fires toggle with { open }.',
    example: { title: '改动的文件', meta: '3 个', open: false }
  }
})
