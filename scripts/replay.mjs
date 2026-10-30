// Feed two scripted coding sessions to a running Lumen at once, the way the plugin and the transcripts would:
//   node scripts/replay.mjs [stepDelayMs]
// Hooks carry only what the plugin sends; the agents' text and tool results go to transcripts in /tmp, written a moment late.
import { appendFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const token = readFileSync(join(homedir(), '.lumen/token'), 'utf8').trim()
const port = process.env.LUMEN_PORT ?? 7373
const delay = +(process.argv[2] ?? 1500)
const run = Date.now().toString(36)
const A = { session_id: `aaaa${run}-api`, transcript_path: `/tmp/replay-a-${run}.jsonl`, cwd: '/Users/dev/projects/shop-api' }
const B = { session_id: `bbbb${run}-web`, transcript_path: `/tmp/replay-b-${run}.jsonl`, cwd: '/Users/dev/projects/shop-web' }
const prompts = new Map()

const post = async (base, payload) => {
  const res = await fetch(`http://127.0.0.1:${port}/hook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lumen-Token': token }, body: JSON.stringify({ ...base, permission_mode: 'default', prompt_id: prompts.get(base), ...payload }) })
  const text = await res.text()
  console.log(base.cwd.split('/').pop().padEnd(9), payload.hook_event_name.padEnd(16), res.status, text === '{}' ? '' : text)
}
const write = (base, type, content) => appendFileSync(base.transcript_path, `${JSON.stringify({ type, promptId: prompts.get(base), sessionId: base.session_id, cwd: base.cwd, timestamp: new Date().toISOString(), message: { role: type, content } })}\n`)
const wait = (ms = delay) => new Promise((r) => setTimeout(r, ms))
let n = 0
const ask = async (base, prompt) => {
  prompts.set(base, `p${run}${++n}`)
  await post(base, { hook_event_name: 'UserPromptSubmit', prompt })
  write(base, 'user', prompt)
}
const tool = async (base, name, input, result, ms = 500) => {
  const id = `toolu_${run}_${++n}`
  await post(base, { hook_event_name: 'PreToolUse', tool_name: name, tool_input: input, tool_use_id: id })
  write(base, 'assistant', [{ type: 'tool_use', id, name, input }])
  await wait(ms)
  write(base, 'user', [{ type: 'tool_result', tool_use_id: id, content: result }])
}
const say = (base, text) => write(base, 'assistant', [{ type: 'text', text }])
const stop = async (base, text) => {
  await post(base, { hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: text })
  say(base, text)
}

await ask(A, '线上 /health 接口偶发返回 500，帮我查一下原因并修复，再补上单元测试')
await ask(B, '把结算页的金额格式改成千分位，并跑一遍 e2e')
await wait()
await tool(A, 'Grep', { pattern: 'func.*Health', path: 'internal' }, 'internal/api/health.go:21:func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {')
await tool(B, 'Edit', { file_path: '/Users/dev/projects/shop-web/src/checkout/Total.tsx', old_string: '{amount.toFixed(2)}', new_string: '{formatMoney(amount)}' }, 'The file has been updated successfully.')
say(A, 'Health 每次都 Ping 数据库，连接池上限 10，高峰期排队超时就返回 500。我先复现。')
await tool(A, 'Bash', { command: 'go test ./internal/api -run TestHealth -count=5' }, '--- FAIL: TestHealthPoolExhausted (0.31s)\n    health_test.go:44: expected 200, got 500\nFAIL', 1200)
await tool(B, 'Bash', { command: 'pnpm e2e checkout' }, '✓ shows total with thousands separators\n✓ applies coupon\n✗ refund shows negative amount (expected "-1,234.00", got "-1234.00")\n2 passed, 1 failed', 1500)
say(B, 'e2e 有一项失败：退款金额是负数时没走 formatMoney。我去修。')
await tool(A, 'Edit', { file_path: '/Users/dev/projects/shop-api/internal/api/health.go', old_string: 'if err := h.db.Ping(); err != nil {', new_string: 'if err := h.probe.Ping(ctx); err != nil {' }, 'The file has been updated successfully.')
await tool(A, 'Bash', { command: 'go test ./... -count=1' }, 'ok  \tshop-api/internal/api\t0.48s\nok  \tshop-api/internal/store\t1.20s', 1500)
await stop(A, '已修复：/health 改用独立探针并带 1 秒超时，全部测试通过。需要我把同样的改动应用到 /ready 吗？')
await tool(B, 'Edit', { file_path: '/Users/dev/projects/shop-web/src/checkout/Refund.tsx', old_string: '-{amount}', new_string: '{formatMoney(-amount)}' }, 'The file has been updated successfully.')
await post(B, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'pnpm e2e checkout' }, tool_use_id: `toolu_${run}_last` })
await post(B, { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' })
console.log('session keys:', A.session_id.slice(0, 6), B.session_id.slice(0, 6))
