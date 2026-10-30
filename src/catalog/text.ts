import { z } from 'zod'
import { defineComponents, tone } from './common'

export const components = defineComponents({
  Markdown: {
    props: z.object({ text: z.string().max(4000) }),
    slots: [],
    description:
      'Rich text for a structured write-up: a summary with headings, lists, a code block or a small table, e.g. a findings report, a plan with sub-steps, a how-to. ' +
      'Supports # to ####, **bold**, *italic*, ~~strike~~, `code`, [text](https://…) links, - / 1. lists (nested, "- [x]" tasks), > quote, ---, fenced ``` code with a language, and | tables |; raw HTML is shown as text. ' +
      'Keep it under about 15 lines; it is fine for the text to grow while you write. ' +
      'Do NOT use it for one or two plain sentences (Text, Message), a single command or log excerpt (Code), real tabular data (Table), attribute lists (KeyValue) or a verdict (Callout). Fires open { url } when a http(s) link is clicked and the element has an `open` binding.',
    example: { text: '## 根因\n\nGRE 隧道丢包触发了 **探针超时**，不是 OOM。\n\n- 38 次重启全部落在丢包窗口内\n- 修复：把 `timeoutSeconds` 调到 5' }
  },
  Quote: {
    props: z.object({
      text: z.string().max(600),
      source: z.string().max(120).optional(),
      tone: tone.optional()
    }),
    slots: [],
    description:
      'A pull quote with a slanted double bar: echo the user\'s current request at the top of the screen, quote an error message or a key sentence from a document verbatim, or cite a source. ' +
      '`text` is the quoted words; `source` says whose or where from (e.g. "你的请求", "CI #4821"). Tone defaults to accent; use ok, warn, serious or err only when the quote is a result or an error. ' +
      'Do NOT use it for the agent\'s own statement (Message), a conclusion with a title (Callout) or longer formatted text (Markdown).',
    example: { text: '帮我查一下为什么 edge-node-3 上的 Pod 一直在重启', source: '你的请求' }
  },
  Chips: {
    props: z.object({
      items: z.array(z.union([z.string().max(60), z.object({ label: z.string().max(60), tone: tone.optional(), hint: z.string().max(120).optional() })])).max(100),
      max: z.number().int().min(1).max(50).optional()
    }),
    slots: [],
    description:
      'A wrapping list of short tags: the files touched, tools used, test groups, languages or topics involved. Items are plain strings (neutral), or { label, tone?, hint? } when a chip carries a status; a chip is a few words at most. ' +
      '`max` (default 12) is how many show before the rest folds into a "+N" chip that expands on click. ' +
      'Do NOT use it for rows that need details (Checklist, Table), long labels (KeyValue) or buttons (Choice).',
    example: { items: ['src/renderer/core.ts', 'web/ui.js', { label: '2 失败', tone: 'err' }], max: 8 }
  },
  LinkList: {
    props: z.object({
      items: z.array(z.object({ title: z.string().max(120), url: z.string().max(2000), note: z.string().max(200).optional(), kind: z.enum(['web', 'file', 'issue', 'pr', 'doc']).optional() })).max(30)
    }),
    slots: [],
    description:
      'Rows of references the user may want to open: documentation the agent consulted, issues and pull requests, dashboards. Each row shows an icon for `kind` (default web), the title, the host and path, and an optional one-line `note`. ' +
      'Only http(s) urls are clickable (a file path is shown as plain text); a click fires open { url }, or asks the host to open it when nothing is bound. ' +
      'Never invent URLs: list only addresses that appeared in the events. Do NOT use it for changed files (FileTree) or navigation (Button).',
    example: { items: [{ title: 'Probe 配置文档', url: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/', kind: 'doc', note: '探针超时的默认值' }] }
  },
  Image: {
    props: z.object({
      src: z.string().max(4000),
      alt: z.string().max(120).optional(),
      caption: z.string().max(200).optional(),
      fit: z.enum(['contain', 'cover']).optional()
    }),
    slots: [],
    description:
      'A framed picture with a caption: a screenshot or diagram the agent produced. `src` must be a data:image/… URI that appears in the events; any other address (a URL, a path) shows a "图片未加载" placeholder, so never make one up. ' +
      '`fit` is contain (whole picture, default) or cover (fills the width and crops). For numbers use Chart, for structure Topology.',
    example: { src: 'data:image/png;base64,iVBORw0KGgo…', alt: '终端截图', caption: '13:40 之后重启次数升高' }
  },
  Stats: {
    props: z.object({
      items: z.array(z.object({ label: z.string().max(24), value: z.union([z.string().max(24), z.number()]), unit: z.string().max(8).optional(), tone: tone.optional(), hint: z.string().max(60).optional() })).max(8)
    }),
    slots: [],
    description:
      'A compact strip of 3–6 vitals about the work at a glance, e.g. 已用时 12m · 工具调用 48 · 修改文件 7 · 测试 126/128. A label is two to four words; give a tone only for a status (warn, err…), and `hint` for a detail. ' +
      'It sits in one row when wide and wraps into an even grid when narrow. Lighter than Metric: no sparkline, no delta, small numerals. ' +
      'Use Metric for one headline number that deserves to be big or needs a trend, Gauge for a fraction of a limit, KeyValue for non-numeric facts.',
    example: { items: [{ label: '已用时', value: '12m' }, { label: '工具调用', value: 48 }, { label: '修改文件', value: 7 }, { label: '测试', value: '126 / 128', tone: 'warn' }] }
  }
})
