/* controls — the user answers back through these: Choice, Input, Toggle, Slider */
;(() => {
  const { el, clamp, setTone, glyph } = Lumen.kit
  const { h, samples, registry } = Lumen

  let seq = 0
  const NONE = Symbol('none')
  const text = (v) => (v == null ? '' : String(v))
  const TONES = ['ok', 'warn', 'serious', 'err', 'accent', 'muted']
  const toneOf = (v) => (TONES.includes(v) ? v : undefined)
  const finite = (v, fallback) => {
    const n = typeof v === 'string' && v.trim() ? Number(v) : v
    return typeof n === 'number' && Number.isFinite(n) ? n : fallback
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

  // A value the user can change lives in the component, so it works unbound. The prop only wins when it changes,
  // which also keeps a streamed spec that repeats the initial value from undoing what the user did.
  const follow = (apply) => {
    let last = NONE
    return (v) => {
      if (last !== NONE && same(v, last)) return
      last = v
      apply(v)
    }
  }

  // ---------- Choice: option cards, a radio group or a checkbox group ----------
  registry.Choice = (p, ctx) => {
    const id = ++seq
    const cap = el('div', { class: 'cap', id: `lm-ch${id}` }), list = el('div', { class: 'list' })
    const root = el('div', { class: 'lm-choice' }, cap, list)
    let opts = [], sig = '', multi = false, picked = [], cur = 0
    let btns = []

    const paint = () => {
      btns.forEach((b, i) => {
        const on = picked.includes(opts[i].value)
        b.setAttribute('aria-checked', on)
        b.tabIndex = i === cur ? 0 : -1
      })
    }
    const commit = (next) => {
      picked = next
      paint()
      const value = multi ? picked : (picked[0] ?? '')
      ctx.write('value', value)
      ctx.fire('change', { value })
    }
    const pick = (i) => {
      cur = i
      const v = opts[i].value
      if (!multi) return picked.includes(v) ? paint() : commit([v])
      const next = picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v]
      commit(opts.map((o) => o.value).filter((x) => next.includes(x)))
    }
    const move = (to) => {
      cur = (to + opts.length) % opts.length
      btns[cur].focus()
      if (multi || picked.includes(opts[cur].value)) paint(); else pick(cur)
    }

    list.addEventListener('keydown', (e) => {
      if (!opts.length || e.altKey || e.ctrlKey || e.metaKey) return
      const to = { ArrowDown: cur + 1, ArrowRight: cur + 1, ArrowUp: cur - 1, ArrowLeft: cur - 1, Home: 0, End: opts.length - 1 }[e.key]
      if (to == null) return
      e.preventDefault()
      move(to)
    })

    const build = () => {
      const had = root.contains(document.activeElement)
      btns = opts.map((o, i) => {
        const b = el('button', { type: 'button', class: 'opt', role: multi ? 'checkbox' : 'radio', 'aria-checked': false, title: o.hint },
          el('span', { class: 'mark', 'aria-hidden': true }, glyph('ok')),
          el('span', { class: 'txt' }, el('b', {}, o.label), o.hint ? el('small', {}, o.hint) : ''))
        setTone(b, o.tone)
        b.addEventListener('click', () => pick(i))
        return b
      })
      list.replaceChildren(...btns)
      if (had) btns[cur]?.focus()
    }

    const onValue = follow((v) => {
      picked = (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(text)
      if (!multi) picked = picked.slice(0, 1)
    })

    const comp = {
      el: root,
      update(p) {
        multi = !!p.multiple
        const next = (Array.isArray(p.options) ? p.options : []).slice(0, 24).filter((o) => o && typeof o === 'object').map((o, i) => {
          const label = text(o.label ?? o.value) || `#${i + 1}`
          return { value: text(o.value ?? o.label ?? i), label, hint: text(o.hint), tone: toneOf(o.tone) }
        })
        root.dataset.layout = p.layout === 'list' || p.layout === 'chips' ? p.layout : 'auto'
        cap.textContent = text(p.label)
        cap.hidden = !p.label
        root.setAttribute('role', multi ? 'group' : 'radiogroup')
        if (p.label) root.setAttribute('aria-labelledby', cap.id); else root.removeAttribute('aria-labelledby')
        onValue(p.value)
        const s = JSON.stringify([multi, next])
        opts = next
        if (!multi && picked.length > 1) picked = picked.slice(0, 1)
        const at = opts.findIndex((o) => picked.includes(o.value))
        cur = at >= 0 ? at : clamp(cur, 0, Math.max(0, opts.length - 1))
        if (s !== sig) { sig = s; build() }
        paint()
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Input: a text field with a send button, safe for IME composition ----------
  registry.Input = (p, ctx) => {
    const btn = el('button', { class: 'lm-btn', type: 'button', 'data-kind': 'primary' })
    const root = el('div', { class: 'lm-input' }, btn)
    let field = null, multi = null, clear = true, timer = 0, pending = null, lastProp = NONE
    const written = [] // values this component wrote and has not seen come back yet

    const flush = () => {
      clearTimeout(timer)
      if (pending == null) return
      written.push(pending)
      if (written.length > 8) written.shift()
      ctx.write('value', pending)
      pending = null
    }
    const sync = () => { btn.disabled = !field.value.trim() }
    const put = (value) => {
      if (field.value === value) return
      const { selectionStart: a, selectionEnd: b } = field
      field.value = value
      if (document.activeElement === field) field.setSelectionRange(Math.min(a, value.length), Math.min(b, value.length))
    }
    const submit = () => {
      flush()
      const value = field.value.trim()
      if (!value) return
      if (!ctx.fire('submit', { text: value })) ctx.emit({ action: 'send', params: { text: value } })
      root.setAttribute('data-sent', '')
      if (!clear) return
      field.value = ''
      written.push('')
      ctx.write('value', '')
      sync()
    }

    const build = (isMulti) => {
      const next = el(isMulti ? 'textarea' : 'input', { class: 'fld', type: isMulti ? null : 'text', autocomplete: 'off', maxlength: 8000, enterkeyhint: 'send' })
      next.addEventListener('input', () => {
        pending = next.value
        clearTimeout(timer)
        timer = setTimeout(flush, 100)
        sync()
      })
      next.addEventListener('blur', flush)
      next.addEventListener('animationend', () => root.removeAttribute('data-sent'))
      next.addEventListener('keydown', (e) => {
        // Enter that confirms an IME candidate must not send (Safari reports it as keyCode 229 after compositionend)
        if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || (isMulti && e.shiftKey)) return
        e.preventDefault()
        submit()
      })
      if (field) {
        next.value = field.value
        const had = document.activeElement === field
        field.replaceWith(next)
        if (had) next.focus()
      } else root.prepend(next)
      field = next
      multi = isMulti
    }
    btn.addEventListener('click', () => {
      submit()
      field.focus({ preventScroll: true })
    })

    const comp = {
      el: root,
      update(p) {
        if (!!p.multiline !== multi) build(!!p.multiline)
        field.placeholder = text(p.placeholder)
        field.setAttribute('aria-label', text(p.placeholder) || '输入')
        if (multi) { field.rows = clamp(Math.round(finite(p.rows, 3)), 1, 8); root.style.setProperty('--rows', field.rows) }
        root.toggleAttribute('data-multi', multi)
        btn.textContent = text(p.submitLabel) || '发送'
        clear = p.clearOnSubmit !== false
        const v = text(p.value)
        if (v !== lastProp) {
          lastProp = v
          const i = written.indexOf(v)
          if (i >= 0) written.splice(0, i + 1) // our own write coming back
          else { written.length = 0; put(v) }
        }
        sync()
      },
      destroy() { clearTimeout(timer) },
    }
    comp.update(p)
    return comp
  }

  // ---------- Toggle: a switch ----------
  registry.Toggle = (p, ctx) => {
    const id = ++seq
    const label = el('b', { id: `lm-tg${id}` }), hint = el('small', { id: `lm-tgh${id}` }), state = el('span', { class: 'st', 'aria-hidden': true })
    const root = el('button', { class: 'lm-toggle', type: 'button', role: 'switch', 'aria-labelledby': label.id },
      el('span', { class: 'txt' }, label, hint), state, el('span', { class: 'trk', 'aria-hidden': true }, el('i')))
    let on = false
    const paint = () => {
      root.setAttribute('aria-checked', on)
      state.textContent = on ? '开' : '关'
    }
    root.addEventListener('click', () => {
      on = !on
      paint()
      ctx.write('value', on)
      ctx.fire('change', { value: on })
    })
    const onValue = follow((v) => { on = v === true || v === 'true' || v === 1 })

    const comp = {
      el: root,
      update(p) {
        label.textContent = text(p.label)
        hint.textContent = text(p.hint)
        hint.hidden = !p.hint
        if (p.hint) root.setAttribute('aria-describedby', hint.id); else root.removeAttribute('aria-describedby')
        onValue(p.value)
        paint()
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Slider: a native range input, styled ----------
  registry.Slider = (p, ctx) => {
    const id = `lm-sl${++seq}`
    const label = el('label', { class: 'lbl', for: id }), out = el('output', { class: 'val', for: id })
    const input = el('input', { id, class: 'rng', type: 'range' })
    const lo = el('span'), hi = el('span')
    const root = el('div', { class: 'lm-slider' }, el('div', { class: 'top' }, label, out), input, el('div', { class: 'ends', 'aria-hidden': true }, lo, hi))
    let min = 0, max = 100, step = 1, unit = ''

    const decimals = () => Math.min(6, (String(step).split('.')[1] ?? '').length)
    const fmt = (n) => `${+n.toFixed(decimals())}`
    const paint = () => {
      const v = Number(input.value)
      input.style.setProperty('--f', (v - min) / (max - min))
      out.replaceChildren(fmt(v), unit ? el('small', {}, unit) : '')
      input.setAttribute('aria-valuetext', `${fmt(v)}${unit}`)
    }
    input.addEventListener('input', () => {
      paint()
      ctx.write('value', Number(input.value))
    })
    input.addEventListener('change', () => ctx.fire('change', { value: Number(input.value) }))
    const onValue = follow((v) => { input.value = finite(v, min) })

    const comp = {
      el: root,
      update(p) {
        min = finite(p.min, 0)
        max = finite(p.max, 100)
        if (max < min) [min, max] = [max, min]
        if (max === min) max = min + 1
        step = finite(p.step, 1)
        if (step <= 0) step = 1
        unit = text(p.unit)
        label.textContent = text(p.label)
        lo.textContent = fmt(min)
        hi.textContent = fmt(max)
        Object.assign(input, { min, max, step })
        onValue(p.value)
        paint()
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Gallery ----------
  const B = (key) => ({ $bindState: key })
  const T = (template) => h('Text', { text: { $template: template }, size: 'sm' })
  const send = { action: 'send' }

  samples.push(
    {
      group: 'controls',
      title: 'Choice · typical (single, bound)',
      state: { '/pick': 'dry' },
      tree: () => h('Stack', { gap: 0.75 },
        h('Choice', {
          label: '下一步怎么做？',
          value: B('/pick'),
          options: [
            { value: 'go', label: '直接应用', hint: '立即滚动更新全部 12 个节点', tone: 'warn' },
            { value: 'dry', label: '先做 dry-run', hint: '只输出变更，不改动集群' },
            { value: 'stop', label: '暂停排查', hint: '保留现场，稍后继续' },
          ],
        }),
        T('当前选择：${/pick}')),
    },
    {
      group: 'controls',
      title: 'Choice · multiple chips (bound)',
      state: { '/tags': ['gateway', 'worker'] },
      tree: () => h('Stack', { gap: 0.75 },
        h('Choice', {
          multiple: true,
          layout: 'chips',
          label: '要检查哪些组件',
          value: B('/tags'),
          options: ['gateway', 'controller', 'worker', 'queue', 'postgres', 'prometheus'].map((value) => ({ value, label: value })),
        }),
        T('已选：${/tags}')),
    },
    {
      group: 'controls',
      title: 'Choice · edge (long, many, unbound)',
      tree: () => h('Choice', {
        layout: 'list',
        options: [
          { value: 'a', label: '把 edge-node-3 上所有处于 CrashLoopBackOff 状态且重启次数超过 20 的 Pod 迁移到备用节点池，并在完成后重新平衡调度权重', hint: '影响范围较大，需要约 10 分钟，期间部分请求会重试', tone: 'serious' },
          { value: 'b', label: 'averyveryverylongunbrokenidentifier_that_never_wraps_on_its_own_0123456789_abcdefghijklmnopqrstuvwxyz', hint: 'overflow-wrap anywhere' },
          { value: 'c', label: '只读' },
          { value: 'd', label: '带提示', hint: 'ok tone', tone: 'ok' },
          { value: 'e', label: 'Err tone', tone: 'err' },
          ...Array.from({ length: 8 }, (_, i) => ({ value: `n${i}`, label: `选项 ${i + 6}`, hint: i % 2 ? '带一行说明' : undefined })),
        ],
      }),
    },
    {
      group: 'controls',
      title: 'Choice · narrow (auto)',
      span: 1,
      tree: () => h('Choice', { label: '策略', value: 'b', options: [{ value: 'a', label: '保守', hint: '串行，每批 1 个' }, { value: 'b', label: '均衡', hint: '每批 25%' }, { value: 'c', label: '激进', hint: '全部并行' }] }),
    },
    {
      group: 'controls',
      title: 'Choice · empty',
      span: 1,
      tree: () => h('Choice', { label: '没有选项', options: [] }),
    },
    {
      group: 'controls',
      title: 'Input · typical (bound, send)',
      state: { '/draft': '' },
      tree: () => h('Stack', { gap: 0.75 },
        { ...h('Input', { placeholder: '告诉智能体下一步做什么…', value: B('/draft') }), on: { submit: send } },
        T('草稿：${/draft}')),
    },
    {
      group: 'controls',
      title: 'Input · unbound (falls back to send)',
      tree: () => h('Input', { placeholder: '直接发送给智能体', submitLabel: '发给智能体' }),
    },
    {
      group: 'controls',
      title: 'Input · multiline (keeps text)',
      state: { '/note': '请先看看 kubelet 的日志，\n再决定是否调整探针超时。' },
      tree: () => h('Stack', { gap: 0.75 },
        { ...h('Input', { multiline: true, rows: 3, clearOnSubmit: false, placeholder: '补充说明（Shift+Enter 换行）', value: B('/note'), submitLabel: '提交' }), on: { submit: send } },
        T('${/note}')),
    },
    {
      group: 'controls',
      title: 'Input · narrow',
      span: 1,
      tree: () => h('Input', { placeholder: '一个很长很长很长很长很长很长的占位提示文字', submitLabel: '发送给当前会话中的智能体' }),
    },
    {
      group: 'controls',
      title: 'Toggle · typical (bound)',
      state: { '/auto': true, '/notify': false },
      tree: () => h('Stack', { gap: 0.5 },
        h('Toggle', { label: '自动批准只读命令', hint: 'Read、Grep、Glob 不再询问', value: B('/auto') }),
        h('Toggle', { label: '完成时通知我', value: B('/notify') }),
        T('自动批准 ${/auto} · 通知 ${/notify}')),
    },
    {
      group: 'controls',
      title: 'Toggle · edge and narrow',
      span: 1,
      tree: () => h('Stack', { gap: 0.5 },
        { ...h('Toggle', { label: '一个非常长的开关名称，说明它会控制什么行为以及在什么时候生效', hint: 'averyveryverylongunbrokenhintwithoutanyspaces_0123456789_abcdefghijklmnopqrstuvwxyz', value: true }), on: { change: { action: 'send', params: { text: '开关已切换' } } } },
        h('Toggle', { label: 'On' }),
        h('Toggle', { label: '' })),
    },
    {
      group: 'controls',
      title: 'Slider · typical (bound)',
      state: { '/par': 4, '/ratio': 0.35 },
      tree: () => h('Stack', { gap: 0.75 },
        h('Slider', { label: '并行度', min: 1, max: 16, step: 1, value: B('/par'), unit: ' 个' }),
        h('Slider', { label: '采样率', min: 0, max: 1, step: 0.05, value: B('/ratio') }),
        T('并行度 ${/par} · 采样率 ${/ratio}')),
    },
    {
      group: 'controls',
      title: 'Slider · edge (unbound, bad props)',
      span: 1,
      tree: () => h('Stack', { gap: 0.75 },
        { ...h('Slider', { label: '超时时间', min: 100, max: 5000, step: 100, value: 1500, unit: 'ms' }), on: { change: send } },
        h('Slider', { label: '范围颠倒', min: 10, max: 0, value: 'x' }),
        h('Slider', { label: '一个特别长特别长特别长特别长特别长特别长的滑块名称', min: -50, max: 50, value: -20, unit: '°C' }),
        h('Slider', { label: '无值', max: 3, step: 0 })),
    },
  )
})()
