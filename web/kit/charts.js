/* charts — Sparkline, Heatmap, Histogram, Scatter, Treemap, StackedBar, Gantt, Funnel, Bullet
   Marks are drawn in container pixels and redrawn by `watch`; they keep their nodes between draws, so CSS transitions animate data changes. */
;(() => {
  const { el, watch, clamp, setTone, fmtNum, nice, glyph, rem, fitText } = Lumen.kit
  const { h, samples, registry } = Lumen

  let seq = 0
  const STATUS = ['ok', 'warn', 'serious', 'err']

  // ---------- Props arrive as anything: coerce, never throw ----------
  const num = (v) => {
    const n = typeof v === 'string' && v.trim() ? Number(v) : v
    return typeof n === 'number' && Math.abs(n) <= 1e15 ? n : null // finite, and small enough for a range to stay finite
  }
  const text = (v) => (v == null ? '' : String(v))
  const arr = (v, cap) => (Array.isArray(v) ? v.slice(0, cap) : [])
  // The first `cap` objects of a list, and how many were left out.
  const objs = (v, cap) => {
    const all = arr(v, 2000).filter((x) => x && typeof x === 'object')
    return [all.slice(0, cap), Math.max(0, all.length - cap)]
  }

  // fmtNum rounds anything below 1 to two decimals, which flattens small magnitudes.
  const fmt = (v, unit = '') => `${v == null ? '—' : v !== 0 && Math.abs(v) < 1 ? +v.toPrecision(3) : fmtNum(v)}${unit}`
  const pct = (f) => `${+(f * 100).toFixed(f < 0.1 ? 1 : 0)}%`
  // Categorical hues are assigned in fixed order and never cycled: the tail goes neutral.
  const series = (i) => (i < 8 ? `s${i + 1}` : 'muted')
  const statusGlyph = (tone) => (STATUS.includes(tone) ? glyph(tone) : null)
  const more = (n) => (n > 0 ? el('span', { class: 'lm-cx-more' }, `+${n}`) : null)

  // replaceChildren would print null and false as text.
  const fill = (node, ...kids) => node.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false))

  const set = (node, attrs) => {
    for (const [k, v] of Object.entries(attrs)) v == null ? node.removeAttribute(k) : node.setAttribute(k, v)
    return node
  }

  // Marks keep their node between draws, so CSS transitions animate them when the data moves; unused ones are swept.
  const pool = (layer) => {
    const live = new Map()
    let used = new Set(), prev = null, first = null, head = null
    return {
      mark(key, tag, cls, attrs) {
        let n = live.get(key)
        if (!n) {
          live.set(key, (n = el(tag)))
          layer.insertBefore(n, prev ? prev.nextSibling : head?.parentNode === layer ? head : null)
        } else if (prev && n.previousSibling !== prev) layer.insertBefore(n, prev.nextSibling)
        if (!prev) first = n
        prev = n
        used.add(key)
        return set(n, { class: cls, ...attrs })
      },
      sweep() {
        for (const [k, n] of live) if (!used.has(k)) { n.remove(); live.delete(k) }
        used = new Set()
        prev = null
        head = first
        first = null
      },
    }
  }

  // A resize redraws at once: transitions are for data changes only.
  const snap = (root, fn) => {
    root.setAttribute('data-snap', '')
    fn()
    root.getBoundingClientRect()
    root.removeAttribute('data-snap')
  }

  const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  canvas.canvas.width = canvas.canvas.height = 1
  // Width of strings in the font the svg draws its text in.
  const ruler = (svg) => {
    const s = getComputedStyle(svg), font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`
    return (str) => {
      canvas.font = font
      return canvas.measureText(str).width
    }
  }
  const clip = (tw, s, w) => {
    if (tw(s) <= w) return s
    let n = s.length
    while (n > 0 && tw(`${s.slice(0, n)}…`) > w) n--
    return n ? `${s.slice(0, n)}…` : ''
  }

  // Nice tick values covering [lo, hi]; `count` is the number of intervals wanted, `whole` keeps ticks on integers.
  const ticksOf = (lo, hi, count, whole) => {
    if (!(hi > lo)) hi = lo + 1
    let step = nice((hi - lo) / Math.max(1, count))
    if (whole) step = Math.max(1, Math.round(step))
    const a = Math.floor(lo / step + 1e-9), b = Math.ceil(hi / step - 1e-9)
    return Array.from({ length: b - a + 1 }, (_, i) => +((a + i) * step).toFixed(10))
  }

  // Arrow keys step through a chart's marks (`stride()` for up and down), Home and End jump; `go(-1)` clears.
  const keys = (node, count, at, go, stride = () => 1) => {
    node.tabIndex = 0
    node.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: stride(), ArrowUp: -stride(), Home: -Infinity, End: Infinity }[e.key]
      if (step == null || !count()) return
      e.preventDefault()
      go(clamp(at() < 0 ? 0 : at() + step, 0, count() - 1))
    })
    node.addEventListener('focus', () => node.matches(':focus-visible') && go(Math.max(at(), 0)))
    node.addEventListener('blur', () => go(-1))
  }

  // Keeps exactly `n` records in `root`, built by `make` as { el, … }, so their transitions survive updates.
  const fit = (root, list, n, make) => {
    while (list.length < n) {
      const r = make()
      list.push(r)
      root.append(r.el)
    }
    while (list.length > n) list.pop().el.remove()
  }

  // The px-drawn charts share one body: a readout line over a plot that redraws at its real size.
  // A plot that sizes itself from the data (`auto`) follows the readout line's width and draws a frame later,
  // because changing the layout inside the observer callback would resize ancestors that are observed too.
  const frame = (cls, redraw, auto) => {
    const plot = el('div', { class: 'plot' }), ro = el('div', { class: 'lm-cx-ro' }), root = el('div', { class: `lm-cx ${cls}` }, ro, plot)
    const size = { w: 0, h: 0 }
    const draw = () => {
      size.w = plot.clientWidth
      size.h = plot.clientHeight
      snap(root, redraw)
    }
    watch(auto ? ro : plot, auto ? () => requestAnimationFrame(draw) : draw, auto ? 'x' : undefined)
    document.fonts?.ready.then(redraw)
    return { root, ro, plot, size }
  }
  // Three svg layers: axes and overlays are rebuilt every draw, marks are pooled.
  const layers = (plot) => {
    const axes = el('g'), marks = el('g'), over = el('g'), svg = el('svg')
    svg.append(axes, marks, over)
    plot.append(svg)
    return { svg, axes, over, pl: pool(marks) }
  }
  const say = (ro, a, b) => fill(ro, el('span', { class: 'a' }, ...a), b ? el('span', { class: 'b' }, ...b) : '')

  // ---------- Sparkline: a trend small enough for one row ----------
  registry.Sparkline = (p) => {
    let cur = p, hot = -1, pts = [], geo = null
    const gid = `lm-sp${++seq}`
    const lab = el('span', { class: 'l' }), val = el('b', { class: 'v' })
    const defs = el('defs', {}, el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, el('stop', { offset: 0, style: 'stop-color: var(--tone, var(--accent)); stop-opacity: .3' }), el('stop', { offset: 1, style: 'stop-color: var(--tone, var(--accent)); stop-opacity: 0' })))
    const svg = el('svg', { 'aria-hidden': true }, defs), plot = el('div', { class: 'p' }, svg)
    const root = el('div', { class: 'lm-spk', role: 'img' }, el('div', { class: 'in' }, el('div', { class: 't' }, lab, val), plot))
    const size = { w: 0, h: 0 }, pl = pool(svg)

    const readout = () => {
      const raw = hot >= 0 ? pts[hot] : (cur.value ?? pts.at(-1)), n = num(raw), unit = text(cur.unit)
      fill(val, statusGlyph(cur.tone), n != null ? fmt(n) : text(raw) || '—', unit ? el('small', {}, unit) : '')
    }

    const draw = () => {
      const { w: W, h: H } = size
      const kind = cur.kind === 'bar' || cur.kind === 'area' ? cur.kind : 'line', n = pts.length
      geo = null
      if (W < 8 || H < 8) return pl.sweep()
      if (!n) {
        pl.mark('base', 'line', 'bl', { x1: 0, x2: W, y1: H / 2, y2: H / 2 })
        return pl.sweep()
      }
      const bars = kind === 'bar', L = 3, R = W - 5, T = bars ? 1 : 5, B = H - T
      const dMin = Math.min(...pts), dMax = Math.max(...pts)
      let lo = num(cur.min) ?? dMin, hi = num(cur.max) ?? dMax
      if (bars) {
        if (num(cur.min) == null) lo = Math.min(0, lo)
        if (num(cur.max) == null) hi = Math.max(0, hi)
      }
      if (hi <= lo) { lo -= 1; hi += 1 }
      const y = (v) => B - ((clamp(v, lo, hi) - lo) / (hi - lo)) * (B - T)
      const slot = W / n, x = (i) => (bars ? (i + 0.5) * slot : L + (n > 1 ? i / (n - 1) : 1) * (R - L))
      geo = { pick: (px) => (bars ? Math.floor(px / slot) : Math.round(((px - L) / (R - L)) * (n - 1))) }

      if (bars) {
        const gap = slot > 6 ? 2 : slot > 3 ? 1 : 0, y0 = y(clamp(0, lo, hi))
        pts.forEach((v, i) => {
          const state = hot >= 0 ? (hot === i ? ' hot' : ' dim') : i === n - 1 ? ' now' : ''
          pl.mark(`b${i}`, 'rect', `bar mk${state}`, { x: i * slot, y: Math.min(y(v), y0), width: Math.max(slot - gap, 1), height: Math.max(Math.abs(y(v) - y0), 1), rx: 1 })
        })
      } else {
        const d = n > 1 ? `M${pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('L')}` : `M${L},${y(pts[0])}L${R},${y(pts[0])}`
        if (kind === 'area') pl.mark('area', 'path', 'fill mk', { d: `${d}L${R},${H}L${n > 1 ? x(0) : L},${H}Z`, fill: `url(#${gid})` })
        pl.mark('line', 'path', 'ln mk', { d })
        if (H >= 20 && n > 3 && dMax > dMin) {
          for (const i of [pts.indexOf(dMin), pts.indexOf(dMax)]) if (i !== n - 1) pl.mark(`ex${i}`, 'circle', 'ex mk', { cx: x(i), cy: y(pts[i]), r: 2.4 })
        }
        pl.mark('now', 'circle', 'dot mk', { cx: x(n - 1), cy: y(pts[n - 1]), r: 3.5 })
        if (hot >= 0) {
          pl.mark('xh', 'line', 'xh', { x1: x(hot), x2: x(hot), y1: 0, y2: H })
          pl.mark('hv', 'circle', 'dot', { cx: x(hot), cy: y(pts[hot]), r: 3.5 })
        }
      }
      pl.sweep()
    }

    const go = (i) => {
      if (i === hot) return
      hot = i
      readout()
      draw()
    }
    plot.addEventListener('pointermove', (e) => geo && go(clamp(geo.pick(e.clientX - plot.getBoundingClientRect().left), 0, pts.length - 1)))
    plot.addEventListener('pointerleave', () => go(-1))
    watch(plot, (w, hh) => {
      size.w = w
      size.h = hh
      snap(root, draw)
    })

    const comp = {
      el: root,
      update(p) {
        cur = p
        pts = (Array.isArray(p.data) ? p.data.slice(-240) : []).map(num).filter((v) => v != null)
        if (hot >= pts.length) hot = -1
        setTone(root, p.tone ?? 'accent')
        lab.textContent = text(p.label)
        readout()
        root.setAttribute('aria-label', `${text(p.label)} ${val.textContent}`.trim())
        draw()
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- StackedBar: one budget split into parts, with its unused remainder ----------
  registry.StackedBar = (p) => {
    let cur = p, hot = -1
    const lab = el('span', { class: 'l' }), read = el('span', { class: 'r' }), bar = el('div', { class: 'bar' }), lg = el('ul', { class: 'lg' })
    const root = el('div', { class: 'lm-sb' }, el('div', { class: 'top' }, lab, read), bar, lg)
    const segs = [], items = []
    const makeItem = () => {
      const n = el('span', { class: 'n' }), v = el('b'), c = el('small')
      return { el: el('li', { class: 'it' }, el('i', { class: 'sw' }), n, v, c), n, v, c }
    }

    const paint = () => {
      const unit = text(cur.unit), [list, left] = objs(cur.segments, 12)
      const sg = list.map((s, i) => ({ label: text(s.label), v: Math.max(0, num(s.value) ?? 0), tone: s.tone ?? series(i) }))
      const sum = sg.reduce((n, s) => n + s.v, 0), total = Math.max(num(cur.total) ?? 0, 0), rest = Math.max(total - sum, 0), base = total || sum || 1
      const label = (s) => (s.rest ? text(cur.rest) || '—' : s.label)
      const shown = rest > 0 ? [...sg, { rest: true, v: rest }] : sg

      lab.textContent = text(cur.label)
      fill(read, total && sum > total ? el('span', { class: 'g', 'data-tone': 'err' }, glyph('err')) : null, el('b', {}, fmt(sum, unit)), total ? ` / ${fmt(total, unit)} · ${pct(sum / total)}` : '', more(left))
      fit(bar, segs, sum ? shown.length : 1, () => ({ el: el('div') }))
      fit(lg, items, shown.length, makeItem)
      segs.forEach((r, i) => {
        const s = shown[i]
        r.el.hidden = sum > 0 && !s.v
        r.el.className = `seg${!sum || s.rest ? ' rest' : ''}${hot >= 0 && hot !== i ? ' dim' : ''}`
        r.el.dataset.i = i
        r.el.style.flexGrow = sum ? s.v : 1
        setTone(r.el, !sum || s.rest ? null : s.tone)
        r.el.title = sum ? `${label(s)}: ${fmt(s.v, unit)} (${pct(s.v / base)})` : ''
      })
      items.forEach((r, i) => {
        const s = shown[i]
        r.el.className = `it${s.rest ? ' rest' : ''}${hot >= 0 && hot !== i ? ' dim' : ''}`
        r.el.dataset.i = i
        setTone(r.el, s.rest ? null : s.tone)
        r.n.textContent = r.n.title = label(s)
        r.v.textContent = fmt(s.v, unit)
        r.c.textContent = pct(s.v / base)
      })
    }

    const light = (i) => {
      if (i === hot) return
      hot = i
      paint()
    }
    root.addEventListener('pointerover', (e) => light(+(e.target.closest('[data-i]')?.dataset.i ?? -1)))
    root.addEventListener('pointerleave', () => light(-1))

    const comp = {
      el: root,
      update(p) {
        cur = p
        paint()
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Funnel: stages that keep a share of the one before ----------
  registry.Funnel = (p) => {
    const recs = [], sum = el('div', { class: 'sum' })
    const root = el('div', { class: 'lm-fn' })
    const make = () => {
      const g = el('span', { class: 'g' }), l = el('span', { class: 'l' }), v = el('b', { class: 'v' }), c = el('span')
      const cv = el('div', { class: 'cv' }, el('svg', { viewBox: '0 0 10 10', 'aria-hidden': true }, el('path', { d: 'M5 1.5v7M2 6l3 3 3-3' })), c)
      return { el: el('div', { class: 'stp' }, cv, el('div', { class: 'st' }, el('div', { class: 'top' }, g, l, v), el('div', { class: 'bar' }, el('i')))), g, l, v, c, cv }
    }
    const comp = {
      el: root,
      update(p) {
        const [list, left] = objs(p.stages, 12), unit = text(p.unit)
        const st = list.map((s) => ({ label: text(s.label), v: Math.max(0, num(s.value) ?? 0), tone: s.tone }))
        const peak = Math.max(0, ...st.map((s) => s.v)), width = (s) => (peak ? (s.v / peak) * 100 : 0)
        fit(root, recs, st.length, make)
        st.forEach((s, i) => {
          const r = recs[i], prev = st[i - 1]
          setTone(r.el, s.tone ?? 'accent')
          r.el.toggleAttribute('data-empty', !s.v)
          r.el.style.cssText = `--w: ${width(s)}%; --w0: ${prev ? width(prev) : 0}%; --a: ${s.tone ? 0.85 : 0.9 - 0.5 * (i / Math.max(1, st.length - 1))}`
          r.cv.hidden = !i
          r.c.textContent = prev ? (prev.v ? pct(s.v / prev.v) : '—') : ''
          fill(r.g, statusGlyph(s.tone))
          r.l.textContent = r.l.title = s.label
          r.v.textContent = fmt(s.v, unit)
        })
        const first = st[0], last = st.at(-1)
        sum.hidden = st.length < 2
        fill(sum, ...(st.length > 1 ? [`${fmt(first.v, unit)} → ${fmt(last.v, unit)}`, el('b', {}, first.v ? pct(last.v / first.v) : '—')] : []), more(left))
        root.append(sum)
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Bullet: a value against its target, over qualitative bands ----------
  registry.Bullet = (p) => {
    const recs = [], root = el('div', { class: 'lm-bl' }), foot = el('div', { class: 'foot' })
    const make = () => {
      const g = el('span', { class: 'g' }), l = el('span', { class: 'l' }), v = el('span', { class: 'v' })
      return { el: el('div', { class: 'row' }, el('div', { class: 'top' }, g, l, v), el('div', { class: 'gr' }, el('i', { class: 'val' }), el('i', { class: 'tg' }))), g, l, v }
    }
    const comp = {
      el: root,
      update(p) {
        const [list, left] = objs(p.items, 12)
        fit(root, recs, list.length, make)
        list.forEach((it, i) => {
          const r = recs[i], value = num(it.value) ?? 0, target = num(it.target), unit = text(it.unit)
          const bands = arr(it.ranges, 3).map(num).filter((v) => v != null).sort((a, b) => a - b)
          const max = Math.max(value, target ?? 0, ...bands, 0) || 1, at = (v) => `${clamp((v / max) * 100, 0, 100)}%`
          const edges = [0, ...bands].map((v, k, all) => (k ? `var(--band-${k}) ${at(all[k - 1])} ${at(v)}` : null)).filter(Boolean)
          setTone(r.el, it.tone ?? 'accent')
          r.el.classList.toggle('no-target', target == null)
          r.el.classList.toggle('zero', !value)
          r.el.style.cssText = `--v: ${at(value)}; --t: ${at(target ?? 0)}; --bands: ${edges.length ? `linear-gradient(90deg, ${edges.join(', ')})` : 'none'}`
          fill(r.g, statusGlyph(it.tone))
          r.l.textContent = r.l.title = text(it.label)
          fill(r.v, el('b', {}, fmt(value, unit)), target != null ? el('small', {}, ` / ${fmt(target, unit)}`) : '')
        })
        fill(foot, more(left))
        root.append(foot)
      },
    }
    comp.update(p)
    return comp
  }

  // CSS colour expression as sRGB, resolved where `node` sits so it follows the theme and palette.
  const rgbOf = (node, expr) => {
    const probe = el('i', { style: `color: ${expr}` })
    node.append(probe)
    const css = getComputedStyle(probe).color
    probe.remove()
    canvas.clearRect(0, 0, 1, 1)
    canvas.fillStyle = '#000'
    canvas.fillStyle = css
    canvas.fillRect(0, 0, 1, 1)
    return [...canvas.getImageData(0, 0, 1, 1).data]
  }
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])

  // ---------- Heatmap: a matrix on a single-hue intensity ramp ----------
  // The ramp is the tone blended over the panel at rising opacity, so it reads as "more" on dark glass (brighter) and on light (deeper) alike.
  registry.Heatmap = (p) => {
    let cur = p, hot = -1, m = null, g = null
    const { root, ro, plot, size } = frame('lm-hm', () => draw(), true)
    const { svg, axes, over, pl } = layers(plot)
    const read = el('span', { class: 'a' }), lo = el('small'), hi = el('small')
    const scale = el('span', { class: 'b scale' }, lo, el('i', { class: 'ramp' }), hi)
    ro.append(read, scale)
    plot.setAttribute('role', 'img')

    const model = () => {
      const rl = arr(cur.rows, 24).map(text), cl = arr(cur.cols, 60).map(text)
      const vals = arr(cur.values, 24).map((r) => arr(r, 60).map(num))
      const R = Math.max(rl.length, vals.length), C = Math.max(cl.length, ...vals.map((r) => r.length))
      const all = vals.flat().filter((v) => v != null)
      let from = num(cur.min) ?? (all.length ? Math.min(...all) : 0), to = num(cur.max) ?? (all.length ? Math.max(...all) : 1)
      if (num(cur.min) == null && from > 0) from = 0 // counts and rates start at nothing
      if (to <= from) to = from + 1
      let top = -1, best = -Infinity
      vals.forEach((r, i) => r.forEach((v, j) => { if (v != null && v > best) { best = v; top = i * C + j } }))
      return { rl, cl, vals, R, C, all, from, to, top: all.length > 1 && best > Math.min(...all) ? top : -1, unit: text(cur.unit) }
    }
    const at = (i) => ({ r: Math.floor(i / m.C), c: i % m.C })
    const valueAt = (r, c) => m.vals[r]?.[c] ?? null

    const readout = () => {
      if (!m) return
      scale.hidden = !m.all.length
      fill(lo, fmt(m.from, m.unit))
      fill(hi, fmt(m.to, m.unit))
      const i = hot >= 0 ? hot : m.top
      if (i < 0) return fill(read)
      const { r, c } = at(i), where = [m.rl[r], m.cl[c]].filter(Boolean).join(' · ') || `${r + 1}, ${c + 1}`
      fill(read, hot < 0 ? el('i', { class: 'pk' }) : null, el('b', {}, fmt(valueAt(r, c), m.unit)), el('small', {}, ` ${where}`))
    }
    const place = () => {
      over.replaceChildren()
      if (hot >= 0 && g) {
        const { r, c } = at(hot)
        over.append(el('rect', { class: 'hv', x: g.left + c * g.cw, y: r * g.ch, width: g.cw, height: g.ch }))
      }
    }

    const draw = () => {
      const W = size.w
      axes.replaceChildren()
      g = null
      if (!m || W < 40 || !m.R || !m.C) {
        plot.style.height = '0px'
        place()
        return pl.sweep()
      }
      const { R, C, rl, cl } = m, u = rem(), tw = ruler(svg)
      const left = rl.some(Boolean) ? Math.ceil(Math.min(Math.max(...rl.map(tw)) + u * 0.7, W * 0.3)) : 0
      const cw = (W - left) / C, gap = cw >= 16 ? 2 : cw >= 5 ? 1 : 0, ch = clamp(cw * 0.62, u * 1.15, u * 2.1)
      const foot = cl.some(Boolean) ? u * 1.6 : 2
      plot.style.height = `${Math.ceil(R * ch + foot)}px`
      g = { left, cw, ch }

      const rowStep = Math.ceil((u * 1.1) / ch)
      rl.forEach((s, r) => s && r % rowStep === 0 && axes.append(el('text', { x: left - u * 0.5, y: (r + 0.5) * ch, 'text-anchor': 'end', 'dominant-baseline': 'central' }, clip(tw, s, left - u * 0.5))))
      const colCap = W * 0.25, colStep = Math.max(1, Math.ceil((Math.min(Math.max(0, ...cl.map(tw)), colCap) + u * 0.6) / cw))
      cl.forEach((s, c) => {
        const x = left + (c + 0.5) * cw, label = clip(tw, s, colCap)
        if (label && c % colStep === 0 && x + tw(label) / 2 <= W + u * 0.3) axes.append(el('text', { x, y: R * ch + u * 0.95, 'text-anchor': 'middle' }, label))
      })

      // Values go into the cells when they fit, in whichever ink reads better on that cell's blend.
      const wide = cw > 24 && ch >= u * 1.2 ? Math.max(0, ...m.all.map((v) => tw(fmt(v)))) : Infinity
      const inked = cw - gap - 6 >= wide
      let flip = null
      if (inked) {
        const tone = rgbOf(root, 'var(--tone, var(--accent))'), bg = rgbOf(root, 'var(--panel-solid)'), ink = lum(rgbOf(root, 'var(--text)')), alt = lum(rgbOf(root, 'var(--accent-ink)'))
        const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
        flip = (a) => { const y = lum(tone.map((c, i) => c * a + bg[i] * (1 - a))); return ratio(y, alt) > ratio(y, ink) }
      }
      for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
          const v = valueAt(r, c), x = left + c * cw + gap / 2, y = r * ch + gap / 2, w = Math.max(cw - gap, 1), hh = Math.max(ch - gap, 1)
          if (v == null) { pl.mark(`${r}:${c}`, 'rect', 'cell na', { x, y, width: w, height: hh }); continue }
          const a = 0.08 + 0.92 * clamp((v - m.from) / (m.to - m.from), 0, 1)
          pl.mark(`${r}:${c}`, 'rect', 'cell mk', { x, y, width: w, height: hh, 'fill-opacity': a.toFixed(3) })
          if (inked) pl.mark(`v${r}:${c}`, 'text', `val${flip(a) ? ' alt' : ''}`, { x: x + w / 2, y: y + hh / 2 }).textContent = fmt(v)
        }
      }
      if (m.top >= 0) {
        const { r, c } = at(m.top)
        pl.mark('peak', 'rect', 'peak', { x: left + c * cw + gap / 2 + 0.5, y: r * ch + gap / 2 + 0.5, width: Math.max(cw - gap - 1, 1), height: Math.max(ch - gap - 1, 1) })
      }
      pl.sweep()
      place()
    }

    const go = (i) => {
      if (i === hot) return
      hot = i
      place()
      readout()
    }
    svg.addEventListener('pointermove', (e) => {
      if (!g) return
      const b = svg.getBoundingClientRect(), c = Math.floor((e.clientX - b.left - g.left) / g.cw), r = Math.floor((e.clientY - b.top) / g.ch)
      go(c >= 0 && c < m.C && r >= 0 && r < m.R ? r * m.C + c : -1)
    })
    svg.addEventListener('pointerleave', () => go(-1))
    keys(plot, () => (m ? m.R * m.C : 0), () => hot, go, () => m.C)

    const comp = {
      el: root,
      update(p) {
        cur = p
        m = model()
        if (hot >= m.R * m.C) hot = -1
        setTone(root, p.tone ?? 'accent')
        plot.setAttribute('aria-label', `${m.R}×${m.C}${m.top >= 0 ? `, max ${fmt(m.to, m.unit)}` : ''}`)
        readout()
        draw()
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Histogram: how a quantity is spread ----------
  // Lower edges read from labels such as "10-20" or "≥ 0.5s"; null when the labels are not an ordered numeric scale.
  const edgesOf = (bins) => {
    const found = bins.map((b) => b.label.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [])
    const lows = found.map((a) => a[0])
    if (!lows.length || lows.some((v, i) => v == null || (i && v <= lows[i - 1]))) return null
    const upper = Math.abs(found.at(-1)[1] ?? NaN), last = lows.at(-1)
    return [...lows, upper > last ? upper : last + (lows.length > 1 ? last - lows.at(-2) : 1)]
  }

  registry.Histogram = (p) => {
    let cur = p, hot = -1, m = null, g = null
    const { root, ro, plot, size } = frame('lm-hist', () => draw())
    const { svg, axes, over, pl } = layers(plot)
    plot.setAttribute('role', 'img')

    const model = () => {
      const unit = text(cur.unit), vs = arr(cur.values, 5000).map(num).filter((v) => v != null)
      const markers = objs(cur.markers, 8)[0].map((k) => ({ label: text(k.label), v: num(k.value) })).filter((k) => k.v != null)
      if (vs.length) {
        let from = Math.min(...vs), to = Math.max(...vs)
        if (from === to) { const d = Math.abs(from) * 0.1 || 1; from -= d; to += d }
        const want = clamp(Math.round(num(cur.binCount) ?? Math.log2(vs.length) + 2), 3, 60)
        const step = nice((to - from) / want), start = Math.floor(from / step + 1e-9) * step, N = clamp(Math.ceil((to - start) / step - 1e-9), 1, 120)
        const bins = Array.from({ length: N }, (_, i) => {
          const a = +(start + i * step).toFixed(10), b = +(start + (i + 1) * step).toFixed(10)
          return { count: 0, label: `${fmt(a)}–${fmt(b, unit)}`, a }
        })
        for (const v of vs) bins[clamp(Math.floor((v - start) / step + 1e-9), 0, N - 1)].count++
        return { bins, N, unit, markers, total: vs.length, scale: (v) => (v - start) / step, tick: (i) => fmt(+(start + i * step).toFixed(10), unit), numeric: true }
      }
      const bins = objs(cur.bins, 60)[0].map((b) => ({ label: text(b.label), count: Math.max(0, num(b.count) ?? 0) }))
      const edges = edgesOf(bins)
      const scale = (v) => {
        const i = edges ? edges.findIndex((e, k) => k < bins.length && v >= e && v <= edges[k + 1]) : -1
        return i < 0 ? null : i + (v - edges[i]) / (edges[i + 1] - edges[i])
      }
      return { bins, N: bins.length, unit, markers, total: bins.reduce((n, b) => n + b.count, 0), scale, numeric: false }
    }

    const readout = () => {
      if (!m) return
      const b = m.bins[hot], n = m.total
      if (b) return say(ro, [b.label], [el('b', {}, fmt(b.count)), ` ${pct(n ? b.count / n : 0)}`])
      say(ro, m.markers.map((k) => el('span', { class: 'kv' }, el('small', {}, k.label), ' ', el('b', {}, fmt(k.v, m.unit)))), m.bins.length ? [`n ${fmt(n)}`] : [])
    }

    const draw = () => {
      const { w: W, h: H } = size
      axes.replaceChildren()
      over.replaceChildren()
      g = null
      if (!m || W < 80 || H < 80) return pl.sweep()
      const u = rem(), tw = ruler(svg), { bins, N } = m
      const rules = m.markers.map((k) => ({ ...k, f: m.scale(k.v) })).filter((k) => k.f != null).sort((a, b) => a.f - b.f)
      const s0 = m.numeric ? Math.min(0, ...rules.map((k) => Math.floor(k.f))) : 0, s1 = m.numeric ? Math.max(N, ...rules.map((k) => Math.ceil(k.f))) : N
      const top = rules.length > 1 ? u * 2.4 : rules.length ? u * 1.6 : u * 0.8, bottom = u * 1.7, right = u * 1.1, ph = H - top - bottom
      const peak = Math.max(0, ...bins.map((b) => b.count)), yt = ticksOf(0, peak, clamp(Math.floor(ph / (u * 3.2)), 2, 5), true), yMax = yt.at(-1)
      const left = Math.ceil(Math.max(...yt.map((t) => tw(fmt(t))))) + u * 0.9, pw = W - left - right
      const X = (f) => left + ((f - s0) / (s1 - s0)) * pw, Y = (v) => top + (1 - v / yMax) * ph, slot = pw / (s1 - s0)
      g = { left, pw, s0, s1, N }

      for (const t of yt) {
        axes.append(el('line', { class: t ? 'gl' : 'bl', x1: left, x2: W - right, y1: Y(t), y2: Y(t) }), el('text', { x: left - u * 0.5, y: Y(t), 'text-anchor': 'end', 'dominant-baseline': 'central' }, fmt(t)))
      }
      // Edge labels for a numeric scale, bin labels for named bins; both thin out to what fits.
      const label = (i) => (m.numeric ? m.tick(i) : bins[i].label)
      const idx = m.numeric ? Array.from({ length: s1 - s0 + 1 }, (_, k) => s0 + k) : bins.map((_, i) => i)
      const step = Math.max(1, Math.ceil((Math.max(0, ...idx.map((i) => tw(label(i)))) + u * 0.7) / slot))
      for (const i of idx) {
        if (i % step) continue
        const x = X(m.numeric ? i : i + 0.5), s = m.numeric ? label(i) : clip(tw, label(i), slot * step - u * 0.5)
        if (x + tw(s) / 2 > W) continue
        axes.append(el('line', { class: 'tk', x1: x, x2: x, y1: Y(0), y2: Y(0) + u * 0.3 }), el('text', { x, y: H - u * 0.45, 'text-anchor': 'middle' }, s))
      }

      const gap = slot >= 10 ? 2 : slot >= 5 ? 1 : 0
      bins.forEach((b, i) => {
        const y = Y(b.count)
        pl.mark(`b${i}`, 'rect', `bar mk${hot < 0 ? '' : hot === i ? ' on' : ' dim'}`, { x: X(i) + gap / 2, y, width: Math.max(slot - gap, 1), height: Math.max(Y(0) - y, b.count ? 1 : 0), rx: 1 })
      })
      pl.sweep()

      // Marker labels sit above the plot, on a second row when the first is taken.
      const taken = [-Infinity, -Infinity]
      for (const k of rules) {
        const x = X(k.f), w = Math.min(tw(k.label), W - left), lx = clamp(x, left + w / 2, W - w / 2), row = lx - w / 2 > taken[0] + 6 ? 0 : lx - w / 2 > taken[1] + 6 ? 1 : -1
        const ly = top - u * (row === 1 ? 1.75 : 0.85)
        over.append(el('line', { class: 'rule', x1: x, x2: x, y1: row < 0 ? top : ly + u * 0.4, y2: Y(0) }))
        if (row >= 0) {
          taken[row] = lx + w / 2
          fitText(over.appendChild(el('text', { class: 'rl', x: lx, y: ly, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, k.label)), w)
        }
      }
    }

    const go = (i) => {
      if (i === hot) return
      hot = i
      readout()
      draw()
    }
    svg.addEventListener('pointermove', (e) => {
      if (!g) return
      const i = Math.floor(g.s0 + ((e.clientX - svg.getBoundingClientRect().left - g.left) / g.pw) * (g.s1 - g.s0))
      go(i >= 0 && i < g.N ? i : -1)
    })
    svg.addEventListener('pointerleave', () => go(-1))
    keys(plot, () => (m ? m.N : 0), () => hot, go)

    const comp = {
      el: root,
      update(p) {
        cur = p
        m = model()
        if (hot >= m.N) hot = -1
        setTone(root, p.tone ?? 'accent')
        plot.setAttribute('aria-label', `n ${m.total}`)
        readout()
        draw()
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Scatter: two measures, one dot per item ----------
  const SHAPES = {
    circle: (r) => `M${-r},0a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`,
    square: (r) => `M${-r * 0.85},${-r * 0.85}h${r * 1.7}v${r * 1.7}h${-r * 1.7}Z`,
    triangle: (r) => `M0,${-r * 1.15}L${r * 1.05},${r * 0.85}H${-r * 1.05}Z`,
    diamond: (r) => `M0,${-r * 1.2}L${r * 1.2},0L0,${r * 1.2}L${-r * 1.2},0Z`,
    cross: (r) => `M${-r},${-r}L${r},${r}M${r},${-r}L${-r},${r}`,
  }
  // Colour is never the only channel: status tones have a fixed shape, other tones take the rest in order of appearance.
  const STATUS_SHAPE = { ok: 'circle', warn: 'triangle', serious: 'diamond', err: 'cross' }
  const SHAPE_ORDER = ['circle', 'square', 'triangle', 'diamond']

  // [lo, hi] of a list with a little air, never a zero-width range.
  const domainOf = (vs) => {
    let lo = Math.min(...vs), hi = Math.max(...vs)
    if (lo === hi) { const d = Math.abs(lo) * 0.1 || 1; lo -= d; hi += d }
    const pad = (hi - lo) * 0.04
    return [lo - pad, hi + pad]
  }
  const axisTitle = (label, unit) => [text(label), unit ? `(${text(unit)})` : ''].filter(Boolean).join(' ')

  registry.Scatter = (p) => {
    let cur = p, hot = -1, m = null, g = null
    const { root, ro, plot, size } = frame('lm-scat', () => draw())
    const { svg, axes, over, pl } = layers(plot)
    plot.setAttribute('role', 'img')

    const model = () => {
      const [list, left] = objs(cur.points, 500)
      const pts = list.map((q, i) => ({ i, x: num(q.x), y: num(q.y), label: text(q.label), tone: q.tone ?? 'accent', size: num(q.size) })).filter((q) => q.x != null && q.y != null).sort((a, b) => a.x - b.x || a.y - b.y)
      const tones = [...new Set(pts.map((q) => q.tone))].filter((t) => t !== 'accent' && !STATUS_SHAPE[t])
      for (const q of pts) q.shape = STATUS_SHAPE[q.tone] ?? SHAPE_ORDER[(q.tone === 'accent' ? 0 : tones.indexOf(q.tone) + 1) % SHAPE_ORDER.length]
      const sizes = pts.map((q) => q.size).filter((v) => v != null)
      return { pts, left, sizes, xu: text(cur.xUnit), yu: text(cur.yUnit), xn: text(cur.xLabel) || 'x', yn: text(cur.yLabel) || 'y' }
    }

    const readout = () => {
      if (!m) return
      const q = m.pts[hot]
      if (!q) return say(ro, [], [`n ${m.pts.length}`, more(m.left)])
      say(ro, [el('i', { 'data-tone': q.tone }), q.label || `#${q.i + 1}`], [`${m.xn} `, el('b', {}, fmt(q.x, m.xu)), ` · ${m.yn} `, el('b', {}, fmt(q.y, m.yu)), q.size != null ? ` · ⌀ ${fmt(q.size)}` : ''])
    }

    const draw = () => {
      const { w: W, h: H } = size
      axes.replaceChildren()
      over.replaceChildren()
      g = null
      if (!m || W < 100 || H < 90) return pl.sweep()
      const u = rem(), tw = ruler(svg), n = m.pts.length
      const xTitle = axisTitle(cur.xLabel, cur.xUnit), yTitle = axisTitle(cur.yLabel, cur.yUnit)
      const top = yTitle ? u * 1.7 : u * 0.8, bottom = u * 1.7 + (xTitle ? u * 1.1 : 0), right = u, ph = H - top - bottom
      const [ylo, yhi] = n ? domainOf(m.pts.map((q) => q.y)) : [0, 1], [xlo, xhi] = n ? domainOf(m.pts.map((q) => q.x)) : [0, 1]
      const yt = ticksOf(ylo, yhi, clamp(Math.floor(ph / (u * 3.2)), 2, 6))
      const left = Math.ceil(Math.max(...yt.map((t) => tw(fmt(t))))) + u * 0.9, pw = W - left - right
      const xt = ticksOf(xlo, xhi, clamp(Math.floor(pw / (u * 5.5)), 2, 8))
      const [x0, x1, y0, y1] = [xt[0], xt.at(-1), yt[0], yt.at(-1)]
      const X = (v) => left + ((v - x0) / (x1 - x0)) * pw, Y = (v) => top + (1 - (v - y0) / (y1 - y0)) * ph

      for (const t of yt) axes.append(el('line', { class: t === y0 ? 'bl' : 'gl', x1: left, x2: W - right, y1: Y(t), y2: Y(t) }), el('text', { x: left - u * 0.5, y: Y(t), 'text-anchor': 'end', 'dominant-baseline': 'central' }, fmt(t)))
      for (const t of xt) {
        const s = fmt(t), x = X(t)
        axes.append(el('line', { class: t === x0 ? 'bl' : 'gl', x1: x, x2: x, y1: top, y2: top + ph }), el('text', { x, y: top + ph + u * 1.1, 'text-anchor': 'middle' }, s))
      }
      if (yTitle) fitText(axes.appendChild(el('text', { class: 'ttl', x: left, y: u * 0.8, 'dominant-baseline': 'central' }, yTitle)), W - left - u * 0.5)
      if (xTitle) fitText(axes.appendChild(el('text', { class: 'ttl', x: W - right, y: H - u * 0.4, 'text-anchor': 'end' }, xTitle)), pw)

      const base = n <= 40 ? 4.5 : n <= 150 ? 3.6 : n <= 300 ? 3 : 2.4, rMax = clamp(Math.min(pw, ph) * 0.07, 6, 18)
      const sLo = Math.min(...m.sizes), sSpan = Math.max(...m.sizes) - sLo || 1
      g = { pts: m.pts.map((q) => ({ x: X(q.x), y: Y(q.y), r: m.sizes.length ? base * 0.8 + Math.sqrt(((q.size ?? sLo + sSpan / 2) - sLo) / sSpan) * (rMax - base * 0.8) : base })) }
      m.pts.forEach((q, k) => {
        pl.mark(`p${q.i}`, 'path', `pt mk${q.shape === 'cross' ? ' x' : ''}${n < 120 ? ' ring' : ''}`, { d: SHAPES[q.shape](g.pts[k].r), 'data-tone': q.tone, style: `transform: translate(${g.pts[k].x}px, ${g.pts[k].y}px)` })
      })
      pl.sweep()
      if (hot >= 0 && g.pts[hot]) over.append(el('circle', { class: 'hv', cx: g.pts[hot].x, cy: g.pts[hot].y, r: g.pts[hot].r + 4 }))
    }

    const go = (i) => {
      if (i === hot) return
      hot = i
      readout()
      draw()
    }
    // The nearest dot within reach wins, so a small dot is never a pinpoint.
    svg.addEventListener('pointermove', (e) => {
      if (!g) return
      const b = svg.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top
      let best = -1, d2 = 28 * 28
      g.pts.forEach((q, i) => {
        const d = (q.x - x) ** 2 + (q.y - y) ** 2
        if (d < d2) { d2 = d; best = i }
      })
      go(best)
    })
    svg.addEventListener('pointerleave', () => go(-1))
    keys(plot, () => (m ? m.pts.length : 0), () => hot, go)

    const comp = {
      el: root,
      update(p) {
        cur = p
        m = model()
        if (hot >= m.pts.length) hot = -1
        plot.setAttribute('aria-label', `n ${m.pts.length}`)
        readout()
        draw()
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Treemap: areas that add up to a budget ----------
  // Squarified (Bruls et al.): rows go along the shorter side while their worst aspect ratio keeps improving. `items` come sorted, largest first.
  const squarify = (items, W, H) => {
    const total = items.reduce((n, it) => n + it.v, 0), out = []
    if (!total) return out
    const rest = items.map((it) => ({ it, a: (it.v / total) * W * H }))
    let x = 0, y = 0, w = W, h = H
    while (rest.length) {
      const side = Math.min(w, h), row = [rest.shift()]
      const worst = (sum, big, small) => Math.max((side * side * big) / (sum * sum), (sum * sum) / (side * side * small))
      let sum = row[0].a
      while (rest.length && worst(sum + rest[0].a, row[0].a, rest[0].a) <= worst(sum, row[0].a, row.at(-1).a)) {
        sum += rest[0].a
        row.push(rest.shift())
      }
      const thick = sum / side
      let at = 0
      for (const { it, a } of row) {
        const len = a / thick
        out.push(w >= h ? { it, x, y: y + at, w: thick, h: len } : { it, x: x + at, y, w: len, h: thick })
        at += len
      }
      if (w >= h) { x += thick; w -= thick } else { y += thick; h -= thick }
    }
    return out
  }

  registry.Treemap = (p) => {
    let cur = p, hot = -1, m = null, cells = []
    const { root, ro, plot, size } = frame('lm-tm', () => draw())
    const pl = pool(plot)

    const model = () => {
      const [list, left] = objs(cur.items, 60), seen = new Map()
      const items = list.map((s, i) => ({ label: text(s.label), v: num(s.value) ?? 0, tone: s.tone ?? series(i), sub: text(s.sub) })).filter((s) => s.v > 0).sort((a, b) => b.v - a.v)
      for (const it of items) {
        seen.set(it.label, (seen.get(it.label) ?? 0) + 1)
        it.key = `${it.label}#${seen.get(it.label)}`
      }
      return { items, left, total: items.reduce((n, it) => n + it.v, 0), unit: text(cur.unit) }
    }

    const readout = () => {
      if (!m) return
      const it = m.items[hot]
      if (!it) return say(ro, [el('b', {}, fmt(m.total, m.unit))], [`n ${m.items.length}`, more(m.left)])
      say(ro, [el('i', { 'data-tone': it.tone }), it.label, it.sub ? el('small', {}, ` ${it.sub}`) : null], [el('b', {}, fmt(it.v, m.unit)), ` ${pct(it.v / m.total)}`])
    }

    const draw = () => {
      const { w: W, h: H } = size
      cells = []
      if (!m || W < 40 || H < 40) return pl.sweep()
      squarify(m.items, W, H).forEach(({ it, x, y, w, h }, k) => {
        const fitLevel = w < 44 || h < 22 ? 0 : h < 42 ? 1 : h < 58 ? 2 : 3
        const cell = pl.mark(it.key, 'div', `cell${hot === k ? ' on' : ''}`, { 'data-tone': it.tone, 'data-k': k, 'data-fit': fitLevel, style: `left: ${x + 1}px; top: ${y + 1}px; width: ${Math.max(w - 2, 1)}px; height: ${Math.max(h - 2, 1)}px` })
        fill(cell, el('b', {}, it.label), el('span', { class: 'n' }, `${fmt(it.v, m.unit)} · ${pct(it.v / m.total)}`), it.sub ? el('small', {}, it.sub) : null)
        cells[k] = cell
      })
      pl.sweep()
    }

    const go = (k) => {
      if (k === hot) return
      cells[hot]?.classList.remove('on')
      hot = k
      cells[hot]?.classList.add('on')
      readout()
    }
    plot.addEventListener('pointerover', (e) => go(+(e.target.closest('.cell')?.dataset.k ?? -1)))
    plot.addEventListener('pointerleave', () => go(-1))
    keys(plot, () => (m ? m.items.length : 0), () => hot, go)

    const comp = {
      el: root,
      update(p) {
        cur = p
        m = model()
        if (hot >= m.items.length) hot = -1
        root.toggleAttribute('data-empty', !m.items.length)
        plot.setAttribute('aria-label', `${fmt(m.total, m.unit)}, n ${m.items.length}`)
        readout()
        draw()
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Gantt: spans on a shared time axis ----------
  const UNIT_MS = { ms: 1, s: 1000, min: 60000 }
  const MAX_SPANS = 80, MAX_ROWS = 24
  // 1500 ms → 1.5s, 90 s → 1m30s
  const fmtTime = (v, unit) => {
    const ms = v * UNIT_MS[unit], a = Math.abs(ms)
    if (!ms) return '0'
    if (a < 1000) return `${+ms.toFixed(a < 1 ? 2 : a < 10 ? 1 : 0)}ms`
    if (a < 60000) return `${+(ms / 1000).toFixed(a < 10000 ? 1 : 0)}s`
    const s = Math.round(ms / 1000), mm = Math.floor(s / 60)
    if (a < 3600000) return s % 60 ? `${mm}m${s % 60}s` : `${mm}m`
    return mm % 60 ? `${Math.floor(mm / 60)}h${mm % 60}m` : `${mm / 60}h`
  }
  const STATE_TONE = { done: 'ok', running: 'accent', failed: 'err' }

  registry.Gantt = (p) => {
    let cur = p, hot = -1, m = null
    const { root, ro, plot, size } = frame('lm-gt', () => draw(), true)
    const { svg, axes, over, pl } = layers(plot)
    plot.setAttribute('role', 'img')

    const model = () => {
      const unit = UNIT_MS[cur.unit] ? cur.unit : 's', [list, extra] = objs(cur.spans, 400)
      const all = list.map((s, i) => ({ i, label: text(s.label), start: num(s.start), dur: Math.max(num(s.duration) ?? NaN, 0), group: text(s.group), state: s.state === 'running' || s.state === 'failed' ? s.state : 'done', tone: s.tone, meta: text(s.meta) }))
        .filter((s) => s.start != null && Number.isFinite(s.dur)).sort((a, b) => a.start - b.start || a.i - b.i)
      // The newest spans matter most on a live screen: the oldest are the ones left out.
      const spans = all.slice(-MAX_SPANS)
      spans.forEach((s, k) => { s.k = k; s.end = s.start + s.dur })
      const groups = [...new Set(spans.map((s) => s.group))], named = groups.some(Boolean)
      for (const s of spans) s.paint = s.state === 'failed' ? 'err' : s.tone ?? (named && groups.length > 1 ? series(groups.indexOf(s.group)) : 'accent')
      return { unit, spans, groups, named, left: extra + all.length - spans.length, dropped: 0 }
    }

    const readout = () => {
      if (!m) return
      const s = m.spans[hot], tally = (state) => m.spans.filter((x) => x.state === state).length
      const mark = (state, n) => (n ? el('span', { class: 'tally', 'data-tone': STATE_TONE[state] }, glyph(STATE_TONE[state]), el('b', {}, n)) : null)
      if (!s) {
        const end = Math.max(0, ...m.spans.map((x) => x.end)), begin = Math.min(end, ...m.spans.map((x) => x.start))
        return say(ro, [mark('done', tally('done')), mark('running', tally('running')), mark('failed', tally('failed'))], [m.spans.length ? fmtTime(end - begin, m.unit) : '', more(m.left + m.dropped)])
      }
      say(ro, [el('span', { class: 'g', 'data-tone': STATE_TONE[s.state] }, glyph(STATE_TONE[s.state])), s.label, s.meta ? el('small', {}, ` ${s.meta}`) : null], [el('span', { class: 'rng' }, `${fmtTime(s.start, m.unit)} → ${fmtTime(s.end, m.unit)} · `), el('b', {}, fmtTime(s.dur, m.unit))])
    }

    const draw = () => {
      const W = size.w
      axes.replaceChildren()
      over.replaceChildren()
      if (!m || W < 120 || !m.spans.length) {
        plot.style.height = '0px'
        pl.sweep()
        return readout()
      }
      const u = rem(), tw = ruler(svg), { spans, groups, named } = m
      const gw = named ? Math.ceil(Math.min(Math.max(...groups.map(tw)) + u * 1.5, W * 0.3)) : 0, right = u * 0.8, pw = W - gw - right
      const end = Math.max(1, ...spans.map((s) => s.end)), first = spans[0]?.start ?? 0
      const lo = first <= end * 0.25 ? Math.min(0, first) : first, hi = end > lo ? end : lo + 1
      const X = (t) => gw + ((t - lo) / (hi - lo)) * pw, perPx = (hi - lo) / pw

      // Rows: one lane per group, split into sub-rows wherever spans overlap.
      let rows = []
      for (const grp of groups) {
        const lanes = []
        for (const s of spans.filter((x) => x.group === grp)) {
          const lane = lanes.find((l) => l.end + 2 * perPx <= s.start) ?? lanes[lanes.push({ end: -Infinity, spans: [] }) - 1]
          lane.spans.push(s)
          lane.end = Math.max(s.end, s.start + 6 * perPx)
        }
        rows.push(...lanes.map((l, k) => ({ grp, first: !k, spans: l.spans })))
      }
      m.dropped = rows.slice(MAX_ROWS).reduce((n, r) => n + r.spans.length, 0)
      rows = rows.slice(0, MAX_ROWS)

      const rowH = u * 1.5, barH = u * 1, top = u * 0.3, body = rows.length * rowH, H = top + body + u * 1.7
      plot.style.height = `${Math.ceil(H)}px`
      const ticks = ticksOf(lo, hi, clamp(Math.floor(pw / (u * 6)), 2, 8)).filter((t) => t >= lo - 1e-9 && t <= hi + 1e-9)
      axes.append(el('line', { class: 'bl', x1: gw, x2: W - right, y1: top + body, y2: top + body }))
      for (const t of ticks) {
        const x = X(t), s = fmtTime(t, m.unit)
        axes.append(el('line', { class: 'gl', x1: x, x2: x, y1: top, y2: top + body }), el('line', { class: 'tk', x1: x, x2: x, y1: top + body, y2: top + body + u * 0.3 }))
        if (x + tw(s) / 2 <= W) axes.append(el('text', { x, y: top + body + u * 1.15, 'text-anchor': 'middle' }, s))
      }

      rows.forEach((r, ri) => {
        const y = top + ri * rowH, cy = y + rowH / 2
        if (r.first && ri) axes.append(el('line', { class: 'sep', x1: 0, x2: W - right, y1: y, y2: y }))
        if (r.first && named) {
          axes.append(el('rect', { class: 'sw', 'data-tone': groups.length > 1 ? series(groups.indexOf(r.grp)) : 'accent', x: 0, y: cy - 3.5, width: 7, height: 7 }))
          if (r.grp) axes.append(el('text', { class: 'grp', x: u * 1.1, y: cy, 'dominant-baseline': 'central' }, clip(tw, r.grp, gw - u * 1.4)))
        }
        // Free room along the row is what the bars and the labels placed so far leave over.
        const bars = r.spans.map((s) => [X(s.start), Math.max(X(s.end), X(s.start) + 3)]), taken = [...bars]
        r.spans.forEach((s, si) => {
          const own = bars[si], w = own[1] - own[0], by = cy - barH / 2, state = hot < 0 ? '' : hot === s.k ? ' on' : ' dim'
          pl.mark(`s${s.i}`, 'rect', `bar mk ${s.state}${state}`, { 'data-tone': s.paint, x: own[0], y: by, width: w, height: barH, rx: 2 })
          if (s.state === 'running') pl.mark(`e${s.i}`, 'rect', `live${state}`, { 'data-tone': s.paint, x: own[1] - 2, y: by, width: 2, height: barH })
          let tail = 0 // room the failure mark takes inside the bar
          if (s.state === 'failed') {
            const inside = w >= 18
            pl.mark(`x${s.i}`, 'path', `fx mk${state}`, { d: 'M-3,-3L3,3M3,-3L-3,3', 'data-tone': 'err', style: `transform: translate(${inside ? own[1] - 8 : own[1] + 8}px, ${cy}px)` })
            if (inside) tail = 12; else own[1] += 14
          }
          if (!s.label) return
          const need = tw(s.label), others = taken.filter((o) => o !== own)
          const roomRight = Math.min(W - right, ...others.filter((o) => o[0] >= own[1] - 0.5).map((o) => o[0])) - own[1] - 8
          const roomLeft = own[0] - Math.max(gw, ...others.filter((o) => o[1] <= own[0] + 0.5).map((o) => o[1])) - 8
          // Inside the bar if it fits, else beside it, else the roomiest spot with the label clipped to it.
          const spots = [{ room: w - 8 - tail, x: own[0] + 4, anchor: 'start', inside: true }, { room: roomRight, x: own[1] + 4, anchor: 'start' }, { room: roomLeft, x: own[0] - 4, anchor: 'end' }]
          const spot = spots.find((c) => need <= c.room) ?? spots.reduce((a, c) => (c.room > a.room ? c : a))
          if (spot.room < 30) return
          const at = { ...spot, text: clip(tw, s.label, spot.room) }
          const span = tw(at.text)
          taken.push(at.anchor === 'start' ? [at.x, at.x + span] : [at.x - span, at.x])
          pl.mark(`t${s.i}`, 'text', `lbl${at.inside ? '' : ' out'}${state}`, { x: at.x, y: cy, 'text-anchor': at.anchor, 'dominant-baseline': 'central' }).textContent = at.text
        })
        // Hit areas outlast the marks: a 1 px span can still be reached.
        r.spans.forEach((s, si) => pl.mark(`h${s.i}`, 'rect', 'hit', { x: bars[si][0] - 3, y, width: Math.max(bars[si][1] - bars[si][0] + 6, 12), height: rowH, 'data-k': s.k }))
      })
      pl.sweep()
      readout()
    }

    const go = (k) => {
      if (k === hot) return
      hot = k
      draw()
    }
    svg.addEventListener('pointerover', (e) => go(e.target.classList.contains('hit') ? +e.target.dataset.k : -1))
    svg.addEventListener('pointerleave', () => go(-1))
    keys(plot, () => (m ? m.spans.length : 0), () => hot, go)

    const comp = {
      el: root,
      update(p) {
        cur = p
        m = model()
        if (hot >= m.spans.length) hot = -1
        plot.setAttribute('aria-label', `n ${m.spans.length}`)
        draw()
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Gallery samples ----------
  const rng = (seed) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  const wave = (n, base, amp, seed = 1, digits = 1) => {
    const r = rng(seed)
    return Array.from({ length: n }, (_, i) => +(base + Math.sin(i / 4 + seed) * amp + (r() - 0.5) * amp * 0.8).toFixed(digits))
  }
  const S = (props) => ({ group: 'charts', span: 1, ...props })

  samples.push(S({
    title: 'Sparkline · typical',
    tree: () => h('Stack', { gap: 0.5 },
      h('Sparkline', { label: '令牌速率', value: 1840, unit: 'tok/s', kind: 'area', data: wave(48, 1800, 400, 3, 0) }),
      h('Sparkline', { label: '工具延迟 p95', value: 482, unit: 'ms', tone: 'warn', data: wave(48, 420, 90, 5, 0) }),
      h('Sparkline', { label: '失败次数', tone: 'err', kind: 'bar', data: [0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 3, 0, 0, 1, 0, 0, 0, 0, 2, 4, 1, 0, 0, 0] }),
      h('Sparkline', { label: '上下文占用', value: '62', unit: '%', min: 0, max: 100, data: Array.from({ length: 30 }, (_, i) => 10 + i * 1.8 + (i % 3)) }),
      h('Sparkline', { data: wave(30, 50, 20, 9, 0) }))
  }))
  samples.push(S({
    title: 'Sparkline · edge',
    tree: () => h('Stack', { gap: 0.5 },
      h('Sparkline', { label: 'one point', data: [42] }),
      h('Sparkline', { label: 'empty', data: [] }),
      h('Sparkline', { label: 'NaN, null and text mixed in', data: [1, null, 'x', NaN, 4, 2, undefined, 8, '5'] }),
      h('Sparkline', { label: 'flat', value: 5, data: [5, 5, 5, 5, 5, 5] }),
      h('Sparkline', { label: '一个非常非常长的标签用来测试省略号是否正常工作 with English too', value: 1234567, kind: 'bar', data: wave(60, 1e6, 8e5, 4, 0) }),
      h('Sparkline', { label: 'negative', kind: 'area', unit: '°', data: wave(40, 0, 30, 2, 0) }),
      h('Sparkline', { label: '300 points', kind: 'line', data: wave(300, 100, 40, 7, 0) }),
      h('Sparkline', { label: 'status tone', value: 'degraded', tone: 'serious', data: wave(20, 5, 3, 8) }))
  }))
  samples.push(S({
    title: 'Sparkline · narrow',
    tree: () => h('Grid', { min: 9, gap: 0.8 },
      h('Sparkline', { label: 'tok/s', value: 1840, kind: 'area', data: wave(30, 1800, 400, 3, 0) }),
      h('Sparkline', { label: '延迟', value: 482, unit: 'ms', tone: 'warn', data: wave(30, 420, 90, 5, 0) }),
      h('Sparkline', { label: 'errors', tone: 'err', kind: 'bar', data: wave(20, 2, 2, 6, 0) }),
      h('Sparkline', { label: 'ctx', value: 62, unit: '%', data: wave(30, 50, 20, 9, 0) }))
  }))

  samples.push(S({
    title: 'StackedBar · typical',
    span: 2,
    tree: () => h('Stack', { gap: 1.4 },
      h('StackedBar', { label: '上下文窗口', unit: ' tok', total: 200000, rest: '空闲', segments: [{ label: '系统提示', value: 6200 }, { label: '工具定义', value: 14800 }, { label: '对话历史', value: 62400 }, { label: '文件内容', value: 38100 }, { label: '工具输出', value: 12500 }] }),
      h('StackedBar', { label: '耗时构成', unit: 's', segments: [{ label: '思考', value: 84 }, { label: '工具', value: 131 }, { label: '等待', value: 22, tone: 'warn' }, { label: '失败重试', value: 9, tone: 'err' }] }))
  }))
  samples.push(S({
    title: 'StackedBar · edge',
    tree: () => h('Stack', { gap: 1.4 },
      h('StackedBar', { label: 'over budget', unit: 'ms', total: 100, segments: [{ label: 'a', value: 70 }, { label: 'b', value: 55 }] }),
      h('StackedBar', { label: 'all zero', total: 50, segments: [{ label: 'a', value: 0 }, { label: 'b', value: 0 }] }),
      h('StackedBar', { label: 'no segments', segments: [] }),
      h('StackedBar', { label: 'tiny slice and a very long segment name that must not break the layout', segments: [{ label: 'dominant', value: 99999 }, { label: '一个非常长的分段名称一个非常长的分段名称', value: 3 }, { label: 'NaN', value: NaN }, { label: 'neg', value: -4 }] }),
      h('StackedBar', { label: '10 segments', segments: Array.from({ length: 10 }, (_, i) => ({ label: `part ${i + 1}`, value: 12 - i })) }))
  }))
  samples.push(S({
    title: 'StackedBar · narrow',
    tree: () => h('Grid', { min: 10, gap: 1 },
      h('StackedBar', { label: 'ctx', unit: 'K', total: 200, segments: [{ label: 'sys', value: 6 }, { label: 'hist', value: 62 }, { label: 'files', value: 38 }] }),
      h('StackedBar', { label: 'time', unit: 's', segments: [{ label: '思考', value: 84 }, { label: '工具', value: 131, tone: 'accent' }] }))
  }))

  samples.push(S({
    title: 'Funnel · typical',
    span: 2,
    tree: () => h('Funnel', { stages: [{ label: '检索到的文件', value: 1240 }, { label: '打开阅读', value: 412 }, { label: '产生编辑', value: 96 }, { label: '测试通过', value: 71 }, { label: '合并', value: 58 }] })
  }))
  samples.push(S({
    title: 'Funnel · edge',
    tree: () => h('Stack', { gap: 1.4 },
      h('Funnel', { stages: [{ label: 'zero start', value: 0 }, { label: 'then some', value: 10 }, { label: '一个非常长的阶段名称一个非常长的阶段名称', value: 5, tone: 'err' }] }),
      h('Funnel', { stages: [{ label: 'single', value: 80 }] }),
      h('Funnel', { stages: [] }),
      h('Funnel', { unit: 'ms', stages: [{ label: 'rising', value: 40 }, { label: 'bigger', value: 90, tone: 'warn' }, { label: 'NaN', value: NaN }, { label: 'last', value: 2 }] }))
  }))
  samples.push(S({
    title: 'Funnel · narrow',
    tree: () => h('Grid', { min: 10, gap: 1 },
      h('Funnel', { stages: [{ label: 'seen', value: 1240 }, { label: 'opened', value: 412 }, { label: 'edited', value: 96 }] }),
      h('Funnel', { stages: [{ label: 'ok', value: 90, tone: 'ok' }, { label: 'warn', value: 40, tone: 'warn' }, { label: 'fail', value: 4, tone: 'err' }] }))
  }))

  samples.push(S({
    title: 'Bullet · typical',
    span: 2,
    tree: () => h('Bullet', { items: [
      { label: '工具延迟 p95', value: 482, target: 400, unit: 'ms', ranges: [300, 500, 800] },
      { label: '缓存命中率', value: 78, target: 90, unit: '%', ranges: [50, 75, 100], tone: 'ok' },
      { label: '每小时成本', value: 3.4, target: 5, unit: '$', ranges: [2, 4, 6] },
      { label: '上下文占用', value: 160, target: 180, unit: 'K', ranges: [100, 150, 200], tone: 'warn' },
    ] })
  }))
  samples.push(S({
    title: 'Bullet · edge',
    tree: () => h('Bullet', { items: [
      { label: 'no target no ranges', value: 40 },
      { label: 'value beyond everything', value: 300, target: 100, ranges: [50, 80, 100] },
      { label: 'zeros', value: 0, target: 0, ranges: [0, 0, 0] },
      { label: '一个非常长的指标名称一个非常长的指标名称 with English', value: 12.5, target: 10, unit: 'GB', ranges: [5] },
      { label: 'unsorted ranges', value: 55, target: 70, ranges: [90, 30, 60] },
      { label: 'NaN', value: NaN, target: NaN },
      { label: 'negative', value: -5, target: 20, ranges: [10, 20, 30], tone: 'err' },
    ] })
  }))
  samples.push(S({
    title: 'Bullet · narrow',
    tree: () => h('Grid', { min: 10, gap: 1 },
      h('Bullet', { items: [{ label: 'p95', value: 482, target: 400, unit: 'ms', ranges: [300, 500, 800] }, { label: 'hit', value: 78, target: 90, unit: '%', ranges: [50, 75, 100] }] }),
      h('Bullet', { items: [{ label: '成本', value: 3.4, target: 5, unit: '$', ranges: [2, 4, 6] }] }))
  }))

  const tools = ['Read', 'Edit', 'Bash', 'Grep', 'Task', 'WebFetch']
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
  const matrix = (rows, cols, seed, peak = 40) => {
    const r = rng(seed)
    return Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => Math.round(Math.max(0, peak * (0.2 + 0.8 * Math.exp(-(((j - cols * 0.55) / (cols * 0.22)) ** 2))) * (0.3 + 0.7 * ((i * 7 + 3) % rows) / rows) * (0.5 + r())))))
  }

  samples.push(S({
    title: 'Heatmap · typical',
    span: 2,
    tree: () => h('Heatmap', { rows: tools, cols: hours, values: matrix(6, 24, 3), unit: ' 次' })
  }))
  samples.push(S({
    title: 'Heatmap · edge',
    span: 2,
    tree: () => h('Stack', { gap: 1.4 },
      h('Heatmap', { rows: ['unit', 'integration', 'e2e', 'lint'], cols: ['run 1', 'run 2', 'run 3', 'run 4', 'run 5', 'run 6'], values: [[0, 4, 2, 0, 0, 1], [12, 3, 0, 0, 8, 2], [30, 25, 41, 18, 22, 37], [0, 0, 0, 1, 0, 0]], unit: '%', tone: 'err' }),
      h('Heatmap', { rows: Array.from({ length: 24 }, (_, i) => `node-${String(i + 1).padStart(2, '0')}`), cols: Array.from({ length: 60 }, (_, i) => `${i}m`), values: matrix(24, 60, 11, 90), unit: '%', tone: 's2' }),
      h('Heatmap', { rows: ['a', 'b'], cols: ['x', 'y', 'z'], values: [[0, 0, 0], [0, 0, 0]] }),
      h('Heatmap', { rows: ['holes', '负数', 'ragged'], cols: ['1', '2', '3', '4'], values: [[1, null, NaN, 4], [-3, -1, 2, 5], [7]] }),
      h('Heatmap', { rows: [], cols: [], values: [] }))
  }))
  samples.push(S({
    title: 'Heatmap · narrow',
    tree: () => h('Grid', { min: 10, gap: 1 },
      h('Heatmap', { rows: tools, cols: hours, values: matrix(6, 24, 5) }),
      h('Heatmap', { rows: ['长长的行标签用来测试', 'b', 'c'], cols: ['mon', 'tue', 'wed', 'thu'], values: [[3, 9, 4, 1], [8, 2, 6, 7], [0, 5, 5, 9]], unit: 'h' }))
  }))

  const durations = (n, seed) => {
    const r = rng(seed)
    return Array.from({ length: n }, () => +(Math.exp(5.2 + 0.7 * (r() + r() + r() - 1.5) * 1.6)).toFixed(0))
  }
  const quantile = (vs, q) => [...vs].sort((a, b) => a - b)[Math.min(vs.length - 1, Math.floor(q * vs.length))]
  const latencies = durations(420, 4)

  samples.push(S({
    title: 'Histogram · typical',
    span: 2,
    tree: () => h('Histogram', { values: latencies, unit: 'ms', markers: [{ label: 'p50', value: quantile(latencies, 0.5) }, { label: 'p95', value: quantile(latencies, 0.95) }] })
  }))
  samples.push(S({
    title: 'Histogram · edge',
    tree: () => h('Stack', { gap: 1.4 },
      h('Histogram', { values: [42] }),
      h('Histogram', { values: [5, 5, 5, 5, 5], unit: 's' }),
      h('Histogram', { values: [-4, -2.5, -1, 0, 0.5, 3, 3.2, 8, NaN, null, 'x'], markers: [{ label: 'mean', value: 1 }] }),
      h('Histogram', { values: [] }),
      h('Histogram', { bins: [{ label: '0-100ms', count: 8 }, { label: '100-200ms', count: 31 }, { label: '200-500ms', count: 22 }, { label: '500-1000ms', count: 9 }, { label: '1000-5000ms', count: 3 }], markers: [{ label: 'SLA', value: 500 }] }),
      h('Histogram', { bins: [{ label: '周一', count: 4 }, { label: '周二', count: 9 }, { label: '周三', count: 7 }, { label: '周四', count: 12 }, { label: '周五', count: 3 }], markers: [{ label: '忽略', value: 3 }] }),
      h('Histogram', { values: durations(1500, 9), binCount: 40, unit: 'ms', markers: [{ label: 'p50', value: 190 }, { label: 'p90', value: 260 }, { label: 'p95', value: 290 }, { label: 'p99', value: 420 }, { label: 'max', value: 2000 }] }))
  }))
  samples.push(S({
    title: 'Histogram · narrow',
    tree: () => h('Grid', { min: 10, gap: 1 },
      h('Histogram', { values: latencies, unit: 'ms', markers: [{ label: 'p50', value: quantile(latencies, 0.5) }, { label: 'p95', value: quantile(latencies, 0.95) }] }),
      h('Histogram', { bins: [{ label: '0-1s', count: 8 }, { label: '1-2s', count: 21 }, { label: '2-5s', count: 12 }] }))
  }))

  const dots = (n, seed, tone) => {
    const r = rng(seed)
    return Array.from({ length: n }, (_, i) => {
      const x = Math.round(200 + r() * 5000), y = Math.round(x * 0.25 + r() * 900)
      return { x, y, label: `${['Read', 'Edit', 'Bash', 'Grep'][i % 4]} #${i + 1}`, size: tone ? Math.round(1 + r() * 20) : undefined, tone: tone && r() < 0.12 ? 'err' : undefined }
    })
  }

  samples.push(S({
    title: 'Scatter · typical',
    span: 2,
    tree: () => h('Scatter', { points: dots(90, 6, true), xLabel: '输入 token', xUnit: 'tok', yLabel: '耗时', yUnit: 'ms' })
  }))
  samples.push(S({
    title: 'Scatter · edge',
    tree: () => h('Stack', { gap: 1.4 },
      h('Scatter', { points: [{ x: 3, y: 4, label: 'only' }] }),
      h('Scatter', { points: [{ x: 1, y: 2 }, { x: 1, y: 5 }, { x: 1, y: 9 }] }),
      h('Scatter', { points: [{ x: 1, y: 2 }, { x: NaN, y: 3 }, { x: 'x', y: 1 }, { x: 4, y: null }, { x: '6', y: '8', label: 'strings' }, { x: -3, y: -7, tone: 'warn', label: 'negative' }] }),
      h('Scatter', { points: dots(500, 12) }),
      h('Scatter', { points: [], xLabel: 'x', yLabel: 'y' }),
      h('Scatter', { xLabel: '一个很长的横轴标题一个很长的横轴标题', yLabel: '一个很长的纵轴标题', points: [{ x: 1, y: 1, tone: 'ok', label: 'ok' }, { x: 2, y: 3, tone: 'warn', label: 'warn' }, { x: 3, y: 2, tone: 'serious', label: 'serious' }, { x: 4, y: 5, tone: 'err', label: 'err' }, { x: 5, y: 4, tone: 'muted', label: 'muted' }, { x: 6, y: 6, label: 'plain' }] }))
  }))
  samples.push(S({
    title: 'Scatter · narrow',
    tree: () => h('Grid', { min: 10, gap: 1 },
      h('Scatter', { points: dots(40, 7, true), xLabel: 'tok', yLabel: 'ms' }),
      h('Scatter', { points: dots(25, 8), xUnit: 'tok', yUnit: 'ms' }))
  }))

  const spend = [['Read', 482000], ['Edit', 211000], ['Bash', 176500], ['Grep', 98200], ['Task', 91000], ['WebFetch', 60300], ['Glob', 22100], ['TodoWrite', 14800], ['NotebookEdit', 6400], ['MultiEdit', 3100], ['LS', 1200], ['KillShell', 400]]
  samples.push(S({
    title: 'Treemap · typical',
    span: 2,
    tree: () => h('Treemap', { unit: ' tok', items: spend.map(([label, value]) => ({ label, value, sub: value > 90000 ? `${Math.round(value / 4800)} 次调用` : undefined })) })
  }))
  samples.push(S({
    title: 'Treemap · edge',
    tree: () => h('Stack', { gap: 1.4 },
      h('Treemap', { items: [{ label: 'only', value: 5 }] }),
      h('Treemap', { items: [] }),
      h('Treemap', { items: [{ label: 'zero', value: 0 }, { label: 'neg', value: -3 }, { label: 'NaN', value: NaN }, { label: '一个非常长的名称一个非常长的名称一个非常长的名称', value: 40, sub: 'with a long second line of detail' }, { label: 'same', value: 10, tone: 'warn' }, { label: 'same', value: 10, tone: 'err' }, { label: 'tiny', value: 0.01 }] }),
      h('Treemap', { unit: 'MB', items: Array.from({ length: 60 }, (_, i) => ({ label: `dir-${i + 1}`, value: Math.round(4000 / (i + 1) ** 1.1) + 1 })) }))
  }))
  samples.push(S({
    title: 'Treemap · narrow',
    tree: () => h('Grid', { min: 10, gap: 1 },
      h('Treemap', { items: spend.slice(0, 6).map(([label, value]) => ({ label, value })) }),
      h('Treemap', { items: [{ label: 'src', value: 62 }, { label: 'node_modules', value: 410, tone: 'muted' }, { label: 'dist', value: 24 }], unit: 'MB' }))
  }))

  const trace = () => {
    const r = rng(21), out = []
    let t = 0
    for (let i = 0; i < 9; i++) {
      const d = +(1 + r() * 5).toFixed(1)
      out.push({ label: ['Read src/daemon/spec.ts', 'Grep "fold"', 'Edit spec.ts', 'Bash yarn typecheck', 'Read ledger.ts', 'Edit fold.ts', 'Bash yarn build', 'Grep TODO', 'Read README.md'][i], start: +t.toFixed(1), duration: d, group: 'main', state: i === 3 ? 'failed' : 'done', meta: i === 3 ? 'exit 2' : undefined })
      t += d + r() * 2
    }
    out.push({ label: 'explore: 梳理 daemon', start: 4, duration: 21, group: '子代理 A' }, { label: 'review: 差异审阅', start: 12, duration: 31, group: '子代理 B', state: 'failed', meta: '超时' })
    out.push({ label: 'WebFetch docs', start: 18, duration: 6, group: '子代理 A' }, { label: 'Read', start: 26, duration: 9, group: '子代理 A' })
    out.push({ label: 'Bash yarn test', start: +t.toFixed(1), duration: 14, group: 'main', state: 'running' })
    return out
  }
  samples.push(S({
    title: 'Gantt · typical',
    span: 2,
    tree: () => h('Gantt', { unit: 's', spans: trace() })
  }))
  samples.push(S({
    title: 'Gantt · edge',
    span: 2,
    tree: () => h('Stack', { gap: 1.4 },
      h('Gantt', { spans: Array.from({ length: 120 }, (_, i) => ({ label: `call ${i + 1}`, start: i * 3, duration: 2 + (i % 5), group: `lane ${i % 4}` })) }),
      h('Gantt', { unit: 'ms', spans: [{ label: 'instant', start: 0, duration: 0 }, { label: 'tiny', start: 1, duration: 0.2 }, { label: 'a bit longer span name', start: 2, duration: 30 }, { label: '一个非常长的跨度名称用来测试标签放置', start: 40, duration: 12, state: 'failed' }, { label: 'bad', start: 'x', duration: 3 }, { label: 'nan', start: 3, duration: NaN }, { label: 'neg', start: 60, duration: -5 }, { label: 'running', start: 70, duration: 25, state: 'running' }] }),
      h('Gantt', { spans: [] }),
      h('Gantt', { unit: 'min', spans: [{ label: 'build', start: 0, duration: 42, group: 'ci' }, { label: 'test', start: 42, duration: 95, group: 'ci' }, { label: 'deploy', start: 140, duration: 12, group: 'ci', state: 'failed' }, { label: 'lint', start: 5, duration: 20, group: 'side' }] }))
  }))
  samples.push(S({
    title: 'Gantt · narrow',
    tree: () => h('Grid', { min: 10, gap: 1 },
      h('Gantt', { spans: trace().slice(0, 8) }),
      h('Gantt', { unit: 'ms', spans: [{ label: 'a', start: 0, duration: 40, group: 'x' }, { label: 'b', start: 20, duration: 50, group: 'y' }, { label: 'c', start: 60, duration: 10, group: 'x', state: 'failed' }] }))
  }))

})()
