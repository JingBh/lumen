import { Tray, app, clipboard, dialog, ipcMain, nativeImage, powerMonitor, shell } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { LUMEN_DIR, loadConfig } from '../daemon/config'
import { DEFAULT_PORT, loadToken, startHookServer } from '../daemon/server'
import { Director } from '../daemon/director'
import { AppWindow, type HostMessage } from './window'
import { clearRuntime, writeRuntime } from './hooks'
import { buildMenu } from './menu'
import { loadSettings, saveSettings } from './settings'

if (!app.requestSingleInstanceLock()) app.exit(0)
app.setName('Lumen')

const log = (message: string): void => {
  const line = `${new Date().toISOString()} ${message}`
  console.log(line)
  try {
    mkdirSync(LUMEN_DIR, { recursive: true })
    appendFileSync(join(LUMEN_DIR, 'lumen.log'), `${line}\n`)
  } catch {
    // logging must never take the app down
  }
}

// A ring with a dot, drawn as a template image so the menu bar tints it.
const trayIcon = (): Electron.NativeImage => {
  const size = 32, buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 15.5, y - 15.5)
      const a = Math.max(0, Math.min(1, 1.3 - Math.abs(d - 11.5))) + Math.max(0, Math.min(1, 1.3 - d / 3.2))
      const i = (y * size + x) * 4
      buf[i + 3] = Math.round(255 * Math.min(1, a))
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 })
  img.setTemplateImage(true)
  return img
}

void app.whenReady().then(async () => {
  const settings = loadSettings()
  const config = loadConfig()
  const token = loadToken()
  const appWindow = new AppWindow(settings, app.getAppPath())
  const send = (channel: string, payload?: unknown): void => {
    if (!appWindow.win.isDestroyed()) appWindow.win.webContents.send(`lumen:${channel}`, payload)
  }

  const director = new Director(config, {
    load: (spec) => send('load', spec),
    patch: (ops) => send('patch', ops),
    log
  })
  // The screen can be seen while the window is open and the screen is not locked.
  let locked = false
  const watched = (): void => director.setVisible(!appWindow.collapsed && !locked)
  appWindow.onVisibility = watched
  powerMonitor.on('lock-screen', () => {
    locked = true
    watched()
  })
  powerMonitor.on('unlock-screen', () => {
    locked = false
    watched()
  })

  let server: Awaited<ReturnType<typeof startHookServer>> | undefined
  let port = DEFAULT_PORT
  for (; port < DEFAULT_PORT + 10 && !server; port++) {
    try {
      server = await startHookServer(director, token, port, log)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e
    }
  }
  if (!server) {
    dialog.showErrorBox('Lumen', `端口 ${DEFAULT_PORT}–${DEFAULT_PORT + 9} 都被占用，无法接收 Claude Code 的 hook。`)
    app.exit(1)
    return
  }
  writeRuntime(port - 1, token)
  director.start()
  log(`hook server on 127.0.0.1:${port - 1}`)

  const toast = (text: string): void => send('toast', text)

  const handleAction = (a: { action?: string; params?: Record<string, unknown>; id?: string; source?: { type?: string; label?: string } }): void => {
    const p = a.params ?? {}
    if (a.action === 'window.close') quit()
    else if (a.action === 'send') {
      const text = String(p.text ?? '').trim().slice(0, 4000)
      if (!text) return
      const session = director.addAction(String(p.label ?? a.source?.label ?? '界面输入'), text, a.source?.type === 'Input', typeof p.to === 'string' ? p.to : undefined)
      if (!session) return toast('没有可以接收的智能体')
      toast(`${session.name}：${session.presence === 'idle' ? '已记录，会在你下次与它对话时一并送达' : '已记录，智能体下一次操作时会收到'}`)
    } else if (a.action === 'dismiss' && a.id) director.dismiss(a.id, String(p.label ?? ''))
    else if (a.action === 'open_url') {
      const url = String(p.url ?? '')
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    } else if (a.action === 'copy') clipboard.writeText(String(p.text ?? '').slice(0, 20_000))
  }

  let quitting = false
  const quit = (): void => {
    if (quitting) return
    quitting = true
    clearRuntime()
    server?.close()
    director.dispose()
    app.exit(0)
  }
  app.on('before-quit', (e) => {
    e.preventDefault()
    quit()
  })
  process.on('SIGTERM', quit)
  process.on('SIGINT', quit)

  const appearance = (): void => send('appearance', { palette: settings.palette })

  ipcMain.on('lumen:ready', (e) => {
    if (e.sender !== appWindow.win.webContents) return
    appearance()
    director.connect()
  })
  ipcMain.on('lumen:host', (e, m: HostMessage) => {
    if (e.sender === appWindow.win.webContents) appWindow.handle(m)
  })
  ipcMain.on('lumen:action', (e, a) => {
    if (e.sender === appWindow.win.webContents) handleAction(a)
  })
  const menu = (): Electron.Menu =>
    buildMenu(
      { palette: settings.palette, paused: director.paused },
      {
        palette: (id) => {
          settings.palette = id
          saveSettings(settings)
          appearance()
        },
        pause: (paused) => director.setPaused(paused),
        reset: () => void director.reset(),
        quit
      }
    )
  ipcMain.on('lumen:menu', (e) => {
    if (e.sender === appWindow.win.webContents) menu().popup({ window: appWindow.win })
  })

  // With no dock icon and no title bar, the menu bar is the way back to the menu if the window is out of reach.
  app.dock?.hide()
  const tray = new Tray(trayIcon())
  tray.setToolTip('Lumen')
  tray.on('click', () => tray.popUpContextMenu(menu()))
  tray.on('right-click', () => tray.popUpContextMenu(menu()))

  app.on('second-instance', () => appWindow.reveal())
  if (process.env.LUMEN_DEVTOOLS) appWindow.win.webContents.openDevTools({ mode: 'detach' })
})
