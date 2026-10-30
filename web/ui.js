// Lumen — component set and renderer for generative UI.
// A spec is flat: { root, elements: { id: { type, props, children } } }, as in json-render.
// Any prop may be { $state: key }; text always goes in as text nodes, never HTML.
;(() => {
  const SVG_NS = 'http://www.w3.org/2000/svg'
  const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'line', 'rect', 'text', 'defs', 'linearGradient', 'stop', 'polygon', 'polyline', 'title'])

  const el = (tag, attrs, ...kids) => {
    const e = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag)
    for (const [k, v] of Object.entries(attrs ?? {})) if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v)
    e.append(...kids.flat(Infinity).filter((k) => k != null && k !== false))
    return e
  }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize)
  const setTone = (e, t) => (t ? e.setAttribute('data-tone', t) : e.removeAttribute('data-tone'))
  const len = (v, fallback) => (v == null ? fallback : typeof v === 'number' ? `${v}rem` : v)
  const pad2 = (n) => String(n).padStart(2, '0')

  // Observe a node's size; `axis` limits callbacks to width changes to avoid feedback loops.
  const watch = (node, fn, axis) => {
    let w = -1, h = -1
    new ResizeObserver(() => {
      const nw = node.clientWidth, nh = node.clientHeight
      // Not shown (the window folded into the orb): keep the layout it had, so showing it again changes nothing.
      if (!nw && !nh) return
      if (nw === w && (axis === 'x' || nh === h)) return
      w = nw; h = nh
      fn(nw, nh)
    }).observe(node)
    // Anything measured before the web fonts arrive was measured too narrow: lay it out again once they have.
    if (document.fonts?.status === 'loading') document.fonts.ready.then(() => { if (w >= 0) fn(node.clientWidth, node.clientHeight) })
  }

  const fmtNum = (v) => {
    const a = Math.abs(v)
    if (a >= 1e9) return `${+(v / 1e9).toFixed(1)}B`
    if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`
    if (a >= 1e4) return `${+(v / 1e3).toFixed(1)}K`
    return String(+v.toFixed(a < 10 ? 2 : a < 100 ? 1 : 0))
  }
  const nice = (raw) => {
    const p = 10 ** Math.floor(Math.log10(raw)), f = raw / p
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p
  }

  // Status glyphs carry meaning with shape as well as colour.
  const GLYPH = {
    ok: 'M2 5.3 4.3 7.6 8.2 2.6',
    warn: 'M5 1.6 9 8.4H1Z',
    serious: 'M5 1 9 5 5 9 1 5Z',
    err: 'M2.4 2.4 7.6 7.6M7.6 2.4 2.4 7.6',
  }
  // SVG text neither wraps nor clips: shorten a placed <text> until it is at most `max` wide, keeping the whole as its tooltip.
  const fullText = new WeakMap()
  const fitText = (t, max, tries = 10) => {
    const full = fullText.get(t) ?? t.textContent
    fullText.set(t, full)
    t.textContent = full
    // Not laid out yet (drawn before it is attached, or inside a closed pane): measure on a later frame.
    if (full && !t.getComputedTextLength()) {
      if (tries) requestAnimationFrame(() => t.isConnected && fitText(t, max, tries - 1))
      return t
    }
    // A web font that is still loading will be wider than the fallback being measured now.
    if (document.fonts?.status === 'loading') document.fonts.ready.then(() => t.isConnected && fitText(t, max, 0))
    if (!(max > 0) || t.getComputedTextLength() <= max) return t
    let lo = 0, hi = full.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      t.textContent = `${full.slice(0, mid)}…`
      if (t.getComputedTextLength() <= max) lo = mid
      else hi = mid - 1
    }
    t.textContent = `${full.slice(0, lo)}…`
    t.append(el('title', {}, full))
    return t
  }
  const glyph = (tone) => el('svg', { viewBox: '0 0 10 10', 'aria-hidden': true }, Object.hasOwn(GLYPH, tone) ? el('path', { d: GLYPH[tone] }) : el('circle', { cx: 5, cy: 5, r: 2, fill: 'currentColor', stroke: 'none' }))

  // Each component: (props, ctx) => { el, slot?, update(props) }
  let lastPanel = 0, burst = 0 // panels created together are projected in one after another
  let uid = 0
  const registry = {}

  // ---------- Presence: the agent's core, drawn in light ----------
  // Made only of points of light: a lattice sphere whose limb glows, a knot of neural filaments around a white-hot core, and
  // three gyroscope rings (an orbit with two satellites, three segment arcs, a dial of ticks). Points are rotated and
  // perspective-projected on the CPU and summed as light on the GPU; a second pass adds bloom and tone-maps the light, so
  // dense overlaps run white-hot while the rest stays saturated colour, which holds on light backdrops as well as dark ones.
  // Idle and thinking use the palette's spectrum, acting turns Jarvis gold, alert turns Ultron red.
  // Every core shares one frame loop; large cores own a WebGL context, small ones share one and copy the result.
  // Without WebGL a line-drawn version is used.
  const TAU = Math.PI * 2
  const CAM = 4.2
  const SLOW = 0.17 // geometry clock: everything moves about six times slower than raw time
  const WHITE = [255, 255, 255]
  const GOLD = [255, 190, 84]
  const ULTRON = [[255, 72, 84], [255, 142, 96], [255, 58, 112], [255, 196, 176]]
  const STATES = {
    idle: { spin: 0.7, glow: 0.85, chaos: 0.35, gold: 0 },
    thinking: { spin: 1.6, glow: 1, chaos: 0.8, gold: 0 },
    acting: { spin: 2.4, glow: 1.1, chaos: 0.6, gold: 1 },
    alert: { spin: 1.2, glow: 1.2, chaos: 1.6, gold: 0, ultron: true },
  }
  // the line-drawn fallback's rings
  const RINGS = [
    { r: 1.0, tx: 1.15, ty: 0.2, spin: 0.5, px: 0.1, py: 0, kind: 'band', ci: 0 },
    { r: 0.86, tx: 1.45, ty: 0, spin: -0.35, px: 0, py: 0.12, kind: 'ticks', ci: 2 },
    { r: 0.72, tx: -1, ty: 0.7, spin: 0.8, px: 0.08, py: 0.05, kind: 'arcs', ci: 1 },
    { r: 1.14, tx: 0.35, ty: 1.3, spin: -0.25, px: 0.05, py: 0.08, kind: 'dash', ci: 0 },
    { r: 0.56, tx: 0.8, ty: -0.9, spin: 1.2, px: 0.12, py: 0.1, kind: 'fine', ci: 4 },
  ]
  const LEVELS = [0.1, 0.2, 0.34, 0.52, 0.72, 0.95]

  const pal = { c: [[110, 231, 255], [138, 164, 255], [192, 139, 255], [255, 143, 183]], dirty: true }
  const probe = el('i', { style: 'position: absolute; width: 0; height: 0; visibility: hidden' })
  const scratch = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })
  const rgbOf = (expr) => {
    if (!probe.isConnected) document.documentElement.append(probe)
    probe.style.color = 'transparent'
    probe.style.color = expr
    scratch.clearRect(0, 0, 1, 1)
    scratch.fillStyle = '#000'
    scratch.fillStyle = getComputedStyle(probe).color
    scratch.fillRect(0, 0, 1, 1)
    return [...scratch.getImageData(0, 0, 1, 1).data.slice(0, 3)]
  }
  // The spectrum follows the palette.
  const refreshPalette = () => {
    pal.c = ['--c1', '--c2', '--c3', '--c4'].map((v) => rgbOf(`var(${v})`))
    pal.dirty = false
  }
  document.addEventListener('lm-appearance', () => { pal.dirty = true })

  const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`
  const hash = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x) }
  const rotMat = (ax, ay, az) => {
    const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az)
    return [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx, sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx, -sy, cy * sx, cy * cx]
  }
  const mul = (A, B) => [
    A[0] * B[0] + A[1] * B[3] + A[2] * B[6], A[0] * B[1] + A[1] * B[4] + A[2] * B[7], A[0] * B[2] + A[1] * B[5] + A[2] * B[8],
    A[3] * B[0] + A[4] * B[3] + A[5] * B[6], A[3] * B[1] + A[4] * B[4] + A[5] * B[7], A[3] * B[2] + A[4] * B[5] + A[5] * B[8],
    A[6] * B[0] + A[7] * B[3] + A[8] * B[6], A[6] * B[1] + A[7] * B[4] + A[8] * B[7], A[6] * B[2] + A[7] * B[5] + A[8] * B[8],
  ]
  const depth = (z) => 0.3 + 0.7 * clamp((z + 1.2) / 2.4, 0, 1)

  // ---- The core's geometry, built once and shared. Model units: 1 = the canvas half-size. ----
  // Rings are [angle, radial offset, strength, size] per point; the lattice is [x, y, z, weight] on the unit sphere.
  const GEO = (() => {
    const lattice = [], orbit = [], segs = [], dial = []
    for (let m = 0; m < 12; m++) {
      const lo = (m * Math.PI) / 6
      for (let i = 0; i < 70; i++) { const la = -1.48 + (i / 69) * 2.96; lattice.push(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo), 0.75) }
    }
    for (const la of [-1.05, -0.52, 0, 0.52, 1.05]) {
      const n = Math.round(200 * Math.cos(la))
      for (let i = 0; i < n; i++) { const lo = (i / n) * TAU; lattice.push(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo), la === 0 ? 1.25 : 0.75) }
    }
    for (let i = 0; i < 320; i++) orbit.push((i / 320) * TAU, (hash(i + 50) - 0.5) * 0.006, 0.4 + 0.3 * hash(i + 90), 0.9)
    // three arcs that brighten toward their leading tips, each with a fainter inner rail
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 90; i++) {
        const q = i / 89, a = (k / 3) * TAU + q * 1.3
        segs.push(a, 0, 0.18 + 0.82 * q ** 2.2 + (i > 85 ? 0.8 : 0), i > 85 ? 1.5 : 1.1)
        segs.push(a, -0.028, 0.22 + 0.2 * q, 0.75)
      }
    }
    // a faint dial with ticks pointing in, every sixth one long
    for (let i = 0; i < 300; i++) dial.push((i / 300) * TAU, 0, 0.2, 0.75)
    for (let i = 0; i < 72; i++) { const long = i % 6 === 0; for (let j = 0; j < (long ? 7 : 3); j++) dial.push((i / 72) * TAU, -0.014 - j * 0.0075, long ? 0.8 : 0.45, 0.8) }

    const axis = [0.32, 0.93, 0.14]
    const plasma = Array.from({ length: 150 }, (_, i) => {
      const rr = 0.04 + 0.27 * hash(i + 3000) ** 0.9, ph = hash(i + 3100) * TAU, ct = hash(i + 3200) * 2 - 1, st = Math.sqrt(1 - ct * ct)
      const v = [rr * st * Math.cos(ph), rr * ct, rr * st * Math.sin(ph)]
      return { v, c: [axis[1] * v[2] - axis[2] * v[1], axis[2] * v[0] - axis[0] * v[2], axis[0] * v[1] - axis[1] * v[0]], d: axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2], w: 1.1 / (0.22 + rr), k: hash(i + 3300), g: rr / 0.31, sz: 0.6 + hash(i + 3400) * 0.6 }
    })
    const filaments = Array.from({ length: 7 }, (_, k) => ({ f: [1 + (k % 3), 2 + ((k + 1) % 3), 1 + ((k + 2) % 4)], ph: [hash(k + 40) * TAU, hash(k + 49) * TAU, hash(k + 59) * TAU], amp: [0.8 + hash(k + 43) * 0.4, 0.8 + hash(k + 45) * 0.4, 0.7 + hash(k + 47) * 0.5], w: 0.4 + hash(k + 51) * 0.8, ci: [0, 1, 0, 2, 1, 0, 1][k] }))
    const motes = Float32Array.from({ length: 40 * 3 }, (_, j) => { const i = Math.floor(j / 3), ct = hash(i + 7000) * 2 - 1, st = Math.sqrt(1 - ct * ct), ph = hash(i + 7100) * TAU, r = 0.62 + hash(i + 7200) * 0.28; return [r * st * Math.cos(ph), r * ct, r * st * Math.sin(ph)][j % 3] })
    const rays = Array.from({ length: 18 }, (_, i) => { const ct = hash(i + 8000) * 2 - 1, st = Math.sqrt(1 - ct * ct), ph = hash(i + 8100) * TAU; return { v: [st * Math.cos(ph), ct, st * Math.sin(ph)], len: 0.42 + hash(i + 8200) * 0.3, w: 0.5 + hash(i + 8300), ph: hash(i + 8400) * TAU } })
    const corona = Array.from({ length: 40 }, (_, i) => { const ct = hash(i + 9000) * 2 - 1, st = Math.sqrt(1 - ct * ct), ph = hash(i + 9100) * TAU; return { v: [st * Math.cos(ph), ct, st * Math.sin(ph)], r: 0.025 + hash(i + 9200) * 0.075, w: 1 + hash(i + 9300) * 2 } })
    return { lattice: Float32Array.from(lattice), orbit: Float32Array.from(orbit), segs: Float32Array.from(segs), dial: Float32Array.from(dial), axis, plasma, filaments, motes, rays, corona }
  })()

  // ---- GPU: pass 1 sums soft points as light; pass 2 adds bloom and tone-maps it ----
  const STRIDE = 8
  const SCENE = new Float32Array(6000 * STRIDE) // x, y, size, r, g, b, strength, softness; every core writes here in turn
  const POINT_VS = 'attribute vec2 a_pos; attribute float a_size; attribute vec4 a_col; attribute float a_soft; varying vec4 v_col; varying float v_soft; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); gl_PointSize = a_size; v_col = a_col; v_soft = a_soft; }'
  const POINT_FS = 'precision mediump float; varying vec4 v_col; varying float v_soft; void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float d = dot(q, q); if (d > 1.0) discard; gl_FragColor = vec4(v_col.rgb * v_col.a * pow(1.0 - d, mix(2.6, 1.0, v_soft)), 1.0); }'
  const POST_VS = 'attribute vec2 a_xy; varying vec2 v_uv; void main() { v_uv = a_xy * 0.5 + 0.5; gl_Position = vec4(a_xy, 0.0, 1.0); }'
  const POST_FS = `precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_scale, u_px;
uniform float u_unit, u_exp, u_bloom, u_sat;
vec3 tap(vec2 uv) { return texture2D(u_tex, clamp(uv, 0.0, 1.0) * u_scale).rgb; }
void main() {
  vec3 b = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float t = float(i) * 0.7854 + 0.39;
    vec2 o = vec2(cos(t), sin(t)) * u_px * u_unit;
    b += tap(v_uv + o * 2.0) + 0.55 * tap(v_uv + o * 5.0);
  }
  vec3 c = (tap(v_uv) + b * u_bloom / 12.4) * u_exp;
  // Tone-map the brightest channel and keep the hue, so most of the light stays saturated colour that holds against a light
  // backdrop too; only the densest light runs on toward white.
  float m = max(c.r, max(c.g, c.b));
  float I = 1.0 - exp(-m);
  vec3 hue = c / max(m, 0.0001);
  vec3 L = mix(hue * I, vec3(I), smoothstep(0.55, 1.0, I) * u_sat);
  gl_FragColor = vec4(L, max(L.r, max(L.g, L.b)));
}`

  const createPainter = (canvas) => {
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' })
    if (!gl) return null
    const program = (vs, fs) => {
      const pr = gl.createProgram()
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const sh = gl.createShader(type)
        gl.shaderSource(sh, src)
        gl.compileShader(sh)
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh))
        gl.attachShader(pr, sh)
      }
      gl.linkProgram(pr)
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr))
      return pr
    }
    const pts = program(POINT_VS, POINT_FS), post = program(POST_VS, POST_FS)
    const A = Object.fromEntries(['a_pos', 'a_size', 'a_col', 'a_soft'].map((k) => [k, gl.getAttribLocation(pts, k)]))
    const xy = gl.getAttribLocation(post, 'a_xy')
    const U = Object.fromEntries(['u_tex', 'u_scale', 'u_px', 'u_unit', 'u_exp', 'u_bloom', 'u_sat'].map((k) => [k, gl.getUniformLocation(post, k)]))
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, SCENE.byteLength, gl.DYNAMIC_DRAW)
    const tri = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, tri)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

    // Light is summed in half floats where the GPU allows, so dense overlaps can run hotter than white before tone mapping.
    const half = gl.getExtension('OES_texture_half_float')
    gl.getExtension('EXT_color_buffer_half_float')
    const linear = !!gl.getExtension('OES_texture_half_float_linear')
    let tex = null, fbo = null, tw = 0, th = 0, hdr = false
    const target = (w, h) => {
      if (tex && w <= tw && h <= th) return
      tw = Math.max(w, tw)
      th = Math.max(h, th)
      if (tex) { gl.deleteTexture(tex); gl.deleteFramebuffer(fbo) }
      tex = gl.createTexture()
      fbo = gl.createFramebuffer()
      const alloc = (type, filter) => {
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tw, th, 0, gl.RGBA, type, null)
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
        return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
      }
      hdr = !!half && alloc(half.HALF_FLOAT_OES, linear ? gl.LINEAR : gl.NEAREST)
      if (!hdr) alloc(gl.UNSIGNED_BYTE, gl.LINEAR)
    }

    // Draw `n` floats of SCENE into the top-left w×h of the canvas.
    const render = (n, w, h, o) => {
      target(w, h)
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.viewport(0, 0, w, h)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      gl.useProgram(pts)
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, SCENE.subarray(0, n))
      const attr = [[A.a_pos, 2, 0], [A.a_size, 1, 8], [A.a_col, 4, 12], [A.a_soft, 1, 28]]
      for (const [loc, size, off] of attr) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off) }
      gl.drawArrays(gl.POINTS, 0, n / STRIDE)
      for (const [loc] of attr) gl.disableVertexAttribArray(loc)

      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      const y0 = canvas.height - h
      gl.viewport(0, y0, w, h)
      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(0, y0, w, h)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.disable(gl.SCISSOR_TEST)
      gl.disable(gl.BLEND)
      gl.useProgram(post)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.uniform1i(U.u_tex, 0)
      gl.uniform2f(U.u_scale, w / tw, h / th)
      gl.uniform2f(U.u_px, 1 / w, 1 / h)
      gl.uniform1f(U.u_exp, hdr ? o.exp : o.exp * 1.4)
      gl.uniform1f(U.u_unit, o.unit)
      gl.uniform1f(U.u_bloom, o.bloom)
      gl.uniform1f(U.u_sat, o.white)
      gl.bindBuffer(gl.ARRAY_BUFFER, tri)
      gl.enableVertexAttribArray(xy)
      gl.vertexAttribPointer(xy, 2, gl.FLOAT, false, 0, 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.disableVertexAttribArray(xy)
    }
    return { canvas, render }
  }

  // Small cores (an orb beside a message, on an agent card) share one context and copy their frame out of it.
  let shared
  const sharedPainter = () => {
    if (shared === undefined) {
      try { shared = createPainter(document.createElement('canvas')) } catch (err) { console.warn('Lumen: WebGL unavailable, drawing the core with lines', err); shared = null }
    }
    return shared
  }

  const cores = new Set()
  const makeCore = (canvas) => {
    let ctx = null, painter = null, mode = ''
    const S = { spin: 0.7, glow: 0.85, chaos: 0.35, gold: 0, ult: 0, hover: 0, press: 0, mx: 0, my: 0 }
    const aim = { mx: 0, my: 0, hover: 0, press: 0 }
    const ripples = []
    const filaments = Array.from({ length: 9 }, (_, k) => ({ f: [1 + (k % 3), 2 + ((k + 1) % 3), 1 + ((k + 2) % 4)], ph: [hash(k) * TAU, hash(k + 9) * TAU, hash(k + 19) * TAU], amp: [0.8 + hash(k + 3) * 0.4, 0.8 + hash(k + 5) * 0.4, 0.7 + hash(k + 7) * 0.5], w: 0.4 + hash(k + 11) * 0.8, ci: [0, 1, 0, 3, 1, 0, 2, 0, 1][k] }))
    const parts = Array.from({ length: 120 }, (_, i) => ({ rho: 0.4 + hash(i) * 0.9, inc: (hash(i + 200) - 0.5) * 2.6, node: hash(i + 400) * TAU, w: (hash(i + 600) < 0.5 ? -1 : 1) * (0.3 + hash(i + 800) * 0.9), a: hash(i + 1000) * TAU, ci: i % 4 }))
    let goal = STATES.idle, size = 0, dpr = 1, t = Math.random() * 10, T = 0, Ph = Math.random() * 10 // Ph: rotation phase, the integral of the speed

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      size = canvas.clientWidth
      canvas.width = canvas.height = Math.max(1, Math.round(size * dpr))
    }
    new ResizeObserver(resize).observe(canvas)

    // ---- one frame of points into SCENE; returns the number of floats written ----
    const scene = (dt, env) => {
      const { cs, G, ex, u, unit, lod } = env
      const D = SCENE, cap = D.length, back = cs[2], hot = mixRgb(WHITE, cs[0], 0.3)
      const Un = 0.97 * (1 - 0.05 * S.press + 0.02 * S.hover)
      let n = 0
      // depth cue: the near side is brighter, larger and crisper; the far side dims and shifts toward the third hue
      const put = (M, x, y, z, size, c, a, soft) => {
        if (n >= cap) return
        const X = M[0] * x + M[1] * y + M[2] * z, Y = M[3] * x + M[4] * y + M[5] * z, Z = M[6] * x + M[7] * y + M[8] * z
        const sp = CAM / (CAM - Z), dp = clamp((Z + 1) / 2, 0, 1), h = (1 - dp) * 0.5
        D[n++] = X * sp * Un; D[n++] = -Y * sp * Un; D[n++] = Math.max(1.25, size * unit * (0.75 + 0.5 * dp))
        D[n++] = (c[0] + (back[0] - c[0]) * h) / 255; D[n++] = (c[1] + (back[1] - c[1]) * h) / 255; D[n++] = (c[2] + (back[2] - c[2]) * h) / 255
        D[n++] = a * (0.28 + 0.72 * dp); D[n++] = (soft ?? 0) + (1 - dp) * 0.4
      }
      const flat = (x, y, size, c, a, soft) => {
        if (n >= cap) return
        D[n++] = x; D[n++] = y; D[n++] = size * unit; D[n++] = c[0] / 255; D[n++] = c[1] / 255; D[n++] = c[2] / 255; D[n++] = a; D[n++] = soft ?? 0
      }

      // far motes, for parallax
      if (lod === 1) {
        const M = mul(G, rotMat(0, t * 0.1, 0)), m = GEO.motes
        for (let i = 0; i < m.length; i += 3) put(M, m[i] * ex, m[i + 1] * ex, m[i + 2] * ex, 1.1, cs[1], 0.18, 0.6)
      }
      // lattice sphere: meridians and parallels of points; the limb glows like a lit edge, the far side is fainter
      {
        const M = mul(G, rotMat(0.2, Ph * 0.25, 0)), L = GEO.lattice, r = 0.56 * ex
        for (let i = 0; i < L.length; i += 4 * lod) {
          const x = L[i], y = L[i + 1], z = L[i + 2], nz = M[6] * x + M[7] * y + M[8] * z, limb = 1 - Math.abs(nz)
          put(M, x * r, y * r, z * r, 1, cs[1], L[i + 3] * (0.16 + 1.25 * limb * limb) * (nz > 0 ? 1 : 0.55) * S.glow * lod, 0.05)
        }
      }
      // plasma: sparks churning around the core with differential rotation
      {
        const P = GEO.plasma, A = GEO.axis, wob = 0.02 + 0.03 * S.chaos
        for (let i = 0; i < P.length; i += lod) {
          const q = P[i], th = q.w * Ph * 0.9, c = Math.cos(th), sn = Math.sin(th), e = (1 - c) * q.d
          const tx = wob * Math.sin(t * 2.1 + q.k * 50), ty = wob * Math.sin(t * 1.7 + q.k * 80), tz = wob * Math.sin(t * 2.6 + q.k * 20)
          put(G, (q.v[0] * c + q.c[0] * sn + A[0] * e + tx) * ex, (q.v[1] * c + q.c[1] * sn + A[1] * e + ty) * ex, (q.v[2] * c + q.c[2] * sn + A[2] * e + tz) * ex, q.sz, mixRgb(hot, cs[1], q.g), (0.3 + 0.25 * Math.sin(t * 3 + q.k * 40)) * (0.7 + 0.4 * S.chaos) * lod, 0.2)
        }
      }
      // neural knot: filaments of points with pulses running along them, and a few brighter nodes
      for (let k = 0; k < GEO.filaments.length; k++) {
        const f = GEO.filaments[k], M = mul(G, rotMat(Ph * 0.3 * f.w + k, Ph * 0.22 + k * 0.7, k * 0.5)), rr = 0.3 * (0.85 + 0.15 * Math.sin(t * f.w + k)) * ex
        for (let i = 0; i < 160; i += lod) {
          const v = (i / 160) * TAU, wb = S.chaos * 0.05 * Math.sin(v * 7 + t * 5 + k * 3)
          const pulse = Math.max(0, Math.sin(v * 2 - t * 7 * f.w + k)) ** 6, node = i % 53 === (k * 13) % 53
          put(M, rr * (f.amp[0] * Math.cos(f.f[0] * v + f.ph[0] + t * f.w) + wb), rr * (f.amp[1] * Math.sin(f.f[1] * v + f.ph[1]) + wb), rr * (f.amp[2] * Math.cos(f.f[2] * v + f.ph[2] + t * f.w * 0.7) + wb),
            node ? 1.5 : 0.7 + pulse * 0.5, node ? hot : cs[f.ci], ((node ? 1 : 0.24) + 1.1 * pulse) * (0.7 + 0.4 * S.chaos) * lod, 0.1)
        }
      }
      // gyroscope rings: a dial of ticks, three segment arcs, an orbit with two satellites; each turns about its own axis
      const jit = 0.06 + 0.05 * S.chaos
      const ring = (arr, rad, tx, ty, spin, c, gain) => {
        const M = mul(G, rotMat(tx + jit * Math.sin(t * 0.4 + tx), ty + jit * Math.cos(t * 0.33 + ty), 0))
        for (let i = 0; i < arr.length; i += 4 * lod) { const a = arr[i] + spin, rr = (rad + arr[i + 1]) * ex; put(M, rr * Math.cos(a), rr * Math.sin(a), 0, arr[i + 3], c, arr[i + 2] * gain * lod, 0) }
        return M
      }
      ring(GEO.dial, 0.86, 0.42, 0.28, Ph * 0.22, cs[1], 1.1)
      ring(GEO.segs, 0.76, 0.62, -0.46, -Ph * 0.55, cs[0], 1.15)
      const Mo = ring(GEO.orbit, 0.68, 1.25, 0.55, Ph * 0.8, cs[0], 0.95)
      for (let s = 0; s < 2; s++) {
        for (let j = 0; j < 12; j += lod) {
          const a = Ph * 1.5 + s * Math.PI - j * 0.035, rr = 0.68 * ex
          put(Mo, rr * Math.cos(a), rr * Math.sin(a), 0, j ? 1.3 * (1 - j / 14) : 2.6, j ? cs[0] : hot, j ? 0.9 * (1 - j / 12) : 2.2, 0.05)
        }
      }
      // Ultron: spikes that only exist while alert
      if (u > 0.04) {
        for (const q of GEO.rays) {
          const len = q.len * (0.7 + 0.3 * Math.sin(t * q.w * 3 + q.ph)) * ex
          for (let j = 0; j < 8; j += lod) { const f = 0.1 + (j / 8) * len; put(G, q.v[0] * f, q.v[1] * f, q.v[2] * f, 1.4 * (1 - j / 10), cs[0], (1 - j / 8) * 0.9 * u * lod, 0.1) }
        }
      }
      // core: a white-hot centre in a small corona; no wide halo
      for (const q of GEO.corona) {
        const th = T * q.w * 0.6, c = Math.cos(th), sn = Math.sin(th), rr = q.r * (1 + 0.15 * S.hover) * (0.85 + 0.15 * Math.sin(T * 2 * q.w))
        put(G, (q.v[0] * c - q.v[2] * sn) * rr, q.v[1] * rr, (q.v[0] * sn + q.v[2] * c) * rr, 1.3, WHITE, 0.45 + 0.35 * Math.sin(T * 3 * q.w), 0.2)
      }
      {
        const pulse = 1 + 0.08 * Math.sin(T * 1.1) + 0.14 * S.press + 0.15 * S.hover
        flat(0, 0, 22 * pulse, cs[1], 0.1 * S.glow, 1)
        flat(0, 0, 10 * pulse, cs[0], 0.55, 0.7)
        flat(0, 0, 4.5 * pulse, WHITE, 1.6, 0.3)
      }
      // ripples: a ring of points thrown outward by a click or an alarm
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i]
        r.age += dt
        const q = r.age / (r.big ? 2.4 : 1.8)
        if (q >= 1) { ripples.splice(i, 1); continue }
        const rad = Un * (0.3 + 0.75 * (1 - (1 - q) ** 3)), alpha = (r.big ? 1 : 0.7) * (1 - q)
        for (let j = 0; j < 120; j += lod) flat(Math.cos((j / 120) * TAU) * rad, Math.sin((j / 120) * TAU) * rad, 1.3, cs[0], alpha, 0.1)
      }
      return n
    }

    // ---- line-drawn fallback, for when WebGL is unavailable ----
    const draw2d = (dt, env) => {
      const { R, u, cs, spin, ex, G } = env
      const level = size >= 120 ? 2 : size >= 56 ? 1 : 0
      const lw = Math.max(0.7, R / 88)
      const U = R * (level === 2 ? 0.68 : level === 1 ? 0.74 : 0.82)
      const ocy = 0
      const bright = 1 - 0.12 * u * (0.5 + 0.5 * Math.sin(T * 1.4))
      ctx ??= canvas.getContext('2d')

      // projection into canvas space (origin at the centre)
      const P = [0, 0, 0], o = [0, 0, 0]
      const proj = (M, x, y, z) => {
        const X = M[0] * x + M[1] * y + M[2] * z, Y = M[3] * x + M[4] * y + M[5] * z, Z = M[6] * x + M[7] * y + M[8] * z, s = CAM / (CAM - Z)
        P[0] = X * s * U; P[1] = ocy + Y * s * U; P[2] = Z
      }
      // line batches: [width class][colour][depth bucket] → one Path2D each
      const paths = new Array(3 * 5 * 6)
      const seg = (w, ci, a, x0, y0, x1, y1) => {
        const i = (w * 5 + ci) * 6 + clamp((a * 6) | 0, 0, 5)
        const q = paths[i] ?? (paths[i] = new Path2D())
        q.moveTo(x0, y0)
        q.lineTo(x1, y1)
      }
      const path3 = (M, n, get, w, ci, base, closed) => {
        get(0, o); proj(M, o[0], o[1], o[2])
        let x0 = P[0], y0 = P[1], z0 = P[2]
        for (let i = 1; i <= n; i++) {
          get(closed ? i % n : i, o); proj(M, o[0], o[1], o[2])
          seg(w, ci, base * depth((z0 + P[2]) / 2) * bright, x0, y0, P[0], P[1])
          x0 = P[0]; y0 = P[1]; z0 = P[2]
        }
      }
      const nn = (n) => (level === 2 ? n : Math.ceil(n / 2))
      const disc = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU) }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size, size)
      ctx.translate(R, R)
      const sc = 1 - 0.06 * S.press
      ctx.scale(sc, sc)

      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'lighter'
      const dots = [] // drawn after the lines so their keylines never cover them

      // glass body: a crisp sphere (no blur) that gives the core a surface of its own on any backdrop
      {
        const br = U * 1.02 * ex
        ctx.globalCompositeOperation = 'source-over'
        const body = ctx.createRadialGradient(-br * 0.28, ocy - br * 0.32, br * 0.04, 0, ocy, br)
        body.addColorStop(0, rgba(cs[1], 0.1)); body.addColorStop(0.65, rgba(cs[1], 0.05)); body.addColorStop(1, rgba(cs[1], 0.18))
        ctx.fillStyle = body
        disc(0, ocy, br)
        ctx.fill()
        ctx.lineWidth = lw
        ctx.strokeStyle = rgba(cs[2], 0.4)
        ctx.stroke()
        ctx.lineCap = 'round'
        ctx.lineWidth = 2 * lw
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'
        ctx.beginPath(); ctx.arc(0, ocy, br * 0.87, Math.PI * 1.08, Math.PI * 1.34); ctx.stroke()
        ctx.globalCompositeOperation = 'lighter'
      }

      // wireframe globe
      if (level >= 1) {
        const M = mul(G, rotMat(0.25, Ph * 0.3, 0)), rho = 0.5 * ex, fine = nn(24)
        for (let k = 0; k < 6; k++) {
          const lon = (k * Math.PI) / 6
          path3(M, fine, (i, q) => { const la = -Math.PI / 2 + (i / fine) * Math.PI; q[0] = rho * Math.cos(la) * Math.sin(lon); q[1] = rho * Math.sin(la); q[2] = rho * Math.cos(la) * Math.cos(lon) }, 0, 1, 0.34)
        }
        for (const la of [-0.6, -0.3, 0, 0.3, 0.6]) {
          path3(M, nn(36), (i, q) => { const lo = (i / nn(36)) * TAU; q[0] = rho * Math.cos(la) * Math.sin(lo); q[1] = rho * Math.sin(la); q[2] = rho * Math.cos(la) * Math.cos(lo) }, 0, 1, 0.3, true)
        }
      }

      // tangled energy filaments
      {
        const count = level === 2 ? 9 : level === 1 ? 5 : 3, n = nn(64), ch = S.chaos
        for (let k = 0; k < count; k++) {
          const f = filaments[k], M = mul(G, rotMat(Ph * 0.3 * f.w + k, Ph * 0.22 + k * 0.7, k * 0.5)), rr = 0.44 * (0.75 + 0.25 * Math.sin(t * f.w + k)) * ex
          path3(M, n, (i, q) => {
            const v = (i / n) * TAU, wob = ch * 0.07 * Math.sin(v * 7 + t * 5 + k * 3)
            q[0] = rr * (f.amp[0] * Math.cos(f.f[0] * v + f.ph[0] + t * f.w) + wob)
            q[1] = rr * (f.amp[1] * Math.sin(f.f[1] * v + f.ph[1]) + wob)
            q[2] = rr * (f.amp[2] * Math.cos(f.f[2] * v + f.ph[2] + t * f.w * 0.7) + wob)
          }, 0, f.ci, (0.5 + 0.2 * Math.sin(t * 3 + k)) * (0.6 + 0.6 * ch), true)
        }
      }

      // gyroscope rings
      for (let k = 0; k < (level === 2 ? 5 : level === 1 ? 4 : 2); k++) {
        const r = RINGS[k], rad = r.r * ex, ph = Ph * r.spin
        const M = mul(G, rotMat(r.tx + r.px * Math.sin(t * 0.4 + k), r.ty + r.py * Math.cos(t * 0.33 + k), 0))
        const face = 0.4 + 0.6 * Math.abs(M[8])
        const circle = (rr, n, w, ci, base) => path3(M, n, (i, q) => { const a = (i / n) * TAU; q[0] = rr * Math.cos(a); q[1] = rr * Math.sin(a); q[2] = 0 }, w, ci, base * face, true)
        const arcs = (rr, count, span, n, w, ci, base) => {
          for (let j = 0; j < count; j++) {
            const a0 = ph + (j * TAU) / count
            path3(M, n, (i, q) => { const a = a0 + (span * i) / n; q[0] = rr * Math.cos(a); q[1] = rr * Math.sin(a); q[2] = 0 }, w, ci, base * face)
          }
        }
        if (r.kind === 'band') {
          circle(rad, nn(72), 0, r.ci, 0.55); circle(rad * 0.955, nn(72), 0, r.ci, 0.3); arcs(rad * 0.985, 5, 0.95, nn(10), 2, r.ci, 0.95)
        } else if (r.kind === 'ticks') {
          circle(rad, nn(72), 0, r.ci, 0.5)
          for (let i = 0; i < nn(72); i++) {
            const a = ph + (i / nn(72)) * TAU, long = i % (level === 2 ? 6 : 3) === 0, l = long ? 1.08 : 1.045
            proj(M, rad * Math.cos(a), rad * Math.sin(a), 0)
            const x0 = P[0], y0 = P[1], z0 = P[2]
            proj(M, rad * l * Math.cos(a), rad * l * Math.sin(a), 0)
            seg(0, r.ci, (long ? 0.8 : 0.45) * face * depth((z0 + P[2]) / 2) * bright, x0, y0, P[0], P[1])
          }
        } else if (r.kind === 'arcs') {
          arcs(rad, 3, 1.4, nn(18), 1, r.ci, 0.9); circle(rad * 1.06, nn(48), 0, r.ci, 0.3)
        } else if (r.kind === 'dash') {
          for (let i = 0; i < nn(36); i++) {
            const a0 = ph + (i / nn(36)) * TAU
            path3(M, 1, (j, q) => { const a = a0 + j * 0.09 * (level === 2 ? 1 : 2); q[0] = rad * Math.cos(a); q[1] = rad * Math.sin(a); q[2] = 0 }, 0, r.ci, 0.8 * face)
          }
        } else {
          circle(rad, nn(48), 0, r.ci, 0.7); circle(rad * 0.92, nn(48), 0, r.ci, 0.4)
          for (let i = 0; i < nn(24); i++) {
            const a = ph + (i / nn(24)) * TAU
            proj(M, rad * 0.8 * Math.cos(a), rad * 0.8 * Math.sin(a), 0)
            const x0 = P[0], y0 = P[1], z0 = P[2]
            proj(M, rad * 0.9 * Math.cos(a), rad * 0.9 * Math.sin(a), 0)
            seg(0, r.ci, 0.6 * depth((z0 + P[2]) / 2) * bright, x0, y0, P[0], P[1])
          }
        }
        // satellites riding the outer rings
        if (k === 0 || k === 3) {
          for (let j = 0; j < 2; j++) {
            const a = ph * (1.6 + j) + j * 3.1
            proj(M, rad * Math.cos(a), rad * Math.sin(a), 0)
            dots.push([P[0], P[1], Math.max(1.3, R * 0.03) * (0.7 + 0.3 * depth(P[2])), r.ci, 1])
          }
        }
      }

      // orbiting particles with short trails
      {
        const count = level === 2 ? 60 : level === 1 ? 24 : 8, M = G
        for (let i = 0; i < count; i++) {
          const q = parts[i], step = q.w * dt * SLOW * spin * (1 + 0.5 * S.hover)
          q.a += step
          const at = (a) => {
            const x = q.rho * ex * (1 - 0.1 * S.hover) * Math.cos(a), y = q.rho * ex * Math.sin(a) * Math.cos(q.inc), z0 = q.rho * ex * Math.sin(a) * Math.sin(q.inc)
            proj(M, x * Math.cos(q.node) + z0 * Math.sin(q.node), y, -x * Math.sin(q.node) + z0 * Math.cos(q.node))
          }
          at(q.a)
          const x1 = P[0], y1 = P[1], z1 = P[2]
          at(q.a - Math.sign(q.w) * 0.22)
          seg(0, q.ci, 0.6 * depth(z1) * bright, P[0], P[1], x1, y1)
          dots.push([x1, y1, Math.max(0.8, R * 0.012) * (0.6 + 0.8 * depth(z1)), q.ci, Math.min(1, 0.4 + 0.5 * depth(z1))])
        }
      }

      // Keyline pass: a dark edge under every stroke keeps the
      // core legible on any backdrop, light, dark or busy, without painting a halo around it.
      const widths = [1, 1.8, 3.2], key = [6, 12, 32], gain = Math.min(1.2, S.glow + 0.1)
      ctx.globalCompositeOperation = 'source-over'
      ctx.lineCap = 'round'
      for (let i = 0; i < paths.length; i++) {
        if (!paths[i]) continue
        ctx.lineWidth = (widths[Math.floor(i / 30)] + 1.8) * lw
        ctx.strokeStyle = rgba(key, LEVELS[i % 6] * 0.5)
        ctx.stroke(paths[i])
      }
      for (const d of dots) { ctx.fillStyle = rgba(key, 0.55 * d[4]); disc(d[0], d[1], d[2] + 1.2 * lw); ctx.fill() }

      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < paths.length; i++) {
        if (!paths[i]) continue
        ctx.lineWidth = widths[Math.floor(i / 30)] * lw
        ctx.strokeStyle = rgba(cs[Math.floor((i % 30) / 6)], Math.min(1, LEVELS[i % 6] * gain))
        ctx.stroke(paths[i])
      }
      for (const d of dots) { ctx.fillStyle = rgba(cs[d[3]], d[4]); disc(d[0], d[1], d[2]); ctx.fill() }

      // core
      {
        const cr = U * 0.13 * (1 + 0.08 * Math.sin(T * 1.1) + 0.14 * S.press) * (1 + 0.15 * S.hover)
        ctx.globalCompositeOperation = 'source-over'
        ctx.fillStyle = rgba(key, 0.45)
        disc(0, ocy, cr * 1.35)
        ctx.fill()
        ctx.globalCompositeOperation = 'lighter'
        const g = ctx.createRadialGradient(0, ocy, 0, 0, ocy, cr * 2.6)
        g.addColorStop(0, 'rgba(255,255,255,0.95)')
        g.addColorStop(0.28, rgba(cs[0], 0.95)); g.addColorStop(0.62, rgba(cs[1], 0.28 * S.glow)); g.addColorStop(1, rgba(cs[1], 0))
        ctx.fillStyle = g
        disc(0, ocy, cr * 2.6)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.97)'
        disc(0, ocy, cr * 0.5)
        ctx.fill()
      }

      // ripples: a shock ring around the orb
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i]
        r.age += dt
        const q = r.age / (r.big ? 2.4 : 1.8)
        if (q >= 1) { ripples.splice(i, 1); continue }
        const k = 1 - (1 - q) ** 3
        ctx.lineWidth = ((r.big ? 3 : 1.6) * (1 - q) + 0.4) * lw
        ctx.strokeStyle = rgba(cs[0], (r.big ? 0.8 : 0.55) * (1 - q))
        disc(0, ocy, U * (0.3 + 1.2 * k)); ctx.stroke()
      }
      ctx.globalCompositeOperation = 'source-over'
    }

    const draw = (dt) => {
      if (pal.dirty) refreshPalette()
      if (size < 8) return
      t += dt * SLOW
      T += dt
      const e = (rate) => 1 - Math.exp(-dt * rate)
      S.spin += (goal.spin - S.spin) * e(1.6); S.glow += (goal.glow - S.glow) * e(1.6); S.chaos += (goal.chaos - S.chaos) * e(1.5)
      S.gold += (goal.gold - S.gold) * e(1.5); S.ult += ((goal.ultron ? 1 : 0) - S.ult) * e(2)
      S.hover += (aim.hover - S.hover) * e(8); S.press += (aim.press - S.press) * e(14)
      S.mx += (aim.mx - S.mx) * e(6); S.my += (aim.my - S.my) * e(6)

      if (!mode) {
        if (size >= 96) {
          try { painter = createPainter(canvas) } catch (err) { console.warn('Lumen: WebGL unavailable, drawing the core with lines', err) }
          mode = painter ? 'own' : '2d'
        } else mode = sharedPainter() ? 'shared' : '2d'
      }

      const R = size / 2, u = S.ult
      const cs = [0, 1, 2, 3].map((i) => mixRgb(pal.c[i], ULTRON[i], u))
      cs.push(mixRgb(GOLD, ULTRON[1], u))
      cs[0] = mixRgb(cs[0], cs[4], S.gold)
      cs[1] = mixRgb(cs[1], cs[4], S.gold * 0.85)
      cs[2] = mixRgb(cs[2], mixRgb(cs[4], [255, 120, 40], 0.4), S.gold * 0.7)
      const spin = S.spin * (1 + 0.25 * S.hover)
      Ph += dt * SLOW * spin
      const ex = 1 + 0.04 * S.hover
      const G = rotMat(clamp(-S.my * 0.3, -0.35, 0.35) - 0.16, S.mx * 0.35 + Ph * 0.1, 0)
      if (mode === '2d') return draw2d(dt, { R, u, cs, spin, ex, G })

      const w = canvas.width, h = canvas.height, unit = (R / 64) * dpr
      const n = scene(dt, { cs, G, ex, u, unit, lod: R >= 44 ? 1 : R >= 22 ? 2 : 3 })
      const post = { unit, exp: 1.7, bloom: S.glow, white: 0.85 }
      if (mode === 'own') return painter.render(n, w, h, post)
      const g = sharedPainter()
      if (g.canvas.width < w || g.canvas.height < h) Object.assign(g.canvas, { width: Math.max(w, g.canvas.width), height: Math.max(h, g.canvas.height) })
      g.render(n, w, h, post)
      ctx ??= canvas.getContext('2d')
      ctx.globalCompositeOperation = 'copy'
      ctx.drawImage(g.canvas, 0, 0, w, h, 0, 0, w, h)
    }

    const core = {
      canvas, draw, orphan: 0,
      state(name) {
        const next = STATES[name] ?? STATES.idle
        if (next.ultron && !goal.ultron) ripples.push({ age: 0, big: true })
        goal = next
      },
      ping() { ripples.push({ age: 0 }) },
      pointer(x, y) { aim.mx = x; aim.my = y },
      hover(on) { aim.hover = on ? 1 : 0 },
      press(on) { aim.press = on ? 1 : 0 },
    }
    cores.add(core)
    return core
  }

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  let lastFrame = 0
  const frame = (now) => {
    requestAnimationFrame(frame)
    if (now - lastFrame < 24) return // the motion is slow: about 40 fps is plenty, and it spares high-refresh screens
    const dt = Math.min((now - lastFrame) / 1000, 0.05) * (reduced?.matches ? 0.25 : 1)
    lastFrame = now
    for (const core of cores) {
      if (!core.canvas.isConnected) { if (++core.orphan > 300) cores.delete(core); continue }
      core.orphan = 0
      if (core.canvas.getClientRects().length) core.draw(dt)
    }
  }
  requestAnimationFrame((now) => { lastFrame = now; frame(now) })

  registry.Presence = (p) => {
    const canvas = el('canvas', { class: 'lm-presence', 'aria-hidden': true })
    const core = makeCore(canvas)
    const comp = {
      el: canvas,
      core,
      update(p) {
        core.state(p.state ?? 'idle')
        if (p.size) canvas.style.setProperty('--s', len(p.size))
      },
    }
    comp.update(p)
    return comp
  }

  registry.Badge = (p) => {
    const root = el('span', { class: 'lm-badge' })
    const comp = {
      el: root,
      update(p) {
        setTone(root, p.tone ?? 'muted')
        root.replaceChildren(glyph(p.tone ?? 'muted'), el('span', {}, p.text ?? ''))
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Window: the irregular, text-free frame around the shell ----------
  // Messages to the host (an Electron or Tauri bridge exposes window.lumenHost; a framing page gets postMessage):
  //   { type: 'window', action: 'collapse', width, height, corner } the window is now the orb at that corner (ne, nw, se, sw);
  //                                                                 resize the OS window, keeping the corner where it is
  //   { type: 'window', action: 'expand', corner }                 the same, the other way
  //   { type: 'window', action: 'drag', phase: 'start' | 'end' }   a drag of the rail or the orb begins or ends; a host that
  //                                                                 can follow the system cursor moves the window itself
  //   { type: 'window', action: 'resize', phase: 'start' | 'end', edge }   a grip (n, ne, e, se, s, sw, w, nw) is held or let go; the
  //                                                                 host resizes the window after the system cursor
  //   { type: 'window', action: 'move', dx, dy }                    the drag moved by this much (screen pixels), for hosts that cannot
  const host = (msg) => {
    if (window.lumenHost) window.lumenHost(msg)
    else if (parent !== window) parent.postMessage(msg, '*')
  }
  const hosted = () => !!window.lumenHost || parent !== window
  const pts = (list) => `M${list.map((q) => `${+q[0].toFixed(2)},${+q[1].toFixed(2)}`).join('L')}Z`

  const windowShape = (W, H, u, m) => {
    const L = m, T = m, R = W - m, B = H - m
    const a = 1.6 * u, b = 0.7 * u, c = 2.2 * u, d = 0.7 * u, n = 0.5 * u, w = 1.6 * u
    const list = [[L + a, T]]
    const x1 = L + a + 7 * u
    if (R - b - x1 > 6 * u) list.push([x1, T], [x1 + n, T + n], [x1 + n + w, T + n], [x1 + 2 * n + w, T])
    list.push([R - b, T], [R, T + b], [R, B - c], [R - c, B])
    const x2 = R - c - 9 * u
    if (x2 - (L + d) > 6 * u) list.push([x2 + 2 * n + w, B], [x2 + n + w, B - n], [x2 + n, B - n], [x2, B])
    list.push([L + d, B], [L, B - d], [L, T + a])
    return list
  }
  registry.Window = (p, ctx) => {
    const svgIcon = (d) => el('svg', { viewBox: '0 0 16 16', 'aria-hidden': true }, el('path', { d }))
    const rim = el('path', { class: 'rim' }), echo = el('path', { class: 'echo' }), pips = el('path', { class: 'pip' })
    const art = el('svg', { class: 'lm-art', 'aria-hidden': true }, echo, pips, rim)

    const min = el('button', { class: 'lm-wbtn', type: 'button', title: '收起为球', 'aria-label': '收起为球' }, svgIcon('M3 8h10'))
    const close = el('button', { class: 'lm-wbtn', type: 'button', 'data-kind': 'close', title: '关闭窗口', 'aria-label': '关闭窗口' }, svgIcon('M4 4l8 8M12 4l-8 8'))
    // The header: the orb and a one-line summary of what the agents are doing; the whole band is the drag handle.
    const orb = registry.Presence({})
    const status = el('p', { class: 'lm-status', 'aria-live': 'polite' })
    const rail = el('div', { class: 'lm-rail', 'data-tauri-drag-region': '' }, orb.el, status, min, close)

    // Confirm dialog: lives inside the window and is clipped by its outline.
    const cancel = el('button', { class: 'lm-btn', type: 'button' }, '取消', el('kbd', {}, 'Esc'))
    const confirm = el('button', { class: 'lm-btn', type: 'button', 'data-kind': 'danger' }, '关闭窗口')
    const icon = el('svg', { class: 'lm-dlg-icon', viewBox: '0 0 48 48', 'aria-hidden': true },
      el('circle', { class: 'ring a', cx: 24, cy: 24, r: 21 }), el('circle', { class: 'ring b', cx: 24, cy: 24, r: 16 }),
      el('path', { class: 'glyph', d: 'M24 15v10M17.63 19.64a9 9 0 1 0 12.74 0', pathLength: 60 }))
    const dialog = el('div', { class: 'lm-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'lm-dlg-t', 'aria-describedby': 'lm-dlg-d' },
      el('i', { class: 'tape' }),
      el('div', { class: 'in' }, icon, el('div', { class: 'txt' }, el('h3', { id: 'lm-dlg-t' }, '关闭窗口？'), el('p', { id: 'lm-dlg-d' }, '关闭后，智能体将无法再在这里展示内容。')), el('div', { class: 'actions' }, cancel, confirm)))
    const modal = el('div', { class: 'lm-modal', hidden: true, role: 'presentation' }, dialog)

    const big = registry.Presence({})
    big.el.classList.add('lm-orb-big')
    const body = el('div', { class: 'lm-frame-body' })
    const view = el('div', { class: 'lm-view' }, rail, body, modal)
    const hit = el('button', { class: 'lm-cap-hit', type: 'button', 'aria-label': '展开窗口' })
    // Resize grips along the outline: the OS only resizes from the window's square edge, which the cut corners leave far
    // from where the eye aims.
    const grips = el('div', { class: 'lm-grips', 'aria-hidden': 'true' }, ...['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].map((edge) => el('i', { 'data-edge': edge })))
    const root = el('div', { class: 'lm-window', 'data-state': 'open', 'data-corner': 'ne', role: 'group' }, view, art, big.el, hit, grips)

    let base = 'idle', pos = { x: 0, y: 0 }

    const draw = () => {
      const W = root.clientWidth, H = root.clientHeight
      if (!W || !H) return
      const u = rem(), m = 2, collapsed = root.dataset.state === 'collapsed'
      let d
      if (collapsed) {
        d = ''
        rim.setAttribute('d', '')
        echo.setAttribute('d', '')
        pips.setAttribute('d', '')
      } else {
        d = pts(windowShape(W, H, u, m))
        rim.setAttribute('d', d)
        const L = m, T = m, R = W - m, B = H - m, a = 1.6 * u, c = 2.2 * u, d_ = 0.7 * u
        echo.setAttribute('d', `M${L + 5},${T + a + 2 + 4 * u}L${L + 5},${T + a + 2}L${L + a + 2},${T + 5}L${L + a + 2 + 4 * u},${T + 5}M${R - 5},${B - c - 2 - 4 * u}L${R - 5},${B - c - 2}L${R - c - 2},${B - 5}L${R - c - 2 - 4 * u},${B - 5}`)
        pips.setAttribute('d', W > 24 * u ? Array.from({ length: 4 }, (_, i) => `M${L + d_ + 1.6 * u + i * 0.8 * u},${B - 8}h2v2h-2z`).join('') : '')
      }
      view.style.clipPath = d ? `path('${d}')` : ''
    }
    watch(root, draw)
    document.addEventListener('lm-appearance', () => {
      if (document.documentElement.dataset.chrome === 'plain' && root.dataset.state === 'collapsed') setState('open')
    })

    // The window folds into the orb at its corner nearest the screen's edges (and unfolds from the orb's), so it opens toward
    // the middle of the screen. The fold plays inside the full-size window; only when it ends is the host asked to shrink
    // the real window, anchored at that corner, so nothing jumps.
    const corner = () => {
      if (!window.lumenHost) return 'ne'
      const left = screenX - (screen.availLeft ?? 0), top = screenY - (screen.availTop ?? 0)
      return (top <= screen.availHeight - top - outerHeight ? 'n' : 's') + (left < screen.availWidth - left - outerWidth ? 'w' : 'e')
    }
    let busy = false
    const wait = (ms) => (reduced?.matches ? 30 : ms)
    const easeInOut = (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2)
    const easeOut = (p) => 1 - (1 - p) ** 3
    const foldTo = (scale, alpha) => {
      view.style.transform = art.style.transform = `scale(${scale})`
      view.style.opacity = art.style.opacity = alpha
    }
    const clearFold = () => { view.style.transform = art.style.transform = ''; view.style.opacity = art.style.opacity = '' }
    // The cards have a sequence of their own around the fold: once the frame has opened they come out one after another,
    // nearest the orb first; before it folds they go back into it, farthest first. Web animations, so the cards' own
    // entry animation does not play again afterwards. Returns how long the cards take to leave.
    const flights = []
    const fly = (out) => {
      flights.splice(0).forEach((a) => a.cancel())
      if (reduced?.matches) return 0
      if (out) return launch(true)
      // Shown again, the cards' contents may lay themselves out anew: measure once that has settled, two frames on,
      // and keep the cards hidden until then.
      const hold = [...body.querySelectorAll('.lm-grid > *')].map((e) => e.animate([{ opacity: 0 }], { fill: 'forwards' }))
      requestAnimationFrame(() => requestAnimationFrame(() => {
        hold.forEach((a) => a.cancel())
        launch(false)
      }))
      return 0
    }
    const launch = (out) => {
      body.querySelector('.lm-grid')?.dispatchEvent(new Event('lm-pack'))
      const box = root.getBoundingClientRect(), cap = parseFloat(getComputedStyle(root).getPropertyValue('--cap-w')) || 128, c = root.dataset.corner
      const ox = c.endsWith('w') ? box.left + cap / 2 : box.right - cap / 2, oy = c.startsWith('s') ? box.bottom - cap / 2 : box.top + cap / 2
      const list = [...body.querySelectorAll('.lm-grid > *')].map((e) => {
        const r = e.getBoundingClientRect(), x = ox - (r.left + r.width / 2), y = oy - (r.top + r.height / 2)
        return { e, x, y, d: Math.hypot(x, y) || 1 }
      }).sort((a, b) => (out ? b.d - a.d : a.d - b.d))
      const [start, duration, step] = out ? [0, 260, Math.min(45, 450 / Math.max(1, list.length - 1))] : [260, 420, Math.min(60, 720 / Math.max(1, list.length - 1))]
      list.forEach(({ e, x, y, d }, i) => {
        const away = { opacity: 0, translate: `${(x / d) * 32}px ${(y / d) * 32}px`, scale: 0.9, filter: 'brightness(1.9)' }, home = { opacity: 1, translate: '0 0', scale: 1, filter: 'brightness(1)' }
        flights.push(e.animate(out ? [home, away] : [away, home], { duration, delay: start + i * step, easing: out ? 'cubic-bezier(.4, 0, 1, 1)' : 'cubic-bezier(.2, .8, .2, 1)', fill: out ? 'forwards' : 'backwards' }))
      })
      return list.length ? start + duration + step * (list.length - 1) : 0
    }
    const tween = (ms, ease, frame, done) => {
      const t0 = performance.now()
      const step = (now) => {
        const p = clamp((now - t0) / ms, 0, 1)
        frame(ease(p), p)
        if (p < 1) requestAnimationFrame(step); else done()
      }
      requestAnimationFrame(step)
    }
    const collapse = () => {
      if (busy || root.dataset.state !== 'open') return
      busy = true
      root.dataset.corner = corner()
      root.dataset.motion = 'to-orb'
      const lead = fly(true)
      // The cards go first, then the frame folds, and only once it has folded does the orb appear.
      setTimeout(() => tween(wait(440), easeInOut, (e, p) => foldTo(1 - 0.92 * e, p < 0.6 ? 1 - 0.5 * (p / 0.6) : 0.5 * (1 - (p - 0.6) / 0.4)), () => {
        root.dataset.state = 'collapsed'
        root.dataset.motion = 'orb'
        big.core.ping()
        setTimeout(() => { if (root.dataset.motion === 'orb') root.removeAttribute('data-motion') }, wait(360))
        clearFold()
        requestAnimationFrame(() => {
          const r = root.getBoundingClientRect()
          host({ type: 'window', action: 'collapse', width: Math.ceil(r.width), height: Math.ceil(r.height), corner: root.dataset.corner })
          draw()
          busy = false
        })
      }), Math.max(0, lead - 60))
    }
    const expand = () => {
      if (busy || root.dataset.state !== 'collapsed') return
      busy = true
      root.dataset.corner = corner()
      host({ type: 'window', action: 'expand', corner: root.dataset.corner })
      setTimeout(() => {
        pos = { x: 0, y: 0 }
        root.style.translate = ''
        root.dataset.state = 'open'
        root.dataset.motion = 'from-orb'
        fly(false)
        foldTo(0.08, 0)
        tween(wait(480), easeOut, (e, p) => foldTo(0.08 + 0.92 * e, p < 0.4 ? 0.5 * (p / 0.4) : 0.5 + 0.5 * ((p - 0.4) / 0.6)), () => {
          clearFold()
          root.removeAttribute('data-motion')
          draw()
          busy = false
        })
      }, hosted() ? 90 : 0)
    }
    const setState = (state) => (state === 'collapsed' ? collapse() : expand())
    min.addEventListener('click', () => setState('collapsed'))

    // The orb: hover leans the rings toward the pointer, press squeezes it, a short click expands, a drag moves it.
    const nativeDrag = () => !!window.__TAURI_INTERNALS__
    const moveBy = (dx, dy) => {
      if (hosted()) return host({ type: 'window', action: 'move', dx, dy })
      const W = root.clientWidth, H = root.clientHeight
      pos = { x: clamp(pos.x + dx, 80 - innerWidth, W - 80), y: clamp(pos.y + dy, 0, innerHeight - 40) }
      root.style.translate = `${pos.x}px ${pos.y}px`
    }
    const dragging = (on) => {
      root.toggleAttribute('data-dragging', on)
      if (hosted()) host({ type: 'window', action: 'drag', phase: on ? 'start' : 'end' })
    }
    let railDrag = null
    rail.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.lm-wbtn') || nativeDrag() || document.documentElement.dataset.chrome === 'plain') return
      rail.setPointerCapture(e.pointerId)
      railDrag = { x: e.screenX, y: e.screenY }
      dragging(true)
    })
    rail.addEventListener('pointermove', (e) => {
      if (!railDrag) return
      moveBy(e.screenX - railDrag.x, e.screenY - railDrag.y)
      railDrag.x = e.screenX
      railDrag.y = e.screenY
    })
    const endRail = () => {
      if (!railDrag) return
      railDrag = null
      dragging(false)
    }
    rail.addEventListener('pointerup', endRail)
    rail.addEventListener('lostpointercapture', endRail)
    grips.addEventListener('pointerdown', (e) => {
      const edge = e.target.dataset.edge
      if (e.button !== 0 || !edge || !hosted()) return
      e.target.setPointerCapture(e.pointerId)
      host({ type: 'window', action: 'resize', phase: 'start', edge })
      e.target.addEventListener('lostpointercapture', () => host({ type: 'window', action: 'resize', phase: 'end' }), { once: true })
    })
    let drag = null
    hit.addEventListener('pointerenter', () => big.core.hover(true))
    hit.addEventListener('pointerleave', () => { big.core.hover(false); big.core.pointer(0, 0) })
    hit.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      hit.setPointerCapture(e.pointerId)
      drag = { x: e.screenX, y: e.screenY, sx: e.screenX, sy: e.screenY, moved: false }
      big.core.press(true)
      big.core.ping()
    })
    hit.addEventListener('pointermove', (e) => {
      const r = hit.getBoundingClientRect()
      big.core.pointer(clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1), clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1))
      if (!drag) return
      if (!drag.moved && Math.hypot(e.screenX - drag.sx, e.screenY - drag.sy) < 5) return
      if (!drag.moved) dragging(true)
      drag.moved = true
      moveBy(e.screenX - drag.x, e.screenY - drag.y)
      drag.x = e.screenX
      drag.y = e.screenY
    })
    const release = (e) => {
      const was = drag
      drag = null
      if (was?.moved) dragging(false)
      big.core.press(false)
      if (was && !was.moved && e.type === 'pointerup') setState('open')
    }
    hit.addEventListener('pointerup', release)
    hit.addEventListener('lostpointercapture', release)
    hit.addEventListener('click', (e) => { if (e.detail === 0) setState('open') })

    const ask = (open) => {
      modal.hidden = !open
      root.toggleAttribute('data-confirm', open)
      if (open) cancel.focus(); else close.focus()
    }
    close.addEventListener('click', () => ask(true))
    cancel.addEventListener('click', () => ask(false))
    confirm.addEventListener('click', () => { ask(false); ctx.emit({ action: 'window.close' }) })
    modal.addEventListener('click', (e) => { if (e.target === modal) ask(false) })
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') ask(false)
      if (e.key === 'Tab') {
        const [first, last] = [cancel, confirm]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    })
    const comp = {
      el: root,
      slot: body,
      update(p) {
        base = p.presence ?? 'idle'
        big.core.state(base)
        orb.core.state(base)
        status.replaceChildren(p.status ?? '', p.status && base !== 'idle' ? el('span', { class: 'lm-caret' }) : '')
        root.setAttribute('aria-label', p.label ?? '')
      },
    }
    comp.update(p)
    // `collapsed` only says how the window starts: as the orb, without a fold.
    if (p.collapsed) {
      root.dataset.state = 'collapsed'
      requestAnimationFrame(() => {
        const cs = getComputedStyle(root)
        root.dataset.corner = corner()
        host({ type: 'window', action: 'collapse', width: parseFloat(cs.getPropertyValue('--cap-w')), height: parseFloat(cs.getPropertyValue('--cap-h')), corner: root.dataset.corner })
      })
    }
    return comp
  }

  // The shell is the scrolling workspace inside the window; it has no title bar of its own.
  // Panels form a mosaic: narrow columns, as many as the width allows, each panel at its own height wherever it sits
  // highest. A wide, low strip fills each column top to bottom instead and scrolls sideways. When the layout changes
  // the panels glide to their new places, and one that leaves fades out where it stood.
  const COL = 14 // rem, the narrowest column
  registry.Shell = (p) => {
    const grid = el('main', { class: 'lm-grid' })
    const ghosts = el('div', { class: 'lm-ghosts', 'aria-hidden': 'true' })
    const ws = el('div', { class: 'lm-workspace' }, el('div', { class: 'lm-stage' }, grid, ghosts))
    const root = el('div', { class: 'lm-shell' }, ws)
    const placed = new WeakMap()
    let flow = 'auto', fill = false, frame = 0

    const pack = () => {
      frame = 0
      const u = rem(), gap = parseFloat(getComputedStyle(grid).columnGap) || u
      const pad = parseFloat(getComputedStyle(ws).paddingTop) || 0
      const W = grid.clientWidth, H = ws.clientHeight - 2 * pad
      if (!W) return
      const across = flow === 'horizontal' || (flow === 'auto' && H > 0 && H < 28 * u && W > 1.8 * H)
      root.dataset.flow = across ? 'horizontal' : 'vertical'
      const cols = across ? Infinity : Math.max(1, Math.floor((W + gap) / (COL * u + gap)))
      const cw = across ? Math.min(24 * u, Math.max(16 * u, W * 0.3)) : (W - gap * (cols - 1)) / cols
      const items = [...grid.children].map((e) => ({ e, s: Math.min(parseInt(e.style.getPropertyValue('--span')) || 1, across ? 2 : cols) }))
      // Panels that all fit in one row share out the rest of it.
      let spare = across ? 0 : cols - items.reduce((n, it) => n + it.s, 0)
      for (let i = 0; spare > 0 && items.length; i = (i + 1) % items.length, spare--) items[i].s++
      const size = (it) => {
        Object.assign(it.e.style, { width: `${it.s * cw + (it.s - 1) * gap}px`, height: '', maxHeight: across ? `${H}px` : '' })
        it.h = it.e.offsetHeight
      }
      items.forEach(size)
      const tops = [], last = []
      const top = (c, s) => { let y = 0; for (let k = c; k < c + s; k++) y = Math.max(y, tops[k] ?? 0); return y }
      // A panel that is last in all its columns can grow down to `y` without covering anything.
      const reach = (it, y) => {
        if (!it || it.y + it.h + gap >= y || !last.slice(it.c, it.c + it.s).every((x) => x === it)) return
        it.h = y - gap - it.y
        it.grown = true
        for (let k = it.c; k < it.c + it.s; k++) tops[k] = y
      }
      items.forEach((it, i) => {
        let c = 0
        // Down: the columns where it sits highest. Across: the first columns it still fits under.
        if (across) while (top(c, it.s) && top(c, it.s) + it.h > H) c++
        else for (let k = 1; k + it.s <= cols; k++) if (top(k, it.s) < top(c, it.s)) c = k
        const y = top(c, it.s)
        if (!across) {
          for (let k = c; k < c + it.s; k++) reach(last[k], y)
          // Columns level with it that the next panel cannot use would stay empty beside it: it takes them.
          let a = c, b = c + it.s
          while (a > 0 && Math.abs((tops[a - 1] ?? 0) - y) < 1) a--
          while (b < cols && Math.abs((tops[b] ?? 0) - y) < 1) b++
          if (b - a > it.s && (items[i + 1]?.s ?? Infinity) > b - a - it.s) {
            Object.assign(it, { s: b - a })
            size(it)
            c = a
          }
        }
        Object.assign(it, { c, y })
        for (let k = c; k < c + it.s; k++) { tops[k] = y + it.h + gap; last[k] = it }
      })
      // Across, and down when asked to fill the window, the last panel of each column reaches the bottom.
      if (fill || across) for (const it of items) reach(it, H + gap)
      for (const it of items) if (it.grown) it.e.style.height = `${it.h}px`
      const fresh = items.filter((it) => !placed.has(it.e))
      for (const { e } of fresh) e.style.transition = 'none'
      for (const it of items) {
        it.e.style.transform = `translate(${it.c * (cw + gap)}px, ${it.y}px)`
        placed.set(it.e, it)
      }
      Object.assign(grid.style, across ? { width: `${Math.max(0, tops.length * (cw + gap) - gap)}px`, height: `${H}px` } : { width: '', height: `${Math.max(0, top(0, tops.length) - gap)}px` })
      if (fresh.length) void grid.offsetWidth
      for (const { e } of fresh) e.style.transition = ''
    }
    const later = () => { frame ||= requestAnimationFrame(pack) }
    const sizes = new ResizeObserver(later)
    sizes.observe(ws)
    new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => n instanceof Element && sizes.observe(n))
        // Not moved but gone: let it fade out where it stood, above the grid the renderer owns.
        r.removedNodes.forEach((n) => {
          if (n.parentNode || !placed.has(n)) return
          sizes.unobserve(n)
          n.classList.add('lm-leaving')
          ghosts.append(n)
          setTimeout(() => n.remove(), 600)
        })
      }
      later()
    }).observe(grid, { childList: true })
    grid.addEventListener('lm-layout', later)
    // Someone about to measure the panels needs them in place now, not on the next frame.
    grid.addEventListener('lm-pack', pack)

    const comp = {
      el: root,
      slot: grid,
      update(p) {
        fill = p.fit === 'fill'
        flow = p.flow ?? 'auto'
        later()
      },
    }
    comp.update(p)
    return comp
  }

  registry.Panel = (p) => {
    const h2 = el('h2'), meta = el('span', { class: 'meta' })
    const body = el('div', { class: 'lm-body' })
    const born = performance.now()
    burst = born - lastPanel < 200 ? Math.min(burst + 1, 9) : 0
    lastPanel = born
    const root = el('section', { class: 'lm-panel', style: `--i: ${burst}` }, el('i', { class: 'lm-sheen', 'aria-hidden': true }), el('header', { class: 'lm-head' }, h2, meta), body)
    let touched = 0
    root.addEventListener('lm-touch', () => {
      const now = performance.now()
      if (now - born < 1500 || now - touched < 900) return
      touched = now
      root.removeAttribute('data-touch')
      void root.offsetWidth
      root.setAttribute('data-touch', '')
    })
    const comp = {
      el: root,
      slot: body,
      update(p) {
        h2.textContent = p.title ?? ''
        meta.textContent = p.meta ?? ''
        meta.hidden = !p.meta
        root.style.setProperty('--span', p.span === 'full' ? 99 : p.span ?? 1)
        root.style.setProperty('--rows', p.rows ?? 1)
        root.dispatchEvent(new Event('lm-layout', { bubbles: true }))
        if (p.tone) root.style.setProperty('--edge', `color-mix(in oklab, var(--${p.tone === 'muted' ? 'text-3' : p.tone}) 55%, transparent)`); else root.style.removeProperty('--edge')
        root.toggleAttribute('data-scroll', !!p.scroll)
        if (p.maxHeight) root.style.setProperty('--max-h', len(p.maxHeight))
      },
    }
    comp.update(p)
    return comp
  }

  const flow = (cls) => (p) => {
    const root = el('div', { class: cls })
    const comp = {
      el: root,
      slot: root,
      update(p) {
        // A gap out of range is most likely pixels written by mistake (8 for 8px): keep the default rather than tear the panel apart.
        if (p.gap >= 0 && p.gap <= 4) root.style.setProperty('--gap', len(p.gap)); else root.style.removeProperty('--gap')
        if (p.align) root.style.setProperty('--align', p.align); else root.style.removeProperty('--align')
        if (p.min != null) root.style.setProperty('--min', len(p.min)); else root.style.removeProperty('--min')
        root.classList.toggle('lm-grow', !!p.grow)
      },
    }
    comp.update(p)
    return comp
  }
  registry.Stack = flow('lm-stack')
  registry.Row = flow('lm-row')
  registry.Grid = flow('lm-cgrid')

  registry.Heading = (p) => {
    const h1 = el('h1'), sub = el('p')
    const root = el('div', { class: 'lm-heading' }, h1, sub)
    const comp = { el: root, update(p) { h1.textContent = p.text ?? ''; sub.textContent = p.sub ?? ''; sub.hidden = !p.sub } }
    comp.update(p)
    return comp
  }

  registry.Text = (p) => {
    const root = el('p', { class: 'lm-text' })
    const comp = { el: root, update(p) { root.textContent = p.text ?? ''; if (p.size) root.dataset.size = p.size; else delete root.dataset.size } }
    comp.update(p)
    return comp
  }

  // The orb belongs to the window alone; a statement's state colours the rule beside it.
  const SAYING = { idle: 'muted', thinking: 'accent', acting: 'accent', alert: 'warn' }
  registry.Message = (p) => {
    const text = el('p')
    const root = el('div', { class: 'lm-msg' }, text)
    const comp = {
      el: root,
      update(p) {
        setTone(root, Object.hasOwn(SAYING, p.state) ? SAYING[p.state] : 'accent')
        text.textContent = p.text ?? ''
      },
    }
    comp.update(p)
    return comp
  }

  registry.Callout = (p) => {
    const root = el('div', { class: 'lm-callout' })
    const comp = {
      el: root,
      update(p) {
        setTone(root, p.tone ?? 'accent')
        root.replaceChildren(glyph(p.tone ?? 'accent'), p.title ? el('b', {}, p.title) : el('span'), p.text ? el('p', {}, p.text) : '')
      },
    }
    comp.update(p)
    return comp
  }

  registry.Divider = (p) => {
    const root = el('div', { class: 'lm-divider' })
    const comp = { el: root, update(p) { root.textContent = p.label ?? '' } }
    comp.update(p)
    return comp
  }

  registry.Button = (p, ctx) => {
    const root = el('button', { class: 'lm-btn', type: 'button' })
    let cur = p
    root.addEventListener('click', () => { if (!ctx.fire('press', { label: cur.label })) ctx.emit({ action: cur.action, params: cur.params }) })
    const comp = { el: root, update(p) { cur = p; root.textContent = p.label ?? ''; root.dataset.kind = p.kind ?? 'ghost' } }
    comp.update(p)
    return comp
  }

  registry.Code = (p) => {
    const code = el('code')
    const root = el('pre', { class: 'lm-code', tabindex: 0 }, code)
    const comp = { el: root, update(p) { code.textContent = p.text ?? '' } }
    comp.update(p)
    return comp
  }

  registry.KeyValue = (p) => {
    const root = el('dl', { class: 'lm-kv' })
    const comp = {
      el: root,
      update(p) {
        root.replaceChildren(...(p.items ?? []).map((i) => el('div', {}, el('dt', {}, i.k), el('dd', { 'data-mono': i.mono }, i.v))))
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Metric: the numeral fits its container, whatever its length ----------
  const spark = (data) => {
    const lo = Math.min(...data), r = Math.max(...data) - lo || 1
    const d = `M${data.map((v, i) => `${(i / (data.length - 1)) * 100},${22 - ((v - lo) / r) * 20}`).join('L')}`
    return el('svg', { class: 'lm-spark', viewBox: '0 0 100 24', preserveAspectRatio: 'none', 'aria-hidden': true }, el('path', { class: 'fill', d: `${d}L100,24L0,24Z` }), el('path', { d }))
  }

  registry.Metric = (p) => {
    const label = el('div', { class: 'lm-label' }), val = el('div', { class: 'val' }), line = el('div', { class: 'line' }, val), sub = el('div', { class: 'sub' })
    const root = el('div', { class: 'lm-metric' }, label, line, sub)
    const fit = () => {
      val.style.fontSize = ''
      val.classList.remove('wrap')
      const avail = root.clientWidth, w = val.offsetWidth
      if (!avail || w <= avail) return
      const size = (parseFloat(getComputedStyle(val).fontSize) * avail * 0.97) / w
      const numeric = /^[\s\d,.+\-−e%]+$/i.test(val.textContent)
      if (size < rem() * (numeric ? 0.9 : 1.3)) val.classList.add('wrap'); else val.style.fontSize = `${size}px`
    }
    watch(root, fit, 'x')
    const comp = {
      el: root,
      update(p) {
        setTone(root, p.tone)
        label.textContent = p.label ?? ''
        const v = typeof p.value === 'number' ? p.value.toLocaleString('en-US', { maximumFractionDigits: p.digits ?? 2 }) : (p.value ?? '—').replace(/,(?=\d)/g, ',​')
        val.replaceChildren(v, p.unit ? el('small', {}, p.unit) : '')
        line.querySelector('.lm-spark')?.remove()
        if (p.trend?.length > 1) line.append(spark(p.trend))
        sub.replaceChildren(p.delta ? el('span', { class: 'delta', 'data-tone': p.deltaTone }, p.delta) : '', p.hint ?? '')
        sub.hidden = !p.delta && !p.hint
        fit()
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Gauge: a ring of discrete blocks that light up ----------
  registry.Gauge = (p) => {
    const N = 36, r = 48
    const at = (deg) => [60 + r * Math.cos((deg * Math.PI) / 180), 60 + r * Math.sin((deg * Math.PI) / 180)]
    const blocks = Array.from({ length: N }, (_, i) => {
      const [x0, y0] = at(135 + (i * 270) / N + 1.3), [x1, y1] = at(135 + ((i + 1) * 270) / N - 1.3)
      return el('path', { class: 'blk', d: `M${x0},${y0}A${r},${r} 0 0 1 ${x1},${y1}` })
    })
    const b = el('b'), cap = el('span')
    const root = el('div', { class: 'lm-gauge' }, el('svg', { viewBox: '0 0 120 120', 'aria-hidden': true }, el('circle', { class: 'inner', cx: 60, cy: 60, r: 39 }), ...blocks), el('div', { class: 'read' }, b, cap))
    const comp = {
      el: root,
      update(p) {
        const max = p.max ?? 100, v = p.value ?? 0, lit = clamp(v / max, 0, 1) * N
        const [warn, err] = p.thresholds ?? []
        setTone(root, p.tone ?? (err != null && v >= err ? 'err' : warn != null && v >= warn ? 'warn' : null))
        const full = Math.floor(lit), part = lit - full > 0.05
        blocks.forEach((blk, i) => {
          blk.classList.toggle('on', i < full || (i === full && part))
          blk.style.opacity = i === full && part ? String(0.3 + 0.7 * (lit - full)) : ''
        })
        const text = typeof v !== 'number' ? String(v) : Math.abs(v) >= 1e4 ? fmtNum(v) : String(+v.toFixed(p.digits ?? 0))
        // The readout shrinks with its length, so it stays inside the ring in a narrow column.
        root.style.setProperty('--n', Math.max(3, text.length + 0.45 * String(p.unit ?? '').length))
        b.replaceChildren(text, p.unit ? el('small', {}, p.unit) : '')
        cap.textContent = p.label ?? ''
        cap.title = p.label ?? ''
      },
    }
    comp.update(p)
    return comp
  }

  const bar = (pct, tone) => el('div', { class: 'lm-track', style: `--p: ${clamp(pct, 0, 100)}%`, 'data-tone': tone }, el('i'))

  registry.Progress = (p) => {
    const cells = Array.from({ length: 40 }, () => el('i'))
    const label = el('span'), text = el('span')
    const root = el('div', { class: 'lm-progress' }, el('div', { class: 'top' }, label, text), el('div', { class: 'lm-blocks' }, ...cells))
    const comp = {
      el: root,
      update(p) {
        const pct = clamp(((p.value ?? 0) / (p.max ?? 100)) * 100, 0, 100)
        setTone(root, p.tone)
        label.textContent = p.label ?? ''
        text.textContent = p.text ?? `${Math.round(pct)}%`
        cells.forEach((c, i) => c.classList.toggle('on', i < Math.round((pct / 100) * cells.length)))
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Donut: a ring of separated sectors with a legend ----------
  registry.Donut = (p) => {
    const svg = el('svg', { viewBox: '0 0 120 120', class: 'lm-donut-svg', 'aria-hidden': true })
    const center = el('div', { class: 'c' }), legend = el('ul', { class: 'lg' })
    const root = el('div', { class: 'lm-donut' }, el('div', { class: 'ring' }, svg, center), legend)
    const comp = {
      el: root,
      update(p) {
        const items = (p.items ?? []).filter((i) => i.value > 0), total = items.reduce((n, i) => n + i.value, 0) || 1
        let acc = 0
        const gap = items.length > 1 ? 1.4 : 0
        svg.replaceChildren(el('circle', { class: 'inner', cx: 60, cy: 60, r: 31 }), ...items.map((it, i) => {
          const v = (it.value / total) * 100, len = Math.max(v - gap, 0.2)
          const c = el('circle', { class: 'seg', cx: 60, cy: 60, r: 44, pathLength: 100, 'stroke-dasharray': `${len} ${100 - len}`, 'stroke-dashoffset': -acc, 'data-tone': it.tone ?? `s${(i % 8) + 1}` }, el('title', {}, `${it.label} ${it.value}`))
          acc += v
          return c
        }))
        center.replaceChildren(el('b', {}, p.center ?? fmtNum(total)), p.label ? el('span', {}, p.label) : '')
        legend.replaceChildren(...items.map((it, i) => el('li', { 'data-tone': it.tone ?? `s${(i % 8) + 1}` }, el('i'), el('span', { title: it.label }, it.label), el('b', {}, `${Math.round((it.value / total) * 100)}%`))))
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Tiles: a grid of status cells, like a periodic table ----------
  registry.Tiles = (p) => {
    const root = el('div', { class: 'lm-tiles' })
    const comp = {
      el: root,
      update(p) {
        if (p.min != null) root.style.setProperty('--min', len(p.min)); else root.style.removeProperty('--min')
        root.replaceChildren(...(p.items ?? []).map((i) => el('div', { class: 'tile', 'data-tone': i.tone ?? 'muted', title: [i.label, i.sub].filter(Boolean).join(' ') }, i.sub ? el('small', {}, i.sub) : '', el('b', {}, i.label))))
      },
    }
    comp.update(p)
    return comp
  }

  registry.BarList = (p) => {
    const root = el('div', { class: 'lm-bars' })
    const comp = {
      el: root,
      update(p) {
        root.replaceChildren(...(p.items ?? []).map((i) => el('div', { class: 'lm-brow' }, el('span', { class: 'l', title: i.label }, i.label), bar((i.value / (i.max ?? p.max ?? 100)) * 100, i.tone), el('span', { class: 'v' }, i.text ?? `${fmtNum(i.value)}${p.unit ?? ''}`))))
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Steps ----------
  registry.Steps = (p) => {
    const root = el('ol', { class: 'lm-steps' })
    const comp = {
      el: root,
      update(p) {
        root.replaceChildren(...(p.items ?? []).map((i) => el('li', { class: 'lm-step', 'data-s': i.state ?? 'pending' }, el('span', { class: 'n' }), el('span', { class: 't' }, i.label), i.meta ? el('span', { class: 'm' }, i.meta) : '', i.detail ? el('span', { class: 'd' }, i.detail) : '')))
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Log: appends are animated, rebuilds are not ----------
  const LOG_TONE = { warn: 'warn', err: 'err', ok: 'ok' }
  registry.Log = (p) => {
    const root = el('div', { class: 'lm-log', tabindex: 0 })
    let prev = []
    const line = (l) => el('div', { class: 'lm-ln', 'data-lv': l.level ?? 'info', 'data-tone': LOG_TONE[l.level] }, el('time', {}, l.ts ?? ''), LOG_TONE[l.level] ? glyph(LOG_TONE[l.level]) : el('i'), el('span', {}, l.text))
    const comp = {
      el: root,
      update(p) {
        const lines = (p.lines ?? []).slice(-(p.maxLines ?? 400))
        const stick = root.scrollHeight - root.scrollTop - root.clientHeight < 24
        const append = prev.length > 0 && lines.length >= prev.length && lines[0] === prev[0]
        if (append) root.append(...lines.slice(prev.length).map(line)); else root.replaceChildren(...lines.map(line))
        prev = lines.slice()
        if (stick || !append) root.scrollTop = root.scrollHeight
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Table: becomes a list of cards when its container is narrow ----------
  registry.Table = (p) => {
    const root = el('div', { class: 'lm-table' })
    const comp = {
      el: root,
      update(p) {
        const all = p.rows ?? []
        const cols = p.columns ?? Object.keys(all[0] ?? {}).map((key) => ({ key, label: key }))
        const rows = all.slice(0, p.maxRows ?? 200)
        const cell = (c, v) => {
          if (c.kind === 'status') return registry.Badge({ text: v, tone: c.tones?.[v] }).el
          if (c.kind === 'bar') return el('span', { style: 'display: flex; align-items: center; gap: .6rem; min-width: 6rem' }, el('span', { style: 'flex: 1' }, bar(v, c.tone)), el('span', { class: 'num' }, `${v}%`))
          return v ?? ''
        }
        const num = (c) => (c.kind === 'num' || c.kind === 'mono' ? 'num' : null)
        root.replaceChildren(
          el('table', {}, el('thead', {}, el('tr', {}, cols.map((c) => el('th', { class: num(c) }, c.label ?? c.key)))), el('tbody', {}, rows.map((r) => el('tr', {}, cols.map((c) => el('td', { class: num(c), 'data-k': c.label ?? c.key }, cell(c, r[c.key]))))))),
          all.length > rows.length ? el('div', { class: 'more' }, `+${all.length - rows.length}`) : '',
        )
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Chart: drawn at real pixel size, so type and strokes stay crisp at any size ----------
  registry.Chart = (p) => {
    let cur = p, W = 0, H = 0, hover = null, geo = null
    const id = ++uid
    const svg = el('svg'), legend = el('div', { class: 'lm-legend' })
    const root = el('div', { class: 'lm-chart' }, legend, el('div', { class: 'lm-plot' }, svg))
    const plot = svg.parentNode

    const draw = () => {
      const series = (cur.series ?? []).filter((s) => s.data?.length)
      const kind = cur.kind ?? 'area', labels = cur.labels ?? [], N = Math.max(1, ...series.map((s) => s.data.length))
      const toneOf = (s, i) => s.tone ?? (series.length === 1 ? 'accent' : `s${(i % 8) + 1}`)
      const at = hover ?? N - 1
      const valueOf = (s) => {
        const v = s.data[Math.min(at, s.data.length - 1)]
        return v == null ? '' : `${fmtNum(v)}${cur.unit ?? ''}`
      }
      legend.replaceChildren(
        ...series.map((s, i) => (s.name || series.length > 1 ? el('span', { class: 'key', 'data-tone': toneOf(s, i), 'data-bar': kind === 'bar' || null }, el('i'), s.name ?? '', el('b', {}, valueOf(s))) : el('span', { class: 'key', 'data-tone': 'accent' }, el('b', {}, valueOf(s))))),
        hover != null && labels[hover] ? el('span', { class: 'at' }, labels[hover]) : '',
      )
      svg.replaceChildren()
      if (W < 60 || H < 50 || !series.length) return

      const u = rem(), all = series.flatMap((s) => s.data)
      let lo = cur.min ?? Math.min(0, ...all), hi = cur.max ?? Math.max(...all)
      if (hi <= lo) hi = lo + 1
      const step = nice((hi - lo) / clamp(Math.floor(H / (u * 5)), 2, 5))
      if (cur.max == null) hi = Math.ceil(hi / step - 1e-9) * step
      if (cur.min == null) lo = Math.floor(lo / step + 1e-9) * step
      const ticks = []
      for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(+v.toFixed(10))

      const ylab = ticks.map((t) => el('text', { 'text-anchor': 'end', 'dominant-baseline': 'central' }, fmtNum(t)))
      svg.append(...ylab)
      const left = Math.ceil(Math.max(...ylab.map((t) => t.getComputedTextLength()))) + u * 0.8
      const right = u * 0.8, top = u * 0.7, bottom = labels.length ? u * 2.1 : u * 1.2
      const pw = W - left - right, ph = H - top - bottom
      const x = (i) => (kind === 'bar' ? left + ((i + 0.5) / N) * pw : left + (N > 1 ? i / (N - 1) : 0.5) * pw)
      const y = (v) => top + (1 - (v - lo) / (hi - lo)) * ph
      geo = { left, pw, N, kind }
      ylab.forEach((t, i) => { t.setAttribute('x', left - u * 0.5); t.setAttribute('y', y(ticks[i])) })

      const out = [el('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' })]
      ticks.forEach((t, i) => out.push(el('line', { class: i === 0 ? 'bl' : 'gl', x1: left, x2: W - right, y1: y(t), y2: y(t) })))
      if (kind !== 'bar') {
        const every = Math.max(1, Math.ceil(N / (pw / 7)))
        for (let i = 0; i < N; i += every) out.push(el('line', { class: 'rt', x1: x(i), x2: x(i), y1: y(lo), y2: y(lo) + u * 0.3 }))
      }
      const xlab = []
      if (labels.length) {
        const n = clamp(Math.floor(pw / (u * 7)), 2, labels.length)
        for (let j = 0; j < n; j++) {
          const i = Math.round((j * (labels.length - 1)) / (n - 1))
          xlab.push(el('text', { x: x(i), y: H - u * 0.5, 'text-anchor': j === 0 ? 'start' : j === n - 1 ? 'end' : 'middle' }, labels[i]))
        }
      }
      series.forEach((s, si) => {
        const g = el('g', { 'data-tone': toneOf(s, si) })
        if (kind === 'bar') {
          const bw = clamp((pw / N) * 0.72 / series.length, 1.5, u * 1.8)
          s.data.forEach((v, i) => {
            const bx = x(i) - (bw * series.length) / 2 + si * bw, by = y(Math.max(v, 0))
            g.append(el('rect', { class: 'bar', x: bx, y: by, width: Math.max(bw - 1, 1), height: Math.max(Math.abs(y(0) - y(v)), 1), rx: 1, opacity: hover == null || hover === i ? 1 : 0.45 }))
          })
        } else {
          const d = `M${s.data.map((v, i) => `${x(i)},${y(v)}`).join('L')}`
          if (kind === 'area' && si === 0) {
            const gid = `lm-a${id}`
            g.append(el('defs', {}, el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, el('stop', { offset: 0, style: 'stop-color: var(--tone); stop-opacity: .28' }), el('stop', { offset: 1, style: 'stop-color: var(--tone); stop-opacity: 0' }))))
            g.append(el('path', { d: `${d}L${x(s.data.length - 1)},${y(lo)}L${x(0)},${y(lo)}Z`, fill: `url(#${gid})` }))
          }
          g.append(el('path', { class: 'ln', d }))
          const k = hover == null ? s.data.length - 1 : Math.min(hover, s.data.length - 1)
          if (hover == null) g.append(el('circle', { class: 'pulse', cx: x(k), cy: y(s.data[k]), r: 3 }))
          g.append(el('circle', { class: 'dot', cx: x(k), cy: y(s.data[k]), r: 3.2 }))
        }
        out.push(g)
      })
      if (hover != null && kind !== 'bar') out.push(el('line', { class: 'xh', x1: x(hover), x2: x(hover), y1: top, y2: y(lo) }))
      svg.append(...out, ...xlab)
      xlab.forEach((t) => fitText(t, pw / Math.max(xlab.length - 1, 1) - u * 0.6))
    }

    svg.addEventListener('pointermove', (e) => {
      if (!geo) return
      const px = e.clientX - svg.getBoundingClientRect().left - geo.left
      const f = geo.kind === 'bar' ? Math.floor((px / geo.pw) * geo.N) : Math.round((px / geo.pw) * (geo.N - 1))
      const i = clamp(f, 0, geo.N - 1)
      if (i !== hover) { hover = i; draw() }
    })
    svg.addEventListener('pointerleave', () => { hover = null; draw() })
    watch(plot, (w, h) => { W = w; H = h; draw() })
    return { el: root, update(p) { cur = p; draw() } }
  }

  // ---------- Topology: a fixed layout that scales to fit, so the diagram never reflows ----------
  registry.Topology = (p) => {
    let cur = p, k = 1
    const nodes = new Map()
    const svg = el('svg', { 'aria-hidden': true })
    const inner = el('div', { class: 'lm-topo-in' }, svg)
    const root = el('div', { class: 'lm-topo' }, inner)
    const edges = () => {
      const box = inner.getBoundingClientRect()
      const at = (id) => nodes.get(id)?.getBoundingClientRect()
      const X = (v) => (v - box.left) / k, Y = (v) => (v - box.top) / k
      svg.replaceChildren(...(cur.edges ?? []).map(([a, b]) => {
        const A = at(a), B = at(b)
        if (!A || !B) return null
        const cls = `e${cur.active === a || cur.active === b ? ' live' : ''}`
        const [U, L] = A.top <= B.top ? [A, B] : [B, A]
        if (Math.abs(A.top - B.top) < 4 * k) {
          const [l, r] = A.left <= B.left ? [A, B] : [B, A]
          const yy = Y(l.top + l.height / 2)
          return el('path', { class: cls, d: `M${X(l.right)},${yy}L${X(r.left)},${yy}` })
        }
        const ux = X(U.left + U.width / 2), uy = Y(U.bottom), lx = X(L.left + L.width / 2), ly = Y(L.top), m = (uy + ly) / 2
        return el('path', { class: cls, d: `M${ux},${uy}C${ux},${m} ${lx},${m} ${lx},${ly}` })
      }))
    }
    const fit = () => {
      const nw = inner.offsetWidth, nh = inner.offsetHeight, aw = root.clientWidth
      // Not shown (the window folded into the orb): measuring now would collapse it to nothing.
      if (!aw) return
      k = nw ? Math.max(Math.min(1, aw / nw), 0.3) : 1
      inner.style.transform = `scale(${k})`
      root.style.height = `${nh * k}px`
      edges()
    }
    watch(root, fit, 'x')
    document.fonts?.ready.then(fit)
    const comp = {
      el: root,
      update(p) {
        cur = p
        nodes.clear()
        inner.querySelectorAll('.lm-tier').forEach((t) => t.remove())
        inner.append(...(p.tiers ?? []).map((tier) => el('div', { class: 'lm-tier' }, tier.map((n) => {
          const d = el('div', { class: 'lm-tn', 'data-tone': n.tone ?? 'muted', 'data-active': p.active === n.id || null, title: n.label }, glyph(n.tone ?? 'muted'), el('b', {}, n.label), n.sub ? el('small', {}, n.sub) : '')
          nodes.set(n.id, d)
          return d
        }))))
        fit()
      },
    }
    comp.update(p)
    return comp
  }

  // ---------- Polar: radar chart ----------
  registry.Polar = (p) => {
    let cur = p, W = 0, H = 0
    const svg = el('svg')
    const root = el('div', { class: 'lm-polar' }, svg)
    const draw = () => {
      svg.replaceChildren()
      const axes = cur.axes ?? []
      if (axes.length < 3 || W < 80) return
      const u = rem(), max = cur.max ?? 100, n = axes.length, cx = W / 2, cy = H / 2
      const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n
      const labels = axes.map((a) => el('text', { 'dominant-baseline': 'central' }, a.label))
      svg.append(...labels)
      labels.forEach((t) => fitText(t, W * 0.3))
      const mw = Math.max(...labels.map((t) => t.getComputedTextLength()))
      const R = Math.max(Math.min(cx - mw - u * 1.5, cy - u * 1.6), u * 3)
      const pt = (i, v) => [cx + R * (v / max) * Math.cos(ang(i)), cy + R * (v / max) * Math.sin(ang(i))]
      const poly = (vals) => vals.map((v, i) => pt(i, clamp(v, 0, max)).join(',')).join(' ')
      labels.forEach((t, i) => {
        const a = ang(i), c = Math.cos(a)
        t.setAttribute('x', cx + (R + u * 0.7) * c)
        t.setAttribute('y', cy + (R + u * 0.7) * Math.sin(a))
        t.setAttribute('text-anchor', Math.abs(c) < 0.25 ? 'middle' : c > 0 ? 'start' : 'end')
      })
      svg.append(
        ...[0.25, 0.5, 0.75, 1].map((f) => el('polygon', { class: 'ring', points: axes.map((_, i) => [cx + R * f * Math.cos(ang(i)), cy + R * f * Math.sin(ang(i))].join(',')).join(' ') })),
        ...axes.map((_, i) => el('line', { class: 'spoke', x1: cx, y1: cy, x2: cx + R * Math.cos(ang(i)), y2: cy + R * Math.sin(ang(i)) })),
        cur.compare ? el('polygon', { class: 'ref', points: poly(cur.compare) }) : null,
        el('polygon', { class: 'area', points: poly(axes.map((a) => a.value)) }),
        ...axes.map((a, i) => el('circle', { class: 'pt', cx: pt(i, clamp(a.value, 0, max))[0], cy: pt(i, clamp(a.value, 0, max))[1], r: 3 }, el('title', {}, `${a.label}: ${a.value}`))),
      )
    }
    watch(root, (w, h) => { W = w; H = h; draw() })
    return { el: root, update(p) { cur = p; setTone(root, p.tone); draw() } }
  }

  // ---------- State, patches, renderer ----------
  // The spec follows json-render: { root, elements, state }. Props may use $state / $cond / $template / $item / $index / $bindState,
  // elements may carry `visible`, `repeat` and `on`; those are resolved by json-render's own core, bundled in vendor/json-render-core.js.
  const Core = window.JsonRenderCore
  const createStore = (init = {}) => Core.createStateStore(init)

  const UNSAFE = new Set(['__proto__', 'constructor', 'prototype'])
  const unescape = (k) => k.replace(/~1/g, '/').replace(/~0/g, '~')

  // ---------- Typewriter: text that changes fades in, left to right and line by line, about 100ms a line ----------
  // One soft-edged gradient per text line, all driven by one sweep, so each line finishes as the next begins. Only for words
  // a component has not shown yet: numbers ticking over, and a component redrawing what it already showed, are left alone.
  // Masks only, the DOM is not touched.
  try { CSS.registerProperty({ name: '--lm-type', syntax: '<length>', inherits: false, initialValue: '0px' }) } catch {}
  const shown = new WeakMap(), sweeps = new WeakMap()
  const words = (s) => s.replace(/[\d\s.,:;%+\-−/|·…()]+/g, '')
  const type = (e) => {
    const key = words(e.textContent ?? ''), host = e.closest('.lm-el') ?? e, seen = shown.get(host) ?? new Set()
    shown.set(host, seen)
    if (!key || seen.has(key)) return
    seen.add(key)
    if (seen.size > 300) seen.delete(seen.values().next().value)
    if (reduced?.matches) return
    const W = e.clientWidth, H = e.clientHeight
    if (!W || !H) return
    const cs = getComputedStyle(e), size = parseFloat(cs.fontSize), lh = parseFloat(cs.lineHeight) || size * 1.5
    const lines = Math.min(24, Math.max(1, Math.round(H / lh))), edge = 3 * size
    const layers = Array.from({ length: lines }, (_, i) => `linear-gradient(90deg, #000 calc(var(--lm-type) - ${i * W + edge}px), transparent calc(var(--lm-type) - ${i * W}px)) 0 ${i * lh}px / 100% ${i === lines - 1 ? H - i * lh : lh}px no-repeat`)
    e.style.mask = e.style.webkitMask = layers.join(', ')
    sweeps.get(e)?.cancel()
    const a = e.animate([{ '--lm-type': '0px' }, { '--lm-type': `${lines * W + edge}px` }], { duration: Math.min(1600, lines * 100) })
    sweeps.set(e, a)
    a.finished.then(() => (e.style.mask = e.style.webkitMask = ''), () => {})
  }
  // The block a piece of text lives in: inline runs (a bold word, a link) are revealed with the line they sit in.
  const block = (n) => {
    let e = n.nodeType === 1 ? n : n.parentElement
    while (e && e.parentElement && getComputedStyle(e).display === 'inline') e = e.parentElement
    return e
  }
  const typewriter = (mount) =>
    new MutationObserver((records) => {
      const blocks = new Set()
      const take = (t) => { if (t.data.trim() && !t.parentElement?.closest('svg, .lm-ghosts, .lm-orb-big')) blocks.add(block(t)) }
      for (const r of records) {
        if (r.type === 'characterData') take(r.target)
        else r.addedNodes.forEach((n) => {
          if (n.nodeType === 3) take(n)
          else if (n.nodeType === 1) for (const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); w.nextNode();) take(w.currentNode)
        })
      }
      blocks.forEach((e) => e && type(e))
    }).observe(mount, { subtree: true, childList: true, characterData: true })

  const createRenderer = ({ mount, store, onAction = () => {}, functions = {} }) => {
    const spec = { root: null, elements: {} }
    const nodes = new Map()
    let queued = false
    typewriter(mount)

    const ROOT = { key: '' }
    const touched = new Set() // elements the latest patches edited; their panels show it
    const scopeCtx = (scope) => ({ stateModel: store.getSnapshot(), repeatItem: scope.item, repeatIndex: scope.index, repeatBasePath: scope.base, functions })

    // Built-in actions change state locally; every other action is the agent's business and goes to the host.
    const dispatch = (id, binding, scope, extra = {}) => {
      const ctx = scopeCtx(scope)
      const params = Object.fromEntries(Object.entries(binding.params ?? {}).map(([k, v]) => [k, Core.resolveActionParam(v, ctx)]))
      const arr = (path) => (Array.isArray(store.get(path)) ? store.get(path) : [])
      if (binding.action === 'setState') store.set(params.statePath, params.value)
      else if (binding.action === 'pushState') store.set(params.statePath, [...arr(params.statePath), params.value])
      else if (binding.action === 'removeState') store.set(params.statePath, arr(params.statePath).filter((_, i) => i !== params.index))
      else onAction({ action: binding.action, params: { ...params, ...extra }, id, source: { type: spec.elements[id]?.type, label: extra.label } })
    }

    const sync = (id, scope, seen) => {
      const def = spec.elements[id], factory = def && registry[def.type]
      if (!factory) return []
      const ctx = scopeCtx(scope)
      const { container } = def.repeat ? Core.splitRepeatVisibility(def.visible) : { container: def.visible }
      if (container !== undefined && !Core.evaluateVisibility(container, ctx)) return []

      const raw = def.props ?? {}
      const props = Core.resolveElementProps(raw, ctx), bindings = Core.resolveBindings(raw, ctx) ?? {}
      const nodeKey = `${id}|${scope.key}`, key = JSON.stringify(props)
      seen.add(nodeKey)
      let n = nodes.get(nodeKey)
      if (!n || n.type !== def.type) {
        n = { type: def.type, key, bindings }
        n.comp = factory(props, {
          emit: (a) => onAction({ ...a, id }),
          // Run the element's `on[event]` bindings; false when it has none.
          fire(event, extra) {
            const on = spec.elements[id]?.on?.[event]
            if (!on) return false
            for (const b of [on].flat()) dispatch(id, b, scope, extra)
            return true
          },
          // Write a value back through a { $bindState } prop.
          write(prop, value) { if (n.bindings[prop]) store.set(n.bindings[prop], value) },
        })
        n.comp.el.classList.add('lm-el')
        nodes.set(nodeKey, n)
      } else {
        n.bindings = bindings
        if (n.key !== key) { n.comp.update(props); n.key = key }
      }

      let kids
      if (def.repeat) {
        const path = Core.resolveRepeatStatePath(def.repeat.statePath, scope.base)
        const items = path && Array.isArray(store.get(path)) ? store.get(path) : []
        const { itemFilter } = Core.splitRepeatVisibility(def.visible)
        kids = items.flatMap((item, index) => {
          const s = { item, index, base: `${path}/${index}`, key: `${scope.key}/${path}#${item?.[def.repeat.key] ?? index}` }
          if (itemFilter !== undefined && !Core.evaluateVisibility(itemFilter, scopeCtx(s))) return []
          return (def.children ?? []).flatMap((c) => sync(c, s, seen))
        })
      } else kids = (def.children ?? []).flatMap((c) => sync(c, scope, seen))

      if (n.comp.slot) {
        const slot = n.comp.slot
        kids.forEach((k, i) => { if (slot.children[i] !== k.comp.el) slot.insertBefore(k.comp.el, slot.children[i] ?? null) })
        while (slot.children.length > kids.length) slot.lastElementChild.remove()
      }
      return [n]
    }

    const render = () => {
      queued = false
      const seen = new Set()
      const [root] = spec.root ? sync(spec.root, ROOT, seen) : []
      for (const [k, n] of nodes) if (!seen.has(k)) { n.comp.destroy?.(); nodes.delete(k) }
      for (const id of touched) nodes.get(`${id}|`)?.comp.el.dispatchEvent(new Event('lm-touch', { bubbles: true }))
      touched.clear()
      if (root && mount.firstChild !== root.comp.el) mount.replaceChildren(root.comp.el)
    }
    const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(render) } }
    store.subscribe(schedule)

    // Paths under /state edit the state model; everything else edits { root, elements }.
    const patchState = (op, path, value) => {
      const i = path.lastIndexOf('/'), parentPath = path.slice(0, i), last = path.slice(i + 1)
      const parent = parentPath ? store.get(parentPath) : undefined
      if (op === 'remove') {
        if (Array.isArray(parent)) store.set(parentPath, parent.filter((_, j) => j !== +last))
        else if (parent && typeof parent === 'object') store.set(parentPath, Object.fromEntries(Object.entries(parent).filter(([k]) => k !== unescape(last))))
        else store.set(path, undefined)
      } else if (op === 'add' && Array.isArray(parent)) {
        const next = parent.slice()
        next.splice(last === '-' ? next.length : +last, 0, value)
        store.set(parentPath, next)
      } else store.set(path, value)
    }

    // JSON Patch (add / replace / remove) over { root, elements, state }, as streamed by the daemon.
    const patch = ({ op, path, value }) => {
      if (path === '/state' || path.startsWith('/state/')) {
        if (path === '/state') for (const [k, v] of Object.entries(value ?? {})) store.set(`/${k}`, v)
        else patchState(op, path.slice(6), value)
        return
      }
      const keys = path.split('/').slice(1).map(unescape)
      if (keys.some((k) => UNSAFE.has(k))) return
      if (keys[0] === 'elements' && keys[1]) touched.add(keys[1])
      const last = keys.pop()
      const target = keys.reduce((t, k) => (t[k] ??= {}), spec)
      if (op === 'remove') Array.isArray(target) ? target.splice(+last, 1) : delete target[last]
      else if (op === 'add' && Array.isArray(target)) last === '-' ? target.push(value) : target.splice(+last, 0, value)
      else target[last] = value
      schedule()
    }

    // Replace everything with a complete spec (a new connection, a session switch).
    const load = (next) => {
      spec.root = next.root ?? null
      spec.elements = next.elements ?? {}
      nodes.clear()
      mount.replaceChildren()
      for (const [k, v] of Object.entries(next.state ?? {})) store.set(`/${k}`, v)
      schedule()
    }
    return { patch, load, spec }
  }

  // Appearance lives on <html>: theme (dark | light), palette (ion | cryo | ember | phosphor | nebula | graphite),
  // chrome (drag | plain). The window frame and the orb look the same in both themes.
  // Omitted keys are left as they are.
  const configure = (opts) => {
    for (const k of ['theme', 'palette', 'chrome']) if (opts[k]) document.documentElement.dataset[k] = opts[k]
    document.dispatchEvent(new Event('lm-appearance'))
  }

  // Samples are what the gallery page renders: { group, title, span?, rows?, state?, tree: () => h(...) }.
  const h = (type, props = {}, ...children) => ({ type, props, children: children.flat() })

  window.Lumen = { createStore, createRenderer, registry, configure, h, samples: [], kit: { el, watch, clamp, setTone, len, fmtNum, nice, glyph, rem, pad2, fitText } }
})()
