// Talk to a running Lumen over the Chrome DevTools protocol (start it with: electron . --remote-debugging-port=9333)
//   node scripts/cdp.mjs eval "<js>"         evaluate in the page, print the result
//   node scripts/cdp.mjs shot out.png        screenshot the page
//   node scripts/cdp.mjs bounds              OS window bounds and state
import { writeFileSync } from 'node:fs'

const port = process.env.CDP_PORT ?? 9333
const [cmd, arg] = process.argv.slice(2)
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('file://') && t.url.endsWith('/app.html'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let n = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) pending.get(m.id)(m)
}
const call = (method, params = {}) => new Promise((res) => { const id = ++n; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })) })

if (cmd === 'eval') {
  const r = await call('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true })
  console.log(JSON.stringify(r.result.result.value ?? r.result.exceptionDetails ?? r.result.result, null, 2))
} else if (cmd === 'shot') {
  const r = await call('Page.captureScreenshot', { format: 'png', fromSurface: true })
  writeFileSync(arg, Buffer.from(r.result.data, 'base64'))
  console.log('wrote', arg)
} else if (cmd === 'bounds') {
  const w = await call('Browser.getWindowForTarget')
  console.log(JSON.stringify(w.result))
}
ws.close()
