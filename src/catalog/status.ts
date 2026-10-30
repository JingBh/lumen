import { z } from 'zod'
import { defineComponents, tone } from './common'

export const components = defineComponents({
  Timeline: {
    props: z.object({
      items: z
        .array(
          z.object({
            time: z.string().optional().describe('Clock time or relative time as you want it shown, e.g. "13:54:06" or "2m ago"'),
            title: z.string().describe('What happened, a few words'),
            text: z.string().optional().describe('One line of grey detail under the title'),
            tone: tone.optional().describe('Status of the event; sets the marker glyph and colour'),
            state: z.enum(['done', 'active', 'pending']).optional().describe('Only for events that are part of an ongoing process; active pulses, pending is dashed'),
            tag: z.string().optional().describe('Short chip next to the title, e.g. a node, tool or severity')
          })
        )
        .max(100)
        .describe('Oldest first'),
      order: z.enum(['asc', 'desc']).optional().describe('asc (default): oldest at the top; desc: newest at the top'),
      limit: z.number().int().min(1).max(50).optional().describe('How many of the newest events to show (default 12); older ones collapse into a "… N earlier" row')
    }),
    slots: [],
    description:
      'A compact vertical history of what happened and when: alerts, tool calls, deploy events, an investigation trail. One marker per event on a time axis, with time in mono and an optional tag chip. Pick it over Log when events are few, meaningful and worth a title (Log is for raw lines), and over Steps when the events are things that HAPPENED rather than a plan still to do. Pass events oldest first; use order "desc" for a live feed that should keep the newest on top.',
    example: {
      items: [
        { time: '13:51', title: '收到告警', tone: 'warn', tag: 'alert' },
        { time: '13:53', title: '关联重启事件', text: '集中在 edge-node-3', tone: 'ok' },
        { time: '13:54', title: '检查 GRE 隧道', state: 'active' }
      ]
    }
  },
  Checklist: {
    props: z.object({
      title: z.string().optional().describe('Heading of the list, e.g. "任务清单"'),
      items: z
        .array(
          z.object({
            label: z.string(),
            state: z.enum(['done', 'active', 'pending', 'blocked']).optional().describe('Default pending'),
            note: z.string().optional().describe('Second line of grey text, e.g. why it is blocked or what is happening now')
          })
        )
        .max(60)
    }),
    slots: [],
    description:
      'The agent\'s own todo list, like TodoWrite: a done / total count, a slim progress bar and one checkbox per task (done items struck through, the active one emphasised, blocked ones marked with a slash). Lighter and denser than Steps: pick it for a flat list of tasks you are ticking off, and Steps for a few phases that each need a duration or an explanation. Keep exactly one item active while working.',
    example: {
      title: '任务清单',
      items: [
        { label: '阅读代码', state: 'done' },
        { label: '实现组件', state: 'active', note: '正在调试布局' },
        { label: '截图验证', state: 'pending' }
      ]
    }
  }
})
