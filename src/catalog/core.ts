import { z } from 'zod'
import { defineComponents, tone } from './common'

const span = z.union([z.number().int().min(1).max(4), z.literal('full')])
const series = z.array(z.number())

export const components = defineComponents({
  Panel: {
    props: z.object({
      title: z.string().describe('Short heading in the panel header'),
      meta: z.string().optional().describe('Small right-aligned note in the header, e.g. a count or "实时"'),
      span: span.optional().describe('Columns it is wide (1 by default). Columns are about 14rem, as many as the window fits; "full" = all of them'),
      rows: z.number().int().min(1).max(4).optional().describe('Minimum height in steps of about 9rem, for content that should stand tall'),
      tone: tone.optional().describe('Tints the panel edge to signal status'),
      scroll: z.boolean().optional().describe('Scroll the body instead of growing'),
      maxHeight: z.number().optional().describe('Max body height in rem when scroll is on')
    }),
    slots: ['default'],
    description:
      'The basic card of the workspace. Every piece of content lives in a Panel that is a direct child of the Shell; panels are packed into a mosaic of narrow columns, each at its own height. One idea per panel.',
    example: { title: '当前进展', meta: '3 / 6' }
  },
  Stack: {
    props: z.object({ gap: z.number().optional().describe('Space between children in rem, 0–4'), align: z.enum(['start', 'center', 'end', 'stretch']).optional(), grow: z.boolean().optional() }),
    slots: ['default'],
    description: 'Vertical flow of children inside a panel.'
  },
  Row: {
    props: z.object({ gap: z.number().optional().describe('Space between children in rem, 0–4'), align: z.enum(['start', 'center', 'end', 'stretch']).optional(), grow: z.boolean().optional() }),
    slots: ['default'],
    description: 'Horizontal flow of children that wraps when the panel is narrow. Good for buttons and badges.'
  },
  Grid: {
    props: z.object({ min: z.number().min(4).max(40).optional().describe('Minimum column width in rem (default 10); columns fit the container'), gap: z.number().min(0).max(4).optional() }),
    slots: ['default'],
    description: 'Responsive grid of equal cells (auto-fit columns). Use for rows of Metric or Gauge.'
  },
  Heading: {
    props: z.object({ text: z.string(), sub: z.string().optional() }),
    slots: [],
    description: 'A heading with an optional subtitle, for the top of a panel that needs one.'
  },
  Text: {
    props: z.object({ text: z.string(), size: z.enum(['sm', 'lg']).optional() }),
    slots: [],
    description: 'A paragraph of plain text. Use sm for secondary notes, lg for a key sentence.',
    example: { text: '重启时间与 GRE 隧道抖动高度吻合。' }
  },
  Message: {
    props: z.object({
      text: z.string().describe('What the agent is saying or doing now, one or two sentences'),
      state: z.enum(['idle', 'thinking', 'acting', 'alert']).optional().describe('Colours the rule beside the text')
    }),
    slots: [],
    description: 'The agent\'s current statement with a small presence orb: use it for "what is happening right now".'
  },
  Callout: {
    props: z.object({ tone: tone.optional(), title: z.string().optional(), text: z.string().optional() }),
    slots: [],
    description: 'A highlighted finding, warning or conclusion. Tone sets urgency (ok, warn, serious, err, accent).',
    example: { tone: 'warn', title: '根因很可能在 GRE 隧道', text: '38 次重启全部落在丢包超过 5% 的窗口内。' }
  },
  Badge: {
    props: z.object({ text: z.string(), tone: tone.optional() }),
    slots: [],
    description: 'A small status label with a status glyph.'
  },
  Divider: {
    props: z.object({ label: z.string().optional() }),
    slots: [],
    description: 'A thin rule, optionally with a label, to separate groups inside a panel.'
  },
  Button: {
    props: z.object({
      label: z.string(),
      kind: z.enum(['primary', 'ghost', 'danger']).optional(),
      action: z.string().optional().describe('Legacy; prefer on.press')
    }),
    slots: [],
    description:
      'A button. Attach behaviour with the element\'s `on`: {"press":{"action":"send","params":{"text":"..."}}}. Only offer buttons whose outcome is a message the user could plausibly send to the agent.'
  },
  Code: {
    props: z.object({ text: z.string() }),
    slots: [],
    description: 'Monospace block for a short config, command or log excerpt (no syntax highlighting). Prefer Snippet for real source code.'
  },
  KeyValue: {
    props: z.object({ items: z.array(z.object({ k: z.string(), v: z.string(), mono: z.boolean().optional() })) }),
    slots: [],
    description: 'Two-column facts list (label → value). Use for attributes of one thing: branch, node, version, owner.',
    example: { items: [{ k: '节点', v: 'edge-node-3' }, { k: '分支', v: 'main', mono: true }] }
  },
  Metric: {
    props: z.object({
      label: z.string(),
      value: z.union([z.number(), z.string()]),
      unit: z.string().optional(),
      delta: z.string().optional().describe('Change, e.g. "+12" or "-3.2%"'),
      deltaTone: tone.optional(),
      hint: z.string().optional(),
      trend: series.optional().describe('Sparkline samples, oldest first'),
      tone: tone.optional(),
      digits: z.number().int().optional()
    }),
    slots: [],
    description: 'One big number with an optional trend sparkline. The numeral shrinks to fit. Put several in a Grid.',
    example: { label: '错误率', value: 0.42, unit: '%', trend: [0.3, 0.5, 0.4, 0.42] }
  },
  Gauge: {
    props: z.object({
      label: z.string(),
      value: z.number(),
      max: z.number().optional().describe('Default 100'),
      unit: z.string().optional(),
      thresholds: z.tuple([z.number(), z.number()]).optional().describe('[warn, err] levels; the gauge changes colour when crossed'),
      tone: tone.optional(),
      digits: z.number().int().optional()
    }),
    slots: [],
    description: 'Segmented radial gauge for a bounded quantity such as CPU, memory, context usage.',
    example: { label: 'CPU', value: 59, unit: '%', thresholds: [70, 90] }
  },
  Progress: {
    props: z.object({ label: z.string().optional(), value: z.number(), max: z.number().optional().describe('Default 100'), text: z.string().optional().describe('Right-aligned readout, e.g. "3 / 6"'), tone: tone.optional() }),
    slots: [],
    description: 'Segmented progress bar for completion of a task or a plan.',
    example: { label: '进度', value: 3, max: 6, text: '3 / 6' }
  },
  Donut: {
    props: z.object({
      label: z.string().optional().describe('Caption in the centre'),
      center: z.string().optional(),
      items: z.array(z.object({ label: z.string(), value: z.number(), tone: tone.optional() }))
    }),
    slots: [],
    description: 'Part-to-whole ring with a legend. Use tones for statuses (running / waiting / failed).'
  },
  Tiles: {
    props: z.object({
      min: z.number().min(2).max(16).optional().describe('Minimum tile width in rem'),
      items: z.array(z.object({ label: z.string(), sub: z.string().optional(), tone: tone.optional() }))
    }),
    slots: [],
    description: 'A wall of small status cells, one per item (nodes, pods, tests, jobs). Colour = state. Handles hundreds of items.'
  },
  BarList: {
    props: z.object({ items: z.array(z.object({ label: z.string(), value: z.number(), tone: tone.optional() })), max: z.number().optional(), unit: z.string().optional() }),
    slots: [],
    description: 'Ranked horizontal bars: a leaderboard or breakdown by category.'
  },
  Steps: {
    props: z.object({
      items: z.array(
        z.object({
          label: z.string(),
          state: z.enum(['done', 'active', 'pending', 'failed']).optional().describe('Default pending'),
          meta: z.string().optional().describe('Right-aligned, e.g. a duration'),
          detail: z.string().optional().describe('Second line of grey text')
        })
      )
    }),
    slots: [],
    description: 'The agent\'s plan as a vertical stepper. Exactly one step should be active while work is in progress.',
    example: { items: [{ label: '拉取指标', state: 'done', meta: '1.2s' }, { label: '定位根因', state: 'active' }, { label: '修复', state: 'pending' }] }
  },
  Log: {
    props: z.object({
      lines: z.array(z.object({ ts: z.string().optional(), level: z.enum(['info', 'ok', 'warn', 'err']).optional(), text: z.string() })),
      maxLines: z.number().int().optional()
    }),
    slots: [],
    description: 'A scrolling event log that sticks to the newest line. Keep the last 6–20 lines of what matters.'
  },
  Table: {
    props: z.object({
      columns: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          kind: z.enum(['text', 'num', 'mono', 'status', 'bar']).optional().describe('status draws a Badge using `tones`; bar draws a 0–100 bar'),
          tones: z.record(z.string(), tone).optional().describe('For kind=status: cell value → tone'),
          tone: tone.optional().describe('For kind=bar')
        })
      ),
      rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
      maxRows: z.number().int().optional()
    }),
    slots: [],
    description: 'A data table that turns into cards when narrow. Keep to at most about 6 columns and 20 rows.'
  },
  Chart: {
    props: z.object({
      kind: z.enum(['line', 'area', 'bar']),
      series: z.array(z.object({ name: z.string().optional(), data: series, tone: tone.optional() })),
      labels: z.array(z.string()).optional().describe('X axis labels, one per sample'),
      unit: z.string().optional(),
      min: z.number().optional(),
      max: z.number().optional()
    }),
    slots: [],
    description: 'Time series or category chart with hover readout. Up to ~4 series.'
  },
  Topology: {
    props: z.object({
      tiers: z.array(z.array(z.object({ id: z.string(), label: z.string(), sub: z.string().optional(), tone: tone.optional() }))).describe('Rows of nodes, top tier first'),
      edges: z.array(z.array(z.string())).describe('[fromId, toId] pairs between node ids'),
      active: z.string().optional().describe('Node id to highlight')
    }),
    slots: [],
    description: 'A layered service / dependency diagram with a fixed layout that scales to fit.'
  },
  Polar: {
    props: z.object({
      axes: z.array(z.object({ label: z.string(), value: z.number() })).min(3),
      compare: z.array(z.number()).optional().describe('A reference polygon, one value per axis'),
      max: z.number().optional(),
      tone: tone.optional()
    }),
    slots: [],
    description: 'Radar chart for a multi-dimensional profile (3–10 axes).'
  }
})
