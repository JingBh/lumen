// Renders Lumen.samples as panels on one page: gallery.html?group=code&only=Diff&theme=light&palette=ember&w=360
// ?stress=long appends a long unbroken run to every free-text prop; ?stress=wide sets every size-like number very large.
;(() => {
  const q = new URLSearchParams(location.search)
  const { h, samples } = Lumen
  Lumen.configure({ theme: q.get('theme') || 'dark', palette: q.get('palette') || 'cryo', chrome: 'drag' })
  if (q.get('w')) document.getElementById('app').style.width = `${q.get('w')}px`

  const flatten = (tree) => {
    const elements = {}
    let n = 0
    const walk = (node) => {
      const id = `${node.type.toLowerCase()}-${++n}`
      const { on, visible, repeat, ...rest } = node
      elements[id] = { type: node.type, props: node.props, children: [], ...(on && { on }), ...(visible !== undefined && { visible }), ...(repeat && { repeat }) }
      elements[id].children = node.children.map(walk)
      return id
    }
    return { root: walk(tree), elements }
  }

  const group = (q.get('group') ?? '').split(',').filter(Boolean), only = q.get('only')
  const list = samples.filter((s) => (!group.length || group.includes(s.group)) && (!only || s.title.includes(only)))
  const store = Lumen.createStore()
  const renderer = Lumen.createRenderer({ mount: document.getElementById('app'), store, onAction: (a) => console.log('action', JSON.stringify(a)) })
  for (const s of list) for (const [k, v] of Object.entries(s.state ?? {})) store.set(k, v)

  const ENUMS = new Set(['tone', 'kind', 'state', 'lang', 'level', 'direction', 'layout', 'fit', 'format', 'order', 'icon', 'status', 'size', 'align', 'deltaTone', 'action', 'src', 'url', 'unit', 'key', 'id', 'from', 'to', 'parent', 'group', 'active'])
  const SIZES = new Set(['min', 'gap', 'span', 'rows', 'maxHeight', 'binCount', 'expand', 'maxLines', 'maxRows', 'maxItems', 'limit', 'max'])
  const stress = q.get('stress')
  const twist = (v, k) => {
    if (Array.isArray(v)) return v.map((x) => twist(x, k))
    if (v && typeof v === 'object') return '$state' in v ? v : Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, twist(x, kk)]))
    if (stress === 'long' && typeof v === 'string' && !ENUMS.has(k) && v.length > 1) return `${v}${'超长不换行Ｗ'.repeat(3)}${'W'.repeat(90)}`
    if (stress === 'wide' && typeof v === 'number' && SIZES.has(k)) return 400
    return v
  }
  const tree = (node) => ({ ...node, props: stress ? twist(node.props) : node.props, children: node.children.map(tree) })
  // The gallery page grows with its content, so the shell cannot judge the window's shape: keep it vertical.
  const page = h('Shell', { flow: 'vertical' }, ...list.map((s) => h('Panel', { title: s.title, meta: s.group, span: s.span ?? 1, rows: s.rows ?? 1 }, tree(s.tree()))))
  const { root, elements } = flatten(page)
  renderer.patch({ op: 'add', path: '/root', value: root })
  for (const [id, value] of Object.entries(elements)) renderer.patch({ op: 'add', path: `/elements/${id}`, value })
  document.title = `Lumen gallery · ${list.length} samples`
})()
