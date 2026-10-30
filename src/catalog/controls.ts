import { z } from 'zod'
import { defineComponents, tone } from './common'

export const components = defineComponents({
  Choice: {
    props: z.object({
      options: z
        .array(
          z.object({
            value: z.string().describe('What is stored and sent; short and unique'),
            label: z.string().describe('The option text, a few words'),
            hint: z.string().optional().describe('One line of explanation under the label'),
            tone: tone.optional().describe('Tints the option, e.g. warn for a risky choice')
          })
        )
        .max(24),
      value: z.union([z.string(), z.array(z.string()).max(24)]).optional().describe('Selected value (an array when multiple). Bind it with {"$bindState":"/path"} so the choice is stored in state'),
      multiple: z.boolean().optional().describe('Allow several selections (checkboxes) instead of one (radios)'),
      layout: z.enum(['auto', 'list', 'chips']).optional().describe('auto: cards in as many columns as fit; list: one card per row; chips: compact wrapping pills for short labels'),
      label: z.string().optional().describe('Caption above the options, e.g. the question')
    }),
    slots: [],
    description:
      'A set of selectable option cards where the user picks one (or several with multiple). Bind value with {"$bindState":"/choice"} and read it back with $state in a Button\'s params (e.g. a "确认" button that sends it), or use on.change. Fires change with { value } (a string, or a string array when multiple), also merged into the action params. Choice only records a selection and sends nothing by itself; to ask the user a question and send the answer immediately, use Ask. For a single immediate action use Button.',
    example: { label: '下一步怎么做？', options: [{ value: 'dry', label: '先做 dry-run', hint: '只输出变更' }, { value: 'go', label: '直接应用', tone: 'warn' }] }
  },
  Input: {
    props: z.object({
      value: z.string().optional().describe('Current text. Bind it with {"$bindState":"/draft"} to read the text back with $state'),
      placeholder: z.string().optional(),
      multiline: z.boolean().optional().describe('A taller field; Enter sends, Shift+Enter inserts a newline'),
      rows: z.number().int().min(1).max(8).optional().describe('Visible lines when multiline (default 3)'),
      submitLabel: z.string().optional().describe('Send button text (default 发送)'),
      clearOnSubmit: z.boolean().optional().describe('Empty the field after sending (default true)')
    }),
    slots: [],
    description:
      'A text field with a send button, for free-form answers or instructions to the agent. Enter (or the button) submits, and Enter that confirms an IME candidate does not. Fires submit with { text }, merged into the action params so {"on":{"submit":{"action":"send"}}} sends the typed text; if no on.submit is bound, the text is sent to the agent as a message anyway. Use it when the answer cannot be a fixed option; otherwise prefer Choice, Ask or Button.',
    example: { placeholder: '告诉智能体下一步做什么…' }
  },
  Toggle: {
    props: z.object({
      label: z.string().describe('What the switch controls'),
      value: z.boolean().optional().describe('On/off. Bind it with {"$bindState":"/flag"} to store the state'),
      hint: z.string().optional().describe('One line of explanation')
    }),
    slots: [],
    description:
      'An on/off switch for a setting or option. Fires change with { value: boolean }. Bind value with {"$bindState":"/path"} so the setting is stored in state and can be sent along by a Button; or use on.change to react immediately. For a yes/no question the agent is waiting on, use Ask instead.',
    example: { label: '自动批准只读命令', hint: 'Read、Grep、Glob 不再询问', value: true }
  },
  Slider: {
    props: z.object({
      label: z.string(),
      min: z.number().optional().describe('Default 0'),
      max: z.number().optional().describe('Default 100'),
      step: z.number().optional().describe('Default 1'),
      value: z.number().optional().describe('Current value. Bind it with {"$bindState":"/path"} to store the choice in state'),
      unit: z.string().optional().describe('Shown after the value, e.g. "%", "ms", " 个"')
    }),
    slots: [],
    description:
      'A draggable, keyboard-adjustable number control with a live readout (e.g. parallelism, timeout, threshold). Writes the bound value continuously while dragging and fires change with { value: number } when the user releases or presses a key. Bind value with {"$bindState":"/path"} and let a Button send it.',
    example: { label: '并行度', min: 1, max: 16, step: 1, value: 4 }
  }
})
