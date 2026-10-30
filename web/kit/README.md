# Writing Lumen components

Lumen is a json-render component set. A model composes a flat spec `{ root, elements: { id: { type, props, children, on?, visible?, repeat? } }, state }`
out of the components registered here, and `ui.js` renders it. Components never see the spec, only their resolved props.

## Files

One group = one file pair in this directory, plus its catalog entry for the model:

| File | What |
| --- | --- |
| `web/kit/<group>.js` | IIFE that registers components on `Lumen.registry` and pushes gallery samples to `Lumen.samples` |
| `web/kit/<group>.css` | Styles for those components only (all selectors under `.lm-…` classes you own) |
| `src/catalog/<group>.ts` | The zod props schema + description the model sees (the stub already exists; replace its body) |

Do not edit `web/ui.js`, `web/ui.css`, `web/scenarios.js`, `src/catalog/index.ts` or another group's files.
If something shared is missing, work around it locally and say so in your final report.

## Component factory

```js
;(() => {
  const { el, watch, clamp, setTone, len, fmtNum, nice, glyph, rem, pad2 } = Lumen.kit
  const { h, samples, registry } = Lumen

  registry.Example = (p, ctx) => {
    const root = el('div', { class: 'lm-example' })
    const comp = {
      el: root,        // the node the parent places
      slot: body,      // optional: where this element's `children` are rendered (only if it is a container)
      update(p) {},    // called with fresh props on every change; must be idempotent and cheap
      destroy() {},    // optional: clear timers / observers (the renderer calls it when the element is removed)
    }
    comp.update(p)
    return comp
  }
})()
```

- `el(tag, attrs, ...children)` builds DOM (SVG tags are handled). Text only ever goes in as text nodes / `textContent`. **Never `innerHTML`.**
- `watch(node, (w, h) => …, 'x')` is a ResizeObserver wrapper (the third argument limits it to width changes).
- A slot container must contain nothing but the rendered children (the renderer manages that node's child list).
- Props can arrive as anything the model writes: missing, `null`, wrong type, huge arrays. Treat every prop defensively and never throw.

### Events and two-way values

- `ctx.fire(event, extra)` runs the element's `on[event]` bindings and returns `true` if there were any. `extra` is merged into the action params
  (so `{"on":{"submit":{"action":"send"}}}` with `extra = { text }` sends the typed text). Call it for user interactions: `press`, `change`, `submit`, `choose`, …
- `ctx.write(prop, value)` writes `value` back to the state path when `prop` is bound with `{ "$bindState": "/path" }`; the new value comes back through `update`.
  Components with a value the user can change must keep a local copy so they work when unbound too.
- `ctx.emit({ action, params })` sends a raw host action (rarely needed).

## Look and feel

Read `web/ui.css` first (`:root` tokens, Panel, Steps, Table, Metric, Gauge, Progress, Chart, Tiles, Topology), and open the ops scenario (`web/screen.html?s=ops`) to see the finished design.
The language: text-free technical chrome, 1px hairlines (`--line`, `--line-2`), 2px radii at most, chamfered corners where a shape needs emphasis,
small mono numerals (`font-family: var(--num)`), restrained colour — colour means status, never decoration.

- **Adaptive**: panels can be 14rem or 60rem wide. Use container queries (`container-type: inline-size; container-name: …` on your root, `@container …` rules), `rem` units and `minmax`/`clamp`. Test narrow (320px) and wide (900px).
- **Tokens**: `--text --text-2 --text-3 --line --line-2 --accent --accent-ink --panel-solid --bg`, status `--ok --warn --serious --err`, categorical series `--s1…--s8` (fixed order, never reuse status colours for series), the core's spectrum `--c1…--c4` (light colours, for use on dark only). Never hardcode a colour that must work on both themes.
- **Tone**: put `data-tone="ok|warn|serious|err|accent|muted|s1…s8"` on a node (or call `setTone(node, tone)`) and use `var(--tone, …)` in CSS.
- **Status is never colour alone**: pair it with a glyph (`glyph(tone)`) or shape.
- **Light and dark**: everything must look right in both (`:root[data-theme='light']`), on all six palettes (`data-palette`).
- **Motion**: short, purposeful, off under `@media (prefers-reduced-motion: reduce)`.
- **Content**: Chinese and English mixed, very long unbroken strings (use `overflow-wrap: anywhere`, `min-width: 0`, ellipsis where a row must stay one line), empty arrays, hundreds of items (cap what you render and say so).
- **Streaming**: `update` runs repeatedly while the model refines props. Don't flash or reset scroll/selection/expanded state on every update; key your DOM where it matters.
- **No network, no external libraries, no `eval`.** Images may only be `data:` URIs.

## Code style

Match `web/ui.js`: 2 spaces, single quotes, no semicolons (except where a leading `;` or `[` needs one), trailing commas in multi-line literals, short comments that say why. Small named helpers inside the IIFE, no classes.
Catalog files match `src/catalog/core.ts`: single quotes, no semicolons, no trailing commas.

## Catalog entry

```ts
import { z } from 'zod'
import { defineComponents, tone } from './common'

export const components = defineComponents({
  Example: {
    props: z.object({
      title: z.string(),
      items: z.array(z.object({ label: z.string(), tone: tone.optional() })).max(40).describe('…only when the name is not obvious')
    }),
    slots: [],           // ['default'] if it is a container that renders `children`
    description: 'What it shows and WHEN to pick it over its neighbours. Mention events it fires, e.g. "Fires change { value }".',
    example: { title: 'x', items: [] }
  }
})
```

The model reads only `description` and the props shape. Keep props flat and few; bound arrays (`.max()`) so the model cannot emit megabytes; prefer enums over free strings; say units (rem, ms, %).
Every prop the component reads must be in the schema, and nothing else.

## Gallery samples

```js
samples.push({ group: '<group>', title: 'Example · typical', span: 1, rows: 1, state: { '/key': value }, tree: () => h('Example', { title: '…' }) })
```

`h(type, props, ...children)` builds a nested tree; for `on`, `visible`, `repeat` put them on the node object: `{ ...h('Button', { label: '发送' }), on: { press: { action: 'send', params: { text: 'hi' } } } }`.
`state` seeds the state model, props can use `{ $state: '/key' }`. Provide: a typical sample, an edge sample (long text / many items / empty), and a narrow one (use `span: 1` in a narrow page).
Titles start with the component name (`--only=Diff` filters by substring).

## Verifying (do this, with your eyes)

```bash
node_modules/.bin/electron scripts/shot.cjs "file://$PWD/web/gallery.html?group=<group>&theme=dark&w=900" /tmp/lumen-<group>-dark.png 900 1800 1500
```

then read the PNG. Arguments after the URL: output, window width, window height, wait ms, optional JS to evaluate in the page (its result is printed, console errors and warnings too).
Gallery query: `group` (comma list, matches your files), `only`, `theme=dark|light`, `palette=cryo|ion|ember|phosphor|nebula|graphite`, `w` (page width in px; try 320, 480, 900).
Check dark and light, at least three widths, at least two palettes, and drive interactions with the JS argument (e.g. click a node and return `document.querySelector(…).textContent`).
Fix what looks off; the bar is "belongs next to the existing ops screen".
