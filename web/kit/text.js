/* text — rich and structured text: Markdown, Quote, Chips, LinkList, Image, Stats */
;(() => {
  const { el, watch, setTone, glyph, rem } = Lumen.kit
  const { h, samples, registry } = Lumen

  const str = (v) => (v == null ? '' : String(v))
  const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : [])
  const isObj = (v) => v != null && typeof v === 'object'
  const HTTP = /^https?:\/\//i
  const TONE = /^(ok|warn|serious|err|accent|muted|s[1-8])$/
  const toneOf = (t) => (TONE.test(t) ? t : null)
  const svgIcon = (d, ...more) => el('svg', { viewBox: '0 0 16 16', 'aria-hidden': true }, el('path', { d }), ...more)

  // ---------- Markdown: a GFM subset parsed into blocks, rendered with DOM nodes only ----------
  // Raw HTML is never interpreted: every character ends up in a text node. While the model streams, the parse is cheap
  // and idempotent: blocks whose source did not change keep their DOM node, so only the growing tail is rebuilt.
  const MD_MAX = 30000 // characters rendered
  const MD_DEPTH = 6 // nesting of lists and quotes
  const MD_ROWS = 300 // rows of one table

  const ASCII_PUNCT = /[!-\/:-@[-`{-~]/
  const CJK_PUNCT = /[\u2018-\u201f\u3000-\u303f\uff00-\uffef]/ // not "punctuation" for emphasis flanking, so **注意：**文字 still works
  const blank = (c) => c === '' || /\s/.test(c)
  const punct = (c) => c !== '' && !CJK_PUNCT.test(c) && /[\p{P}\p{S}]/u.test(c)

  const URL_RE = /https?:\/\/[^\s<>\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]+/iy
  const AUTO_RE = /<(https?:\/\/[^\s<>]+)>/iy
  const count = (s, c) => s.split(c).length - 1
  const trimUrl = (u) => {
    for (;;) {
      const t = u.replace(/[?!.,:;*_~'"]+$/, '')
      if (t !== u) u = t
      else if (u.endsWith(')') && count(u, '(') < count(u, ')')) u = u.slice(0, -1)
      else return u
    }
  }

  // The `(url "title")` after a link text, from just after the opening paren.
  const dest = (s, i) => {
    const skip = () => { while (s[i] === ' ' || s[i] === '\n') i++ }
    skip()
    let url = ''
    if (s[i] === '<') {
      const e = s.indexOf('>', i)
      if (e < 0) return null
      url = s.slice(i + 1, e)
      i = e + 1
    } else {
      for (let depth = 0; i < s.length && !/\s/.test(s[i]); i++) {
        const c = s[i]
        if (c === '\\' && ASCII_PUNCT.test(s[i + 1] ?? '')) { url += s[++i]; continue }
        if (c === '(') depth++
        else if (c === ')' && !depth--) break
        url += c
      }
    }
    skip()
    if (s[i] === '"' || s[i] === "'") {
      const e = s.indexOf(s[i], i + 1)
      if (e < 0) return null
      i = e + 1
      skip()
    }
    return s[i] === ')' ? { url, end: i + 1 } : null
  }

  const bracketEnd = (s, i) => {
    for (let depth = 0, j = i; j < s.length; j++) {
      if (s[j] === '\\') j++
      else if (s[j] === '[') depth++
      else if (s[j] === ']' && !--depth) return j
    }
    return -1
  }

  const flat = (x) => (x.k === 'd' ? x.ch.repeat(x.n) : x)
  const wrap = (ch, n, kids) => ({ k: ch === '~' ? 'del' : n > 1 ? 'strong' : 'em', kids })

  // CommonMark's delimiter-run algorithm: pairs openers with closers and nests the tokens between them.
  const emphasize = (t) => {
    for (let ci = 0; ci < t.length; ci++) {
      const c = t[ci]
      if (c.k !== 'd' || !c.c) continue
      let oi = ci - 1
      for (; oi >= 0; oi--) {
        const o = t[oi]
        if (o.k === 'd' && o.ch === c.ch && o.o && !((o.c || c.o) && (o.n + c.n) % 3 === 0 && (o.n % 3 || c.n % 3))) break
      }
      if (oi < 0) continue
      const o = t[oi], use = c.ch === '~' || (o.n > 1 && c.n > 1) ? 2 : 1
      o.n -= use
      c.n -= use
      t.splice(oi + 1, ci - oi - 1, wrap(c.ch, use, t.slice(oi + 1, ci).map(flat)))
      let at = oi + 2
      if (!o.n) { t.splice(oi, 1); at-- }
      if (!c.n) t.splice(at, 1)
      ci = at - 1 // a closer with delimiters left over looks for another opener
    }
  }

  // Inline text → a tree of strings and { k, … } nodes. `tail` marks text that may still be growing:
  // an unclosed **bold**, `code` or [link](… is shown as if it were closed, and a dangling marker is hidden.
  const inline = (s, o) => {
    const t = []
    let buf = '', i = 0, m, url
    const push = (x) => { if (buf) t.push(buf); buf = ''; t.push(x) }
    while (i < s.length) {
      const c = s[i]
      if (c === '\\' && ASCII_PUNCT.test(s[i + 1] ?? '')) { buf += s[i + 1]; i += 2 }
      else if (c === '\n' || (c === '\\' && s[i + 1] === '\n')) {
        buf = buf.replace(/ +$/, '')
        push({ k: 'br' })
        i += c === '\n' ? 1 : 2
        while (s[i] === ' ') i++
      } else if (c === '`') {
        let j = i
        while (s[j] === '`') j++
        const re = /`+/g
        re.lastIndex = j
        let end = -1
        while ((m = re.exec(s))) if (m[0].length === j - i) { end = m.index; break }
        const code = (a, b) => { const x = s.slice(a, b).replace(/\n/g, ' '); return /^ .*[^ ].* $/.test(x) ? x.slice(1, -1) : x }
        if (end >= 0) { push({ k: 'code', s: code(j, end) }); i = end + j - i }
        else if (o.tail) { if (j < s.length) push({ k: 'code', s: code(j, s.length) }); i = s.length }
        else { buf += s.slice(i, j); i = j }
      } else if (c === '<' && o.link && ((AUTO_RE.lastIndex = i), (m = AUTO_RE.exec(s)))) {
        push({ k: 'a', href: m[1], kids: [m[1]] })
        i += m[0].length
      } else if ((c === 'h' || c === 'H') && o.link && !/\w/.test(s[i - 1] ?? '') && ((URL_RE.lastIndex = i), (m = URL_RE.exec(s))) && (url = trimUrl(m[0])).length > 8) {
        push({ k: 'a', href: url, kids: [url] })
        i += url.length
      } else if ((c === '[' || (c === '!' && s[i + 1] === '[')) && o.link) {
        const img = c === '!', b = i + (img ? 1 : 0), e = bracketEnd(s, b)
        const d = e > 0 && s[e + 1] === '(' ? dest(s, e + 2) : null
        if (d) {
          push(img ? { k: 'img', alt: s.slice(b + 1, e) } : { k: 'a', href: d.url, kids: inline(s.slice(b + 1, e), { link: false }) })
          i = d.end
        } else if (o.tail && e > 0 && s[e + 1] === '(' && !s.includes(')', e)) {
          push({ k: 'a', kids: inline(s.slice(b + 1, e), { link: false }) }) // the address is still being written
          i = s.length
        } else { buf += c; i++ }
      } else if (c === '*' || c === '_' || c === '~') {
        let j = i
        while (s[j] === c) j++
        const n = j - i, prev = s[i - 1] ?? '', next = s[j] ?? ''
        if (c === '~' && n !== 2) { buf += s.slice(i, j); i = j; continue }
        const left = !blank(next) && (!punct(next) || blank(prev) || punct(prev))
        const right = !blank(prev) && (!punct(prev) || blank(next) || punct(next))
        push({ k: 'd', ch: c, n, o: c === '_' ? left && (!right || punct(prev)) : left, c: c === '_' ? right && (!left || punct(next)) : right })
        i = j
      } else { buf += c; i++ }
    }
    if (buf) t.push(buf)
    emphasize(t)
    if (o.tail) {
      const last = t[t.length - 1]
      if (last?.k === 'd' && !last.o && !last.c) t.pop()
      for (let k = t.length - 1; k >= 0; k--) {
        const d = t[k]
        if (d.k !== 'd' || !d.o || d.c) continue
        let kids = t.splice(k).slice(1).map(flat)
        for (let n = d.n; kids.length && n > 0; n -= d.ch === '~' || n > 1 ? 2 : 1) kids = [wrap(d.ch, n, kids)]
        t.push(...kids)
      }
    }
    return t.map(flat)
  }

  const TAGS = { em: 'em', strong: 'strong', del: 'del' }
  const nodes = (t) => t.map((x) => {
    if (typeof x === 'string') return x
    if (x.k === 'code') return el('code', {}, x.s)
    if (x.k === 'br') return el('br')
    if (x.k === 'img') return el('span', { class: 'img' }, x.alt || '图片')
    if (x.k === 'a') {
      const kids = x.kids.length ? nodes(x.kids) : str(x.href)
      return HTTP.test(x.href ?? '') ? el('a', { class: 'a', role: 'link', tabindex: 0, title: x.href, 'data-url': x.href }, kids) : el('span', { class: 'a', 'data-inert': true, title: x.href }, kids)
    }
    return el(TAGS[x.k], {}, nodes(x.kids))
  })

  const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
  const HEAD = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
  const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
  const QUOTE = /^ {0,3}>/
  const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?: +(.*))?$/
  const RULER = /^ *\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/
  const indent = (l) => l.length - l.trimStart().length
  const fenceOf = (l) => { const m = FENCE.exec(l); return m && !(m[1][0] === '`' && m[2].includes('`')) ? m : null }
  const interrupts = (l) => fenceOf(l) || HEAD.test(l) || HR.test(l) || QUOTE.test(l) || ITEM.test(l)

  const cells = (line) => {
    let s = line.trim()
    if (s.startsWith('|')) s = s.slice(1)
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
    const out = []
    let cur = ''
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++ }
      else if (s[i] === '|') { out.push(cur.trim()); cur = '' }
      else cur += s[i]
    }
    return [...out, cur.trim()]
  }
  const tableAt = (lines, i) => lines[i].includes('|') && lines[i + 1] != null && lines[i + 1].includes('|') && RULER.test(lines[i + 1]) && cells(lines[i]).length === cells(lines[i + 1]).length

  // Lines → blocks: { t: 'p' | 'h' | 'hr' | 'code' | 'q' | 'ul' | 'ol' | 'table', src, … }, where src is the block's own source.
  const blocks = (lines, depth) => {
    const out = []
    for (let i = 0; i < lines.length;) {
      const l = lines[i], start = i
      let m, b
      if (!l.trim()) { i++; continue }
      if ((m = fenceOf(l))) {
        const body = []
        for (i++; i < lines.length; i++) {
          const c = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i])
          if (c && c[1][0] === m[1][0] && c[1].length >= m[1].length) { i++; break }
          body.push(lines[i])
        }
        b = { t: 'code', lang: m[2].trim().split(/\s/)[0].replace(/^\{\.?|\}$/g, '').slice(0, 24), text: body.join('\n') }
      } else if ((m = HEAD.exec(l))) {
        i++
        if (!m[2]) continue
        b = { t: 'h', n: Math.min(m[1].length, 4), text: m[2] }
      } else if (HR.test(l)) {
        i++
        b = { t: 'hr' }
      } else if (tableAt(lines, i)) {
        const head = cells(l), align = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : ''))
        const rows = []
        for (i += 2; i < lines.length && lines[i].trim() && lines[i].includes('|') && !interrupts(lines[i]); i++) rows.push(cells(lines[i]).slice(0, head.length))
        b = { t: 'table', head, align, rows }
      } else if (QUOTE.test(l) && depth < MD_DEPTH) {
        const inner = []
        while (i < lines.length && (QUOTE.test(lines[i]) || (inner.at(-1)?.trim() && lines[i].trim() && !interrupts(lines[i])))) inner.push(lines[i++].replace(/^ {0,3}> ?/, ''))
        b = { t: 'q', kids: blocks(inner, depth + 1) }
      } else if ((m = ITEM.exec(l)) && depth < MD_DEPTH) {
        const ordered = /\d/.test(m[2]), mark = m[2].slice(-1), first = parseInt(m[2], 10)
        const items = []
        let loose = false
        for (;;) {
          let k = i
          while (k < lines.length && !lines[k].trim()) k++
          const it = k < lines.length && !HR.test(lines[k]) && ITEM.exec(lines[k])
          if (!it || ordered !== /\d/.test(it[2]) || it[2].slice(-1) !== mark) break
          if (k > i) loose = true
          // Content starts after the marker and its spaces; deeper-indented lines belong to the item.
          const ind = it[1].length, gap = it[3] == null ? 1 : lines[k].length - ind - it[2].length - it[3].length
          const w = ind + it[2].length + (gap > 4 ? 1 : gap)
          const body = [it[3] ?? '']
          for (i = k + 1; i < lines.length; i++) {
            const n = lines[i]
            if (!n.trim()) {
              let j = i + 1
              while (j < lines.length && !lines[j].trim()) j++
              if (j < lines.length && indent(lines[j]) >= w) { body.push(''); continue }
              break
            }
            const di = indent(n)
            if (di >= w) body.push(n.slice(w))
            else if (di > ind && ITEM.test(n) && !HR.test(n)) body.push(n.slice(di)) // a nested list indented less than CommonMark wants
            else if (body.at(-1).trim() && !interrupts(n)) body.push(n.trimStart())
            else break
          }
          const task = /^\[([ xX])\][ \t]+/.exec(body[0])
          if (task) body[0] = body[0].slice(task[0].length)
          items.push({ task: task ? task[1] !== ' ' : null, kids: blocks(body, depth + 1) })
        }
        b = { t: ordered ? 'ol' : 'ul', start: first, loose, items }
      } else {
        const body = [l.trimStart()]
        for (i++; i < lines.length && lines[i].trim() && !interrupts(lines[i]) && !tableAt(lines, i); i++) body.push(lines[i].trimStart())
        b = { t: 'p', text: body.join('\n') }
      }
      b.src = lines.slice(start, i).join('\n')
      out.push(b)
    }
    return out
  }

  const render = (b, tail) => {
    const run = (text) => nodes(inline(text, { link: true, tail }))
    const kids = (arr, last = tail) => arr.map((x, i) => render(x, last && i === arr.length - 1))
    switch (b.t) {
      case 'p': return el('p', {}, run(b.text))
      case 'h': return el(`h${b.n}`, {}, run(b.text))
      case 'hr': return el('hr')
      case 'more': return el('p', { class: 'more' }, b.text)
      case 'q': return el('blockquote', {}, kids(b.kids))
      case 'ul':
      case 'ol':
        return el(b.t, { 'data-loose': b.loose, start: b.t === 'ol' && b.start !== 1 ? b.start : null }, b.items.map((it, i) => {
          const body = kids(it.kids, tail && i === b.items.length - 1)
          if (it.task == null) return el('li', {}, body)
          return el('li', { 'data-task': it.task ? 'done' : 'todo' }, el('i', { class: 'box', role: 'img', 'aria-label': it.task ? '已完成' : '未完成' }), el('div', { class: 'c' }, body))
        }))
      case 'code':
        return el('div', { class: 'code' }, b.lang ? el('div', { class: 'lang' }, b.lang) : null, el('pre', { tabindex: 0 }, el('code', {}, b.text)))
      case 'table': {
        const rows = b.rows.slice(0, MD_ROWS)
        const cell = (tag) => (text, c) => el(tag, { 'data-align': b.align[c] || null }, run(text))
        return el('div', { class: 'table' }, el('table', {},
          el('thead', {}, el('tr', {}, b.head.map(cell('th')))),
          el('tbody', {}, rows.map((r) => el('tr', {}, b.head.map((_, c) => cell('td')(r[c] ?? '', c)))), b.rows.length > rows.length ? el('tr', { class: 'more' }, el('td', { colspan: b.head.length }, `… 另有 ${b.rows.length - rows.length} 行未显示`)) : null)))
      }
    }
  }

  registry.Markdown = (p, ctx) => {
    const root = el('div', { class: 'lm-md' })
    let last = null, prev = []

    const open = (e) => {
      const a = e.target.closest?.('a[data-url]')
      if (a) ctx.fire('open', { url: a.dataset.url })
    }
    root.addEventListener('click', open)
    root.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(e) })

    // Same code block, more text: update in place so its scroll position survives, and follow the end if the reader was there.
    const morph = (o, n) => {
      if (o?.b.t === 'code' && n.b.t === 'code' && o.b.lang === n.b.lang) {
        const pre = o.node.querySelector('pre'), end = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4
        pre.firstChild.textContent = n.b.text
        if (end) pre.scrollTop = pre.scrollHeight
        return o.node
      }
      if (o?.b.t === 'table' && n.b.t === 'table') {
        o.node.replaceChildren(...render(n.b, n.tail).childNodes)
        return o.node
      }
      return render(n.b, n.tail)
    }

    const comp = {
      el: root,
      update(p) {
        const text = str(p.text)
        if (text === last) return
        last = text
        const src = (text.length > MD_MAX ? text.slice(0, MD_MAX) : text).replace(/\r\n?/g, '\n').replace(/^[ \t]+/gm, (s) => s.replace(/\t/g, '    '))
        const bs = blocks(src.split('\n'), 0)
        if (text.length > MD_MAX) bs.push({ t: 'more', text: `… 内容过长，已省略 ${text.length - MD_MAX} 个字符`, src: '' })
        // The last block is "the tail": it may still be growing, so it parses leniently (see inline).
        const next = bs.map((b, i) => ({ b, tail: i === bs.length - 1, sig: `${i === bs.length - 1 ? '~' : '='}${b.t}\n${b.src}` }))
        let a = 0, z = 0
        while (a < prev.length && a < next.length && prev[a].sig === next[a].sig) { next[a].node = prev[a].node; a++ }
        while (z < prev.length - a && z < next.length - a && prev.at(-1 - z).sig === next.at(-1 - z).sig) { next.at(-1 - z).node = prev.at(-1 - z).node; z++ }
        for (let i = a; i < next.length - z; i++) next[i].node = morph(i < prev.length - z ? prev[i] : null, next[i])
        prev = next
        next.forEach((n, i) => { if (root.children[i] !== n.node) root.insertBefore(n.node, root.children[i] ?? null) })
        while (root.children.length > next.length) root.lastElementChild.remove()
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Quote: a pull quote, an echo of the request, a citation ----------
  registry.Quote = (p) => {
    const t = el('blockquote', { class: 't' }), cite = el('span', { class: 'src' })
    const foot = el('figcaption', {})
    const root = el('figure', { class: 'lm-quote' }, el('i', { class: 'mark', 'aria-hidden': true }), t, foot)
    const comp = {
      el: root,
      update(p) {
        const tone = toneOf(p.tone) ?? 'accent'
        setTone(root, tone)
        t.textContent = str(p.text)
        cite.textContent = str(p.source)
        const status = ['ok', 'warn', 'serious', 'err'].includes(tone)
        foot.replaceChildren(status ? glyph(tone) : '', cite)
        foot.hidden = !p.source && !status
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Chips: a wrapping tag list that folds the overflow into "+N" ----------
  registry.Chips = (p) => {
    const more = el('button', { class: 'chip more', type: 'button', 'aria-expanded': false })
    const root = el('div', { class: 'lm-chips' })
    let open = false, items = [], max = 12
    const draw = () => {
      const focused = document.activeElement === more
      const shown = open ? items : items.slice(0, max)
      const hidden = items.length - max
      root.replaceChildren(...shown.map((i) => {
        const tone = toneOf(i.tone)
        const c = el('span', { class: 'chip', title: i.hint || i.label }, tone ? glyph(tone) : '', el('span', {}, i.label))
        setTone(c, tone)
        return c
      }), hidden > 0 ? more : '')
      more.textContent = open ? '收起' : `+${hidden}`
      more.setAttribute('aria-expanded', open)
      more.setAttribute('aria-label', open ? '收起' : `展开其余 ${hidden} 项`)
      if (focused) more.focus()
    }
    more.addEventListener('click', () => { open = !open; draw() })
    const comp = {
      el: root,
      update(p) {
        items = list(p.items, 100).map((i) => (isObj(i) ? { label: str(i.label), tone: i.tone, hint: str(i.hint) } : { label: str(i) })).filter((i) => i.label)
        max = Number.isFinite(+p.max) && +p.max >= 1 ? Math.floor(+p.max) : 12
        draw()
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- LinkList: sources, files, issues; only http(s) rows can be opened ----------
  const KIND = {
    web: svgIcon('M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8ZM1.8 8h12.4M8 1.8c1.9 1.7 2.6 3.8 2.6 6.2S9.9 12.5 8 14.2M8 1.8C6.1 3.5 5.4 5.6 5.4 8S6.1 12.5 8 14.2'),
    file: svgIcon('M3.8 1.5h5.2L12.5 5v9.5h-8.7ZM9 1.5V5h3.5'),
    issue: svgIcon('M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8Z', el('circle', { cx: 8, cy: 8, r: 1.4, fill: 'currentColor', stroke: 'none' })),
    pr: svgIcon('M4.2 5.6v4.8M11.8 10.4V7.2A2.2 2.2 0 0 0 9.6 5H7.6M9.2 3.2 7.4 5l1.8 1.8', el('circle', { cx: 4.2, cy: 3.8, r: 1.6 }), el('circle', { cx: 4.2, cy: 12.2, r: 1.6 }), el('circle', { cx: 11.8, cy: 12.2, r: 1.6 })),
    doc: svgIcon('M3.5 1.5h9v13h-9ZM6 5h4M6 8h4M6 11h2.5'),
  }
  const GO = svgIcon('M4 12 12 4M6 4h6v6')
  GO.classList.add('go')
  const hostPath = (url) => {
    try {
      const u = new URL(url)
      const path = `${u.pathname === '/' ? '' : u.pathname}${u.search}${u.hash}`
      return [u.host.replace(/^www\./, ''), path]
    } catch {
      return [url, '']
    }
  }

  registry.LinkList = (p, ctx) => {
    const root = el('ul', { class: 'lm-links' })
    const go = (url) => { if (!ctx.fire('open', { url })) ctx.emit({ action: 'open_url', params: { url } }) }
    root.addEventListener('click', (e) => {
      const row = e.target.closest?.('a[data-url]')
      if (row) go(row.dataset.url)
    })
    root.addEventListener('keydown', (e) => {
      const row = e.target.closest?.('a[data-url]')
      if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(row.dataset.url) }
    })
    const comp = {
      el: root,
      update(p) {
        const all = Array.isArray(p.items) ? p.items : []
        const rows = list(all, 50).filter(isObj).map((i) => {
          const url = str(i.url).trim(), live = HTTP.test(url), kind = KIND[i.kind] ? i.kind : 'web'
          const [host, path] = live ? hostPath(url) : [url, '']
          const body = [
            KIND[kind].cloneNode(true),
            el('span', { class: 't' }, str(i.title) || host),
            el('span', { class: 'u' }, live ? [el('b', {}, host), path] : url),
            i.note ? el('span', { class: 'n' }, str(i.note)) : '',
            live ? GO.cloneNode(true) : '',
          ]
          return el('li', {}, live
            ? el('a', { class: 'row', role: 'link', tabindex: 0, 'data-kind': kind, 'data-url': url, title: url }, body)
            : el('div', { class: 'row', 'data-kind': kind, 'data-inert': true, title: url }, body))
        })
        root.replaceChildren(...rows, all.length > 50 ? el('li', { class: 'more' }, `… 另有 ${all.length - 50} 项未显示`) : '')
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Image: inline data:image only; anything else is a clear placeholder ----------
  const DATA_IMG = /^data:image\/[\w.+-]+[;,]/i
  registry.Image = (p) => {
    const img = el('img', { decoding: 'async', draggable: false })
    const ph = el('div', { class: 'ph', role: 'img' }, svgIcon('M2.5 3h11v10h-11ZM2.5 11l3.2-3.4 2.6 2.6 2-2 3.2 3.3M10.5 6.2h.01'), el('b', {}, '图片未加载'), el('span', {}))
    const frame = el('div', { class: 'frame' }, img, ph, el('i', { class: 'tk a' }), el('i', { class: 'tk b' }), el('i', { class: 'tk c' }))
    const cap = el('figcaption', {})
    const root = el('figure', { class: 'lm-img' }, frame, cap)
    let src = null
    const fail = (alt) => {
      frame.dataset.state = 'err'
      ph.querySelector('span').textContent = alt
      ph.setAttribute('aria-label', `图片未加载${alt ? `：${alt}` : ''}`)
    }
    img.addEventListener('load', () => { frame.dataset.state = 'ok' })
    img.addEventListener('error', () => fail(img.alt))
    const comp = {
      el: root,
      update(p) {
        root.dataset.fit = p.fit === 'cover' ? 'cover' : 'contain'
        img.alt = str(p.alt)
        cap.textContent = str(p.caption)
        cap.hidden = !p.caption
        const next = str(p.src).trim()
        if (next === src) return
        src = next
        if (DATA_IMG.test(next) && next.length < 8e6) {
          if (frame.dataset.state !== 'ok') frame.dataset.state = 'loading' // a picture already shown stays until its replacement has loaded
          img.src = next
        } else {
          img.removeAttribute('src')
          fail(str(p.alt))
        }
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Stats: a compact strip of vitals ----------
  registry.Stats = (p) => {
    const root = el('dl', { class: 'lm-stats' })
    let n = 0, width = 0, queued = false
    // Rows are filled evenly (6 items in a narrow panel become 3 + 3, never 5 + 1), and a column is never narrower than its widest value.
    const fit = () => {
      queued = false
      if (!width || !n) return
      root.dataset.measure = ''
      const natural = Math.max(...[...root.querySelectorAll('dd')].map((d) => d.offsetWidth))
      delete root.dataset.measure
      const g = 1.25 * rem(), most = Math.max(1, Math.floor((width + g) / (Math.min(Math.max(natural, 6 * rem()), 8 * rem()) + g)))
      root.style.setProperty('--cols', Math.ceil(n / Math.ceil(n / most)))
    }
    // Deferred: changing the columns resizes the observed node itself, which would trip the observer loop guard.
    const later = () => { if (!queued) { queued = true; requestAnimationFrame(fit) } }
    watch(root, (w) => { width = w; later() }, 'x')
    const comp = {
      el: root,
      update(p) {
        const items = list(p.items, 12).filter(isObj)
        n = items.length
        root.replaceChildren(...items.map((i) => {
          const v = typeof i.value === 'number' ? i.value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : str(i.value) || '—'
          const tone = toneOf(i.tone), status = ['ok', 'warn', 'serious', 'err'].includes(tone)
          const cell = el('div', { title: str(i.hint) || null, 'data-long': v.length > 9 || null },
            el('dt', {}, status ? glyph(tone) : '', el('span', {}, str(i.label))),
            el('dd', {}, v, i.unit ? el('small', {}, str(i.unit)) : ''),
            i.hint ? el('p', {}, str(i.hint)) : '')
          setTone(cell, tone)
          return cell
        }))
        later()
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Gallery ----------
  const MD_TYPICAL = `## 修复方案

重启的根因是 **GRE 隧道丢包** 触发了 kubelet 的探针超时，而不是 *OOM*。已确认 \`edge-node-3\` 上的 38 次重启全部落在丢包超过 5% 的窗口内，详见 [集群日志](https://grafana.example.com/d/pod-restarts)。

### 计划
1. 把 \`livenessProbe.timeoutSeconds\` 从 1 调到 5
2. 先 dry-run，确认不会影响其他节点
   - 检查 \`kubectl diff\` 输出
   - 观察 ~~旧的~~ 新的探针指标
3. 滚动更新并验证

- [x] 拉取集群指标
- [x] 关联 Pod 重启事件
- [ ] 验证根因

> 注意：调整前请确认 Prometheus 有至少 6 小时的数据。

\`\`\`yaml
livenessProbe:
  httpGet: { path: /healthz, port: 8080 }
  timeoutSeconds: 5
\`\`\`

| 节点 | 重启 | 状态 |
| :-- | --: | :-: |
| edge-node-3 | 38 | 异常 |
| edge-node-4 | 0 | 正常 |

---

完整分析见 https://example.com/report/2026-10-29。`

  const MD_EDGE = `# 一级标题：很长的中文标题用来检验换行行为是否合理
## 二级标题 Second level
### 三级标题 Third level
#### 四级标题 fourth level

这是一段很长的中文段落，用来检验换行、行高和字距是否舒适。这个排查过程持续了很久：先是怀疑内存泄漏，随后确认了网络抖动，最后发现是 **探针超时配置过于激进**，并且在 GRE 隧道丢包的窗口里被放大了很多倍。**注意：**这样的写法在中文里也应当正常加粗。

超长链接 https://example.com/a/very/long/path/that/never/ends/and/keeps/going/and/going/and/going/index.html?token=abcdefghijklmnopqrstuvwxyz0123456789&redirect=https%3A%2F%2Fexample.org%2Fx 以及 [一个很长很长的链接文字 with an english tail](https://example.com/x "标题")。

行内 HTML 不会被解析：<script>alert(1)</script> <b>粗体</b> <img src=x onerror=alert(1)>

\`\`\`
这是一行很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长的代码，应该在块内横向滚动而不是撑破面板
\`\`\`

| 文件 | 说明 | 路径 | 备注 |
| --- | --- | --- | --- |
| a.ts | 入口 | /Users/dev/projects/lumen/src/renderer/some/really/long/path/to/file.ts | 这一列很宽，表格应当在组件内横向滚动 |
| b.ts | 工具 | /tmp/x | ok |

- 一级 A
  - 二级 A1
    - 三级 A1a
      - 四级 A1a-i
  - 二级 A2
- 一级 B

**未闭合的加粗和 \`未闭合的代码`

  samples.push(
    { group: 'text', title: 'Markdown · typical', span: 2, rows: 2, tree: () => h('Markdown', { text: MD_TYPICAL }) },
    { group: 'text', title: 'Markdown · edge', span: 2, rows: 2, tree: () => h('Markdown', { text: MD_EDGE }) },
    {
      group: 'text', title: 'Markdown · links fire open', span: 1,
      tree: () => ({ ...h('Markdown', { text: '点击 [文档](https://example.com/docs) 或 [本地](file:///etc/passwd)，也可以点 https://example.org/a。只有 http(s) 会触发 open。' }), on: { open: { action: 'open_url' } } }),
    },
    { group: 'text', title: 'Markdown · narrow', span: 1, tree: () => h('Markdown', { text: '### 结果\n\n- **通过** 42\n- *跳过* 3\n- 失败 `test_probe_timeout`\n\n| 项 | 值 |\n| - | - |\n| 耗时 | 12.4s |\n| 命令 | `yarn test --runInBand --coverage` |\n\n```ts\nconst veryLongIdentifierName = computeSomethingExpensive(argumentNumberOne)\n```' }) },
    { group: 'text', title: 'Markdown · empty', span: 1, tree: () => h('Markdown', { text: '' }) },
  )

  const art = (w, hgt, body) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}">${body}</svg>`)}`
  const bars = Array.from({ length: 18 }, (_, i) => `<rect x="${40 + i * 30}" y="${210 - (30 + ((i * 37) % 90))}" width="18" height="${30 + ((i * 37) % 90)}" fill="${i > 13 ? '#e66767' : '#3987e5'}"/>`).join('')
  const shot = art(640, 400, `<rect width="640" height="400" fill="#0f1a2e"/><rect width="640" height="26" fill="#18283f"/><circle cx="14" cy="13" r="4" fill="#e66767"/><circle cx="28" cy="13" r="4" fill="#fab219"/><circle cx="42" cy="13" r="4" fill="#0ca30c"/><rect x="24" y="48" width="180" height="10" fill="#5fd4e8"/><rect x="24" y="68" width="320" height="6" fill="#33496b"/>${bars.replace(/y="(\d+)"/g, (_, y) => `y="${+y + 110}"`)}<rect x="24" y="352" width="260" height="6" fill="#33496b"/><rect x="24" y="368" width="180" height="6" fill="#33496b"/>`)
  const tall = art(180, 320, '<rect width="180" height="320" fill="#1d2440"/><rect x="14" y="14" width="152" height="40" fill="#2b3a66"/><rect x="14" y="68" width="152" height="150" fill="#33496b"/><circle cx="90" cy="143" r="38" fill="#5fd4e8"/><rect x="14" y="232" width="110" height="8" fill="#5b6c96"/><rect x="14" y="250" width="152" height="8" fill="#3c4a73"/><rect x="14" y="268" width="130" height="8" fill="#3c4a73"/>')
  const icon = art(72, 72, '<rect width="72" height="72" fill="#18283f"/><path d="M12 52 28 30l12 14 8-8 12 16Z" fill="#5fd4e8"/><circle cx="52" cy="20" r="6" fill="#fab219"/>')

  samples.push(
    { group: 'text', title: 'Quote · typical', span: 1, tree: () => h('Quote', { text: '帮我查一下为什么 edge-node-3 上的 Pod 一直在重启，先别改任何配置。', source: '你的请求 · 13:42' }) },
    {
      group: 'text', title: 'Quote · tones', span: 1,
      tree: () => h('Stack', { gap: 0.9 },
        h('Quote', { text: '全部 128 项测试通过。', source: '测试', tone: 'ok' }),
        h('Quote', { text: '磁盘使用率已达 91%，建议先清理 /raid 下的缓存。', source: 'df -h', tone: 'warn' }),
        h('Quote', { text: '构建在第 3 步失败：找不到模块 lumen-core。', source: 'CI #4821', tone: 'err' }),
        h('Quote', { text: '仅有一个结论，没有来源。', tone: 'muted' })),
    },
    { group: 'text', title: 'Quote · edge', span: 2, tree: () => h('Quote', { text: '这是一段很长的引用，用来检验换行与行高：先是怀疑内存泄漏，随后确认了网络抖动，最后发现是探针超时配置过于激进。https://example.com/a/very/long/path/that/never/ends/and/keeps/going/and/going/and/going/index.html?token=abcdefghijklmnopqrstuvwxyz0123456789', source: '一个同样很长很长很长很长很长很长很长很长很长的来源名称 /Users/dev/projects/lumen/src/renderer/core.ts:128', tone: 'serious' }) },
    { group: 'text', title: 'Quote · narrow', span: 1, tree: () => h('Quote', { text: '把重启的 Pod 数量降到 5 以下。', source: '目标' }) },

    {
      group: 'text', title: 'Chips · typical', span: 1,
      tree: () => h('Stack', { gap: 1 },
        h('Chips', { items: ['TypeScript', 'Electron', 'json-render', 'zod', '中文界面'] }),
        h('Chips', { items: [{ label: '通过 128', tone: 'ok' }, { label: '跳过 3', tone: 'muted' }, { label: '失败 2', tone: 'err', hint: 'test_probe_timeout, test_gre_flap' }, { label: '不稳定 1', tone: 'warn' }, { label: '焦点', tone: 'accent' }] })),
    },
    {
      group: 'text', title: 'Chips · edge', span: 2,
      tree: () => h('Stack', { gap: 1 },
        h('Chips', { items: Array.from({ length: 40 }, (_, i) => `src/modules/part-${i + 1}.ts`), max: 8 }),
        h('Chips', { items: ['一个非常非常长的标签用来检验省略号是否生效而不是撑破容器 https://example.com/a/very/long/path/that/never/ends/and/keeps/going', 'short'] }),
        h('Chips', { items: [] })),
    },
    { group: 'text', title: 'Chips · narrow', span: 1, tree: () => h('Chips', { items: ['alpha', 'beta', { label: '失败', tone: 'err' }, 'gamma', 'delta', 'epsilon'], max: 3 }) },

    {
      group: 'text', title: 'LinkList · typical', span: 1,
      tree: () => h('LinkList', {
        items: [
          { title: 'Kubernetes probe 配置文档', url: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/', note: '探针超时的默认值与取值范围', kind: 'doc' },
          { title: 'fix: raise liveness probe timeout', url: 'https://github.com/example/infra/pull/482', kind: 'pr', note: '等待 review' },
          { title: 'Pod 在丢包时批量重启', url: 'https://github.com/example/infra/issues/477', kind: 'issue' },
          { title: 'Grafana · Pod 重启趋势', url: 'https://grafana.example.com/d/pod-restarts?orgId=1&from=now-6h', kind: 'web' },
          { title: 'src/renderer/core.ts', url: 'src/renderer/core.ts', kind: 'file', note: '不是网页，只作为引用显示' },
        ],
      }),
    },
    {
      group: 'text', title: 'LinkList · edge', span: 2,
      tree: () => h('LinkList', {
        items: [
          { title: '一个非常非常长的标题用来检验换行行为是否合理，而不是把面板撑开或者被截断得看不见', url: 'https://example.com/a/very/long/path/that/never/ends/and/keeps/going/and/going/and/going/index.html?token=abcdefghijklmnopqrstuvwxyz0123456789&redirect=https%3A%2F%2Fexample.org%2Fx#section-12', note: '这是一条同样很长的备注，用来检验第二行文字在窄面板里的换行表现，以及与上方内容之间的间距。' },
          { title: 'javascript: 链接不可点击', url: 'javascript:alert(1)' },
          { title: '没有备注，只有标题', url: 'http://localhost:5173/' },
          { title: '', url: 'https://www.example.org/' },
          { title: '相对路径', url: '/etc/hosts', kind: 'file' },
        ],
      }),
    },
    { group: 'text', title: 'LinkList · narrow', span: 1, tree: () => h('LinkList', { items: [{ title: '修复探针超时', url: 'https://github.com/example/infra/pull/482', kind: 'pr', note: '等待 review' }, { title: 'README', url: 'https://example.com/README.md', kind: 'doc' }] }) },

    { group: 'text', title: 'Image · typical', span: 1, tree: () => h('Image', { src: shot, alt: '终端截图', caption: '重启次数在 13:40 之后明显升高（红色柱）' }) },
    {
      group: 'text', title: 'Image · variants', span: 1,
      tree: () => h('Stack', { gap: 1.2 },
        h('Image', { src: tall, alt: '竖图', caption: '竖图不超过固定最大高度' }),
        h('Image', { src: icon, alt: '小图' }),
        h('Image', { src: shot, alt: '裁切', fit: 'cover', caption: 'fit = cover' })),
    },
    {
      group: 'text', title: 'Image · edge', span: 2,
      tree: () => h('Stack', { gap: 1.2 },
        h('Image', { src: 'https://example.com/shot.png', alt: '外链图片', caption: '非 data: 地址不会加载' }),
        h('Image', { src: 'data:image/png;base64,AAAA', alt: '损坏的图片' }),
        h('Image', { src: '', caption: '没有 src' })),
    },
    { group: 'text', title: 'Image · narrow', span: 1, tree: () => h('Image', { src: shot, alt: '截图', caption: '窄面板里的图片按宽度缩放' }) },

    {
      group: 'text', title: 'Stats · typical', span: 2,
      tree: () => h('Stats', { items: [{ label: '已用时', value: '12m 30s' }, { label: '工具调用', value: 48 }, { label: '修改文件', value: 7, tone: 'accent' }, { label: '测试', value: '126 / 128', tone: 'warn', hint: '2 项失败' }] }),
    },
    {
      group: 'text', title: 'Stats · edge', span: 2,
      tree: () => h('Stats', { items: [
        { label: '上下文占用', value: 182340, unit: 'tokens' }, { label: '输入', value: 1284330 }, { label: '输出', value: 48120, unit: 'tok' }, { label: '花费', value: 3.4567, unit: 'USD', tone: 'ok' },
        { label: '一个很长很长的标签名称', value: 'edge-node-3', hint: '节点' }, { label: '失败', value: 2, tone: 'err' }, { label: '降级', value: 1, tone: 'serious' }, { label: '空值', value: '' },
      ] }),
    },
    { group: 'text', title: 'Stats · narrow', span: 1, tree: () => h('Stats', { items: [{ label: '已用时', value: '12m' }, { label: '工具调用', value: 48 }, { label: '修改文件', value: 7 }, { label: '错误', value: 2, tone: 'err' }, { label: '重试', value: 1 }, { label: '跳过', value: 0 }] }) },
  )
})()
