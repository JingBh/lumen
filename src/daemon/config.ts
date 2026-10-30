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
  }
  /** Wait this long for more events before asking the model (ms). */
  debounceMs: number
  /** Never wait longer than this while events keep arriving. */
  maxWaitMs: number
  /** Minimum time between two model runs of one session. */
  minGapMs: number
  /** The same three while the window is folded into the orb and nobody is reading the screen. */
  hidden: { debounceMs: number; maxWaitMs: number; minGapMs: number }
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
  debounceMs: 400,
  maxWaitMs: 2500,
  minGapMs: 1000,
  hidden: { debounceMs: 3000, maxWaitMs: 15000, minGapMs: 8000 },
  denyTools: [],
  denyPaths: ['.env', 'id_rsa', 'id_ed25519', '.pem', 'credentials', 'secrets']
}

export const loadConfig = (): Config => {
  mkdirSync(LUMEN_DIR, { recursive: true })
  const file = join(LUMEN_DIR, 'config.json')
  if (!existsSync(file)) writeFileSync(file, `${JSON.stringify(defaults, null, 2)}\n`)
  const user = JSON.parse(readFileSync(file, 'utf8')) as Partial<Config>
  return { ...defaults, ...user, llm: { ...defaults.llm, ...user.llm }, hidden: { ...defaults.hidden, ...user.hidden } }
}

export const readKey = (config: Config): string => {
  const { envFile, keyName } = config.llm
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m?.[1] === keyName) return m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  throw new Error(`${keyName} not found in ${envFile}`)
}
