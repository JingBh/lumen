import { type Config, LUMEN_DIR, readKey } from './config'

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface Usage {
  input: number
  /** Of the input, the part the provider served from its prompt cache. */
  cached: number
  output: number
}

export interface ChatOptions {
  messages: Message[]
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
  onUsage?: (usage: Usage) => void
}

let key = ''

/** Every call's tokens added up, for the hourly summary in the log. */
export const spent = { calls: 0, input: 0, cached: 0, output: 0 }

/** What tokens cost at the configured price, if there is one. */
export const costOf = (config: Config, u: Usage): number | undefined => {
  const p = config.llm.price
  return p && (u.cached * p.cachedInput + (u.input - u.cached) * p.input + u.output * p.output) / 1e6
}

/** Stream the content deltas of a chat completion (OpenAI-compatible wire format). */
export async function* streamChat(config: Config, options: ChatOptions): AsyncGenerator<string> {
  const { baseUrl, model, extraBody } = config.llm
  if (!model) throw new Error(`no model: set llm.model (and llm.baseUrl) in ${LUMEN_DIR}/config.json`)
  key ||= readKey(config)
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: options.maxTokens ?? 1500,
      temperature: options.temperature ?? 0.2,
      messages: options.messages,
      ...extraBody
    }),
    signal: options.signal
  })
  if (!res.ok || !res.body) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`)

  const decoder = new TextDecoder()
  let buffer = ''
  let usage: Usage | undefined
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true })
    let i: number
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim()
      buffer = buffer.slice(i + 1)
      if (!line.startsWith('data:') || line.endsWith('[DONE]')) continue
      const data = JSON.parse(line.slice(5)) as {
        choices?: { delta?: { content?: string } }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; prompt_cache_hit_tokens?: number }
      }
      const u = data.usage
      if (u) usage = { input: u.prompt_tokens ?? 0, cached: u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0, output: u.completion_tokens ?? 0 }
      const delta = data.choices?.[0]?.delta?.content
      if (delta) yield delta
    }
  }
  if (!usage) return
  spent.calls++
  spent.input += usage.input
  spent.cached += usage.cached
  spent.output += usage.output
  options.onUsage?.(usage)
}

export const chat = async (config: Config, options: ChatOptions): Promise<string> => {
  let out = ''
  for await (const delta of streamChat(config, options)) out += delta
  return out
}
