import { Menu } from 'electron'

export const PALETTES: [string, string][] = [['cryo', '低温'], ['ion', '离子'], ['ember', '余烬'], ['phosphor', '磷光'], ['nebula', '星云'], ['graphite', '石墨']]

export interface MenuState {
  palette: string
  paused: boolean
}

export interface MenuActions {
  palette(id: string): void
  pause(paused: boolean): void
  reset(): void
  quit(): void
}

export const buildMenu = (state: MenuState, act: MenuActions): Menu =>
  Menu.buildFromTemplate([
    { label: '配色', submenu: PALETTES.map(([id, name]) => ({ label: name, type: 'radio', checked: state.palette === id, click: () => act.palette(id) })) },
    { type: 'separator' },
    { label: '暂停摘要（不再调用模型）', type: 'checkbox', checked: state.paused, click: (item) => act.pause(item.checked) },
    { label: '重新整理全部内容', click: act.reset },
    { type: 'separator' },
    { label: '退出 Lumen', click: act.quit }
  ])
