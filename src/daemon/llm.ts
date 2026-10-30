import { type Config, LUMEN_DIR, readKey } from './config'

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  messages: Message[]
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}

let key = ''

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
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true })
    let i: number
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim()
      buffer = buffer.slice(i + 1)
      if (!line.startsWith('data:') || line.endsWith('[DONE]')) continue
      const delta = (JSON.parse(line.slice(5)) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content
      if (delta) yield delta
    }
  }
}

export const chat = async (config: Config, options: ChatOptions): Promise<string> => {
  let out = ''
  for await (const delta of streamChat(config, options)) out += delta
  return out
}
