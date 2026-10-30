// Lumen kit · status: Timeline (event history), Checklist (the agent's todo list).
;(() => {
  const { el, glyph } = Lumen.kit
  const { h, samples, registry } = Lumen

  const TONES = ['ok', 'warn', 'serious', 'err', 'accent', 'muted']
  const str = (v) => (v == null ? '' : String(v))
  const list = (v, max) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object').slice(0, max) : [])
  const ALIAS = { completed: 'done', complete: 'done', success: 'done', finished: 'done', running: 'active', in_progress: 'active', current: 'active', todo: 'pending', waiting: 'pending', queued: 'pending', stuck: 'blocked' }
  const stateOf = (s, ok) => (ok.includes(ALIAS[s] ?? s) ? ALIAS[s] ?? s : null)

  // ---------- Timeline: a vertical time axis, one marker per event ----------
  const TL_LIMIT = 12

  registry.Timeline = (p) => {
    const ol = el('ol', { class: 'lm-tl-l' }), root = el('div', { class: 'lm-tl' }, ol)

    const row = (it) => {
      const state = stateOf(it.state, ['done', 'active', 'pending'])
      const tone = TONES.includes(it.tone) ? it.tone : state === 'active' || state === 'done' ? 'accent' : 'muted'
      const mk = el('span', { class: 'mk', 'data-tone': tone }, glyph(state === 'done' && (tone === 'accent' || tone === 'muted') ? 'ok' : tone)) // a finished event ticks even without a status tone
      return el('li', { class: 'lm-ev', 'data-s': state, 'aria-current': state === 'active' ? 'step' : null },
        it.time ? el('time', {}, str(it.time)) : el('span'), mk,
        el('div', { class: 'bd' },
          el('div', { class: 'hd' }, el('b', {}, str(it.title)), it.tag ? el('span', { class: 'tag' }, str(it.tag)) : ''),
          it.text ? el('p', {}, str(it.text)) : ''))
    }

    const comp = {
      el: root,
      update(p) {
        const all = list(p?.items, 100)
        const limit = Number.isFinite(p?.limit) ? Math.max(1, p.limit) : TL_LIMIT
        const desc = p?.order === 'desc'
        const hidden = Math.max(0, all.length - limit)
        const rows = all.slice(hidden).map(row)
        if (desc) rows.reverse()
        const more = hidden ? el('li', { class: 'lm-ev more' }, el('span'), el('span', { class: 'mk' }), el('div', { class: 'bd' }, `… ${hidden} earlier`)) : null
        ol.toggleAttribute('data-notime', !all.some((it) => it.time))
        ol.replaceChildren(...(desc ? [...rows, more] : [more, ...rows]).filter(Boolean))
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Checklist: the agent's todo list ----------
  const box = (state) => {
    const mark = {
      done: [['path', { d: 'M3.2 6.4 5.2 8.4 8.8 3.8' }]],
      active: [['rect', { class: 'core', x: 3.6, y: 3.6, width: 4.8, height: 4.8, rx: 0.6 }]],
      blocked: [['path', { d: 'M3.4 8.6 8.6 3.4' }]],
      pending: [],
    }[state]
    return el('svg', { class: 'bx', viewBox: '0 0 12 12', 'aria-hidden': true }, el('rect', { class: 'fr', x: 0.75, y: 0.75, width: 10.5, height: 10.5, rx: 1.5 }), mark.map(([tag, attrs]) => el(tag, attrs)))
  }
  const LABEL = { done: 'done', active: 'in progress', pending: 'pending', blocked: 'blocked' }

  registry.Checklist = (p) => {
    const title = el('h3'), count = el('span', { class: 'ct' }), fill = el('i')
    const head = el('div', { class: 'hd' }, title, count)
    const track = el('div', { class: 'tr', 'aria-hidden': true }, fill)
    const ul = el('ul', { class: 'ls' })
    const root = el('div', { class: 'lm-check' }, head, track, ul)

    const comp = {
      el: root,
      update(p) {
        const items = list(p?.items, 60).map((it) => ({ ...it, st: stateOf(it.state, ['done', 'active', 'pending', 'blocked']) ?? 'pending' }))
        const done = items.filter((it) => it.st === 'done').length, total = items.length
        title.textContent = str(p?.title)
        head.toggleAttribute('data-bare', !p?.title)
        head.hidden = !p?.title && !total
        count.replaceChildren(...(total && done === total ? [glyph('ok')] : []), total ? `${done} / ${total}` : '')
        root.toggleAttribute('data-complete', !!total && done === total)
        track.hidden = !total
        fill.style.width = total ? `${(done / total) * 100}%` : '0'
        ul.replaceChildren(...items.map((it) => el('li', { class: 'lm-ci', 'data-s': it.st, 'aria-current': it.st === 'active' ? 'step' : null, 'aria-label': `${LABEL[it.st]}: ${str(it.label)}` },
          box(it.st),
          el('span', { class: 'l' }, str(it.label)),
          it.note ? el('span', { class: 'n' }, str(it.note)) : '')))
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Gallery samples ----------
  samples.push(
    { group: 'status', title: 'Timeline · typical', span: 1, tree: () => h('Timeline', { items: [
      { time: '13:51:02', title: '收到告警', text: 'Pod 重启率超过阈值 (38 / h)', tone: 'warn', tag: 'alert' },
      { time: '13:52:40', title: '拉取集群指标', text: 'Prometheus 最近 6 小时', tone: 'ok', state: 'done' },
      { time: '13:53:15', title: '关联 Pod 重启事件', text: '集中在 edge-node-3', tone: 'ok', state: 'done' },
      { time: '13:54:06', title: 'kubelet NotReady', tone: 'err', tag: 'node-3' },
      { time: '13:54:30', title: '检查 GRE 隧道', text: '对比丢包与探针超时', state: 'active' },
      { time: '—', title: '验证根因', state: 'pending' },
    ] }) },
    { group: 'status', title: 'Timeline · newest first', span: 1, tree: () => h('Timeline', { order: 'desc', items: [
      { time: '2m ago', title: 'Session started', tag: 'init' },
      { time: '2m ago', title: 'Read web/ui.js', tone: 'ok' },
      { time: '90s ago', title: 'Edit web/kit/graph.js', text: '+412 −0', tone: 'ok', tag: 'edit' },
      { time: '40s ago', title: 'Screenshot failed', text: 'ResizeObserver loop completed with undelivered notifications', tone: 'serious' },
      { time: 'now', title: 'Fixing layout', state: 'active' },
    ] }) },
    { group: 'status', title: 'Timeline · edge (40 events, long text, no times)', span: 2, tree: () => h('Timeline', { limit: 8, items: Array.from({ length: 40 }, (_, i) => ({
      title: i === 37 ? 'an-extremely-long-event-title-without-any-spaces-that-would-otherwise-overflow-the-panel-and-break-the-axis' : `Event ${i + 1}`,
      text: i % 6 === 5 ? '这是一段很长的说明文字，用来检查中文与 English mixed text 在窄栏里是否正确换行，而不会撑破时间轴。' : undefined,
      tone: i % 11 === 10 ? 'err' : i % 7 === 6 ? 'warn' : undefined,
      tag: i % 9 === 8 ? 'retry' : undefined,
    })) }) },
    { group: 'status', title: 'Timeline · narrow', span: 1, tree: () => h('Timeline', { items: [
      { time: '13:51', title: '收到告警', tone: 'warn', tag: 'alert' },
      { time: '13:53', title: '关联 Pod 重启事件', text: '集中在 edge-node-3 上的 38 次重启', tone: 'ok' },
      { time: '13:54', title: '检查 GRE 隧道', state: 'active' },
    ] }) },
    { group: 'status', title: 'Timeline · empty', span: 1, tree: () => h('Timeline', { items: [] }) },

    { group: 'status', title: 'Checklist · typical', span: 1, tree: () => h('Checklist', { title: '任务清单', items: [
      { label: '阅读 README 与 ui.js', state: 'done' },
      { label: '实现 Flow 与 Tree', state: 'done' },
      { label: '实现 Graph 自动布局', state: 'active', note: '正在调试交叉最小化' },
      { label: '编写 catalog 描述', state: 'pending' },
      { label: '亮 / 暗主题截图验证', state: 'pending' },
      { label: '合并到 main', state: 'blocked', note: '等待 CI 通过' },
    ] }) },
    { group: 'status', title: 'Checklist · all done', span: 1, tree: () => h('Checklist', { title: 'Release', items: [
      { label: 'Bump version', state: 'done' }, { label: 'Update changelog', state: 'done' }, { label: 'Tag and push', state: 'done' },
    ] }) },
    { group: 'status', title: 'Checklist · edge (long labels, many items)', span: 2, tree: () => h('Checklist', { title: 'A very long checklist title that goes on and on and must not break the header layout at all', items: [
      { label: 'an-extremely-long-unbroken-task-label-that-would-overflow-the-row-if-it-were-not-wrapped-correctly', state: 'done', note: 'and a note that is long as well, to see how the second line behaves' },
      { label: '把这个非常非常长的中文任务名称写在这里，用来检查换行与对齐是否正常，而不会把勾选框挤变形', state: 'active' },
      ...Array.from({ length: 24 }, (_, i) => ({ label: `Task ${i + 3}`, state: i < 6 ? 'done' : i === 6 ? 'blocked' : 'pending', note: i === 6 ? 'waiting for review' : undefined })),
    ] }) },
    { group: 'status', title: 'Checklist · narrow', span: 1, tree: () => h('Checklist', { items: [
      { label: '拉取指标', state: 'done' },
      { label: '检查 GRE 隧道', state: 'active', note: '对比丢包与探针超时' },
      { label: '修复并验证', state: 'blocked' },
    ] }) },
    { group: 'status', title: 'Checklist · empty', span: 1, tree: () => h('Checklist', { items: [] }) },
  )
})()
