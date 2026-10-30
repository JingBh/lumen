import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LUMEN_DIR } from './config'
import type { Director } from './director'
import type { HookPayload } from './types'

export const DEFAULT_PORT = 7373

/** A secret that hook requests must carry, so web pages and other users' processes cannot feed the screen. */
export const loadToken = (): string => {
  mkdirSync(LUMEN_DIR, { recursive: true })
  const file = join(LUMEN_DIR, 'token')
  if (!existsSync(file)) writeFileSync(file, `${randomBytes(24).toString('hex')}\n`, { mode: 0o600 })
  return readFileSync(file, 'utf8').trim()
}

const MAX_BODY = 4_000_000

/**
 * Claude Code's http hooks POST here. The answer is immediate: the model is never waited for.
 * The response may carry messages the user sent from the window back to the agent.
 */
export const startHookServer = (director: Director, token: string, port: number, log: (m: string) => void): Promise<Server> =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const reply = (code: number, body = '{}'): void => {
        res.writeHead(code, { 'Content-Type': 'application/json' }).end(body)
      }
      if (req.method !== 'POST' || req.url !== '/hook') return reply(404)
      if (req.headers.host !== `127.0.0.1:${port}` || req.headers['x-lumen-token'] !== token) return reply(403)
      let size = 0
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > MAX_BODY) req.destroy()
        else chunks.push(c)
      })
      req.on('end', () => {
        try {
          const p = JSON.parse(Buffer.concat(chunks).toString('utf8')) as HookPayload
          if (process.env.LUMEN_DEBUG) appendFileSync(join(LUMEN_DIR, 'payloads.jsonl'), `${JSON.stringify(p)}\n`)
          director.ingest(p)
          const context = director.deliveries(p)
          reply(200, context ? JSON.stringify({ hookSpecificOutput: { hookEventName: p.hook_event_name, additionalContext: context } }) : '{}')
        } catch (e) {
          log(`bad hook payload: ${e instanceof Error ? e.message : String(e)}`)
          reply(400)
        }
      })
    })
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
