// The page Lumen serves on the local network while that is allowed: the window's screen, live and read-only. It cannot
// fold or move; its one button fills the screen, which shows the window without its drag rail.
;(() => {
  const fits = () => Lumen.configure({ chrome: document.fullscreenElement || !document.fullscreenEnabled ? 'plain' : 'drag' })
  Lumen.configure({ theme: 'dark', controls: 'fullscreen' })
  fits()
  document.addEventListener('fullscreenchange', fits)

  // The window fills what is in view, toolbars or not, and the page does not zoom. Safari ignores user-scalable=no, but
  // not its own gesture events, which a pinch makes; and it zooms on a double tap inside the scrolling workspace
  // whatever touch-action says, unless the tap that ends it is cancelled.
  const view = () => document.documentElement.style.setProperty('--view-h', `${window.visualViewport?.height ?? innerHeight}px`)
  view()
  window.visualViewport?.addEventListener('resize', view)
  addEventListener('resize', view)
  for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, (e) => e.preventDefault())
  let tapped = 0
  document.addEventListener('touchend', (e) => {
    if (e.timeStamp - tapped < 350) e.preventDefault()
    tapped = e.timeStamp
  })

  const toast = (text) => {
    document.querySelector('.lm-toast')?.remove()
    document.body.append(Object.assign(document.createElement('div'), { className: 'lm-toast', textContent: text }))
    setTimeout(() => document.querySelector('.lm-toast')?.remove(), 2600)
  }

  const renderer = Lumen.createRenderer({
    mount: document.getElementById('app'),
    store: Lumen.createStore(),
    onAction: (a) => (a.action === 'open_url' && /^https?:\/\//i.test(a.params?.url ?? '') ? open(a.params.url, '_blank', 'noopener') : toast('这里只能查看')),
  })
  // Lumen sends the whole screen when the page connects (and again after a reconnect), then each change.
  const events = new EventSource('events')
  events.addEventListener('load', (e) => {
    const spec = JSON.parse(e.data)
    spec.elements.window.props.collapsed = false
    renderer.load(spec)
  })
  events.addEventListener('patch', (e) => JSON.parse(e.data).forEach((op) => renderer.patch(op)))
  events.addEventListener('appearance', (e) => Lumen.configure(JSON.parse(e.data)))
})()
