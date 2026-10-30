import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { type Corner, type Settings, saveSettings } from './settings'

const MIN = { w: 360, h: 300 }

export interface HostMessage {
  type?: string
  action?: string
  width?: number
  height?: number
  dx?: number
  dy?: number
  phase?: 'start' | 'end'
  edge?: string
  corner?: Corner
  over?: boolean
}

/**
 * The floating window. It is always the same OS window: folded it is the orb (a small square), open it is the screen.
 * Both hang from one anchor, the corner the page picks as it folds or unfolds, so neither moves that corner.
 */
export class AppWindow {
  readonly win: BrowserWindow
  collapsed = true
  onVisibility: (visible: boolean) => void = () => {}
  private size = { w: 128, h: 128 }
  private follow?: NodeJS.Timeout

  constructor(
    private settings: Settings,
    root: string
  ) {
    this.win = new BrowserWindow({
      ...this.fit(this.size.w, this.size.h),
      frame: false,
      transparent: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      show: false,
      title: 'Lumen',
      webPreferences: { preload: join(root, 'dist/main/preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, spellcheck: false }
    })
    this.win.setAlwaysOnTop(true, 'floating')
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    this.win.once('ready-to-show', () => this.win.showInactive())
    this.win.on('resized', () => {
      if (this.collapsed) return
      const b = this.win.getBounds()
      this.settings.size = { w: b.width, h: b.height }
      this.remember()
    })
    this.win.on('moved', () => this.remember())
    void this.win.loadFile(join(root, 'web/app.html'))
  }

  private get corner(): Corner {
    return this.settings.corner ?? 'ne'
  }

  /** Where the anchored corner is, defaulting to the top-right of the main display. */
  private anchor(): { x: number; y: number } {
    const saved = this.settings.anchor
    const display = saved ? screen.getDisplayNearestPoint(saved) : screen.getPrimaryDisplay()
    const wa = display.workArea
    const a = saved ?? { x: wa.x + wa.width - 24, y: wa.y + 24 }
    return { x: Math.min(Math.max(a.x, wa.x), wa.x + wa.width), y: Math.min(Math.max(a.y, wa.y), wa.y + wa.height) }
  }

  /** Anchor at `corner` of the window as it is now. */
  private remember(corner = this.corner): void {
    const b = this.win.getBounds()
    this.settings.corner = corner
    this.settings.anchor = { x: corner.endsWith('e') ? b.x + b.width : b.x, y: corner.startsWith('s') ? b.y + b.height : b.y }
    saveSettings(this.settings)
  }

  private fit(w: number, h: number): Electron.Rectangle {
    const a = this.anchor(), c = this.corner
    const wa = screen.getDisplayNearestPoint(a).workArea
    const width = Math.min(w, wa.width), height = Math.min(h, wa.height)
    const x = c.endsWith('e') ? a.x - width : a.x, y = c.startsWith('s') ? a.y - height : a.y
    return { x: Math.min(Math.max(x, wa.x), wa.x + wa.width - width), y: Math.min(Math.max(y, wa.y), wa.y + wa.height - height), width, height }
  }

  handle(m: HostMessage): void {
    // Transparent parts of the window let clicks through to whatever is behind it.
    if (m.type === 'pointer') return this.win.setIgnoreMouseEvents(!m.over, { forward: true })
    if (m.type !== 'window') return
    if (m.action === 'collapse' && m.width && m.height) {
      if (!this.collapsed) {
        const b = this.win.getBounds()
        this.settings.size = { w: b.width, h: b.height }
      }
      this.collapsed = true
      this.remember(m.corner)
      this.size = { w: Math.round(m.width), h: Math.round(m.height) }
      this.win.setResizable(false)
      this.win.setMinimumSize(1, 1)
      this.win.setBounds(this.fit(this.size.w, this.size.h))
      this.onVisibility(false)
    } else if (m.action === 'expand') {
      this.collapsed = false
      this.remember(m.corner)
      this.win.setMinimumSize(MIN.w, MIN.h)
      this.win.setBounds(this.fit(this.settings.size.w, this.settings.size.h))
      this.win.setResizable(true)
      this.win.focus()
      this.onVisibility(true)
    } else if (m.action === 'drag') {
      // Follow the system cursor rather than the page's event coordinates, which lag behind a moving window.
      clearInterval(this.follow)
      this.follow = undefined
      if (m.phase === 'start') {
        const c = screen.getCursorScreenPoint(), [x, y] = this.win.getPosition(), dx = c.x - x, dy = c.y - y
        this.follow = setInterval(() => {
          const p = screen.getCursorScreenPoint()
          this.win.setPosition(p.x - dx, p.y - dy)
        }, 8)
      } else this.remember()
    } else if (m.action === 'resize') {
      // The same for a grip: the edges it names follow the cursor, the others stay put.
      clearInterval(this.follow)
      this.follow = undefined
      if (m.phase === 'start' && m.edge) {
        const e = m.edge, c = screen.getCursorScreenPoint(), b = this.win.getBounds()
        this.follow = setInterval(() => {
          const p = screen.getCursorScreenPoint()
          const width = Math.max(MIN.w, b.width + (e.includes('e') ? p.x - c.x : e.includes('w') ? c.x - p.x : 0))
          const height = Math.max(MIN.h, b.height + (e.includes('s') ? p.y - c.y : e.includes('n') ? c.y - p.y : 0))
          this.win.setBounds({ x: e.includes('w') ? b.x + b.width - width : b.x, y: e.includes('n') ? b.y + b.height - height : b.y, width, height })
        }, 8)
      } else if (!this.collapsed) {
        const b = this.win.getBounds()
        this.settings.size = { w: b.width, h: b.height }
        this.remember()
      }
    } else if (m.action === 'move' && !this.follow && typeof m.dx === 'number' && typeof m.dy === 'number') {
      const [x, y] = this.win.getPosition()
      this.win.setPosition(Math.round(x + m.dx), Math.round(y + m.dy))
      this.remember()
    }
  }

  /** Bring the window back into view (a second launch, a menu click). */
  reveal(): void {
    if (this.win.isMinimized()) this.win.restore()
    this.win.showInactive()
  }
}
