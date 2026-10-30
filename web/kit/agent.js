/* agent — AgentCard, ToolCall, Ask, Timer: what the agent and its helpers are doing, and asking */
;(() => {
  const { el, clamp, setTone, glyph, pad2 } = Lumen.kit
  const { h, samples, registry } = Lumen

  let seq = 0
  const text = (v) => (v == null ? '' : String(v))
  const TONES = ['ok', 'warn', 'serious', 'err', 'accent', 'muted']
  const toneOf = (v) => (TONES.includes(v) ? v : undefined)
  const finite = (v, fallback) => {
    const n = typeof v === 'string' && v.trim() ? Number(v) : v
    return typeof n === 'number' && Number.isFinite(n) ? n : fallback
  }

  // ---------- AgentCard: a sub-agent and what it is doing ----------
  const AGENT = {
    idle: { tone: 'muted', label: '空闲' },
    thinking: { tone: 'accent', label: '思考中' },
    acting: { tone: 'accent', label: '执行中' },
    alert: { tone: 'serious', label: '需要关注' },
    done: { tone: 'ok', label: '已完成' },
    failed: { tone: 'err', label: '已失败' },
  }

  registry.AgentCard = (p) => {
    const name = el('b', { class: 'nm' }), role = el('span', { class: 'rl' })
    const st = el('span', { class: 'st' })
    const task = el('p', { class: 'tk' })
    const fill = el('i'), pct = el('span', { class: 'pc' })
    const bar = el('div', { class: 'pg', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': '进度' }, el('span', { class: 'tr' }, fill), pct)
    const meta = el('span', { class: 'mt' })
    const root = el('div', { class: 'lm-agent', role: 'group' },
      el('div', { class: 'ag' }, el('div', { class: 'id' }, name, role), st, task, bar, meta))

    const comp = {
      el: root,
      update(p) {
        const key = Object.hasOwn(AGENT, p.state) ? p.state : 'idle', s = AGENT[key]
        root.dataset.state = key
        setTone(root, s.tone)
        name.textContent = text(p.name)
        name.title = text(p.name)
        role.textContent = text(p.role)
        role.hidden = !p.role
        st.replaceChildren(glyph(s.tone), s.label)
        task.textContent = text(p.task)
        task.title = text(p.task)
        task.hidden = !p.task
        const v = finite(p.progress, null)
        bar.hidden = v == null
        if (v != null) {
          const n = clamp(v, 0, 100)
          fill.style.width = `${n}%`
          pct.textContent = `${Math.round(n)}%`
          bar.setAttribute('aria-valuenow', Math.round(n))
        }
        meta.textContent = text(p.meta)
        meta.hidden = !p.meta
        root.setAttribute('aria-label', `${text(p.name)}，${s.label}`)
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- ToolCall: one tool invocation; click to see its arguments and result ----------
  const CLIP = 4000
  const clip = (s) => (s.length > CLIP ? `${s.slice(0, CLIP)}\n… 已截断，还有 ${s.length - CLIP} 个字符` : s)
  const TOOL = { running: { tone: 'accent', label: '运行中' }, ok: { tone: 'ok', label: '成功' }, err: { tone: 'err', label: '失败' } }
  const duration = (ms) => {
    if (ms < 1000) return `${Math.round(ms)}ms`
    const s = ms / 1000
    if (s < 10) return `${+s.toFixed(1)}s`
    if (s < 60) return `${Math.round(s)}s`
    const m = Math.floor(s / 60)
    return m < 60 ? `${m}m ${pad2(Math.round(s % 60) % 60)}s` : `${Math.floor(m / 60)}h ${pad2(m % 60)}m`
  }
  const spinner = () => el('svg', { class: 'spin', viewBox: '0 0 10 10', 'aria-hidden': true }, el('circle', { cx: 5, cy: 5, r: 3.6 }))

  registry.ToolCall = (p) => {
    const id = ++seq
    const ic = el('span', { class: 'ic', role: 'img' }), nm = el('b', { class: 'nm' }), sm = el('span', { class: 'sm' }), du = el('time', { class: 'du' })
    const ch = el('svg', { class: 'ch', viewBox: '0 0 10 10', 'aria-hidden': true }, el('path', { d: 'M2 3.5 5 6.5 8 3.5' }))
    const block = (title) => {
      const pre = el('pre', { tabindex: 0, 'aria-label': title })
      return { pre, shown: null, box: el('section', { class: 'blk' }, el('h4', {}, title), pre) }
    }
    const args = block('参数'), result = block('结果')
    const detail = el('div', { class: 'dt', id: `lm-tc${id}` }, el('div', { class: 'in' }, args.box, result.box))
    const root = el('div', { class: 'lm-tool' }, detail)
    let head = null, open = false, expandable = false

    const paint = () => {
      const show = open && expandable
      root.toggleAttribute('data-open', show)
      if (expandable) head.setAttribute('aria-expanded', show)
      detail.inert = !show
    }
    const mount = (live) => {
      const next = el(live ? 'button' : 'div', { class: 'hd', type: live ? 'button' : null }, ic, nm, sm, du, ch)
      if (live) {
        next.setAttribute('aria-controls', detail.id)
        next.addEventListener('click', () => { open = !open; paint() })
      }
      if (head) head.replaceWith(next); else root.prepend(next)
      head = next
    }
    const fill = (b, v) => {
      const s = clip(text(v))
      b.box.hidden = !s
      if (s !== b.shown) { b.shown = s; b.pre.textContent = s }
    }

    const comp = {
      el: root,
      update(p) {
        const key = Object.hasOwn(TOOL, p.state) ? p.state : 'running', s = TOOL[key]
        root.dataset.state = key
        setTone(root, s.tone)
        ic.replaceChildren(key === 'running' ? spinner() : glyph(s.tone))
        ic.setAttribute('aria-label', s.label)
        nm.textContent = text(p.name) || 'tool'
        sm.textContent = text(p.summary)
        sm.title = text(p.summary)
        const ms = finite(p.durationMs, null)
        du.textContent = ms == null || ms < 0 ? '' : duration(ms)
        fill(args, p.args)
        fill(result, p.result)
        const live = !args.box.hidden || !result.box.hidden
        if (live !== expandable || !head) { expandable = live; mount(live) }
        paint()
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Ask: the agent is waiting for an answer ----------
  registry.Ask = (p, ctx) => {
    const id = ++seq
    const beacon = el('span', { class: 'bc', 'aria-hidden': true }), ttl = el('b', { class: 'ttl', id: `lm-ask${id}` })
    const q = el('p', { class: 'q' }), opts = el('div', { class: 'opts' })
    // Closing ignores the question: nothing goes to the agent.
    const x = el('button', { class: 'x', type: 'button', title: '关闭，不回复', 'aria-label': '关闭，不回复' }, el('svg', { viewBox: '0 0 16 16', 'aria-hidden': true }, el('path', { d: 'M4 4l8 8M12 4l-8 8' })))
    const root = el('section', { class: 'lm-ask', role: 'group', 'aria-labelledby': ttl.id }, el('header', {}, beacon, ttl, x), q, opts)
    x.addEventListener('click', () => {
      root.hidden = true
      ctx.emit({ action: 'dismiss', params: { label: ttl.textContent } })
    })
    let list = [], sig = '', chosen = -1, btns = [], title = ''

    const paint = () => {
      root.toggleAttribute('data-answered', chosen >= 0)
      beacon.replaceChildren(chosen >= 0 ? glyph('ok') : '')
      ttl.textContent = title || (chosen >= 0 ? '已回复' : '等待你的回复')
      btns.forEach((b, i) => {
        b.toggleAttribute('data-chosen', i === chosen)
        b.disabled = chosen >= 0 && i !== chosen
        if (chosen >= 0) b.setAttribute('aria-pressed', i === chosen); else b.removeAttribute('aria-pressed')
        if (chosen === i) b.setAttribute('aria-disabled', true); else b.removeAttribute('aria-disabled')
      })
    }
    const choose = (i) => {
      if (chosen >= 0) return
      chosen = i
      paint()
      const { text: reply, label } = list[i]
      if (!ctx.fire('choose', { text: reply, label })) ctx.emit({ action: 'send', params: { text: reply } })
    }

    const comp = {
      el: root,
      update(p) {
        setTone(root, toneOf(p.tone) ?? 'accent')
        const next = (Array.isArray(p.options) ? p.options : []).slice(0, 6).filter((o) => o && typeof o === 'object').map((o) => ({ label: text(o.label ?? o.text), text: text(o.text ?? o.label), kind: o.kind }))
        // without an explicit primary, the first option that has no kind becomes it
        let primary = next.some((o) => o.kind === 'primary')
        next.forEach((o) => {
          if (!['primary', 'ghost', 'danger'].includes(o.kind)) { o.kind = primary ? 'ghost' : 'primary'; primary = true }
        })
        // a different question starts unanswered
        const s = JSON.stringify([p.title, p.text, next])
        if (s !== sig) {
          sig = s
          list = next
          chosen = -1
          btns = list.map((o, i) => {
            const b = el('button', { class: 'lm-btn', type: 'button', 'data-kind': o.kind }, o.label)
            b.addEventListener('click', () => choose(i))
            return b
          })
          opts.replaceChildren(...btns)
        }
        title = text(p.title)
        q.textContent = text(p.text)
        q.hidden = !p.text
        paint()
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Timer: live elapsed time; every timer shares one interval ----------
  const timers = new Set()
  let beat = 0
  const tick = () => timers.forEach((t) => t())
  const join = (t) => {
    timers.add(t)
    if (!beat) beat = setInterval(tick, 1000)
  }
  const leave = (t) => {
    timers.delete(t)
    if (!timers.size) { clearInterval(beat); beat = 0 }
  }

  // epoch ms, epoch seconds (what small models tend to write), or anything Date.parse takes
  const when = (v) => {
    if (v == null || v === '' || typeof v === 'boolean') return null
    const n = typeof v === 'number' ? v : /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : Date.parse(v)
    return Number.isFinite(n) && n > 0 ? (n < 1e11 ? n * 1000 : n) : null
  }
  const clock = (ms) => {
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60)
    return m >= 60 ? `${Math.floor(m / 60)}:${pad2(m % 60)}:${pad2(s % 60)}` : `${pad2(m)}:${pad2(s % 60)}`
  }
  const compact = (ms) => {
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60), hr = Math.floor(m / 60)
    if (hr >= 24) return `${Math.floor(hr / 24)}d ${pad2(hr % 24)}h`
    if (hr) return `${hr}h ${pad2(m % 60)}m`
    return m ? `${m}m ${pad2(s % 60)}s` : `${s}s`
  }

  registry.Timer = (p) => {
    const lb = el('span', { class: 'lb' }), v = el('time', { class: 'v' })
    const root = el('div', { class: 'lm-timer', role: 'timer' }, lb, el('div', { class: 'row' }, el('i', { class: 'dot', 'aria-hidden': true }), v))
    let cur = p, frozen = Date.now()

    const render = () => {
      const a = when(cur.since), b = when(cur.until), running = cur.running !== false
      let ms = null
      if (running) ms = a != null ? Date.now() - a : b != null ? b - Date.now() : null
      else if (a != null) ms = (b ?? frozen) - a
      const out = ms == null ? (cur.format === 'compact' ? '--' : '--:--') : (cur.format === 'compact' ? compact : clock)(Math.max(0, ms))
      if (v.textContent !== out) v.textContent = out
    }
    const comp = {
      el: root,
      update(p) {
        cur = p
        frozen = Date.now()
        lb.textContent = text(p.label)
        lb.hidden = !p.label
        root.toggleAttribute('data-live', p.running !== false)
        render()
      },
      destroy() { leave(render) },
    }
    comp.update(p)
    join(render)
    return comp
  }

  // ---------- Gallery ----------
  const S = (key) => ({ $state: key })
  const send = { action: 'send' }
  const ago = (s) => Date.now() - s * 1000

  samples.push(
    {
      group: 'agent',
      title: 'AgentCard · typical (all states)',
      span: 2,
      tree: () => h('Grid', { min: 17, gap: 0.75 },
        h('AgentCard', { name: 'explorer', role: 'Explore', state: 'thinking', task: '在 monitoring 命名空间里搜索 kubelet 探针相关的配置', progress: 35, meta: '已读 18 个文件' }),
        h('AgentCard', { name: 'fixer', role: 'general-purpose', state: 'acting', task: '把 probe timeoutSeconds 从 1 调整到 3', progress: 72, meta: '3 次编辑 · 1 次测试' }),
        h('AgentCard', { name: 'reviewer', role: 'Code review', state: 'alert', task: '发现一处可能破坏滚动更新的改动，等待确认', meta: '需要你决定' }),
        h('AgentCard', { name: 'tester', role: 'Test runner', state: 'done', task: '48 个用例全部通过', progress: 100, meta: '用时 2m 03s' }),
        h('AgentCard', { name: 'deployer', role: 'Rollout', state: 'failed', task: 'kubectl rollout status 超时', progress: 40, meta: '退出码 1' }),
        h('AgentCard', { name: 'idle-helper', state: 'idle' })),
    },
    {
      group: 'agent',
      title: 'AgentCard · edge (long, odd values)',
      span: 1,
      tree: () => h('Stack', { gap: 0.75 },
        h('AgentCard', { name: 'a-very-long-agent-name-that-keeps-going-and-going-0123456789', role: 'averyveryverylongunbrokenrolenamethatneverwraps_0123456789_abcdefghijklmnopqrstuvwxyz', state: 'acting', task: '一段特别长的任务描述，用来测试多行截断是否正常工作：先读取全部配置文件，再逐个比对差异，随后生成补丁并在本地验证，最后提交审阅。这一句还在继续继续继续继续。', progress: 250, meta: '元信息也很长很长很长很长很长很长很长很长很长很长很长' }),
        h('AgentCard', { name: '未知状态', state: 'sleeping', progress: -5 }),
        h('AgentCard', { name: '', task: '只有任务' })),
    },
    {
      group: 'agent',
      title: 'AgentCard · narrow',
      span: 1,
      tree: () => h('AgentCard', { name: 'explorer', role: 'Explore', state: 'thinking', task: '搜索 kubelet 探针配置', progress: 35, meta: '已读 18 个文件' }),
    },
    {
      group: 'agent',
      title: 'ToolCall · typical',
      span: 2,
      tree: () => h('Stack', { gap: 0.5 },
        h('ToolCall', { name: 'Read', summary: 'web/ui.js', state: 'ok', durationMs: 42 }),
        h('ToolCall', { name: 'Grep', summary: '"probe" in k8s/', state: 'ok', durationMs: 380, args: '{\n  "pattern": "probe",\n  "path": "k8s/",\n  "output_mode": "content"\n}', result: 'k8s/monitoring/prometheus/values.yml:41:    scrape_timeout: 10s\nk8s/jobs-system/controller/deployment.yml:62:        readinessProbe:\nk8s/jobs-system/controller/deployment.yml:63:          timeoutSeconds: 1' }),
        h('ToolCall', { name: 'Edit', summary: 'k8s/jobs-system/controller/deployment.yml', state: 'running', args: '{"old_string": "timeoutSeconds: 1", "new_string": "timeoutSeconds: 3"}' }),
        h('ToolCall', { name: 'Bash', summary: 'kubectl rollout status deploy/controller', state: 'err', durationMs: 120000, args: 'kubectl -n jobs-system rollout status deploy/controller --timeout=120s', result: 'error: timed out waiting for the condition' }),
        h('ToolCall', { name: 'WebFetch', summary: 'https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/', state: 'ok', durationMs: 1840 })),
    },
    {
      group: 'agent',
      title: 'ToolCall · edge (huge result, bad input)',
      span: 1,
      tree: () => h('Stack', { gap: 0.5 },
        h('ToolCall', { name: 'Bash', summary: '一个特别长的摘要用来测试单行省略号 averyveryverylongunbrokenstring_0123456789_abcdefghijklmnopqrstuvwxyz', state: 'ok', durationMs: 3723000, args: 'seq 1 2000', result: Array.from({ length: 1500 }, (_, i) => `line ${i + 1}: ${'x'.repeat(i % 40)}`).join('\n') }),
        h('ToolCall', { name: '', state: 'weird', durationMs: -3 }),
        h('ToolCall', { name: 'Glob', state: 'running', durationMs: 'oops' })),
    },
    {
      group: 'agent',
      title: 'ToolCall · narrow',
      span: 1,
      tree: () => h('ToolCall', { name: 'Grep', summary: '"timeoutSeconds" in k8s/ (12 matches)', state: 'ok', durationMs: 380, result: 'k8s/a.yml:3\nk8s/b.yml:9' }),
    },
    {
      group: 'agent',
      title: 'Ask · typical (unbound, falls back to send)',
      span: 2,
      tree: () => h('Ask', {
        title: '要继续应用到其余 11 个节点吗？',
        text: 'dry-run 显示只会改动探针超时，不会重启其他节点上的 Pod。',
        options: [{ label: '应用到全部节点', text: '继续，应用到全部节点' }, { label: '只先应用 edge-node-3', text: '只先应用到 edge-node-3，观察 10 分钟' }, { label: '先不要', text: '先暂停，不要应用' }],
      }),
    },
    {
      group: 'agent',
      title: 'Ask · bound choose, danger, tone',
      span: 1,
      tree: () => ({ ...h('Ask', {
        tone: 'warn',
        title: '删除 3 个已完成的 Job？',
        text: '这不可恢复，Pod 日志也会一起清理。',
        options: [{ label: '删除', text: '确认删除这 3 个 Job', kind: 'danger' }, { label: '保留', text: '保留这些 Job', kind: 'ghost' }],
      }), on: { choose: send } }),
    },
    {
      group: 'agent',
      title: 'Ask · edge (long text, many options)',
      span: 1,
      tree: () => h('Ask', {
        text: '这是一段很长很长的问题描述，用来测试换行与滚动：我在 edge-node-3 上发现 38 次重启几乎全部发生在 GRE 隧道丢包超过 5% 的窗口内，averyveryverylongunbrokenstring_0123456789_abcdefghijklmnopqrstuvwxyz。你希望我如何处理？',
        options: [
          { label: '一个特别长的选项文字用来测试按钮是否会正确换行而不是被截断', text: '选 1' },
          { label: '选项二', text: '选 2' },
          { label: '选项三', text: '选 3', kind: 'danger' },
          { label: '选项四', text: '选 4' },
        ],
      }),
    },
    {
      group: 'agent',
      title: 'Ask · narrow',
      span: 1,
      tree: () => h('Ask', { title: '继续吗？', text: '要不要继续？', options: [{ label: '继续', text: '继续' }, { label: '停止', text: '停止' }] }),
    },
    {
      group: 'agent',
      title: 'Timer · typical',
      span: 1,
      tree: () => h('Row', { gap: 1.5 },
        h('Timer', { since: ago(12 * 60 + 3), label: '已运行' }),
        h('Timer', { since: ago(3723), format: 'compact', label: '会话时长' }),
        h('Timer', { since: ago(300), until: ago(60), running: false, label: '上次构建' })),
    },
    {
      group: 'agent',
      title: 'Timer · edge (bad input, ISO, seconds)',
      span: 1,
      tree: () => h('Row', { gap: 1.5 },
        h('Timer', { since: 'not a date', label: '无效' }),
        h('Timer', { since: new Date(ago(95)).toISOString(), label: 'ISO' }),
        h('Timer', { since: Math.floor(ago(7200) / 1000), format: 'compact', label: '秒级时间戳' }),
        h('Timer', { since: ago(-60), label: '未来' }),
        h('Timer', { until: ago(-90), label: '倒计时' }),
        h('Timer', { since: ago(86400 * 2 + 3600 * 3), format: 'compact' }),
        h('Timer', {})),
    },
    {
      group: 'agent',
      title: 'Timer · in a state (live)',
      span: 1,
      state: { '/since': Date.now() - 45000 },
      tree: () => h('Timer', { since: S('/since'), label: '上一步已耗时' }),
    },
  )
})()
