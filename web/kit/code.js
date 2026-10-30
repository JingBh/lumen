/* code — what a coding agent works on: Snippet, Diff, FileTree, Terminal, JsonTree */
;(() => {
  const { el, watch, clamp, rem } = Lumen.kit
  const { h, samples, registry } = Lumen

  const text = (v) => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '')
  const int = (v, lo, hi, fallback) => (typeof v === 'number' && Number.isFinite(v) ? clamp(Math.trunc(v), lo, hi) : fallback)
  const splitLines = (s) => (s === '' ? [] : s.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n'))
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s)
  const lookup = (map, key) => (Object.hasOwn(map, key) ? map[key] : undefined)
  const restoreFocus = (root, key) => {
    if (key) root.querySelector(`[data-p="${CSS.escape(key)}"]`)?.focus({ preventScroll: true })
  }
  const focused = (root) => (root.contains(document.activeElement) ? document.activeElement.dataset.p : undefined)

  const chevron = () => el('svg', { class: 'cv', viewBox: '0 0 10 10', 'aria-hidden': 'true' }, el('path', { d: 'M3 2 7 5 3 8' }))

  // ---------------------------------------------------------------------------------------------
  // Syntax highlighting: one hand-written sticky regex per language, a word classifier for identifiers.
  // Classes: kw keyword, st string, nm number or literal, fn call, ty type, at key or attribute, va variable, cm comment, pu punctuation.
  // ---------------------------------------------------------------------------------------------
  const set = (s) => new Set(s.split(' '))
  const rx = {
    block: /\/\*[\s\S]*?(?:\*\/|$)/,
    dq: /"(?:\\.|[^"\\\n])*"?/,
    sq: /'(?:\\.|[^'\\\n])*'?/,
    bt: /`(?:\\[\s\S]|[^`\\])*`?/,
    num: /0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?(?:[a-zA-Z%]\w*)?/,
    word: /[A-Za-z_$][\w$]*/,
    pu: /[{}()[\];,.:<>=+\-*/%&|!?^~@#\\]+/,
  }
  const slash = [['cm', /\/\/[^\n]*/], ['cm', rx.block]]
  const hash = ['cm', /(?<![^\s])#[^\n]*/]
  const base = [['nm', rx.num], ['$w', rx.word], ['$p', rx.pu]]

  const lang = (rules, word) => {
    const all = [...rules, [null, /\s+/], [null, /[\s\S]/]]
    return { re: new RegExp(all.map(([, r]) => `(${r.source})`).join('|'), 'y'), cls: all.map(([c]) => c), word }
  }
  // A call is a name followed by "(", checked before the PascalCase guess so that fmt.Println stays a call.
  const words = (kw, ty = '', lit = '', ci = false) => {
    const K = set(kw), T = set(ty), N = set(lit)
    return (t, src, end) => {
      const u = ci ? t.toUpperCase() : t
      return K.has(u) ? 'kw' : N.has(u) ? 'nm' : T.has(u) ? 'ty' : src[end] === '(' ? 'fn' : !ci && /^[A-Z][a-z]\w*$/.test(t) ? 'ty' : null
    }
  }

  const JS_KW = 'const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof in of delete void yield static this super with enum interface type implements public private protected readonly abstract declare namespace as keyof satisfies'
  const rustWord = words('fn let mut pub struct enum impl trait use mod crate self Self super match if else for while loop return break continue as in where move ref static const unsafe async await dyn type', 'i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool str char', 'true false')
  const GO_TY = 'string int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr float32 float64 complex64 complex128 bool byte rune error any'
  const SQL_KW = 'SELECT FROM WHERE JOIN LEFT RIGHT INNER OUTER FULL CROSS ON GROUP BY ORDER HAVING LIMIT OFFSET INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP INDEX VIEW PRIMARY KEY FOREIGN REFERENCES NOT AND OR IN IS LIKE ILIKE BETWEEN AS DISTINCT UNION ALL CASE WHEN THEN ELSE END WITH EXISTS ASC DESC DEFAULT UNIQUE CHECK CONSTRAINT RETURNING USING OVER PARTITION BEGIN COMMIT ROLLBACK ADD COLUMN IF'
  const SQL_TY = 'INT INTEGER BIGINT SMALLINT TEXT VARCHAR CHAR BOOLEAN BOOL TIMESTAMP TIMESTAMPTZ DATE TIME NUMERIC DECIMAL FLOAT DOUBLE REAL JSON JSONB UUID SERIAL BYTEA'

  // Shell: a word is a command at the start of a line or after a pipe, ";" or "&&"; NAME=value is a variable.
  const shWord = (() => {
    const K = set('if then else elif fi for in do done while until case esac function return exit export local readonly set unset source alias break continue shift trap eval exec')
    return (t, src, end, st) => {
      if (K.has(t)) return 'kw'
      const cmd = st.prev === undefined || st.prev === '\n' || /^[|;&($]+$/.test(st.prev) || /^(?:then|do|else|elif|if|while|until)$/.test(st.prev)
      return src[end] === '=' && cmd ? 'va' : cmd ? 'fn' : null
    }
  })()
  const cssWord = (t, src, end, st) => {
    let j = end
    while (src[j] === ' ') j++
    if (src[end] === '(') return 'fn'
    if (st.depth === 0) return 'ty'
    return src[j] === ':' && src[j + 1] !== ':' ? 'at' : null
  }

  const tagRe = /<[/!?]?[\w:.-]*/y, attrRe = /[^\s=/>"']+/y, quotedRe = /"[^"]*"?|'[^']*'?/y, bareRe = /[^\s>]+/y, closeRe = /\/?>/y, spaceRe = /\s+/y
  const scanHtml = (src) => {
    const out = []
    const eat = (re, at) => { re.lastIndex = at; return re.exec(src)?.[0] }
    let i = 0
    while (i < src.length) {
      let t
      if (src.startsWith('<!--', i)) {
        const e = src.indexOf('-->', i + 4)
        t = src.slice(i, e < 0 ? src.length : e + 3)
        out.push(['cm', t])
      } else if (src[i] === '<' && /[A-Za-z/!?]/.test(src[i + 1] ?? '') && (t = eat(tagRe, i))) {
        out.push(['kw', t])
        i += t.length
        for (let guard = 0; i < src.length && guard < 400; guard++) {
          if ((t = eat(spaceRe, i))) out.push([null, t])
          else if ((t = eat(closeRe, i))) { out.push(['pu', t]); i += t.length; break }
          else if ((t = eat(quotedRe, i))) out.push(['st', t])
          else if (src[i] === '=') { t = '='; out.push(['pu', t]) }
          else if ((t = eat(attrRe, i))) out.push([src[i - 1] === '=' ? 'st' : 'at', t])
          else { t = src[i]; out.push([null, t]) }
          i += t.length
        }
        continue
      } else if (src[i] === '&' && (t = /^&#?\w+;/.exec(src.slice(i, i + 12))?.[0])) out.push(['nm', t])
      else { t = /^[^<&]+|^[<&]/.exec(src.slice(i, i + 4000))[0]; out.push([null, t]) }
      i += t.length
    }
    return out
  }

  const LANGS = Object.assign(Object.create(null), {
    js: lang([...slash, ['st', rx.bt], ['st', rx.dq], ['st', rx.sq], ['fn', /@[A-Za-z_]\w*/], ...base], words(JS_KW, 'string number boolean any unknown never object symbol bigint', 'true false null undefined NaN Infinity')),
    py: lang([hash, ['st', /(?:[rRbBfFuU]{1,2})?(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$))/], ['st', /(?:[rRbBfFuU]{1,2})?(?:"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)/], ['fn', /@[A-Za-z_][\w.]*/], ...base],
      words('def class return if elif else for while in not and or is import from as with try except finally raise lambda pass break continue yield async await global nonlocal del assert self cls', 'int str float bool list dict set tuple bytes object type', 'True False None')),
    go: lang([...slash, ['st', rx.bt], ['st', rx.dq], ['st', rx.sq], ...base], words('func package import var const type struct interface map chan go defer return if else for range switch case default break continue select fallthrough goto', GO_TY, 'true false nil iota')),
    rust: lang([...slash, ['st', rx.dq], ['st', /'(?:\\u\{[\da-fA-F]+\}|\\.|[^'\\\n])'/], ['ty', /'[A-Za-z_]\w*/], ['at', /#!?\[[^\]\n]*\]/], ...base],
      (t, src, end, st) => (src[end] === '!' && src[end + 1] === '(' ? 'fn' : rustWord(t, src, end, st))),
    java: lang([...slash, ['st', /"""[\s\S]*?(?:"""|$)/], ['st', rx.dq], ['st', rx.sq], ['fn', /@[A-Za-z_]\w*/], ...base],
      words('public private protected class interface extends implements static final void new return if else for while do switch case break continue try catch finally throw throws import package this super instanceof abstract enum default synchronized volatile transient native', 'int long short byte char float double boolean var', 'true false null')),
    c: lang([...slash, ['kw', /(?<![^\n])[ \t]*#\s*\w+/], ['st', rx.dq], ['st', rx.sq], ...base],
      words('auto break case const continue default do else enum extern for goto if inline register return sizeof static struct switch typedef union volatile while class namespace template typename public private protected virtual override new delete this using try catch throw constexpr', 'int char float double void bool short long signed unsigned size_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t', 'true false NULL nullptr')),
    sh: lang([['cm', /(?<![^\s])#[^\n]*/], ['st', rx.dq], ['st', /'[^']*'?/], ['va', /\$\{[^}\n]*\}?|\$[A-Za-z_]\w*|\$[0-9@#?$!*-]/], ['at', /(?<![\w-])--?[A-Za-z][\w-]*/], ['nm', rx.num], ['$w', /[A-Za-z_./~][\w./~:+-]*/], ['$p', rx.pu]], shWord),
    json: lang([...slash, ['at', /"(?:\\.|[^"\\\n])*"(?=\s*:)/], ['st', rx.dq], ...base], words('', '', 'true false null')),
    yaml: lang([hash, ['at', /(?:"(?:\\.|[^"\\\n])*"|'[^'\n]*'|[\w.$@/-]+)(?=[ \t]*:(?:[ \t]|\n|$))/], ['st', rx.dq], ['st', /'[^'\n]*'?/], ['pu', /-(?=\s)|---|\.\.\./], ['ty', /[&*!][\w!./-]+/],
      ['nm', /[+-]?\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?(?=[ \t]*(?:\n|$|#|,|\]|\}))/], ['$w', /[\w.$@/%+~=-]+/], ['pu', /[:,[\]{}|>?]/]], (t) => (/^(?:true|false|null|yes|no|on|off|True|False|Null|~)$/.test(t) ? 'nm' : null)),
    toml: lang([hash, ['ty', /(?<![^\n])[ \t]*\[\[?[\w.\- "']+\]\]?/], ['at', /[\w."-]+(?=[ \t]*=)/], ['st', /"""[\s\S]*?(?:"""|$)/], ['st', rx.dq], ['st', /'[^'\n]*'?/], ...base], words('', '', 'true false')),
    sql: lang([['cm', /--[^\n]*/], ['cm', rx.block], ['st', /'(?:''|[^'])*'?/], ['at', /"[^"\n]*"?|`[^`\n]*`?/], ...base], words(SQL_KW, SQL_TY, 'TRUE FALSE NULL', true)),
    css: lang([['cm', rx.block], ['st', rx.dq], ['st', rx.sq], ['kw', /@[\w-]+/], ['nm', /#[\da-fA-F]{3,8}\b/], ['at', /--[\w-]+/], ['nm', rx.num], ['$w', /-?[A-Za-z_][\w-]*/], ['$p', rx.pu]], cssWord),
  })
  const ALIAS = Object.assign(Object.create(null), {
    javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', typescript: 'js', ts: 'js', tsx: 'js', python: 'py', python3: 'py', golang: 'go', rs: 'rust', kotlin: 'java',
    bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', jsonc: 'json', json5: 'json', yml: 'yaml', ini: 'toml', scss: 'css', less: 'css', htm: 'html', xml: 'html', svg: 'html', vue: 'html',
    patch: 'diff', cpp: 'c', 'c++': 'c', cc: 'c', h: 'c', hpp: 'c', postgres: 'sql', mysql: 'sql', pgsql: 'sql',
  })
  const langKey = (v) => {
    const k = text(v).trim().toLowerCase()
    return ALIAS[k] ?? k
  }

  const tokenize = (src, L) => {
    const out = [], st = { depth: 0, prev: undefined }
    const re = L.re
    re.lastIndex = 0
    while (re.lastIndex < src.length) {
      const m = re.exec(src)
      if (!m) break
      const t = m[0]
      let g = 1
      while (m[g] === undefined) g++
      let c = L.cls[g - 1]
      if (c === '$w') c = L.word(t, src, re.lastIndex, st)
      else if (c === '$p') {
        c = 'pu'
        for (const ch of t) if (ch === '{') st.depth++; else if (ch === '}') st.depth = Math.max(0, st.depth - 1)
      }
      if (/\S/.test(t)) st.prev = t; else if (t.includes('\n')) st.prev = '\n'
      const last = out.at(-1)
      if (last && last[0] === c) last[1] += t; else out.push([c, t])
    }
    return out
  }

  // Tokens may span lines (block comments, template strings): cut them into per-line token lists.
  const toLines = (tokens) => {
    const lines = [[]]
    for (const [c, t] of tokens) t.split('\n').forEach((part, i) => {
      if (i) lines.push([])
      if (part) lines.at(-1).push([c, part])
    })
    return lines
  }
  const spans = (line) => line.map(([c, t]) => (c ? el('span', { class: c }, t) : t))

  // diff-ish text is coloured by line, not by token.
  const diffKind = (s) => (/^(?:\+\+\+|---|diff |index |new file|deleted file|similarity|rename )/.test(s) ? 'dm' : s.startsWith('@@') ? 'dh' : s[0] === '+' ? 'da' : s[0] === '-' ? 'dd' : null)

  // ---------- Snippet ----------
  const SNIP_LINES = 400
  registry.Snippet = (p) => {
    const title = el('span', { class: 'ti' }), tag = el('span', { class: 'lg' })
    const head = el('div', { class: 'hd' }, title, tag)
    const code = el('div', { class: 'cd' })
    const scroll = el('div', { class: 'sc', tabindex: 0 }, code)
    const more = el('div', { class: 'mo' })
    const root = el('div', { class: 'lm-snip' }, head, scroll, more)
    const comp = {
      el: root,
      update(p) {
        const key = langKey(p.lang)
        const src = text(p.code).replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => clip(l, 600)).join('\n')
        const L = lookup(LANGS, key)
        const kinds = key === 'diff' ? src.split('\n').map(diffKind) : []
        const lines = key === 'diff' ? src.split('\n').map((l) => (l ? [[null, l]] : [])) : toLines(key === 'html' ? scanHtml(src) : L ? tokenize(src, L) : [[null, src]])
        const start = int(p.startLine, 0, 1e6, 1), shown = lines.slice(0, SNIP_LINES)
        const hl = new Set(Array.isArray(p.highlight) ? p.highlight : [])
        title.textContent = text(p.title)
        tag.textContent = text(p.lang).trim().slice(0, 16)
        head.hidden = !title.textContent && !tag.textContent
        root.style.setProperty('--dg', String(start + shown.length - 1).length)
        root.toggleAttribute('data-wrap', !!p.wrap)
        code.replaceChildren(...shown.map((l, i) => el('div', { class: 'l', 'data-hl': hl.has(start + i), 'data-k': kinds[i] }, el('span', { class: 'n' }, start + i), el('span', { class: 'c' }, spans(l)))))
        more.hidden = lines.length <= shown.length
        more.textContent = `… ${lines.length - shown.length} more lines`
      },
    }
    comp.update(p)
    return comp
  }

  // ---------------------------------------------------------------------------------------------
  // Diff: parse a unified diff, or diff two texts line by line (Myers), then fold long unchanged runs.
  // A row is { t: 'ctx' | 'add' | 'del', o?, n?, po, pn, text, mk? }: o and n are the displayed line numbers,
  // po and pn the old and new line counters at the row, mk the changed span of a replaced line.
  // ---------------------------------------------------------------------------------------------
  const CTX = 3, DIFF_BUDGET = 400, DIFF_FILES = 40

  // Myers' O(ND) edit script ('e' keep, 'd' delete, 'a' add); null when the files differ too much to be worth it.
  const myers = (A, B) => {
    const n = A.length, m = B.length, max = Math.min(n + m, 1500), off = max + 1
    const V = new Int32Array(2 * max + 3), trace = []
    for (let d = 0; d <= max; d++) {
      trace.push(V.slice(off - d - 1, off + d + 2))
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && V[off + k - 1] < V[off + k + 1]) ? V[off + k + 1] : V[off + k - 1] + 1
        let y = x - k
        while (x < n && y < m && A[x] === B[y]) { x++; y++ }
        V[off + k] = x
        if (x >= n && y >= m) {
          const ops = []
          for (let i = d; i >= 0; i--) {
            const v = trace[i], at = (j) => v[j + i + 1], kk = x - y
            const pk = kk === -i || (kk !== i && at(kk - 1) < at(kk + 1)) ? kk + 1 : kk - 1
            const px = at(pk), py = px - pk
            while (x > px && y > py) { ops.push('e'); x--; y-- }
            if (i > 0) ops.push(x === px ? 'a' : 'd')
            x = px; y = py
          }
          return ops.reverse()
        }
      }
    }
    return null
  }

  const diffRows = (a, b) => {
    let s = 0
    while (s < a.length && s < b.length && a[s] === b[s]) s++
    let ea = a.length, eb = b.length
    while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb-- }
    const ops = myers(a.slice(s, ea), b.slice(s, eb)) ?? [...Array(ea - s).fill('d'), ...Array(eb - s).fill('a')]
    const rows = []
    let i = 0, j = 0
    const put = (t, text) => {
      rows.push({ t, po: i + 1, pn: j + 1, o: t === 'add' ? undefined : i + 1, n: t === 'del' ? undefined : j + 1, text })
      if (t !== 'add') i++
      if (t !== 'del') j++
    }
    for (; i < s;) put('ctx', a[i])
    for (const op of ops) op === 'e' ? put('ctx', a[i]) : op === 'd' ? put('del', a[i]) : put('add', b[j])
    while (i < a.length) put('ctx', a[i])
    return rows
  }

  // Intra-line change: the middle of a replaced line, when enough of the line is shared for the highlight to mean something.
  const intra = (x, y) => {
    const a = x.text, b = y.text
    let p = 0
    while (p < a.length && p < b.length && a[p] === b[p]) p++
    let s = 0
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
    if ((p + s) * 2 < Math.max(a.length, b.length) || (p + s >= a.length && p + s >= b.length)) return
    if (a.length - s > p) x.mk = [p, a.length - s]
    if (b.length - s > p) y.mk = [p, b.length - s]
  }
  const mark = (rows) => {
    for (let i = 0; i < rows.length;) {
      let j = i, k
      while (j < rows.length && rows[j].t === 'del') j++
      k = j
      while (k < rows.length && rows[k].t === 'add') k++
      for (let q = 0; q < Math.min(j - i, k - j); q++) intra(rows[i + q], rows[j + q])
      i = Math.max(k, i + 1)
    }
  }

  // Cut a run of rows into hunks of changes with CTX lines around them; a longer unchanged run becomes a gap between hunks.
  const hunkify = (rows, title = '') => {
    if (!rows.some((r) => r.t !== 'ctx')) return []
    const out = []
    let cur = null
    for (let i = 0; i < rows.length;) {
      if (rows[i].t !== 'ctx') { (cur ??= []).push(rows[i++]); continue }
      let j = i
      while (j < rows.length && rows[j].t === 'ctx') j++
      const run = rows.slice(i, j)
      if (!cur) cur = run.slice(-CTX)
      else if (j === rows.length) { cur.push(...run.slice(0, CTX)); out.push(cur); cur = null }
      else if (run.length > 2 * CTX + 1) { cur.push(...run.slice(0, CTX)); out.push(cur); cur = run.slice(-CTX) }
      else cur.push(...run)
      i = j
    }
    if (cur) out.push(cur)
    return out.map((r, i) => {
      mark(r)
      const oc = r.filter((x) => x.t !== 'add').length, nc = r.length - r.filter((x) => x.t === 'del').length
      return { rows: r, title: i ? '' : title, o1: r[0].po, n1: r[0].pn, oc, nc }
    })
  }
  const range = (s, c) => (c === 1 ? `${s}` : c === 0 ? `${s - 1},0` : `${s},${c}`)
  const hunkHead = (k) => `@@ -${range(k.o1, k.oc)} +${range(k.n1, k.nc)} @@${k.title ? ` ${k.title}` : ''}`

  const stripPath = (s) => s.replace(/\t.*$/, '').replace(/^"(.*)"$/, '$1').replace(/^[ab]\//, '')
  const parsePatch = (src) => {
    const L = src.replace(/\r\n?/g, '\n').split('\n')
    while (L.length && L.at(-1) === '') L.pop()
    const files = []
    let f = null, hk = null, o = 1, n = 1, ro = 0, rn = 0
    const begin = () => files.push((f = { path: '', old: '', status: 'modified', raw: [], binary: false }))
    for (let i = 0; i < L.length; i++) {
      const s = L[i]
      let m
      if (s.startsWith('diff ')) {
        begin()
        hk = null
        f.path = (/ b\/(.+)$/.exec(s) ?? /(\S+)$/.exec(s))?.[1] ?? ''
      } else if (s.startsWith('--- ') && L[i + 1]?.startsWith('+++ ') && (L[i + 2]?.startsWith('@@') || !(hk && (ro > 0 || rn > 0)))) {
        if (!f || f.raw.length || f.seen) begin()
        const from = stripPath(s.slice(4)), to = stripPath(L[++i].slice(4))
        f.seen = true
        f.old = from
        f.path = to === '/dev/null' ? from : to
        if (from === '/dev/null') f.status = 'added'; else if (to === '/dev/null') f.status = 'deleted'
        hk = null
      } else if ((m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(s))) {
        if (!f) begin()
        f.raw.push((hk = { rows: [], title: m[5] }))
        o = +m[1] + (m[2] === '0' ? 1 : 0); n = +m[3] + (m[4] === '0' ? 1 : 0); ro = m[2] === undefined ? 1 : +m[2]; rn = m[4] === undefined ? 1 : +m[4]
      } else if (hk && (s === '' || ' +-'.includes(s[0]))) {
        const c = s[0] ?? ' ', body = s.slice(1)
        if (c === '+') { hk.rows.push({ t: 'add', n, po: o, pn: n, text: body }); n++; rn-- }
        else if (c === '-') { hk.rows.push({ t: 'del', o, po: o, pn: n, text: body }); o++; ro-- }
        else { hk.rows.push({ t: 'ctx', o, n, po: o, pn: n, text: body }); o++; n++; ro--; rn-- }
      } else if (!hk && ' +-'.includes(s[0] ?? 'x') && s[0]) {
        // bare +/- lines without any header
        if (!f) begin()
        f.raw.push((hk = { rows: [], title: '' }))
        o = n = 1; ro = rn = 1e9
        i--
      } else if (f) {
        if (s.startsWith('new file mode')) f.status = 'added'
        else if (s.startsWith('deleted file mode')) f.status = 'deleted'
        else if (s.startsWith('rename from ')) { f.old = s.slice(12); f.status = 'renamed' }
        else if (s.startsWith('rename to ')) { f.path = s.slice(10); f.status = 'renamed' }
        else if (/^(?:Binary files|GIT binary patch)/.test(s)) f.binary = true
      }
    }
    return files.map((x) => finish(x, x.raw.flatMap((k) => k.rows.length ? [k] : []), null))
  }

  const finish = (f, raw, total) => {
    const rows = raw.flatMap((k) => k.rows)
    return {
      path: f.path,
      old: f.status === 'renamed' ? f.old : '',
      status: f.status,
      binary: f.binary,
      add: rows.filter((r) => r.t === 'add').length,
      del: rows.filter((r) => r.t === 'del').length,
      hunks: raw.flatMap((k) => hunkify(k.rows, k.title)),
      total,
    }
  }

  const fromTexts = (path, before, after) => {
    const a = splitLines(before).slice(0, 20000), b = splitLines(after).slice(0, 20000)
    const status = !a.length && b.length ? 'added' : a.length && !b.length ? 'deleted' : 'modified'
    return finish({ path, old: '', status, binary: false }, [{ rows: diffRows(a, b), title: '' }], a.length)
  }

  const diffModel = (p) => {
    const patch = text(p.patch), path = text(p.path)
    if (patch.trim()) {
      const files = parsePatch(patch)
      if (files.length === 1 && !files[0].path) files[0].path = path
      return files
    }
    if (typeof p.before === 'string' || typeof p.after === 'string') return [fromTexts(path, text(p.before), text(p.after))]
    return []
  }

  const STATUS = { added: ['A', 'ok'], modified: ['M', 'warn'], deleted: ['D', 'err'], renamed: ['R', 'accent'], untouched: ['·', 'muted'] }
  const chip = (status) => {
    const s = lookup(STATUS, status)
    return s ? el('span', { class: 'st', 'data-tone': s[1], title: status }, s[0]) : null
  }
  const counts = (add, del) => [add ? el('span', { class: 'ad' }, `+${add}`) : null, del ? el('span', { class: 'dl' }, `−${del}`) : null]
  const pathNode = (path) => {
    const i = path.lastIndexOf('/')
    return el('span', { class: 'pt', title: path }, i < 0 ? '' : el('span', { class: 'dir' }, path.slice(0, i + 1)), path.slice(i + 1))
  }

  const cellText = (r) => (r.mk ? [r.text.slice(0, r.mk[0]), el('mark', {}, r.text.slice(r.mk[0], r.mk[1])), r.text.slice(r.mk[1])] : r.text)
  const SIGN = { ctx: '', add: '+', del: '−' }

  registry.Diff = (p) => {
    const body = el('div', { class: 'bd' })
    const root = el('div', { class: 'lm-diff', tabindex: 0 }, body)
    const closed = new Set()
    let files = [], split = false

    const unified = (r) => el('div', { class: `r ${r.t}` }, el('span', { class: 'o' }, r.o), el('span', { class: 'n' }, r.n), el('span', { class: 'm' }, SIGN[r.t]), el('span', { class: 'c' }, cellText(r)))
    const side = (r, k) => el('div', { class: 'sd', 'data-t': r ? r.t : 'nil' }, el('span', { class: 'n' }, r ? (k ? r.n : r.o) : ''), el('span', { class: 'm' }, r ? SIGN[r.t] : ''), el('span', { class: 'c' }, r ? cellText(r) : ''))
    const pairs = (rows) => {
      const out = []
      for (let i = 0; i < rows.length;) {
        if (rows[i].t === 'ctx') { out.push([rows[i], rows[i]]); i++; continue }
        const dels = [], adds = []
        while (i < rows.length && rows[i].t === 'del') dels.push(rows[i++])
        while (i < rows.length && rows[i].t === 'add') adds.push(rows[i++])
        for (let q = 0; q < Math.max(dels.length, adds.length); q++) out.push([dels[q], adds[q]])
      }
      return out
    }
    const rowsOf = (rows) => (split ? pairs(rows).map(([l, r]) => el('div', { class: 'r s' }, side(l, 0), side(r, 1))) : rows.map(unified))

    const render = () => {
      const focus = focused(root)
      let left = DIFF_BUDGET, add = 0, del = 0, avail = 0
      for (const f of files) { add += f.add; del += f.del }
      const nodes = []
      if (files.length > 1) nodes.push(el('div', { class: 'sm' }, `${files.length} files`, el('span', {}, counts(add, del))))
      files.slice(0, DIFF_FILES).forEach((f, fi) => {
        const key = f.path || `#${fi}`, shut = closed.has(key)
        const digits = String(Math.max(1, ...f.hunks.map((k) => Math.max(k.o1 + k.oc, k.n1 + k.nc)))).length
        const head = el('button', { class: 'fh', type: 'button', 'aria-expanded': String(!shut), 'data-p': key },
          chevron(), chip(f.status), f.path ? pathNode(f.path) : el('span', { class: 'pt' }), f.old ? el('span', { class: 'rn', title: f.old }, `← ${f.old}`) : null,
          el('span', { class: 'cn' }, counts(f.add, f.del)))
        const out = [head]
        if (!shut) avail += f.add + f.del
        if (!shut) {
          let prevEnd = 1
          if (f.binary) out.push(el('div', { class: 'nt' }, 'Binary file changed'))
          else if (!f.hunks.length) out.push(el('div', { class: 'nt' }, f.status === 'renamed' ? 'Renamed without changes' : 'No changes'))
          for (const k of f.hunks) {
            if (left <= 0) break
            const gap = k.o1 - prevEnd
            prevEnd = k.o1 + k.oc
            let rows = k.rows, cut = 0
            for (const [i, r] of k.rows.entries()) {
              if (r.t !== 'ctx' && --left < 0) { cut = i; break }
            }
            if (left < 0) { rows = k.rows.slice(0, cut); left = 0 }
            out.push(el('div', { class: 'hk' }, gap > 0 ? el('span', { class: 'gp' }, `… ${gap} unchanged lines`) : null, el('span', { class: 'rg' }, hunkHead(k))), ...rowsOf(rows))
          }
          const last = f.hunks.at(-1)
          if (f.total != null && last && left > 0 && f.total + 1 - (last.o1 + last.oc) > 0) out.push(el('div', { class: 'hk' }, el('span', { class: 'gp' }, `… ${f.total + 1 - (last.o1 + last.oc)} unchanged lines`)))
        }
        nodes.push(el('section', { class: 'fl', style: `--dg: ${digits}` }, out))
      })
      const omitted = avail - (DIFF_BUDGET - left)
      if (!files.length) nodes.push(el('div', { class: 'nt' }, 'No changes'))
      if (omitted > 0) nodes.push(el('div', { class: 'nt' }, `… ${omitted} more changed lines not shown`))
      if (files.length > DIFF_FILES) nodes.push(el('div', { class: 'nt' }, `… ${files.length - DIFF_FILES} more files not shown`))
      body.replaceChildren(...nodes)
      restoreFocus(root, focus)
    }

    body.addEventListener('click', (e) => {
      const b = e.target.closest('.fh')
      if (!b) return
      const key = b.dataset.p
      closed.has(key) ? closed.delete(key) : closed.add(key)
      render()
    })
    // re-laying out inside the observer callback would trip the loop guard, so the switch waits for the next frame
    watch(root, (w) => {
      const next = w >= 44 * rem()
      if (next !== split) requestAnimationFrame(() => { split = next; root.dataset.mode = split ? 'split' : 'unified'; render() })
    }, 'x')

    const comp = {
      el: root,
      update(p) {
        files = diffModel(p)
        render()
      },
    }
    root.dataset.mode = 'unified'
    comp.update(p)
    return comp
  }

  // ---------------------------------------------------------------------------------------------
  // FileTree: flat paths become folders (single-child chains merged), folders fold and keep their state.
  // ---------------------------------------------------------------------------------------------
  const TREE_ITEMS = 300
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })

  const buildTree = (items) => {
    const top = { name: '', path: '', dirs: new Map(), files: [] }
    for (const it of items) {
      const parts = it.path.split('/')
      let dir = top
      for (const seg of parts.slice(0, -1)) {
        const path = dir.path ? `${dir.path}/${seg}` : seg
        if (!dir.dirs.has(seg)) dir.dirs.set(seg, { name: seg, path, dirs: new Map(), files: [] })
        dir = dir.dirs.get(seg)
      }
      dir.files.push({ name: parts.at(-1), item: it })
    }
    // sums for folders, then merge a folder whose only child is a folder
    const sum = (d) => {
      d.kids = [...d.dirs.values()].map(sum).sort(byName)
      d.files.sort(byName)
      d.add = d.kids.reduce((s, k) => s + k.add, 0) + d.files.reduce((s, f) => s + f.item.add, 0)
      d.del = d.kids.reduce((s, k) => s + k.del, 0) + d.files.reduce((s, f) => s + f.item.del, 0)
      d.count = d.kids.reduce((s, k) => s + k.count, 0) + d.files.length
      while (d.name && !d.files.length && d.kids.length === 1) {
        const k = d.kids[0]
        Object.assign(d, { name: `${d.name}/${k.name}`, path: k.path, kids: k.kids, files: k.files })
      }
      return d
    }
    return sum(top)
  }

  const cleanItems = (v) => {
    const seen = new Set(), out = []
    for (const it of Array.isArray(v) ? v.slice(0, 2000) : []) {
      const path = text(it?.path).replace(/\\/g, '/').replace(/^(?:\.\/)+|^\/+|\/+$/g, '')
      if (!path || seen.has(path)) continue
      seen.add(path)
      out.push({ path, status: lookup(STATUS, it.status) ? it.status : undefined, note: text(it.note), add: int(it.additions, 0, 1e9, 0), del: int(it.deletions, 0, 1e9, 0) })
    }
    return out
  }

  registry.FileTree = (p) => {
    const sum = el('div', { class: 'sm' }), list = el('div', { class: 'ls', role: 'tree' }), more = el('div', { class: 'mo' })
    const root = el('div', { class: 'lm-ftree' }, sum, list, more)
    const open = new Map()
    let cur = p

    const render = () => {
      const focus = focused(root)
      const all = cleanItems(cur.items), items = all.slice(0, TREE_ITEMS)
      const tree = buildTree(items), shut = !!cur.collapse
      const anyStatus = items.some((i) => i.status)
      const rows = []
      const draw = (d, depth) => {
        const isOpen = open.get(d.path) ?? !shut
        if (d.name) {
          rows.push(el('button', { class: 'row dir', type: 'button', role: 'treeitem', 'aria-expanded': String(isOpen), 'data-p': d.path, style: `--d: ${depth}`, title: d.path },
            chevron(), anyStatus ? el('span', { class: 'st' }) : null,
            el('span', { class: 'tx' }, el('span', { class: 'nm' }, `${d.name}/`), isOpen ? null : el('span', { class: 'nt' }, `${d.count}`)),
            el('span', { class: 'cn' }, counts(d.add, d.del))))
          if (!isOpen) return
        }
        const dd = d.name ? depth + 1 : depth
        for (const k of d.kids) draw(k, dd)
        for (const { name, item } of d.files) {
          rows.push(el('div', { class: 'row file', role: 'treeitem', style: `--d: ${dd}`, 'data-s': item.status, title: item.path },
            el('i', { class: 'sp' }), anyStatus ? chip(item.status) ?? el('span', { class: 'st' }) : null,
            el('span', { class: 'tx' }, el('span', { class: 'nm' }, name), item.note ? el('span', { class: 'nt', title: item.note }, item.note) : null),
            el('span', { class: 'cn' }, counts(item.add, item.del))))
        }
      }
      draw(tree, 0)

      const tally = Object.keys(STATUS).slice(0, 4).map((s) => [s, items.filter((i) => i.status === s).length]).filter(([, n]) => n)
      const add = items.reduce((s, i) => s + i.add, 0), del = items.reduce((s, i) => s + i.del, 0)
      sum.replaceChildren(`${all.length} ${all.length === 1 ? 'file' : 'files'}`, ...tally.map(([s, n]) => el('span', { class: 'tl', 'data-tone': STATUS[s][1], title: s }, `${STATUS[s][0]} ${n}`)), el('span', { class: 'cn' }, counts(add, del)))
      sum.hidden = !all.length
      list.replaceChildren(...rows)
      more.hidden = all.length <= items.length
      more.textContent = `… ${all.length - items.length} more files not shown`
      if (!all.length) list.replaceChildren(el('div', { class: 'nt empty' }, 'No files'))
      restoreFocus(root, focus)
    }

    list.addEventListener('click', (e) => {
      const b = e.target.closest('.dir')
      if (!b) return
      open.set(b.dataset.p, b.getAttribute('aria-expanded') !== 'true')
      render()
    })

    const comp = { el: root, update(p) { cur = p; render() } }
    comp.update(p)
    return comp
  }

  // ---------------------------------------------------------------------------------------------
  // Terminal: a command card. Output keeps basic ANSI colours, drops every other escape, and shows the tail.
  // ---------------------------------------------------------------------------------------------
  const ESC = /\x1b\[([\d;:]*)m|\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-_]|[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g
  const sgr = (st, params) => {
    const ps = params === '' ? [0] : params.split(/[;:]/).map(Number)
    for (let i = 0; i < ps.length; i++) {
      const n = ps[i]
      if (n === 0) Object.assign(st, { fg: -1, bg: -1, b: false, d: false, u: false, v: false })
      else if (n === 1) st.b = true
      else if (n === 2) st.d = true
      else if (n === 4) st.u = true
      else if (n === 7) st.v = true
      else if (n === 22) st.b = st.d = false
      else if (n === 24) st.u = false
      else if (n === 27) st.v = false
      else if (n >= 30 && n <= 37) st.fg = n - 30
      else if (n === 39) st.fg = -1
      else if (n >= 40 && n <= 47) st.bg = n - 40
      else if (n === 49) st.bg = -1
      else if (n >= 90 && n <= 97) st.fg = n - 82
      else if (n >= 100 && n <= 107) st.bg = n - 92
      else if (n === 38 || n === 48) {
        // 256-colour and truecolour: only the first 16 map onto the theme; the rest is skipped
        const c = ps[i + 1] === 5 ? ps[i + 2] : -1
        if (c >= 0 && c < 16) st[n === 38 ? 'fg' : 'bg'] = c
        i += ps[i + 1] === 5 ? 2 : ps[i + 1] === 2 ? 4 : 0
      }
    }
  }
  const sgrClass = (st) => [st.fg >= 0 && `f${st.fg}`, st.bg >= 0 && `g${st.bg}`, st.b && 'b', st.d && 'd', st.u && 'u', st.v && 'v'].filter(Boolean).join(' ')

  // One line of output into nodes; `st` carries the style across lines.
  const ansiLine = (line, st) => {
    const out = []
    let last = 0
    const flush = (to) => {
      if (to <= last) return
      const c = sgrClass(st), t = line.slice(last, to)
      out.push(c ? el('span', { class: c }, t) : t)
    }
    for (const m of line.matchAll(ESC)) {
      flush(m.index)
      last = m.index + m[0].length
      if (m[1] !== undefined) sgr(st, m[1])
    }
    flush(line.length)
    return out
  }

  const fmtDur = (ms) => {
    if (ms < 1000) return `${Math.round(ms)}ms`
    const s = ms / 1000
    if (s < 60) return `${+s.toFixed(s < 10 ? 1 : 0)}s`
    const m = Math.floor(s / 60)
    return m < 60 ? `${m}m ${Math.round(s % 60)}s` : `${Math.floor(m / 60)}h ${m % 60}m`
  }

  const TERM_LINES = 30
  registry.Terminal = (p) => {
    const cwd = el('div', { class: 'cw' }), cmd = el('span', { class: 'cm' }), meta = el('div', { class: 'mt' })
    const out = el('div', { class: 'out', tabindex: 0 })
    const root = el('div', { class: 'lm-term' }, el('div', { class: 'hd' }, cwd, el('div', { class: 'ln' }, el('div', { class: 'pr' }, el('span', { class: 'ps' }, '$'), ' ', cmd), meta)), out)
    let fresh = true
    const comp = {
      el: root,
      update(p) {
        const running = !!p.running, code = typeof p.exitCode === 'number' && Number.isFinite(p.exitCode) ? Math.trunc(p.exitCode) : null
        const state = running ? 'running' : code === null ? 'idle' : code === 0 ? 'ok' : 'err'
        root.dataset.s = state
        cwd.textContent = text(p.cwd)
        cwd.title = cwd.textContent
        cwd.hidden = !cwd.textContent
        cmd.textContent = text(p.command)

        const dur = typeof p.durationMs === 'number' && p.durationMs >= 0 ? el('span', { class: 'du' }, fmtDur(p.durationMs)) : null
        const badge = running ? registry.Badge({ text: 'running', tone: 'accent' }).el : code !== null ? registry.Badge({ text: `exit ${code}`, tone: code === 0 ? 'ok' : 'err' }).el : null
        if (badge) badge.classList.add('xb')
        meta.replaceChildren(...[badge, dur].filter(Boolean))

        const max = int(p.maxLines, 1, 200, TERM_LINES)
        // a bare \r rewrites the line (progress bars): only the last segment survives
        const raw = text(p.output).replace(/\r\n/g, '\n').replace(/\n$/, ''), endsLine = running && /\n$/.test(text(p.output))
        const all = (raw === '' ? [] : raw.split('\n')).map((l) => (l.includes('\r') ? l.split('\r').filter(Boolean).pop() ?? '' : l))
        const hidden = Math.max(0, all.length - max), st = { fg: -1, bg: -1, b: false, d: false, u: false, v: false }
        const nodes = []
        if (hidden) nodes.push(el('div', { class: 'eh' }, `… ${hidden} earlier lines`))
        const lines = all.slice(hidden).map((l) => clip(l, 1500))
        lines.forEach((l, i) => nodes.push(...ansiLine(l, st), i < lines.length - 1 || endsLine ? '\n' : null))
        if (running) nodes.push(el('span', { class: 'tc' }))
        else if (!lines.length) nodes.push(el('span', { class: 'nt' }, 'No output'))
        const stick = fresh || out.scrollHeight - out.scrollTop - out.clientHeight < 32
        out.replaceChildren(...nodes.filter(Boolean))
        if (stick) out.scrollTop = out.scrollHeight
        fresh = false
      },
    }
    comp.update(p)
    return comp
  }

  // ---------------------------------------------------------------------------------------------
  // JsonTree: rows are rebuilt on every update; open state lives by path, so it survives.
  // ---------------------------------------------------------------------------------------------
  const JSON_ROWS = 500, JSON_DEPTH = 12
  const isBox = (v) => v !== null && typeof v === 'object'
  const keyText = (k) => (typeof k === 'number' || /^[A-Za-z_$][\w$-]*$/.test(k) ? String(k) : JSON.stringify(k))
  const brief = (v) => (Array.isArray(v) ? '[…]' : isBox(v) ? '{…}' : typeof v === 'string' ? clip(JSON.stringify(v), 18) : String(v))
  const preview = (v) => {
    const arr = Array.isArray(v), ents = arr ? v.map((x) => [null, x]) : Object.entries(v)
    const body = ents.slice(0, 5).map(([k, x]) => (k === null ? brief(x) : `${keyText(k)}: ${brief(x)}`)).join(', ')
    return arr ? `[ ${body}${ents.length > 5 ? ', …' : ''} ]` : `{ ${body}${ents.length > 5 ? ', …' : ''} }`
  }
  const leaf = (v) => {
    if (typeof v === 'string') {
      const j = JSON.stringify(v), t = clip(j, 200)
      return el('span', { class: 'st', title: t.length < j.length || v.length > 24 ? v : null }, t)
    }
    if (v === null) return el('span', { class: 'nl' }, 'null')
    if (v === undefined) return el('span', { class: 'nl' }, 'undefined')
    return el('span', { class: typeof v === 'boolean' ? 'bo' : 'nm' }, String(v))
  }

  registry.JsonTree = (p) => {
    const root = el('div', { class: 'lm-jt', role: 'tree' })
    const open = new Map()
    let cur = p

    const render = () => {
      const focus = focused(root)
      const expand = int(cur.expand, 0, 8, 1), cap = int(cur.maxItems, 1, 200, 30)
      const rows = []
      let cut = false
      const walk = (v, key, path, depth) => {
        if (rows.length >= JSON_ROWS) { cut = true; return }
        const label = key === null ? null : [el('span', { class: typeof key === 'number' ? 'ix' : 'ky', title: path }, keyText(key)), el('span', { class: 'sep' }, ':')]
        if (!isBox(v)) {
          rows.push(el('div', { class: 'row', role: 'treeitem', style: `--d: ${depth}`, title: path }, el('i', { class: 'sp' }), label, leaf(v)))
          return
        }
        const arr = Array.isArray(v), ents = arr ? v.map((x, i) => [i, x]) : Object.entries(v)
        const isOpen = ents.length > 0 && depth < JSON_DEPTH && (open.get(path) ?? depth < expand)
        const size = ents.length ? (arr ? `[${ents.length}]` : `{${ents.length}}`) : arr ? '[ ]' : '{ }'
        rows.push(el('button', { class: 'row node', type: 'button', role: 'treeitem', 'aria-expanded': ents.length ? String(isOpen) : null, 'data-p': path, disabled: !ents.length, style: `--d: ${depth}`, },
          ents.length ? chevron() : el('i', { class: 'sp' }), label, el('span', { class: 'sz' }, size), ents.length && !isOpen ? el('span', { class: 'pv' }, preview(v)) : null))
        if (!isOpen) return
        for (const [k, x] of ents.slice(0, cap)) walk(x, k, `${path}${arr ? `[${k}]` : `.${k}`}`, depth + 1)
        if (ents.length > cap) rows.push(el('div', { class: 'row more', style: `--d: ${depth + 1}` }, el('i', { class: 'sp' }), `… ${ents.length - cap} more`))
      }
      walk(cur.value, null, '$', 0)
      if (cut) rows.push(el('div', { class: 'row more', style: '--d: 0' }, el('i', { class: 'sp' }), '… truncated'))
      root.replaceChildren(...rows)
      restoreFocus(root, focus)
    }

    root.addEventListener('click', (e) => {
      const b = e.target.closest('.node')
      if (!b || b.disabled) return
      open.set(b.dataset.p, b.getAttribute('aria-expanded') !== 'true')
      render()
    })

    const comp = { el: root, update(p) { cur = p; render() } }
    comp.update(p)
    return comp
  }

  // ---------------------------------------------------------------------------------------------
  // Gallery samples
  // ---------------------------------------------------------------------------------------------
  const TS = `import { components } from '../catalog'
import type { Element } from './types'

const MAX_STRING = 4000

/** 把模型写的元素规范化；不能用时返回原因。 */
export const cleanElement = (id: string, value: unknown) => {
  if (!isObj(value)) return { error: \`\${id}: not an object\` }
  const type = value.type
  if (typeof type !== 'string' || !(type in components)) {
    return { error: \`\${id}: unknown component \${String(type)}\` }
  }
  const props = sanitize(value.props ?? {}, 0) as Record<string, unknown>
  return { el: { type, props, children: [] } satisfies Element }
}`

  samples.push({ group: 'code', title: 'Snippet · typical', span: 2, tree: () => h('Snippet', { code: TS, lang: 'ts', title: 'src/daemon/spec.ts', startLine: 38, highlight: [45, 46] }) })
  samples.push({
    group: 'code', title: 'Snippet · languages', span: 2,
    tree: () => h('Grid', { min: 15 },
      h('Snippet', { lang: 'py', title: 'agent/runner.py', code: '@dataclass\nclass Step:\n    """One unit of work."""\n    name: str\n    retries: int = 3\n\n    async def run(self, ctx: Context) -> bool:\n        for attempt in range(self.retries):\n            if await ctx.exec(self.name, timeout=2.5):  # ok\n                return True\n        return False' }),
      h('Snippet', { lang: 'go', title: 'cmd/server/main.go', code: 'func (s *Server) Serve(ctx context.Context) error {\n\tln, err := net.Listen("tcp", s.addr)\n\tif err != nil {\n\t\treturn fmt.Errorf("listen: %w", err)\n\t}\n\tdefer ln.Close()\n\t// block until cancelled\n\t<-ctx.Done()\n\treturn nil\n}' }),
      h('Snippet', { lang: 'rust', title: 'src/lib.rs', code: "pub fn parse<'a>(src: &'a str) -> Result<Vec<&'a str>, Error> {\n    let mut out = Vec::new();\n    for (i, line) in src.lines().enumerate() {\n        if line.is_empty() { continue; }\n        println!(\"{i}: {line}\");\n        out.push(line);\n    }\n    Ok(out)\n}" }),
      h('Snippet', { lang: 'java', title: 'Retry.java', code: '@Override\npublic <T> T call(Supplier<T> task) throws Exception {\n    int n = 0;\n    while (true) {\n        try { return task.get(); }\n        catch (IOException e) {\n            if (++n >= 3) throw e;\n        }\n    }\n}' }),
      h('Snippet', { lang: 'sh', code: '# 重新部署\nset -euo pipefail\nNS=jobs-system\nkubectl -n "$NS" rollout restart deploy/controller \\\n  && kubectl -n "$NS" rollout status deploy/controller --timeout=120s\ngit log --oneline -n 5 | grep -v "^$"' }),
      h('Snippet', { lang: 'json', title: 'package.json', code: '{\n  "name": "lumen",\n  "version": "0.1.0",\n  "private": true,\n  "scripts": { "build": "node scripts/build.mjs" },\n  "workspaces": null,\n  "port": 8080\n}' }),
      h('Snippet', { lang: 'yaml', title: 'deployment.yml', code: 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: controller # 控制器\n  labels: { app: controller }\nspec:\n  replicas: 2\n  template:\n    spec:\n      containers:\n        - name: main\n          image: "registry/controller:v1.2.0"\n          args: ["--verbose", "--port=8080"]\n          resources: &res\n            limits: { cpu: 500m }' }),
      h('Snippet', { lang: 'sql', title: 'report.sql', code: "-- 最近 7 天失败最多的任务\nSELECT t.name, COUNT(*) AS fails\nFROM tasks t\nJOIN runs r ON r.task_id = t.id\nWHERE r.status = 'failed' AND r.ts > NOW() - INTERVAL '7 days'\nGROUP BY t.name\nORDER BY fails DESC\nLIMIT 10;" }),
      h('Snippet', { lang: 'css', title: 'ui.css', code: '/* 面板 */\n@media (min-width: 640px) {\n  .lm-panel:hover > .head {\n    color: var(--text);\n    border: 1px solid #3a86ff;\n    transition: all .2s ease-in;\n  }\n}' }),
      h('Snippet', { lang: 'html', title: 'index.html', code: '<!-- entry -->\n<div class="app" id="root" data-n=3>\n  <a href="/docs?x=1&amp;y=2" target=_blank>Docs</a>\n  <input type="text" disabled />\n  <p>It\'s "fine" &copy; 2026</p>\n</div>' }),
      h('Snippet', { lang: 'diff', title: 'change.patch', code: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,3 +1,3 @@\n const a = 1\n-const b = 2\n+const b = 3\n const c = 4' }),
      h('Snippet', { lang: 'toml', title: 'Cargo.toml', code: '[package]\nname = "lumen"\nversion = "0.1.0"\n\n[dependencies]\nserde = { version = "1", features = ["derive"] }\ntokio = "1.38" # runtime' }),
    ),
  })
  samples.push({
    group: 'code', title: 'Snippet · edge', span: 2,
    tree: () => h('Stack', { gap: 0.75 },
      h('Snippet', { title: '很长的一行（默认横向滚动）', lang: 'js', code: `const payload = ${JSON.stringify({ session: 'a'.repeat(60), items: Array.from({ length: 12 }, (_, i) => ({ id: i, name: `item-${i}`, tags: ['x', 'y'] })) })}\nconsole.log(payload.items.length)` }),
      h('Snippet', { title: '自动换行', wrap: true, lang: 'sh', code: `curl -sS -H 'Authorization: Bearer $TOKEN' 'https://example.com/api/v1/sessions/${'0123456789abcdef'.repeat(6)}/events?since=2026-10-29T00:00:00Z&limit=500' | jq '.items[] | select(.level == "error")'` }),
      h('Snippet', { lang: 'cobol', title: '未知语言回退为纯文本', code: 'IDENTIFICATION DIVISION.\nPROGRAM-ID. HELLO.\n  DISPLAY "Hello, 世界".' }),
      h('Snippet', { code: '' }),
      h('Snippet', { lang: 'ts', title: '504 lines', code: Array.from({ length: 504 }, (_, i) => `export const v${i} = ${i} * 2 // line ${i + 1}`).join('\n') }),
    ),
  })
  samples.push({ group: 'code', title: 'Snippet · narrow', span: 1, tree: () => h('Snippet', { code: TS, lang: 'ts', title: 'spec.ts', highlight: [11, 12] }) })

  const PATCH = `diff --git a/src/daemon/spec.ts b/src/daemon/spec.ts
index 3b1f2a4..9c7d0e1 100644
--- a/src/daemon/spec.ts
+++ b/src/daemon/spec.ts
@@ -10,7 +10,8 @@ import type { Element, Patch, Spec } from './types'
 export const ALLOWED_ACTIONS = new Set(['send', 'open_url', 'copy', 'setState', 'pushState', 'removeState'])
 const PROTECTED = new Set(['window', 'shell'])
-const MAX_ELEMENTS = 120
+const MAX_ELEMENTS = 180
+const MAX_STRING = 4000
 const MAX_ARRAY = 400
 const MAX_BYTES = 160_000
 const FORBIDDEN_KEY = new Set(['__proto__', 'constructor', 'prototype'])
@@ -58,9 +59,9 @@ const sanitize = (v: unknown, depth = 0): unknown => {
-  if (typeof v === 'string') return v
+  if (typeof v === 'string') return v.length > MAX_STRING ? \`\${v.slice(0, MAX_STRING)}…\` : v
   if (Array.isArray(v)) return depth > 8 ? [] : v.slice(0, MAX_ARRAY).map((x) => sanitize(x, depth + 1))
   if (isObj(v)) {
     if (depth > 8) return {}
     return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sanitize(x, depth + 1)]))
   }
   return v
diff --git a/web/kit/old.js b/web/kit/old.js
deleted file mode 100644
index 4f5e6d7..0000000
--- a/web/kit/old.js
+++ /dev/null
@@ -1,3 +0,0 @@
-// obsolete helper
-export const noop = () => {}
-export default noop
diff --git a/docs/notes.md b/docs/notes.md
new file mode 100644
--- /dev/null
+++ b/docs/notes.md
@@ -0,0 +1,2 @@
+# 笔记
+Lumen 的 Diff 组件支持新增、删除与重命名。
`
  const BEFORE = Array.from({ length: 60 }, (_, i) => `line ${i + 1}: ${['alpha', 'beta', 'gamma', 'delta'][i % 4]} = ${i * 3}`).join('\n')
  const AFTER = BEFORE.split('\n').map((l, i) => (i === 7 ? 'line 8: beta = 99 // tuned' : i === 8 ? null : i === 41 ? `${l}\nline 42b: inserted` : l)).filter((l) => l !== null).join('\n')

  samples.push({ group: 'code', title: 'Diff · typical (patch)', span: 2, tree: () => h('Diff', { patch: PATCH }) })
  samples.push({ group: 'code', title: 'Diff · before / after', span: 2, tree: () => h('Diff', { path: 'notes/config.txt', before: BEFORE, after: AFTER }) })
  samples.push({
    group: 'code', title: 'Diff · edge', span: 2,
    tree: () => h('Stack', { gap: 0.75 },
      h('Diff', { path: 'identical.txt', before: 'a\nb', after: 'a\nb' }),
      h('Diff', { path: 'generated/big.json', before: Array.from({ length: 900 }, (_, i) => `  "k${i}": ${i},`).join('\n'), after: Array.from({ length: 900 }, (_, i) => `  "k${i}": ${i % 3 === 0 ? i + 1 : i},`).join('\n') }),
      h('Diff', { patch: 'diff --git a/logo.png b/logo.png\nnew file mode 100644\nBinary files /dev/null and b/logo.png differ\ndiff --git a/old/name.ts b/lib/name.ts\nsimilarity index 100%\nrename from old/name.ts\nrename to lib/name.ts\n' }),
    ),
  })
  samples.push({
    group: 'code', title: 'Diff · narrow', span: 1,
    tree: () => h('Diff', { path: 'src/run.go', before: 'func main() {\n\tcfg := load("config.yml")\n\tfmt.Println("starting", cfg.Name)\n\trun(cfg)\n}\n', after: 'func main() {\n\tcfg, err := load("config.yml")\n\tif err != nil {\n\t\tlog.Fatal(err)\n\t}\n\tfmt.Println("starting", cfg.Name, "with a rather long trailing argument list")\n\trun(cfg)\n}\n' }),
  })

  const FILES = [
    { path: 'src/daemon/spec.ts', status: 'modified', additions: 12, deletions: 3 },
    { path: 'src/daemon/prompt.ts', status: 'modified', additions: 4, deletions: 1, note: 'tone rules' },
    { path: 'src/catalog/code.ts', status: 'added', additions: 128 },
    { path: 'src/catalog/index.ts', status: 'modified', additions: 1, deletions: 1 },
    { path: 'web/kit/code.js', status: 'added', additions: 940 },
    { path: 'web/kit/code.css', status: 'added', additions: 310 },
    { path: 'web/kit/old.js', status: 'deleted', deletions: 22 },
    { path: 'docs/guide/getting-started/overview.md', status: 'renamed', note: 'from docs/overview.md', additions: 2, deletions: 2 },
    { path: 'README.md', status: 'untouched' },
    { path: 'package.json', status: 'modified', additions: 1 },
  ]
  samples.push({ group: 'code', title: 'FileTree · typical', span: 1, tree: () => h('FileTree', { items: FILES }) })
  samples.push({ group: 'code', title: 'FileTree · plain, collapsed', span: 1, tree: () => h('FileTree', { collapse: true, items: FILES.map(({ path }) => ({ path })) }) })
  samples.push({
    group: 'code', title: 'FileTree · edge', span: 2,
    tree: () => h('FileTree', {
      items: [
        ...Array.from({ length: 330 }, (_, i) => ({ path: `packages/pkg-${i % 7}/src/${['core', 'ui', 'utils'][i % 3]}/module-${i}.ts`, status: ['added', 'modified', 'deleted', 'renamed', 'untouched'][i % 5], additions: (i * 7) % 40, deletions: (i * 3) % 12 })),
        { path: 'a/very/deeply/nested/directory/with/a/very-long-file-name-that-keeps-going-and-going-and-going-until-it-must-be-clipped.config.generated.json', status: 'modified', note: '这是一个很长的备注，说明了为什么这个文件被修改了' },
        { path: 'docs/说明文档/使用指南.md', status: 'added' },
      ],
    }),
  })
  samples.push({ group: 'code', title: 'FileTree · narrow', span: 1, tree: () => h('FileTree', { items: FILES.slice(0, 8) }) })

  const TEST_OUT = '\x1b[1mRunning 12 tests\x1b[0m\n\x1b[32m✓\x1b[0m parses a unified diff \x1b[2m(3ms)\x1b[0m\n\x1b[32m✓\x1b[0m folds long unchanged runs \x1b[2m(1ms)\x1b[0m\n\x1b[31m✗ keeps tree state across updates\x1b[0m\n  \x1b[31mExpected:\x1b[0m true\n  \x1b[31mReceived:\x1b[0m \x1b[33mfalse\x1b[0m\n\x1b[90m    at Object.<anonymous> (tests/tree.test.ts:42:18)\x1b[0m\n\x1b[1;36mTests:\x1b[0m  \x1b[31m1 failed\x1b[0m, \x1b[32m11 passed\x1b[0m, 12 total\n\x1b[?25l\x1b]0;title\x07\x1b[2K'
  samples.push({ group: 'code', title: 'Terminal · failed', span: 1, tree: () => h('Terminal', { command: 'yarn test --reporter=spec', cwd: '~/src/lumen', output: TEST_OUT, exitCode: 1, durationMs: 4380 }) })
  samples.push({ group: 'code', title: 'Terminal · running', span: 1, tree: () => h('Terminal', { command: 'docker build -t registry/controller:v1.2.0 .', cwd: '/home/dev/projects/jobs', running: true, durationMs: 12400, output: '#1 [internal] load build definition\n#1 transferring dockerfile: 1.2kB done\n#5 [2/6] RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates\n#5 0.812 Get:1 http://deb.debian.org/debian bookworm InRelease [151 kB]\n#5 1.390 Fetched 9412 kB in 1s (7213 kB/s)' }) })
  samples.push({
    group: 'code', title: 'Terminal · edge', span: 2,
    tree: () => h('Stack', { gap: 0.75 },
      h('Terminal', { command: 'git status --short', output: '', exitCode: 0 }),
      h('Terminal', { command: 'npm ci', exitCode: 0, durationMs: 83200, maxLines: 12, output: `${Array.from({ length: 140 }, (_, i) => `\x1b[90mnpm\x1b[0m \x1b[33mwarn\x1b[0m deprecated package-${i}@1.${i}.0: no longer supported`).join('\n')}\n\r[#######-------------] 35%\r[##############------] 70%\r[####################] 100%\nadded 842 packages in 1m` }),
      h('Terminal', { command: 'node -e "console.log(\'x\'.repeat(400))"', exitCode: 137, output: `${'x'.repeat(400)}\n\x1b[41;97m FAIL \x1b[0m \x1b[4munderlined\x1b[0m \x1b[7minverse\x1b[0m \x1b[1;32mbold green\x1b[0m \x1b[92mbright\x1b[0m` }),
    ),
  })
  samples.push({ group: 'code', title: 'Terminal · narrow', span: 1, tree: () => h('Terminal', { command: 'kubectl -n jobs-system get pods -o wide', cwd: '~/src/infra', exitCode: 0, durationMs: 640, output: 'NAME                     READY   STATUS    RESTARTS\ncontroller-7d9c8-x2k4p   1/1     Running   0\nworker-b-5c6f7-9qw2z     1/1     Running   2' }) })

  const STATE = {
    session: { id: 'a3f9c2d1-7b5e-4d0a-8e21-c04b9f2a7712', cwd: '/Users/dev/projects/lumen', model: 'claude-sonnet-5-5', turns: 18, done: false, error: null },
    plan: [{ label: '读取 README', state: 'done', ms: 1200 }, { label: '实现 Diff', state: 'active', ms: null }, { label: '验证', state: 'pending', ms: null }],
    usage: { input: 128400, output: 9120, cache: { read: 90210, write: 4400 }, cost: 0.4217 },
    tags: ['ui', 'design', '组件'],
    notes: '这是一段很长的说明文字，用来检验长字符串是否会被省略号截断，并且完整内容保留在悬停提示里。'.repeat(3),
  }
  samples.push({ group: 'code', title: 'JsonTree · typical', span: 1, tree: () => h('JsonTree', { value: STATE, expand: 2 }) })
  samples.push({
    group: 'code', title: 'JsonTree · edge', span: 1,
    tree: () => h('JsonTree', {
      expand: 3, maxItems: 8,
      value: {
        empty: { arr: [], obj: {} }, nothing: null, big: Array.from({ length: 120 }, (_, i) => i * i),
        deep: { a: { b: { c: { d: { e: { f: 'bottom' } } } } } }, 'key with spaces': true, 'wide.key/path': 1e21,
        table: Array.from({ length: 4 }, (_, i) => ({ id: i, name: `row-${i}`, ok: i % 2 === 0, meta: { score: i / 3 } })),
        url: `https://example.com/${'segment/'.repeat(30)}`,
      },
    }),
  })
  samples.push({ group: 'code', title: 'JsonTree · narrow', span: 1, tree: () => h('JsonTree', { value: STATE.usage, expand: 2 }) })
})()
