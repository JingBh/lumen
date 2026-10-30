// Lumen kit · graph: Flow (pipeline), Tree (outline from flat nodes), Graph (auto-laid-out DAG).
;(() => {
  const { el, watch, clamp, setTone, glyph, rem } = Lumen.kit
  const { h, samples, registry } = Lumen

  const TONES = ['ok', 'warn', 'serious', 'err', 'accent', 'muted']
  const toneOf = (t) => (TONES.includes(t) ? t : null)
  const str = (v) => (v == null ? '' : String(v))
  const list = (v, max) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object').slice(0, max) : [])
  // Models spell states many ways; fold the common ones onto the vocabulary of the schema.
  const ALIAS = { completed: 'done', complete: 'done', success: 'done', ok: 'done', finished: 'done', running: 'active', in_progress: 'active', current: 'active', todo: 'pending', waiting: 'pending', queued: 'pending', error: 'failed', fail: 'failed', skip: 'skipped' }
  const stateOf = (s, ok) => (ok.includes(ALIAS[s] ?? s) ? ALIAS[s] ?? s : 'pending')
  const sync = (parent, els) => {
    const keep = new Set(els)
    for (const c of [...parent.children]) if (!keep.has(c)) c.remove()
    els.forEach((e, i) => { if (parent.children[i] !== e) parent.insertBefore(e, parent.children[i] ?? null) })
  }
  const svgOf = (cls, box, parts) => el('svg', { class: cls, viewBox: box, 'aria-hidden': true }, parts.map(([tag, attrs]) => el(tag, attrs)))

  // ---------- Flow: stages joined by connectors; a row when wide, a column when narrow ----------
  const FLOW_STATES = ['done', 'active', 'pending', 'failed', 'skipped']
  const FLOW_MARK = {
    done: [['circle', { cx: 8, cy: 8, r: 6.5 }], ['path', { d: 'M5 8.2 7.2 10.3 11 5.8' }]],
    active: [['circle', { cx: 8, cy: 8, r: 6.5 }], ['circle', { class: 'dot', cx: 8, cy: 8, r: 2.7 }]],
    pending: [['circle', { cx: 8, cy: 8, r: 6.5 }]],
    failed: [['rect', { x: 1.5, y: 1.5, width: 13, height: 13, rx: 2 }], ['path', { d: 'M5.4 5.4 10.6 10.6M10.6 5.4 5.4 10.6' }]],
    skipped: [['circle', { cx: 8, cy: 8, r: 6.5 }], ['path', { d: 'M5.4 8h5.2' }]],
  }

  registry.Flow = (p) => {
    const root = el('ol', { class: 'lm-flow', 'data-mode': 'row' })
    const rows = []
    let cur = p, count = 0

    // A stage needs about 8rem to read in a row (5.5rem when the model insists on a row); below that the chain turns vertical.
    const fit = () => {
      const w = root.clientWidth
      if (!w) return
      const need = (cur.direction === 'row' ? 5.5 : 8) * count + 1.7 * (count - 1)
      root.dataset.mode = cur.direction === 'column' || w < need * rem() ? 'col' : 'row'
    }
    watch(root, () => requestAnimationFrame(fit), 'x')

    const comp = {
      el: root,
      update(p) {
        cur = p ?? {}
        const stages = list(cur.stages, 24)
        count = stages.length
        stages.forEach((s, i) => {
          const r = rows[i] ??= (() => {
            const mk = el('svg', { class: 'mk', viewBox: '0 0 16 16', 'aria-hidden': true }), t = el('span', { class: 't' }), m = el('span', { class: 'm' }), d = el('span', { class: 'd' })
            return { li: el('li', { class: 'lm-fs' }, mk, t, m, d), mk, t, m, d }
          })()
          const state = stateOf(s.state, FLOW_STATES)
          if (r.li.dataset.s !== state) {
            r.li.dataset.s = state
            r.mk.replaceChildren(...FLOW_MARK[state].map(([tag, attrs]) => el(tag, attrs)))
          }
          if (state === 'active') r.li.setAttribute('aria-current', 'step'); else r.li.removeAttribute('aria-current')
          r.t.textContent = str(s.label)
          r.m.textContent = str(s.meta)
          r.m.hidden = !s.meta
          r.d.textContent = str(s.detail)
          r.d.hidden = !s.detail
        })
        rows.length = Math.min(rows.length, count)
        sync(root, rows.map((r) => r.li))
        fit()
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Tree: an outline built from flat nodes with parent references ----------
  const ICONS = {
    folder: ['M1 2.6h2.8l1.1 1.2H9v4.6H1Z'],
    file: ['M2.4 1h3.6l1.8 1.8V9H2.4Z', 'M6 1v2h1.8'],
    task: ['M1.6 1.6h6.8v6.8H1.6Z', 'M3.3 5l1.3 1.3 2.2-2.6'],
    agent: ['M5 .9 8.8 3v4L5 9.1 1.2 7V3Z', 'M5 4.2v1.6'],
  }
  const TREE_CAP = 300
  const WORST = { err: 3, serious: 2, warn: 1 }

  registry.Tree = (p, ctx) => {
    const root = el('div', { class: 'lm-tree', role: 'tree' })
    const open = new Map(), pool = new Map() // open: the user's own toggles by id, which outlive every update
    let cur = p, shown = [], byId = new Map(), cursor = null

    // Flat nodes → forest. A parent that is missing (yet) makes a root; a cycle is broken at the first node reached.
    const forest = () => {
      const nodes = []
      const index = new Map()
      list(cur.nodes, TREE_CAP).forEach((n, i) => {
        const id = str(n.id ?? `#${i}`)
        if (index.has(id)) return
        const parent = n.parent == null ? '' : str(n.parent)
        const node = { id, label: str(n.label ?? id), meta: str(n.meta), tone: toneOf(n.tone), icon: ICONS[n.icon] ? n.icon : null, parent: parent === id ? '' : parent, kids: [], total: 0, worst: null }
        index.set(id, node)
        nodes.push(node)
      })
      const roots = []
      for (const n of nodes) {
        const par = index.get(n.parent)
        if (par) par.kids.push(n); else roots.push(n)
      }
      const reached = new Set()
      const reach = (n) => { if (!reached.has(n)) { reached.add(n); n.kids.forEach(reach) } }
      roots.forEach(reach)
      for (const n of nodes) {
        if (reached.has(n)) continue
        let c = n
        const trail = new Set()
        while (!trail.has(c)) { trail.add(c); c = index.get(c.parent) } // every unreached node has a parent: walk up into the cycle
        const par = index.get(c.parent)
        par.kids = par.kids.filter((k) => k !== c)
        roots.push(c)
        reach(c)
      }
      const tally = (n) => {
        for (const c of n.kids) {
          tally(c)
          n.total += 1 + c.total
          for (const t of [c.tone, c.worst]) if ((WORST[t] ?? 0) > (WORST[n.worst] ?? 0)) n.worst = t
        }
      }
      roots.forEach(tally)
      return { roots, index }
    }

    // The visible rows in order, each with the guide cells that draw its connector lines.
    const rowsOf = (roots) => {
      const levels = Number.isFinite(cur.expand) ? cur.expand : 2
      const out = []
      const walk = (n, depth, trail, last, parent) => {
        const branch = n.kids.length > 0, isOpen = branch && (open.get(n.id) ?? depth < levels)
        out.push({ n, depth, branch, open: isOpen, parent, guides: depth ? [...trail.map((t) => (t ? 'line' : 'none')), last ? 'elbow' : 'tee'] : [] })
        if (isOpen) n.kids.forEach((c, i) => walk(c, depth + 1, depth ? [...trail, !last] : [], i === n.kids.length - 1, n))
      }
      roots.forEach((r, i) => walk(r, 0, [], i === roots.length - 1, null))
      return out
    }

    const toggle = (x) => { open.set(x.n.id, !x.open); render() }
    const make = (id) => {
      const gds = el('span', { class: 'gds' }), tg = el('span', { class: 'tg' }), t = el('span', { class: 't' }), n = el('span', { class: 'n' }), m = el('span', { class: 'm' }), b = el('span', { class: 'b' })
      const row = el('div', { class: 'lm-tr', role: 'treeitem', tabindex: -1 }, gds, tg, el('span', { class: 'bd' }, t, n, m, b))
      row.addEventListener('click', () => {
        const x = byId.get(id)
        if (!x) return
        if (x.branch) toggle(x)
        ctx.fire('select', { id })
      })
      const r = { row, gds, tg, t, n, m, b }
      pool.set(id, r)
      return r
    }

    const render = () => {
      const { roots, index } = forest()
      shown = rowsOf(roots)
      byId = new Map(shown.map((x) => [x.n.id, x]))
      for (const id of pool.keys()) if (!index.has(id)) pool.delete(id)
      if (!byId.has(cursor)) cursor = shown[0]?.n.id
      sync(root, shown.map((x) => {
        const { n } = x, r = pool.get(n.id) ?? make(n.id)
        setTone(r.row, n.tone)
        r.row.toggleAttribute('data-leaf', !x.branch)
        r.row.tabIndex = n.id === cursor ? 0 : -1
        r.row.setAttribute('aria-level', x.depth + 1)
        if (x.branch) r.row.setAttribute('aria-expanded', x.open); else r.row.removeAttribute('aria-expanded')
        r.gds.replaceChildren(...x.guides.map((g) => el('i', { class: 'gd', 'data-g': g })))
        r.tg.replaceChildren(x.branch ? svgOf('chev', '0 0 10 10', [['path', { d: 'M3.4 2.2 6.8 5 3.4 7.8' }]]) : '')
        r.t.replaceChildren(n.icon ? svgOf('ic', '0 0 10 10', ICONS[n.icon].map((d) => ['path', { d }])) : '', el('span', { class: 'l' }, n.label))
        r.n.textContent = x.branch && !x.open ? `+${n.total}` : ''
        r.m.textContent = n.meta
        const mark = n.tone ?? (x.branch && !x.open ? n.worst : null) // a closed branch still shows the worst thing inside it
        r.b.replaceChildren(mark ? glyph(mark) : '')
        setTone(r.b, mark)
        r.b.toggleAttribute('data-inner', !n.tone && !!mark)
        r.row.title = n.label
        return r.row
      }))
    }

    const go = (j) => {
      const x = shown[clamp(j, 0, shown.length - 1)]
      if (x) pool.get(x.n.id).row.focus()
    }
    root.addEventListener('focusin', (e) => {
      const x = shown.find((s) => pool.get(s.n.id).row === e.target)
      if (!x || x.n.id === cursor) return
      pool.get(cursor)?.row.setAttribute('tabindex', -1)
      cursor = x.n.id
      e.target.tabIndex = 0
    })
    root.addEventListener('keydown', (e) => {
      const i = shown.findIndex((s) => pool.get(s.n.id).row === e.target)
      if (i < 0) return
      const x = shown[i]
      if (e.key === 'ArrowDown') go(i + 1)
      else if (e.key === 'ArrowUp') go(i - 1)
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(shown.length - 1)
      else if (e.key === 'ArrowRight') { if (x.branch && !x.open) toggle(x); else go(i + 1) }
      else if (e.key === 'ArrowLeft') { if (x.branch && x.open) toggle(x); else if (x.parent) go(shown.indexOf(byId.get(x.parent.id))) }
      else if (e.key === 'Enter' || e.key === ' ') e.target.click()
      else return
      e.preventDefault()
    })

    const comp = { el: root, update(p) { cur = p ?? {}; render() } }
    comp.update(p)
    return comp
  }

  // ---------- Graph: layered DAG layout, drawn as nodes + SVG edges, scaled to fit ----------
  // Sugiyama in miniature: reverse back edges, longest-path layering, virtual vertices on long edges, barycenter sweeps to cut
  // crossings, then coordinates by isotonic regression (each layer sits as close to its neighbours as the order and spacing allow).
  // All lengths are rem. The flow axis is `m` (main) and the other `c` (cross); LR maps m→x, TB maps m→y.
  const NODE_GAP = 0.9, PAD = 0.7, ARROW = 0.5, MAX_NODES = 120, MIN_SCALE = 0.55

  // Measured with the real fonts, so a node is exactly as wide as its label needs (up to a cap).
  const canvas = document.createElement('canvas').getContext('2d')
  const textW = (s, weight, em, mono) => {
    const css = getComputedStyle(document.documentElement), px = rem() * em
    canvas.font = `${weight} ${px}px ${css.getPropertyValue(mono ? '--num' : '--font')}`
    return canvas.measureText(s).width / rem()
  }

  const isotone = (t, w) => {
    const blocks = []
    t.forEach((x, i) => {
      blocks.push({ s: x * w[i], w: w[i], n: 1 })
      while (blocks.length > 1) {
        const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2]
        if (a.s / a.w <= b.s / b.w) break
        a.s += b.s; a.w += b.w; a.n += b.n
        blocks.pop()
      }
    })
    return blocks.flatMap((b) => Array(b.n).fill(b.s / b.w))
  }

  const components = (nodes, links) => {
    const parent = new Map(nodes.map((n) => [n.id, n.id]))
    const find = (id) => { while (parent.get(id) !== id) id = parent.get(id); return id }
    for (const l of links) parent.set(find(l.from), find(l.to))
    const groups = new Map()
    for (const n of nodes) { const k = find(n.id); groups.set(k, [...(groups.get(k) ?? []), n.id]) }
    return [...groups.values()]
  }

  // One connected component → layers of vertices with a cross-axis centre `c` each, plus the routes of its edges.
  const layered = (ids, links, crossOf) => {
    const out = new Map(ids.map((id) => [id, []])), indeg = new Map(ids.map((id) => [id, 0]))
    for (const l of links) { out.get(l.from).push(l); indeg.set(l.to, indeg.get(l.to) + 1) }
    const stack = new Set(), done = new Set(), back = new Set()
    const visit = (id) => {
      stack.add(id)
      done.add(id)
      for (const l of out.get(id)) {
        if (stack.has(l.to)) back.add(l)
        else if (!done.has(l.to)) visit(l.to)
      }
      stack.delete(id)
    }
    for (const id of [...ids.filter((id) => !indeg.get(id)), ...ids]) if (!done.has(id)) visit(id)
    const arcs = links.map((l) => (back.has(l) ? { a: l.to, b: l.from, rev: true, l } : { a: l.from, b: l.to, rev: false, l }))

    const rank = new Map(ids.map((id) => [id, 0])), waiting = new Map(ids.map((id) => [id, 0])), succ = new Map(ids.map((id) => [id, []]))
    for (const e of arcs) { waiting.set(e.b, waiting.get(e.b) + 1); succ.get(e.a).push(e.b) }
    const queue = ids.filter((id) => !waiting.get(id))
    for (let i = 0; i < queue.length; i++) {
      for (const b of succ.get(queue[i])) {
        rank.set(b, Math.max(rank.get(b), rank.get(queue[i]) + 1))
        waiting.set(b, waiting.get(b) - 1)
        if (!waiting.get(b)) queue.push(b)
      }
    }

    // Edges that skip layers get a thin virtual vertex in each layer they cross, so they take part in ordering and keep clear of nodes.
    const vs = new Map(ids.map((id) => [id, { id, r: rank.get(id), s: crossOf(id), up: [], down: [] }]))
    let virtual = 0
    const routes = arcs.map((e) => {
      const chain = [e.a]
      for (let r = rank.get(e.a) + 1; r < rank.get(e.b); r++) {
        const id = `\0${virtual++}`
        vs.set(id, { id, r, s: 0.3, dummy: true, up: [], down: [] })
        chain.push(id)
      }
      chain.push(e.b)
      chain.slice(1).forEach((id, i) => { vs.get(chain[i]).down.push(id); vs.get(id).up.push(chain[i]) })
      return { ...e, chain }
    })
    const layers = []
    for (const v of vs.values()) (layers[v.r] ??= []).push(v)

    const reindex = () => layers.forEach((L) => L.forEach((v, i) => (v.i = i)))
    const crossings = () => {
      let n = 0
      for (let r = 0; r + 1 < layers.length; r++) {
        const es = layers[r].flatMap((v) => v.down.map((id) => [v.i, vs.get(id).i]))
        for (let x = 0; x < es.length; x++) for (let y = x + 1; y < es.length; y++) if ((es[x][0] - es[y][0]) * (es[x][1] - es[y][1]) < 0) n++
      }
      return n
    }
    const sweep = (down) => {
      for (let k = 1; k < layers.length; k++) {
        const L = layers[down ? k : layers.length - 1 - k], nb = down ? 'up' : 'down'
        const key = new Map(L.map((v) => [v, v[nb].length ? v[nb].reduce((s, id) => s + vs.get(id).i, 0) / v[nb].length : v.i]))
        L.sort((a, b) => key.get(a) - key.get(b) || a.i - b.i)
        L.forEach((v, i) => (v.i = i))
      }
    }
    reindex()
    let best = layers.map((L) => L.slice()), bestN = crossings()
    for (let it = 0; it < 14 && bestN > 0; it++) {
      sweep(it % 2 === 0)
      const n = crossings()
      if (n < bestN) { bestN = n; best = layers.map((L) => L.slice()) }
    }
    best.forEach((L, r) => (layers[r] = L))
    reindex()

    const sep = (a, b) => (a.s + b.s) / 2 + (a.dummy || b.dummy ? NODE_GAP * 0.35 : NODE_GAP)
    layers.forEach((L) => L.forEach((v, i) => (v.c = i ? L[i - 1].c + sep(L[i - 1], v) : 0)))
    const relax = (L, around) => {
      const want = L.map((v) => { const nb = around(v); return nb.length ? nb.reduce((s, id) => s + vs.get(id).c, 0) / nb.length : v.c })
      const off = L.map(() => 0)
      for (let i = 1; i < L.length; i++) off[i] = off[i - 1] + sep(L[i - 1], L[i])
      const q = isotone(want.map((x, i) => x - off[i]), L.map((v) => (v.dummy ? 4 : 1)))
      L.forEach((v, i) => (v.c = q[i] + off[i]))
    }
    for (let it = 0; it < 8; it++) {
      for (let r = 1; r < layers.length; r++) relax(layers[r], (v) => v.up)
      for (let r = layers.length - 2; r >= 0; r--) relax(layers[r], (v) => v.down)
    }
    for (let r = 0; r < layers.length; r++) relax(layers[r], (v) => [...v.up, ...v.down])
    const lo = Math.min(...[...vs.values()].map((v) => v.c - v.s / 2)), hi = Math.max(...[...vs.values()].map((v) => v.c + v.s / 2))
    for (const v of vs.values()) v.c -= lo
    return { vs, layers, routes, span: hi - lo }
  }

  // The whole graph for one direction → boxes, routed edges and total size, all in rem.
  const arrange = (nodes, links, tb) => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const NH = nodes.some((n) => n.sub) ? 2.7 : 2
    const GL = (tb ? 2.6 : 3.4) + (links.some((l) => l.label) ? (tb ? 0.9 : 2.2) : 0) // room between layers; edge labels need more
    const xy = (m, c) => (tb ? [c + PAD, m + PAD] : [m + PAD, c + PAD])
    const n2 = (v) => +v.toFixed(2)
    const boxes = new Map(), routes = []
    let cross = 0, W = 0, H = 0

    const groups = components(nodes, links)
    const where = new Map(groups.flatMap((g, i) => g.map((id) => [id, i])))
    groups.forEach((ids, gi) => {
      if (ids.length < 2) return
      const part = layered(ids, links.filter((l) => where.get(l.from) === gi), (id) => (tb ? byId.get(id).w : NH))
      const T = part.layers.map((L) => (tb ? NH : Math.max(...L.filter((v) => !v.dummy).map((v) => byId.get(v.id).w))))
      const M = T.map((_, r) => T.slice(0, r).reduce((s, t) => s + t + GL, 0))
      for (const v of part.vs.values()) {
        if (v.dummy) continue
        const w = tb ? byId.get(v.id).w : T[v.r]
        const [x, y] = xy(M[v.r], cross + v.c - (tb ? w : NH) / 2)
        boxes.set(v.id, { x, y, w, h: NH })
      }
      for (const r of part.routes) {
        const pts = r.chain.map((id, i) => {
          const v = part.vs.get(id)
          return [v.dummy ? M[v.r] + T[v.r] / 2 : i ? M[v.r] : M[v.r] + T[v.r], cross + v.c]
        })
        const tip = r.rev ? 0 : pts.length - 1, dir = r.rev ? -1 : 1
        const P = pts.map(([m, c]) => [m, c])
        P[tip][0] -= dir * ARROW * 0.8
        const d = P.map(([m, c], i) => {
          const [x, y] = xy(m, c)
          if (!i) return `M${n2(x)},${n2(y)}`
          const mid = (P[i - 1][0] + m) / 2, [ax, ay] = xy(mid, P[i - 1][1]), [bx, by] = xy(mid, c)
          return `C${n2(ax)},${n2(ay)} ${n2(bx)},${n2(by)} ${n2(x)},${n2(y)}`
        }).join('')
        const [tm, tc] = pts[tip]
        const head = [[tm, tc], [tm - dir * ARROW, tc - ARROW * 0.5], [tm - dir * ARROW, tc + ARROW * 0.5]].map(([m, c]) => xy(m, c).map(n2).join(',')).join(' ')
        const at = pts.length > 2 ? pts[pts.length >> 1] : [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]
        routes.push({ from: r.l.from, to: r.l.to, d, head, rev: r.rev, label: r.l.label, at: xy(at[0], at[1]) })
      }
      cross += part.span + NODE_GAP * 2
    })

    // Nodes with no edge at all (typical while a model is still streaming) wrap into a compact grid instead of one long line.
    const lone = groups.filter((g) => g.length === 1).map((g) => g[0])
    if (lone.length) {
      const cw = Math.max(...lone.map((id) => byId.get(id).w)), cols = clamp(Math.ceil(Math.sqrt(lone.length)), 1, 6)
      lone.forEach((id, i) => {
        const gx = (i % cols) * (cw + NODE_GAP), gy = Math.floor(i / cols) * (NH + NODE_GAP)
        const [x, y] = tb ? xy(gy, cross + gx) : xy(gx, cross + gy)
        boxes.set(id, { x, y, w: cw, h: NH })
      })
    }
    for (const b of boxes.values()) { W = Math.max(W, b.x + b.w + PAD); H = Math.max(H, b.y + b.h + PAD) }
    return { boxes, routes, W, H }
  }

  registry.Graph = (p, ctx) => {
    const svg = el('svg', { 'aria-hidden': true }), inner = el('div', { class: 'lm-graph-in' }, svg)
    const box = el('div', { class: 'lm-graph-box' }, inner)
    const empty = el('div', { class: 'lm-graph-empty' }, '—')
    const root = el('div', { class: 'lm-graph' }, box, empty)
    const nodeEls = new Map()
    let cur = p, model = null, lay = {}, dir = null, hover = null, focus = null, edgeEls = [], labelEls = []

    const parse = () => {
      const nodes = [], seen = new Set()
      for (const n of list(cur.nodes, MAX_NODES)) {
        const id = str(n.id)
        if (!id || seen.has(id)) continue
        seen.add(id)
        const label = str(n.label ?? id), sub = str(n.sub)
        nodes.push({ id, label, sub, tone: toneOf(n.tone), w: clamp(Math.max(textW(label, 500, 0.875), sub ? textW(sub, 300, 0.72, true) : 0) + 3, 6, 13) })
      }
      const links = [], keyed = new Set()
      for (const e of list(cur.edges, 400)) {
        const from = str(e.from), to = str(e.to), key = `${from}\0${to}`
        if (from === to || !seen.has(from) || !seen.has(to) || keyed.has(key)) continue
        keyed.add(key)
        links.push({ from, to, label: str(e.label) })
      }
      const near = new Map(nodes.map((n) => [n.id, new Set()]))
      for (const l of links) { near.get(l.from).add(l.to); near.get(l.to).add(l.from) }
      return { nodes, links, near }
    }

    const nodeEl = (id) => {
      const e = el('div', { class: 'lm-gn', role: 'button', tabindex: 0 })
      e.addEventListener('mouseenter', () => { hover = id; paint() })
      e.addEventListener('mouseleave', () => { hover = null; paint() })
      e.addEventListener('focus', () => { focus = id; paint() })
      e.addEventListener('blur', () => { focus = null; paint() })
      e.addEventListener('click', () => ctx.fire('select', { id }))
      e.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); e.click() } })
      return e
    }

    // Hover or focus lights a node, its neighbours and the edges between them; everything else steps back.
    const paint = () => {
      const id = hover ?? focus, near = model?.near.get(id)
      root.toggleAttribute('data-focus', !!near)
      for (const [k, e] of nodeEls) {
        e.toggleAttribute('data-on', k === id)
        e.toggleAttribute('data-near', !!near?.has(k))
      }
      for (const r of edgeEls) r.g.classList.toggle('hl', !!near && (r.from === id || r.to === id))
    }

    const place = (d) => {
      dir = d
      const L = lay[d]
      inner.style.width = `${L.W}rem`
      inner.style.height = `${L.H}rem`
      svg.setAttribute('viewBox', `0 0 ${L.W} ${L.H}`)
      for (const [id, b] of L.boxes) {
        const s = nodeEls.get(id).style
        s.left = `${b.x}rem`; s.top = `${b.y}rem`; s.width = `${b.w}rem`; s.height = `${b.h}rem`
      }
      edgeEls = L.routes.map((r) => ({ ...r, g: el('g', { class: `ge${r.rev ? ' back' : ''}${cur.active === r.from || cur.active === r.to ? ' live' : ''}` }, el('path', { class: 'e', d: r.d }), el('polygon', { class: 'ah', points: r.head })) }))
      svg.replaceChildren(...edgeEls.map((r) => r.g))
      for (const e of labelEls) e.remove()
      labelEls = L.routes.filter((r) => r.label).map((r) => el('span', { class: 'lm-ge-l', style: `left: ${r.at[0]}rem; top: ${r.at[1]}rem`, title: r.label }, r.label))
      inner.append(...labelEls)
      paint()
    }

    // Scale the fixed layout to the container (never reflow it); `auto` takes whichever direction would be drawn larger.
    const fit = () => {
      const aw = root.clientWidth, u = rem()
      if (!aw || !model?.nodes.length) return
      const score = (L) => Math.min(1, aw / (L.W * u), 30 / L.H)
      const want = cur.direction === 'LR' || cur.direction === 'TB' ? cur.direction : score(lay.TB) > score(lay.LR) + 0.02 ? 'TB' : 'LR'
      if (want !== dir || dirty) place(want)
      dirty = false
      const L = lay[dir], k = clamp(aw / (L.W * u), MIN_SCALE, 1)
      box.style.width = `${L.W * u * k}px`
      box.style.height = `${L.H * u * k}px`
      inner.style.transform = `scale(${k})`
      root.toggleAttribute('data-scroll', L.W * u * k > aw + 1)
    }
    let dirty = false
    watch(root, () => requestAnimationFrame(fit), 'x') // deferred: fit resizes root, which must not loop back into the observer
    document.fonts?.ready.then(() => comp.update(cur))

    const comp = {
      el: root,
      update(p) {
        cur = p ?? {}
        model = parse()
        const d = cur.direction
        lay = { LR: d === 'TB' ? null : arrange(model.nodes, model.links, false), TB: d === 'LR' ? null : arrange(model.nodes, model.links, true) }
        for (const [id, e] of nodeEls) if (!model.near.has(id)) { e.remove(); nodeEls.delete(id) }
        for (const n of model.nodes) {
          const e = nodeEls.get(n.id) ?? nodeEls.set(n.id, nodeEl(n.id)).get(n.id)
          setTone(e, n.tone)
          e.toggleAttribute('data-active', cur.active === n.id)
          e.title = n.sub ? `${n.label} · ${n.sub}` : n.label
          e.replaceChildren(glyph(n.tone ?? 'muted'), el('b', {}, n.label), n.sub ? el('small', {}, n.sub) : '')
          if (!e.isConnected) inner.append(e)
        }
        empty.hidden = model.nodes.length > 0
        box.hidden = !model.nodes.length
        dirty = true
        fit()
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Gallery samples ----------
  const N = (id, label, extra) => ({ id, label, ...extra })

  samples.push(
    { group: 'graph', title: 'Flow · typical', span: 2, tree: () => h('Flow', { stages: [
      { label: '检出代码', state: 'done', meta: '0.8s' },
      { label: '安装依赖', state: 'done', meta: '14s', detail: '命中缓存 212 / 230' },
      { label: '构建镜像', state: 'done', meta: '42s' },
      { label: '单元测试', state: 'active', meta: '3 / 8 组', detail: 'pytest -n 8' },
      { label: '部署到预发', state: 'pending' },
      { label: '冒烟测试', state: 'pending' },
    ] }) },
    { group: 'graph', title: 'Flow · failed, skipped, long', span: 2, tree: () => h('Flow', { stages: [
      { label: 'lint', state: 'done', meta: '3s' },
      { label: 'type-check-the-entire-monorepo-including-generated-clients', state: 'done', meta: '1m 12s' },
      { label: '集成测试', state: 'failed', meta: '2m 03s', detail: 'test_gre_tunnel_flap: expected 0 restarts, got 38' },
      { label: '构建镜像', state: 'skipped', meta: '跳过' },
      { label: '部署', state: 'skipped' },
      { label: 'notify', state: 'pending' },
    ] }) },
    { group: 'graph', title: 'Flow · narrow', span: 1, tree: () => h('Flow', { stages: [
      { label: '拉取指标', state: 'done', meta: '1.2s' },
      { label: '关联重启事件', state: 'done', meta: '2.1s', detail: '38 次重启集中在 edge-node-3' },
      { label: '检查 GRE 隧道', state: 'active', detail: '对比丢包与探针超时' },
      { label: '生成修复方案', state: 'pending' },
    ] }) },
    { group: 'graph', title: 'Flow · edge (12 stages, empty)', span: 2, tree: () => h('Stack', {},
      h('Flow', { direction: 'row', stages: Array.from({ length: 12 }, (_, i) => ({ label: `阶段 ${i + 1}`, state: i < 5 ? 'done' : i === 5 ? 'active' : 'pending', meta: i < 5 ? `${i + 2}s` : undefined })) }),
      h('Flow', { stages: [] })) },

    { group: 'graph', title: 'Tree · typical', span: 1, rows: 2, tree: () => ({ ...h('Tree', { expand: 2, nodes: [
      N('src', 'src', { icon: 'folder' }),
      N('agent', 'agent', { parent: 'src', icon: 'folder', meta: '4 files' }),
      N('loop', 'loop.ts', { parent: 'agent', icon: 'file', meta: '218', tone: 'warn' }),
      N('tools', 'tools.ts', { parent: 'agent', icon: 'file', meta: '96' }),
      N('mem', 'memory.ts', { parent: 'agent', icon: 'file', meta: '140', tone: 'err' }),
      N('ui', 'ui', { parent: 'src', icon: 'folder' }),
      N('panel', 'Panel.tsx', { parent: 'ui', icon: 'file', meta: '88' }),
      N('chart', 'Chart.tsx', { parent: 'ui', icon: 'file', meta: '312' }),
      N('tests', 'tests', { icon: 'folder' }),
      N('t1', 'loop.test.ts', { parent: 'tests', icon: 'task', tone: 'ok' }),
      N('t2', 'memory.test.ts', { parent: 'tests', icon: 'task', tone: 'err', meta: '2 failed' }),
      N('pkg', 'package.json', { icon: 'file' }),
    ] }), on: { select: { action: 'select' } } }) },
    { group: 'graph', title: 'Tree · agents and tasks', span: 1, rows: 2, tree: () => h('Tree', { expand: 3, nodes: [
      N('main', '主智能体', { icon: 'agent', tone: 'accent', meta: '规划中' }),
      N('a1', '探索代码库', { parent: 'main', icon: 'agent', tone: 'ok', meta: '完成' }),
      N('a1a', '读取 web/ui.js', { parent: 'a1', icon: 'task', tone: 'ok' }),
      N('a1b', '读取 web/ui.css', { parent: 'a1', icon: 'task', tone: 'ok' }),
      N('a2', '实现组件', { parent: 'main', icon: 'agent', tone: 'accent', meta: '进行中' }),
      N('a2a', 'Flow', { parent: 'a2', icon: 'task', tone: 'ok' }),
      N('a2b', 'Tree', { parent: 'a2', icon: 'task', tone: 'accent' }),
      N('a2c', 'Graph', { parent: 'a2', icon: 'task', tone: 'muted' }),
      N('a3', '验证截图', { parent: 'main', icon: 'agent', tone: 'muted', meta: '等待' }),
    ] }) },
    { group: 'graph', title: 'Tree · edge (300 nodes, cycles, orphans, collapsed)', span: 2, rows: 2, tree: () => {
      const nodes = []
      for (let d = 0; d < 12; d++) {
        nodes.push(N(`d${d}`, `module-${d}`, { icon: 'folder', parent: d % 4 === 3 ? `d${d - 1}` : null }))
        for (let f = 0; f < 22; f++) nodes.push(N(`d${d}f${f}`, f === 3 ? 'an-extremely-long-file-name-that-never-wraps-nicely-and-keeps-going-until-the-end.generated.ts' : `file-${f}.ts`, { parent: `d${d}`, icon: 'file', meta: `${(f * 37 + d * 11) % 900}`, tone: d === 6 && f === 5 ? 'err' : d === 6 && f === 9 ? 'warn' : undefined }))
      }
      nodes.unshift(N('late', '先于父节点出现的子节点', { parent: 'later-parent' }), N('x', 'cycle-x', { parent: 'y' }), N('y', 'cycle-y', { parent: 'x' }), N('self', 'points-at-itself', { parent: 'self' }), N('orphan', '孤儿节点（父节点不存在）', { parent: 'ghost' }))
      nodes.push(N('later-parent', '后到的父节点', { icon: 'folder' }))
      return h('Tree', { expand: 1, nodes })
    } },
    { group: 'graph', title: 'Tree · empty', span: 1, tree: () => h('Tree', { nodes: [] }) },

    { group: 'graph', title: 'Graph · task plan', span: 2, tree: () => ({ ...h('Graph', { active: 'impl', nodes: [
      N('read', '阅读设计文档', { sub: 'done', tone: 'ok' }),
      N('api', '定义接口', { sub: 'done', tone: 'ok' }),
      N('impl', '实现后端', { sub: 'running', tone: 'accent' }),
      N('ui', '实现界面', { sub: 'waiting' }),
      N('test', '编写测试', { sub: 'waiting' }),
      N('ship', '联调发布', { sub: 'blocked', tone: 'warn' }),
    ], edges: [
      { from: 'read', to: 'api' }, { from: 'api', to: 'impl', label: '契约' }, { from: 'api', to: 'ui', label: '契约' },
      { from: 'impl', to: 'test' }, { from: 'ui', to: 'test' }, { from: 'test', to: 'ship' }, { from: 'read', to: 'ship' },
    ] }), on: { select: { action: 'select' } } }) },
    { group: 'graph', title: 'Graph · call graph with a cycle', span: 1, tree: () => h('Graph', { nodes: [
      N('main', 'main'), N('parse', 'parse'), N('eval', 'eval'), N('apply', 'apply'), N('lookup', 'lookup', { tone: 'warn' }), N('print', 'print'),
    ], edges: [
      { from: 'main', to: 'parse' }, { from: 'parse', to: 'eval' }, { from: 'eval', to: 'apply' }, { from: 'apply', to: 'eval', label: 'recurse' },
      { from: 'eval', to: 'lookup' }, { from: 'apply', to: 'lookup' }, { from: 'main', to: 'print' }, { from: 'eval', to: 'print' },
    ] }) },
    { group: 'graph', title: 'Graph · data flow, top-down', span: 1, tree: () => h('Graph', { direction: 'TB', nodes: [
      N('src', 'Kafka', { sub: 'orders' }), N('ing', 'Ingest', { sub: '12 pods', tone: 'ok' }), N('val', 'Validate', { tone: 'ok' }), N('dlq', 'Dead letter', { sub: '38 msgs', tone: 'err' }), N('ws', 'Warehouse'),
    ], edges: [
      { from: 'src', to: 'ing' }, { from: 'ing', to: 'val' }, { from: 'val', to: 'ws' }, { from: 'val', to: 'dlq', label: 'bad' }, { from: 'ing', to: 'dlq' },
    ] }) },
    { group: 'graph', title: 'Graph · edge (48 nodes, long labels)', span: 2, tree: () => {
      const nodes = Array.from({ length: 48 }, (_, i) => N(`n${i}`, i % 9 === 4 ? `pkg/very/long/module/path/number-${i}` : `mod-${i}`, { sub: i % 5 === 0 ? 'core' : undefined, tone: i % 13 === 7 ? 'err' : i % 11 === 3 ? 'warn' : undefined }))
      const edges = []
      for (let i = 1; i < 48; i++) {
        edges.push({ from: `n${Math.floor((i - 1) / 3)}`, to: `n${i}` })
        if (i % 4 === 0 && i > 8) edges.push({ from: `n${i - 8}`, to: `n${i}` })
      }
      return h('Graph', { nodes, edges })
    } },
    { group: 'graph', title: 'Graph · edge (disconnected, unknown ids)', span: 2, tree: () => h('Graph', { nodes: [
      N('a', 'alpha'), N('b', 'beta'), N('c', 'gamma'), N('d', 'delta'), N('e', 'epsilon'), N('f', 'zeta'), N('g', 'eta'), N('h', 'theta'),
    ], edges: [
      { from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'd', to: 'e' }, { from: 'e', to: 'd' }, { from: 'a', to: 'nope' }, { from: 'c', to: 'c' }, { from: 'a', to: 'b' },
    ] }) },
    { group: 'graph', title: 'Graph · narrow', span: 1, tree: () => h('Graph', { nodes: [
      N('a', '拉取指标'), N('b', '关联事件', { tone: 'ok' }), N('c', '检查隧道', { tone: 'accent' }), N('d', '验证根因'),
    ], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }, { from: 'a', to: 'd' }], active: 'c' }) },
    { group: 'graph', title: 'Graph · empty', span: 1, tree: () => h('Graph', { nodes: [], edges: [] }) },
  )
})()
