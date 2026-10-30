import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LUMEN_DIR } from '../daemon/config'

const CURL_CONF = join(LUMEN_DIR, 'curl.conf')

/**
 * The plugins in plugins/ forward hook events with `curl -K ~/.lumen/curl.conf`. While Lumen runs that file
 * exists and the daemon answers at once; when Lumen quits it is deleted, and the hook ends in a few milliseconds.
 */
export const writeRuntime = (port: number, token: string): void => {
  mkdirSync(LUMEN_DIR, { recursive: true })
  writeFileSync(CURL_CONF, `url = "http://127.0.0.1:${port}/hook"\nheader = "X-Lumen-Token: ${token}"\nheader = "Content-Type: application/json"\nsilent\nmax-time = 0.8\n`, { mode: 0o600 })
}

export const clearRuntime = (): void => rmSync(CURL_CONF, { force: true })
