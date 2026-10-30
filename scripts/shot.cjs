// Screenshot a page with Electron: electron scripts/shot.cjs <url> <out.png> [width] [height] [waitMs] [js]
// `js` runs in the page before the capture. Console output and page errors are printed.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')

const [url, out, w = '1280', h = '800', wait = '1500', js] = process.argv.slice(2)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: +w, height: +h, show: false, useContentSize: true, transparent: false, webPreferences: { backgroundThrottling: false, offscreen: false } })
  win.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
    if (level === 'error' || level === 'warning' || message.startsWith('action')) console.log(`[console ${level}] ${message} (${sourceId.split('/').pop()}:${lineNumber})`)
  })
  win.webContents.on('render-process-gone', (_e, d) => console.log('[gone]', d.reason))
  await win.loadURL(url)
  await new Promise((r) => setTimeout(r, +wait))
  if (js) console.log('[js]', JSON.stringify(await win.webContents.executeJavaScript(js)))
  await new Promise((r) => setTimeout(r, 200))
  const img = await win.webContents.capturePage()
  fs.writeFileSync(out, img.toPNG())
  console.log('wrote', out, img.getSize())
  app.quit()
})
