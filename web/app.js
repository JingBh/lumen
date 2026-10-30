// The desktop window: renders whatever the daemon (in the main process) sends, follows the system theme.
;(() => {
  const dark = matchMedia('(prefers-color-scheme: dark)')
  const theme = () => Lumen.configure({ theme: dark.matches ? 'dark' : 'light', chrome: 'drag' })
  theme()
  dark.addEventListener('change', theme)

  const toast = (text) => {
    document.querySelector('.lm-toast')?.remove()
    document.body.append(Object.assign(document.createElement('div'), { className: 'lm-toast', textContent: text }))
    setTimeout(() => document.querySelector('.lm-toast')?.remove(), 2600)
  }

  const store = Lumen.createStore()
  const renderer = Lumen.createRenderer({
    mount: document.getElementById('app'),
    store,
    onAction: (a) => lumenIpc.send('action', a),
  })
  window.lumen = { renderer, store }
  lumenIpc.on('load', (spec) => renderer.load(spec))
  lumenIpc.on('patch', (ops) => ops.forEach((op) => renderer.patch(op)))
  lumenIpc.on('appearance', (a) => Lumen.configure(a))
  lumenIpc.on('toast', toast)

  // Only the window's own shape takes the mouse; the transparent rest of the OS window lets clicks through.
  let over = true
  document.addEventListener('mousemove', (e) => {
    if (e.buttons) return // a drag keeps the mouse until it ends, wherever the pointer goes
    const now = !!document.elementFromPoint(e.clientX, e.clientY)?.closest('.lm-view, .lm-cap-hit, .lm-orb-big, .lm-grips')
    if (now !== over) lumenHost({ type: 'pointer', over: (over = now) })
  })
  document.addEventListener('mouseleave', () => { if (over) lumenHost({ type: 'pointer', over: (over = false) }) })

  // Right-click on the orb or the drag rail opens the app menu (built natively by the main process).
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    if (e.target.closest('.lm-rail, .lm-cap-hit, .lm-orb-big')) lumenIpc.send('menu')
  })
  lumenIpc.send('ready')
})()
