import { z } from 'zod'
import { defineComponents, tone } from './common'

export const components = defineComponents({
  AgentCard: {
    props: z.object({
      name: z.string().describe('The sub-agent or teammate, short'),
      role: z.string().optional().describe('What kind of agent it is, e.g. "Explore", "Code review"'),
      state: z.enum(['idle', 'thinking', 'acting', 'alert', 'done', 'failed']).optional().describe('Default idle. alert = it needs the user\'s attention'),
      task: z.string().optional().describe('What it is doing or did, one or two sentences'),
      progress: z.number().min(0).max(100).optional().describe('Percent complete; omit when unknown'),
      meta: z.string().optional().describe('A small fact such as elapsed time, files read, tokens')
    }),
    slots: [],
    description:
      'A card for one sub-agent or teammate: its name, role, state, current task and optional progress. Put several in a Grid (min about 17) to show a team working in parallel. Use Message for the main agent\'s own current statement, Steps for a plan, and this for the other agents. Display only.',
    example: { name: 'explorer', role: 'Explore', state: 'thinking', task: '搜索 kubelet 探针相关配置', progress: 35, meta: '已读 18 个文件' }
  },
  ToolCall: {
    props: z.object({
      name: z.string().describe('Tool name as the agent calls it: Read, Edit, Grep, Bash, WebFetch…'),
      summary: z.string().optional().describe('One line of what it acts on: a path, a pattern, a command'),
      state: z.enum(['running', 'ok', 'err']).optional().describe('Default running'),
      durationMs: z.number().min(0).optional().describe('How long it took, in milliseconds'),
      args: z.string().max(4000).optional().describe('Input of the call, shown when the user expands it'),
      result: z.string().max(4000).optional().describe('Output or error text, shown when the user expands it')
    }),
    slots: [],
    description:
      'One tool invocation of the agent as a compact row: state glyph (spinner while running), tool name, one-line summary and duration. When args or result are given the user can click to expand them. Stack the last 3 to 8 calls to show what the agent has just been doing; use Log for free-form event lines and Steps for the plan. Display only.',
    example: { name: 'Grep', summary: '"probe" in k8s/', state: 'ok', durationMs: 380, result: 'k8s/a.yml:41: timeoutSeconds: 1' }
  },
  Ask: {
    props: z.object({
      title: z.string().optional().describe('The question in a few words (default: "等待你的回复")'),
      text: z.string().describe('The question or the situation, one to three sentences, so the user can answer without scrolling back'),
      options: z
        .array(
          z.object({
            label: z.string().describe('Button text, a few words'),
            text: z.string().describe('The full reply that is sent to the agent when this option is clicked'),
            kind: z.enum(['primary', 'ghost', 'danger']).optional().describe('Default: the first option is primary, the others ghost; use danger for destructive replies')
          })
        )
        .min(1)
        .max(6),
      tone: tone.optional().describe('accent by default; warn or serious when the decision is risky')
    }),
    slots: [],
    description:
      'A question to an agent that is still working, whose answer it will receive at its next tool call: an edge that gently pulses, the question, and one button per answer. Lumen removes it once that agent stops working, as no answer could reach it then. Clicking a button fires choose with { text, label } (merged into the action params, so {"on":{"choose":{"action":"send"}}} sends the reply text); if nothing is bound to choose, the option\'s text is sent to the agent as a message anyway. After a click the chosen option stays selected and the others are disabled, so it cannot send twice. The user can also close it without answering: then nothing is sent, and an event says so. Pick Ask for a question that must be answered now with 2 to 4 fixed replies; Choice when the user selects first and confirms later (or picks several); Button for a plain action that is not a question; Input when the answer is free text.',
    example: { title: '要继续应用到其余节点吗？', text: 'dry-run 只会改动探针超时。', options: [{ label: '继续', text: '继续应用到全部节点' }, { label: '先不要', text: '先暂停' }] }
  },
  Timer: {
    props: z.object({
      since: z.union([z.number(), z.string()]).optional().describe('Start time: epoch milliseconds or an ISO time string'),
      until: z.union([z.number(), z.string()]).optional().describe('End time. With running=false the timer shows until − since; with running and no since it counts down to this time'),
      label: z.string().optional().describe('Caption above the time, e.g. "已运行"'),
      running: z.boolean().optional().describe('Keep ticking (default true); false freezes it'),
      format: z.enum(['clock', 'compact']).optional().describe('clock = 12:03 (1:02:03 past an hour); compact = 12m 03s, 1h 02m')
    }),
    slots: [],
    description:
      'A live elapsed-time readout that ticks every second by itself, so the UI does not need to be re-sent: how long a task, a tool or a build has been running. Give since as epoch milliseconds or an ISO string. Set running=false with an until time for a finished duration. Display only.',
    example: { since: 1761700000000, label: '已运行', format: 'clock' }
  }
})
