import { z } from 'zod'
import { defineComponents, tone } from './common'

export const components = defineComponents({
  Sparkline: {
    props: z.object({
      data: z.array(z.number()).max(240).describe('Samples, oldest first (the last 240 are drawn)'),
      label: z.string().max(60).optional(),
      value: z.union([z.number(), z.string().max(24)]).optional().describe('Headline value shown beside the trace; defaults to the last sample'),
      unit: z.string().max(12).optional(),
      tone: tone.optional().describe('Colour of the trace (accent by default); a status tone also puts its glyph beside the value'),
      kind: z.enum(['line', 'area', 'bar']).optional().describe('line (default), area, or bar for counts per interval'),
      min: z.number().optional().describe('Fixed bottom of the scale, e.g. 0'),
      max: z.number().optional().describe('Fixed top of the scale, e.g. 100 for a percentage')
    }),
    slots: [],
    description:
      'One row of trend: label and latest value on the left, a small axis-less trace on the right with the last point dotted and the min and max marked; hover reads any sample. `value` defaults to the last sample, `kind` is line, area or bar (counts per interval), `min`/`max` fix the scale. Pick it for a list of several series (per tool, per worker, per metric) where only shape and current value matter; stack them in a Stack. Use Metric when one number is the headline, Chart when you need axes, several series on one plot or exact values.',
    example: { label: '令牌速率', value: 1840, unit: 'tok/s', kind: 'area', data: [1500, 1620, 1580, 1710, 1840] }
  },
  Heatmap: {
    props: z.object({
      rows: z.array(z.string().max(40)).max(24).describe('Row labels, top to bottom'),
      cols: z.array(z.string().max(24)).max(60).describe('Column labels, left to right; thinned automatically when crowded'),
      values: z.array(z.array(z.number().nullable()).max(60)).max(24).describe('values[row][col]; null = no data'),
      tone: tone.optional().describe('Hue of the intensity ramp (accent by default); use err/warn only when high means bad'),
      unit: z.string().max(12).optional(),
      min: z.number().optional().describe('Value drawn as the faintest cell; default 0 for non-negative data'),
      max: z.number().optional().describe('Value drawn as the strongest cell; default the largest value')
    }),
    slots: [],
    description:
      'Matrix of cells shaded on a single-hue ramp, up to 24 rows by 60 columns: `values[row][col]` (null = no data), labelled by `rows` and `cols`. The strongest cell is outlined, hover or arrow keys read any cell, and small matrices print the numbers in the cells. Use tone err/warn only when high means bad. Pick it for two dimensions of magnitude: failures per test and run, tool calls per tool and hour, latency per node and minute. Use Chart for one series over time, Tiles for one status per item, Table when exact numbers matter more than the pattern.',
    example: { rows: ['Read', 'Edit', 'Bash'], cols: ['10:00', '11:00', '12:00', '13:00'], values: [[4, 9, 12, 3], [1, 5, 8, 2], [0, 2, 14, 9]], unit: ' 次' }
  },
  Histogram: {
    props: z.object({
      values: z.array(z.number()).max(2000).optional().describe('Raw samples; binned automatically on round edges. Prefer this over bins'),
      bins: z.array(z.object({ label: z.string().max(24), count: z.number() })).max(40).optional().describe('Prebuilt bins when you only have counts; labels like "0-100ms" let markers be placed'),
      binCount: z.number().int().min(3).max(60).optional().describe('Wanted number of bins for raw values (default grows with the sample count)'),
      unit: z.string().max(12).optional().describe('Appended to the x values, e.g. ms'),
      tone: tone.optional(),
      markers: z.array(z.object({ label: z.string().max(12), value: z.number() })).max(6).optional().describe('Labelled vertical rules on the x scale, e.g. p50, p95, an SLA limit')
    }),
    slots: [],
    description:
      'How one quantity is spread: bars of counts per value range, with a hover readout of each bin. Give raw `values` (binned on round edges, `binCount` optional) or, if you only have counts, `bins` (markers on bins need numeric labels in one unit, like "0-100ms"). `markers` draw labelled vertical rules at x values: p50, p95, an SLA limit. Pick it for durations, sizes, token counts or scores when the tail matters ("is p95 far from p50?"). Use Chart for change over time and BarList for named categories.',
    example: { values: [120, 180, 190, 210, 240, 260, 300, 410, 980], unit: 'ms', markers: [{ label: 'p50', value: 240 }, { label: 'p95', value: 980 }] }
  },
  Scatter: {
    props: z.object({
      points: z
        .array(
          z.object({
            x: z.number(),
            y: z.number(),
            label: z.string().max(60).optional().describe('Shown on hover or focus'),
            tone: tone.optional().describe('Class or status of this point; the marker shape changes with it, so it never relies on colour alone'),
            size: z.number().optional().describe('Third measure drawn as dot area')
          })
        )
        .max(500),
      xLabel: z.string().max(40).optional(),
      yLabel: z.string().max(40).optional(),
      xUnit: z.string().max(12).optional(),
      yUnit: z.string().max(12).optional()
    }),
    slots: [],
    description:
      'One dot per item on two numeric axes (up to 500); `size` adds a third measure as dot area, `label` is read on hover or arrow keys, and a point `tone` changes its marker shape too, so use err/warn for the points that need attention. Pick it for relationships and outliers: tokens vs. latency per tool call, file size vs. edit count, cost vs. duration per subagent. Name the axes with xLabel/yLabel and units. Use Chart instead when x is regular time, BarList when one axis is a category.',
    example: { points: [{ x: 1200, y: 340, label: 'Read a.ts' }, { x: 5200, y: 1800, label: 'Bash test', tone: 'err' }], xLabel: '输入', xUnit: 'tok', yLabel: '耗时', yUnit: 'ms' }
  },
  Treemap: {
    props: z.object({
      items: z
        .array(
          z.object({
            label: z.string().max(60),
            value: z.number().describe('Must be positive; zero and negative items are not drawn'),
            tone: tone.optional().describe('Default: a distinct categorical colour per item, in order'),
            sub: z.string().max(60).optional().describe('Second line in larger cells')
          })
        )
        .max(60),
      unit: z.string().max(12).optional().describe('Appended to compact values such as 12K, so prefer tok, ms, B over MB')
    }),
    slots: [],
    description:
      'Areas proportional to a positive `value` (others are dropped), packed to fill a fixed-shape box, each cell labelled with its name, value and share (`sub` adds a second line in big cells); hover or arrow keys read any cell, even tiny ones. Cells get distinct colours in order unless you give a tone. `unit` is appended to compact numbers (12K), so prefer tok, ms, B to MB. Pick it for a budget with many parts (more than about six) where comparing sizes at a glance matters: disk by folder, tokens by tool, cost by subagent, time by phase. Use StackedBar for a few parts of one limited budget, Donut for a handful of shares, BarList when exact ranking matters.',
    example: { unit: ' tok', items: [{ label: 'Read', value: 482000 }, { label: 'Edit', value: 211000 }, { label: 'Bash', value: 176500, sub: '37 次调用' }] }
  },
  StackedBar: {
    props: z.object({
      segments: z.array(z.object({ label: z.string().max(40), value: z.number(), tone: tone.optional().describe('Default: a distinct categorical colour per segment, in order') })).max(12),
      total: z.number().optional().describe('The limit; when it exceeds the sum, the remainder shows as an empty track and the readout says used / total'),
      unit: z.string().max(12).optional(),
      label: z.string().max(60).optional().describe('Caption above the bar'),
      rest: z.string().max(24).optional().describe('Legend name of the unused remainder, e.g. "空闲"')
    }),
    slots: [],
    description:
      'A single bar split into labelled segments, with a legend of values and percentages. Give `total` (the limit) to show how much is used: the unused remainder is an empty track named by `rest` (e.g. "空闲") and the readout says used / total; over the limit it shows a ✕ glyph. Think context window by system, tools, history, files; quota; time budget. Pick it over Donut when there is a limit or when values must be read, over Progress when there are several parts, over Treemap when there are few parts. Put several in a Stack to compare budgets.',
    example: { label: '上下文窗口', unit: ' tok', total: 200000, rest: '空闲', segments: [{ label: '系统提示', value: 6200 }, { label: '对话历史', value: 62400 }, { label: '文件内容', value: 38100 }] }
  },
  Gantt: {
    props: z.object({
      spans: z
        .array(
          z.object({
            label: z.string().max(60),
            start: z.number().describe('From a shared origin (e.g. session start), in `unit`'),
            duration: z.number().describe('In `unit`; for a running span, the elapsed time so far'),
            group: z.string().max(30).optional().describe('Lane name, e.g. main, a subagent, a tool kind; spans in a lane that overlap get sub-rows'),
            state: z.enum(['done', 'running', 'failed']).optional().describe('Default done; running has a live edge, failed a ✕'),
            tone: tone.optional().describe('Overrides the lane colour'),
            meta: z.string().max(60).optional().describe('Extra detail shown on hover, e.g. an exit code')
          })
        )
        .max(200),
      unit: z.enum(['ms', 's', 'min']).optional().describe('Unit of start and duration (default s)')
    }),
    slots: [],
    description:
      'Trace of work on a shared time axis: tool calls, sub-agent runs, pipeline steps. `start` and `duration` are numbers in `unit` (default s) from one common origin such as session start; a running span\'s duration is its elapsed time so far and gets a live edge, a failed span gets a ✕ mark; spans with the same `group` share a lane (overlaps get sub-rows); `meta` is read on hover or arrow keys. Shows the latest 80 spans and says how many are left out. Pick it to answer what ran when, what overlapped and what was slow. Use Steps for an ordered plan with status, Chart for a metric over time, Log for text events.',
    example: { unit: 's', spans: [{ label: 'Read spec.ts', start: 0, duration: 1.2, group: 'main' }, { label: 'explore', start: 0.5, duration: 6, group: '子代理 A' }, { label: 'yarn test', start: 3, duration: 4, group: 'main', state: 'failed', meta: 'exit 1' }] }
  },
  Funnel: {
    props: z.object({
      stages: z.array(z.object({ label: z.string().max(40), value: z.number(), tone: tone.optional().describe('Only to flag a stage by status; default is one hue that fades along the funnel') })).max(12),
      unit: z.string().max(12).optional()
    }),
    slots: [],
    description:
      'Stages that each keep a share of the one before, drawn as shrinking bars with the conversion percentage between them and first-to-last at the bottom. Pick it for a pipeline where items drop out: files found, read, edited, tests passed; requests, retries, successes. Use BarList for unrelated categories, Steps for a plan, StackedBar for parts of one whole.',
    example: { stages: [{ label: '检索到的文件', value: 1240 }, { label: '打开阅读', value: 412 }, { label: '产生编辑', value: 96 }] }
  },
  Bullet: {
    props: z.object({
      items: z
        .array(
          z.object({
            label: z.string().max(60),
            value: z.number(),
            target: z.number().optional().describe('Drawn as a tick'),
            ranges: z.array(z.number()).max(3).optional().describe('Up to three ascending upper limits of the background bands, e.g. [300, 500, 800]'),
            unit: z.string().max(12).optional(),
            tone: tone.optional().describe('Colour of the value bar; a status tone also adds its glyph')
          })
        )
        .max(12)
    }),
    slots: [],
    description:
      'Compact rows of a measured value (bar) against a `target` (tick) over shaded bands; `ranges` are up to three ascending upper limits of the bands (e.g. [300, 500, 800]), and each row has its own scale and unit. Pick it for several KPIs against goals or limits in little space: p95 latency vs. SLO, cache hit rate vs. goal, cost vs. budget. Use Gauge for one value against its maximum, Progress for completion, Metric for a bare number.',
    example: { items: [{ label: '工具延迟 p95', value: 482, target: 400, unit: 'ms', ranges: [300, 500, 800] }, { label: '缓存命中率', value: 78, target: 90, unit: '%', ranges: [50, 75, 100] }] }
  }
})
