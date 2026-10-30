import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Settings {
  palette: string
  /** Top-right corner of the window, in screen coordinates: the orb and the open window both hang from it. */
  anchor?: { x: number; y: number }
  size: { w: number; h: number }
}

const file = (): string => join(app.getPath('userData'), 'settings.json')

export const loadSettings = (): Settings => {
  const defaults: Settings = { palette: 'cryo', size: { w: 520, h: 780 } }
  try {
    return { ...defaults, ...(JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>) }
  } catch {
    return defaults
  }
}

export const saveSettings = (settings: Settings): void => writeFileSync(file(), JSON.stringify(settings, null, 2))
