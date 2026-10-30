// Gallery samples for the components that live in ui.js.
;(() => {
  const { h, samples } = Lumen
  const add = (title, tree, extra = {}) => samples.push({ group: 'core', title, tree, ...extra })
  const series = (n, base, amp, seed) => Array.from({ length: n }, (_, i) => Math.max(0, base + Math.sin(i / 4 + seed) * amp + Math.cos(i / 1.7 + seed) * amp * 0.4))

  add('Heading · Text · Divider', () => h('Stack', {},
    h('Heading', { text: '隧道丢包触发了探针级联失败', sub: '影响 38 个 Pod，持续 47 分钟' }),
    h('Text', { text: 'edge-node-3 与 transit-gw 之间的 GRE 隧道出现间歇性丢包，峰值 23%。' }),
    h('Divider', { label: '细节' }),
    h('Text', { text: '探针超时只有 1 秒，无法容忍这种抖动。', size: 'sm' })))
  add('Message · Callout · Badge', () => h('Stack', {},
    h('Message', { text: '正在核对 kubelet 的探针配置。', state: 'thinking' }),
    h('Callout', { tone: 'warn', title: '根因很可能在 GRE 隧道', text: '38 次重启全部落在丢包超过 5% 的窗口内。' }),
    h('Row', {}, h('Badge', { text: 'Running', tone: 'ok' }), h('Badge', { text: 'CrashLoopBackOff', tone: 'err' }), h('Badge', { text: 'Pending', tone: 'warn' }))))
  add('Button · Code', () => h('Stack', {},
    h('Row', {}, h('Button', { label: '应用到 jobs-worker', kind: 'primary' }), h('Button', { label: '继续排查' }), h('Button', { label: '回滚', kind: 'danger' })),
    h('Code', { text: 'readinessProbe:\n  httpGet:\n    path: /healthz\n    port: 8080\n  timeoutSeconds: 1' })))
  add('KeyValue', () => h('KeyValue', { items: [{ k: '节点', v: 'edge-node-3' }, { k: '提交', v: 'a352220c9d1f4e6b8a0c7d3e5f2b1a9087654321', mono: true }, { k: '日志', v: 'https://logs.example.com/k8s-log/kubelet' }] }))
  add('Metric (Grid)', () => h('Grid', { min: 9 },
    h('Metric', { label: '运行中的 Pod', value: 1284, trend: series(24, 1280, 20, 1), delta: '+12', hint: '较 1 小时前' }),
    h('Metric', { label: '错误率', value: 0.42, unit: '%', trend: series(24, 0.4, 0.2, 2), tone: 'warn' }),
    h('Metric', { label: 'p95 延迟', value: 112, unit: 'ms', trend: series(24, 110, 25, 3) })), { span: 2 })
  add('Gauge (Grid)', () => h('Grid', { min: 6.5 },
    h('Gauge', { label: 'CPU', value: 59, unit: '%', thresholds: [70, 90] }),
    h('Gauge', { label: '上下文', value: 182000, max: 200000, thresholds: [150000, 190000] })))
  add('Progress · BarList', () => h('Stack', {},
    h('Progress', { label: '诊断进度', value: 3, max: 6, text: '3 / 6' }),
    h('BarList', { unit: '%', items: [{ label: 'readinessProbe 超时', value: 71 }, { label: 'livenessProbe 超时导致容器被杀', value: 18 }, { label: '其他', value: 4 }] })))
  add('Donut · Tiles', () => h('Stack', {},
    h('Donut', { label: 'Pod', items: [{ label: '运行中', value: 1180, tone: 'ok' }, { label: '等待调度', value: 62, tone: 'warn' }, { label: '重启循环', value: 14, tone: 'err' }] }),
    h('Tiles', { items: Array.from({ length: 24 }, (_, i) => ({ label: String(100 + i), sub: i % 5 ? undefined : 'gpu', tone: i === 7 ? 'err' : i % 6 === 0 ? 'warn' : 'ok' })) })))
  add('Steps', () => h('Steps', { items: [
    { label: '拉取集群指标', state: 'done', meta: '1.2s', detail: 'Prometheus 最近 6 小时' },
    { label: '检查隧道与 kubelet 状态', state: 'active', detail: '对比 GRE 隧道丢包与探针超时' },
    { label: '验证根因', state: 'pending' },
    { label: '应用修复', state: 'failed', meta: 'exit 1' },
  ] }))
  add('Log', () => h('Log', { lines: [
    { ts: '15:02:11', level: 'info', text: 'controller 调谐完成，32 个任务无变化' },
    { ts: '15:02:41', level: 'warn', text: 'edge-node-3 kubelet NotReady，持续 12s' },
    { ts: '15:03:05', level: 'err', text: 'worker-a /healthz 探针超时 (timeout 1s)' },
    { ts: '15:49:30', level: 'ok', text: 'gateway 2xx 占比 99.4%' },
  ] }))
  add('Table', () => h('Table', {
    columns: [{ key: 'pod', label: 'Pod' }, { key: 'state', label: '状态', kind: 'status', tones: { Running: 'ok', CrashLoopBackOff: 'err' } }, { key: 'restarts', label: '重启', kind: 'num' }, { key: 'ok', label: '恢复', kind: 'bar', tone: 'ok' }],
    rows: [{ pod: 'jobs-worker-7d9f6-x2kq9', state: 'CrashLoopBackOff', restarts: 14, ok: 30 }, { pod: 'jobs-controller-0', state: 'Running', restarts: 0, ok: 100 }],
  }), { span: 2 })
  add('Chart', () => h('Chart', { kind: 'area', series: [{ name: 'edge-node-3', data: series(40, 6, 5, 1) }, { name: '其他节点', data: series(40, 1.5, 1, 2) }], labels: Array.from({ length: 40 }, (_, i) => `-${40 - i}m`) }), { span: 2 })
  add('Topology', () => h('Topology', {
    tiers: [[{ id: 'gw', label: 'Gateway', sub: 'ingress-nginx' }], [{ id: 'ctl', label: 'Controller', sub: 'jobs-system', tone: 'ok' }, { id: 'mon', label: 'Prometheus', sub: 'monitoring' }], [{ id: 'w1', label: 'worker-a', sub: 'node-1', tone: 'err' }, { id: 'w2', label: 'worker-b', sub: 'node-3', tone: 'warn' }, { id: 'db', label: 'Postgres', sub: 'db' }]],
    edges: [['gw', 'ctl'], ['mon', 'ctl'], ['ctl', 'w1'], ['ctl', 'w2'], ['ctl', 'db']],
    active: 'w1',
  }), { span: 2 })
  add('Polar', () => h('Polar', { max: 100, axes: [{ label: '网络', value: 52 }, { label: '存储', value: 81 }, { label: '计算', value: 74 }, { label: '调度', value: 90 }, { label: '镜像', value: 68 }], compare: [80, 80, 80, 80, 80] }))
  add('Panel · span and rows', () => h('Text', { text: '面板的 span 和 rows 被设成很大的值时，也只能占满一整行。' }))
})()
