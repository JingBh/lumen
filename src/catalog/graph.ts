import { z } from 'zod'
import { defineComponents, tone } from './common'

export const components = defineComponents({
  Flow: {
    props: z.object({
      stages: z
        .array(
          z.object({
            label: z.string().describe('Stage name, a few words'),
            state: z.enum(['done', 'active', 'pending', 'failed', 'skipped']).optional().describe('Default pending'),
            meta: z.string().optional().describe('Small mono note, e.g. a duration or "3 / 8"'),
            detail: z.string().optional().describe('One line of grey text under the name, e.g. the error')
          })
        )
        .max(24),
      direction: z.enum(['auto', 'row', 'column']).optional().describe('auto (default): a horizontal chain when the panel is wide, vertical when narrow')
    }),
    slots: [],
    description:
      'A pipeline of 3–8 stages joined by arrows, laid out horizontally when there is room and vertically when not. Pick it over Steps when the point is the FLOW between stages (build → test → deploy, request path, agent phases) and each stage is short; use Steps for a longer plan with explanatory detail lines, Checklist for a todo list. Exactly one stage is normally active; a failed stage stops the chain visually, skipped stages are dashed.',
    example: {
      stages: [
        { label: '构建', state: 'done', meta: '42s' },
        { label: '测试', state: 'active', meta: '3 / 8' },
        { label: '部署', state: 'pending' }
      ]
    }
  },
  Tree: {
    props: z.object({
      nodes: z
        .array(
          z.object({
            id: z.string().describe('Unique within this tree'),
            label: z.string(),
            parent: z.string().nullable().optional().describe('id of the parent node; omit or null for a top-level node'),
            meta: z.string().optional().describe('Small right-aligned mono note, e.g. a size, count or status word'),
            tone: tone.optional().describe('Adds a status badge; a collapsed branch shows the worst tone hidden inside it'),
            icon: z.enum(['folder', 'file', 'task', 'agent']).optional()
          })
        )
        .max(300)
        .describe('FLAT list: every node names its parent by id, so you can append nodes one at a time and in any order'),
      expand: z.number().int().min(0).max(6).optional().describe('How many levels start open (default 2). The user\'s own open/close choices survive updates')
    }),
    slots: [],
    description:
      'A collapsible outline for hierarchical things: a file tree, an agent / sub-agent / task tree, a nested plan, a call stack. Build it from flat nodes with parent ids (parents may arrive after their children). Handles hundreds of nodes and scrolls by itself. Pick it over Table when rows nest, and over Graph when every node has a single parent. Fires select { id } when a row is clicked.',
    example: {
      nodes: [
        { id: 'src', label: 'src', icon: 'folder' },
        { id: 'a', label: 'loop.ts', parent: 'src', icon: 'file', meta: '218', tone: 'warn' },
        { id: 'b', label: 'tools.ts', parent: 'src', icon: 'file', meta: '96' }
      ]
    }
  },
  Graph: {
    props: z.object({
      nodes: z
        .array(z.object({ id: z.string(), label: z.string().describe('Short name; long ones are truncated'), sub: z.string().optional().describe('Small mono second line, e.g. a status or count'), tone: tone.optional() }))
        .max(60),
      edges: z
        .array(z.object({ from: z.string().describe('Source node id'), to: z.string().describe('Target node id'), label: z.string().optional().describe('Short note on the edge, 1–2 words') }))
        .max(200),
      direction: z.enum(['auto', 'LR', 'TB']).optional().describe('Flow direction: LR = left to right, TB = top to bottom; auto (default) picks whichever fits the panel better'),
      active: z.string().optional().describe('Node id to highlight (the one being worked on); its edges animate')
    }),
    slots: [],
    description:
      'A directed graph laid out automatically in layers, so you only list nodes and edges, with no coordinates and no tiers: task dependencies, a plan with parallel branches, a call graph, a data flow, module imports. Cycles and disconnected parts are fine. Pick it over Topology when you cannot say which tier a node belongs to or when edges skip levels; use Topology for a hand-arranged service diagram of at most ~12 boxes, Tree when nothing has more than one parent. Hovering a node highlights its neighbours. Keep it under ~40 nodes to stay readable. Fires select { id } when a node is clicked.',
    example: {
      nodes: [
        { id: 'a', label: '解析', tone: 'ok' },
        { id: 'b', label: '实现', tone: 'accent' },
        { id: 'c', label: '测试' }
      ],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'a', to: 'c' }],
      active: 'b'
    }
  }
})
