/* layout — Tabs, Accordion */
;(() => {
  const { el, watch, clamp, setTone, glyph } = Lumen.kit
  const { h, samples, registry } = Lumen

  let seq = 0
  const NONE = Symbol('none')
  const MAX_TABS = 12
  const text = (v) => (v == null ? '' : String(v))
  const TONES = ['ok', 'warn', 'serious', 'err', 'accent', 'muted']
  const toneOf = (v) => (TONES.includes(v) ? v : undefined)
  const finite = (v, fallback) => {
    const n = typeof v === 'string' && v.trim() ? Number(v) : v
    return typeof n === 'number' && Number.isFinite(n) ? n : fallback
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

  // The user's choice lives in the component so it works unbound; the prop only wins when it changes.
  const follow = (apply) => {
    let last = NONE
    return (v) => {
      if (last !== NONE && same(v, last)) return
      last = v
      apply(v)
    }
  }

  // ---------- Tabs: the children are the panes, the active one is picked by CSS from data-active ----------
  registry.Tabs = (p, ctx) => {
    const id = ++seq
    const list = el('div', { class: 'tl', role: 'tablist' })
    const panes = el('div', { class: 'panes' })
    const root = el('div', { class: 'lm-tabs' }, list, panes)
    let tabs = [], sig = '', active = 0, btns = []

    const fades = () => {
      list.toggleAttribute('data-l', list.scrollLeft > 1)
      list.toggleAttribute('data-r', list.scrollLeft + list.clientWidth < list.scrollWidth - 1)
    }
    const reveal = () => {
      const b = btns[active]
      if (!b) return
      const l = b.offsetLeft, r = l + b.offsetWidth, pad = 24
      if (l - pad < list.scrollLeft) list.scrollLeft = l - pad
      else if (r + pad > list.scrollLeft + list.clientWidth) list.scrollLeft = r + pad - list.clientWidth
    }
    const paint = () => {
      root.dataset.active = active
      btns.forEach((b, i) => {
        b.setAttribute('aria-selected', i === active)
        b.tabIndex = i === active ? 0 : -1
      })
      reveal()
      fades()
    }
    const select = (i, focus) => {
      if (i === active) return focus && btns[i].focus()
      active = i
      paint()
      if (focus) btns[i].focus()
      ctx.write('active', i)
      ctx.fire('change', { index: i })
    }
    list.addEventListener('scroll', fades, { passive: true })
    list.addEventListener('keydown', (e) => {
      if (!tabs.length || e.altKey || e.ctrlKey || e.metaKey) return
      const to = { ArrowRight: active + 1, ArrowLeft: active - 1, Home: 0, End: tabs.length - 1 }[e.key]
      if (to == null) return
      e.preventDefault()
      select((to + tabs.length) % tabs.length, true)
    })
    watch(list, fades, 'x')

    // The renderer owns the pane list; only ARIA attributes are set on the panes, never the list itself.
    const label = () => [...panes.children].forEach((c, i) => {
      c.setAttribute('role', 'tabpanel')
      c.id = `lm-tp${id}-${i}`
      c.setAttribute('aria-labelledby', `lm-tb${id}-${i}`)
    })
    const watcher = new MutationObserver(label)
    watcher.observe(panes, { childList: true })

    const build = () => {
      const had = list.contains(document.activeElement)
      btns = tabs.map((t, i) => {
        const b = el('button', { type: 'button', class: 'tab', role: 'tab', id: `lm-tb${id}-${i}`, 'aria-controls': `lm-tp${id}-${i}`, title: t.label },
          el('span', { class: 't' }, t.label),
          t.badge || t.tone ? el('span', { class: 'bdg', 'data-tone': t.tone }, t.tone ? glyph(t.tone) : '', t.badge) : '')
        b.addEventListener('click', () => select(i, false))
        return b
      })
      list.replaceChildren(...btns)
      if (had) btns[active]?.focus()
    }
    const onActive = follow((v) => { active = Math.round(finite(v, 0)) })

    const comp = {
      el: root,
      slot: panes,
      update(p) {
        tabs = (Array.isArray(p.tabs) ? p.tabs : []).slice(0, MAX_TABS).map((t, i) => {
          const o = t && typeof t === 'object' ? t : { label: t }
          return { label: text(o.label) || `#${i + 1}`, badge: text(o.badge), tone: toneOf(o.tone) }
        })
        onActive(p.active)
        active = clamp(active, 0, Math.max(0, tabs.length - 1))
        const s = JSON.stringify(tabs)
        if (s !== sig) { sig = s; build() }
        paint()
        label()
      },
      destroy() { watcher.disconnect() },
    }
    comp.update(p)
    return comp
  }

  // ---------- Accordion: a collapsible section, its height animates through grid-template-rows ----------
  registry.Accordion = (p, ctx) => {
    const id = ++seq
    const mark = el('span', { class: 'mk', 'aria-hidden': true })
    const title = el('b', { class: 't', id: `lm-acl${id}` }), meta = el('span', { class: 'm' })
    const chev = el('svg', { class: 'chev', viewBox: '0 0 10 10', 'aria-hidden': true }, el('path', { d: 'M2 3.5 5 6.5 8 3.5' }))
    const head = el('button', { class: 'hd', type: 'button', 'aria-expanded': false, 'aria-controls': `lm-acb${id}` }, chev, mark, title, meta)
    const slot = el('div', { class: 'slot' })
    const body = el('div', { class: 'bd', id: `lm-acb${id}`, role: 'region', 'aria-labelledby': title.id }, el('div', { class: 'in' }, slot))
    const root = el('div', { class: 'lm-acc' }, head, body)
    let open = false

    const paint = () => {
      root.toggleAttribute('data-open', open)
      head.setAttribute('aria-expanded', open)
      body.inert = !open
    }
    head.addEventListener('click', () => {
      open = !open
      paint()
      ctx.write('open', open)
      ctx.fire('toggle', { open })
    })
    const onOpen = follow((v) => { open = v === true || v === 'true' })

    const comp = {
      el: root,
      slot,
      update(p) {
        title.textContent = text(p.title)
        head.title = text(p.title)
        meta.textContent = text(p.meta)
        meta.hidden = !p.meta
        const tone = toneOf(p.tone)
        setTone(root, tone)
        mark.replaceChildren(tone ? glyph(tone) : '')
        mark.hidden = !tone
        onOpen(p.open)
        paint()
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Gallery ----------
  const B = (key) => ({ $bindState: key })
  const T = (template) => h('Text', { text: { $template: template }, size: 'sm' })

  const facts = [{ k: '分支', v: 'fix/probe-timeout', mono: true }, { k: '节点', v: 'edge-node-3' }, { k: '改动', v: '+42 −7，3 个文件' }]
  const steps = [
    { label: '拉取集群指标', state: 'done', meta: '1.2s' },
    { label: '关联 Pod 重启事件', state: 'done', meta: '2.1s' },
    { label: '检查隧道与 kubelet', state: 'active' },
    { label: '验证根因', state: 'pending' },
  ]
  const lines = [
    { ts: '13:54:06', level: 'info', text: 'controller 调谐完成，32 个任务无变化' },
    { ts: '13:54:07', level: 'warn', text: 'edge-node-3 kubelet NotReady，持续 12s' },
    { ts: '13:54:09', level: 'err', text: 'worker-a /healthz 探针超时 (timeout 1s)' },
  ]

  samples.push(
    {
      group: 'layout',
      title: 'Tabs · typical (bound)',
      span: 2,
      state: { '/tab': 1 },
      tree: () => h('Stack', { gap: 0.75 },
        h('Tabs', { active: B('/tab'), tabs: [{ label: '计划' }, { label: '事件', badge: '3', tone: 'warn' }, { label: '详情' }] },
          h('Steps', { items: steps }),
          h('Log', { lines }),
          h('KeyValue', { items: facts })),
        T('当前标签：${/tab}')),
    },
    {
      group: 'layout',
      title: 'Tabs · edge (many, long labels, scrolls)',
      span: 1,
      tree: () => h('Tabs', {
        tabs: [
          { label: '概览' }, { label: '一个特别长的标签名称用来测试省略与滚动行为是否正常', badge: '12' }, { label: 'Pods', badge: '1.2k', tone: 'ok' }, { label: '错误', badge: '5', tone: 'err' },
          { label: 'Events', tone: 'serious' }, { label: '节点' }, { label: '网络' }, { label: '存储' }, { label: '配置' }, { label: '日志' },
        ],
      },
      h('Text', { text: '概览：第一个标签的内容。' }),
      h('KeyValue', { items: facts }),
      h('Text', { text: '第三个。' })),
    },
    {
      group: 'layout',
      title: 'Tabs · narrow, fewer panes than tabs',
      span: 1,
      tree: () => h('Tabs', { active: 2, tabs: [{ label: '计划' }, { label: '事件', badge: '3', tone: 'warn' }, { label: '详情' }, { label: '空' }] },
        h('Steps', { items: steps }),
        h('Log', { lines }),
        h('KeyValue', { items: facts })),
    },
    {
      group: 'layout',
      title: 'Tabs · empty',
      span: 1,
      tree: () => h('Tabs', { tabs: [] }),
    },
    {
      group: 'layout',
      title: 'Accordion · typical (bound, tones)',
      span: 2,
      state: { '/open': true },
      tree: () => h('Stack', { gap: 0.5 },
        { ...h('Accordion', { title: '改动的文件', meta: '3 个', open: B('/open') }, h('KeyValue', { items: facts })), on: { toggle: { action: 'send', params: { text: '展开了改动列表' } } } },
        h('Accordion', { title: '测试结果', meta: '2 失败', tone: 'err' }, h('Log', { lines })),
        h('Accordion', { title: '执行计划', meta: '3 / 4', tone: 'ok', open: true }, h('Steps', { items: steps })),
        T('第一项展开：${/open}')),
    },
    {
      group: 'layout',
      title: 'Accordion · edge (long, nested, empty)',
      span: 1,
      tree: () => h('Stack', { gap: 0.5 },
        h('Accordion', { title: '一个特别长的标题用来测试单行省略号，同时 meta 也很长很长很长', meta: 'averyveryverylongmetavalue_0123456789' }, h('Text', { text: '内容' })),
        h('Accordion', { title: '嵌套', open: true },
          h('Accordion', { title: '内层 A', meta: '1', tone: 'warn' }, h('Text', { text: '内层内容 A，averyveryverylongunbrokenstring_abcdefghijklmnopqrstuvwxyz_0123456789_abcdefghijklmnopqrstuvwxyz' })),
          h('Accordion', { title: '内层 B', open: true }, h('KeyValue', { items: facts }))),
        h('Accordion', { title: '没有内容' })),
    },
  )
})()
