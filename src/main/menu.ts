import { Menu, type MenuItemConstructorOptions } from 'electron'

export const PALETTES: [string, string][] = [['cryo', '低温'], ['ion', '离子'], ['ember', '余烬'], ['phosphor', '磷光'], ['nebula', '星云'], ['graphite', '石墨']]

export interface MenuState {
  palette: string
  paused: boolean
  /** The screen's local network URLs, while devices there may open it. */
  lan?: string[]
}

export interface MenuActions {
  palette(id: string): void
  pause(paused: boolean): void
  reset(): void
  lan(on: boolean): void
  copy(text: string): void
  quit(): void
}

export const buildMenu = (state: MenuState, act: MenuActions): Menu =>
  Menu.buildFromTemplate([
    { label: '配色', submenu: PALETTES.map(([id, name]) => ({ label: name, type: 'radio', checked: state.palette === id, click: () => act.palette(id) })) },
    { type: 'separator' },
    { label: '暂停摘要（不再调用模型）', type: 'checkbox', checked: state.paused, click: (item) => act.pause(item.checked) },
    { label: '重新整理全部内容', click: act.reset },
    { type: 'separator' },
    { label: '允许局域网访问', type: 'checkbox', checked: !!state.lan, click: (item) => act.lan(item.checked) },
    ...(state.lan
      ? [{ label: '查看 URL', submenu: state.lan.length ? state.lan.map((url) => ({ label: url, click: () => act.copy(url) })) : [{ label: '没有局域网地址', enabled: false }] } satisfies MenuItemConstructorOptions]
      : []),
    { type: 'separator' },
    { label: '退出 Lumen', click: act.quit }
  ])
