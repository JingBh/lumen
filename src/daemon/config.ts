import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const LUMEN_DIR = join(homedir(), '.lumen')
export const SOCKET_PATH = join(LUMEN_DIR, 'hook.sock')

export interface Config {
  llm: {
    /** Any OpenAI-compatible chat completions endpoint; set it and the model in ~/.lumen/config.json. */
    baseUrl: string
    model: string
    /** File with KEY=value lines; the key itself is never copied anywhere else. */
    envFile: string
    keyName: string
    extraBody: Record<string, unknown>
    /** Price per million tokens, in any currency, so the log can say what the runs cost. */
    price?: { cachedInput: number; input: number; output: number }
  }
  /** After an important event (a prompt, a turn's end, a wait for the user, a click), ask the model this soon (ms). */
  majorDelayMs: number
  /** Tool calls and other small events are gathered and shown at most this often (ms). */
  minorIntervalMs: number
  /** Once the window has been folded into the orb, or the screen locked, this long, the model waits until it opens (ms). */
  pauseAfterMs: number
  /** Tool results from these tools are never sent to the model. */
  denyTools: string[]
  /** Skip tool results that mention these path fragments. */
  denyPaths: string[]
}

const defaults: Config = {
  llm: {
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    envFile: join(LUMEN_DIR, 'api-key.env'),
    keyName: 'LUMEN_API_KEY',
    extraBody: {}
  },
  majorDelayMs: 3000,
  minorIntervalMs: 60_000,
  pauseAfterMs: 60_000,
  denyTools: [],
  denyPaths: ['.env', 'id_rsa', 'id_ed25519', '.pem', 'credentials', 'secrets']
}

export const loadConfig = (): Config => {
  mkdirSync(LUMEN_DIR, { recursive: true })
  const file = join(LUMEN_DIR, 'config.json')
  if (!existsSync(file)) writeFileSync(file, `${JSON.stringify(defaults, null, 2)}\n`)
  const user = JSON.parse(readFileSync(file, 'utf8')) as Partial<Config>
  return { ...defaults, ...user, llm: { ...defaults.llm, ...user.llm } }
}

export const readKey = (config: Config): string => {
  const { envFile, keyName } = config.llm
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m?.[1] === keyName) return m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  throw new Error(`${keyName} not found in ${envFile}`)
}
