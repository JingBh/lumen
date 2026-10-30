// Demo scenarios for the Lumen preview. Each one is what an agent could emit, authored as a nested
// tree and flattened to the same flat spec json-render uses, then streamed in as JSON patches.
;(() => {
  const h = (type, props = {}, ...children) => ({ type, props, children: children.flat() })

  const flatten = (tree) => {
    const elements = {}
    let n = 0
    const walk = (node) => {
      const id = `${node.type.toLowerCase()}-${++n}`
      const def = (elements[id] = { type: node.type, props: node.props, children: [] })
      def.children = node.children.map(walk)
      return id
    }
    return { root: walk(tree), elements }
  }

  const toPatches = ({ root, elements }) => [
    { op: 'add', path: '/root', value: root },
    ...Object.entries(elements).map(([id, value]) => ({ op: 'add', path: `/elements/${id}`, value })),
  ]

  const S = (key) => ({ $state: key })
  const rnd = (a, b) => a + Math.random() * (b - a)
  const walk = (v, lo, hi, s) => Math.min(hi, Math.max(lo, v + rnd(-s, s)))
  const pad2 = (n) => String(n).padStart(2, '0')
  const now = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` }
  const series = (n, base, amp) => Array.from({ length: n }, (_, i) => Math.max(0, base + Math.sin(i / 5) * amp + rnd(-amp / 2, amp / 2)))
  const minutes = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.now() - (n - 1 - i) * 60000); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}` })
  const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }

  // Every screen lives in the window frame.
  const framed = (scenario) => ({ type: 'Window', props: scenario.window ?? {}, children: [scenario.tree()] })

  const Scenarios = { flatten, toPatches, framed }

  // ---------------------------------------------------------------------------------------------
  // 1. A dense, live operations screen.
  // ---------------------------------------------------------------------------------------------
  const plan = [
    ['拉取集群指标', '1.2s', 'Prometheus 最近 6 小时'],
    ['关联 Pod 重启事件', '2.1s', '38 次重启，集中在 edge-node-3'],
    ['检查隧道与 kubelet 状态', '', '对比 GRE 隧道丢包与探针超时'],
    ['验证根因', '', ''],
    ['生成修复方案', '', ''],
    ['应用并确认滚动更新', '', ''],
  ]
  const says = [
    '重启时间与 GRE 隧道抖动高度吻合，我正在检查 kubelet 的探针超时是否由此引起。',
    '内存曲线平稳，可以排除 OOM。接下来对比隧道丢包率与重启时间点。',
    '相关性成立：每次隧道丢包超过 5% 之后 30 秒内必有一批探针失败。',
    '准备调整探针超时并先做 dry-run，确认不会影响其他节点。',
  ]
  const logs = [
    ['info', 'controller 调谐完成，32 个任务无变化'], ['info', 'worker-b 租约续期成功'], ['warn', 'edge-node-3 kubelet NotReady，持续 12s'],
    ['info', '队列已处理 18 项'], ['err', 'worker-a /healthz 探针超时 (timeout 1s)'], ['info', 'prometheus 抓取 4.1k 个序列'],
    ['ok', 'gateway 2xx 占比 99.4%'], ['warn', '/raid 磁盘使用率 78%'],
  ]

  Scenarios.ops = {
    window: { label: '集群诊断', presence: S('/presence'), status: S('/say') },
    init(store) {
      const set = (k, v) => store.set(k, v)
      set('/presence', 'thinking'); set('/say', says[0]); set('/active', 'ctl')
      set('/steps', plan.map(([label, meta, detail], i) => ({ label, meta, detail, state: i < 2 ? 'done' : i === 2 ? 'active' : 'pending' })))
      set('/cpu', 54); set('/mem', 66); set('/disk', 78)
      set('/pods', 1284); set('/podsTrend', series(24, 1280, 20)); set('/restartRate', 38); set('/restartTrend', series(24, 30, 14))
      set('/err', 0.42); set('/errTrend', series(24, 0.4, 0.2)); set('/p95', 112); set('/p95Trend', series(24, 110, 25))
      set('/labels', Array.from({ length: 60 }, (_, i) => (i === 59 ? '现在' : `-${59 - i}m`))); set('/restartsA', series(60, 6, 5)); set('/restartsB', series(60, 1.5, 1.2))
      set('/queues', ['rollout', 'eval', 'build', 'sync', 'gc'].map((label, i) => ({ label, value: [78, 54, 33, 61, 12][i] })))
      set('/log', Array.from({ length: 10 }, (_, i) => ({ ts: now(), level: logs[i % logs.length][0], text: logs[i % logs.length][1] })))
    },
    live(store) {
      let cpu = 54, mem = 66, step = 2, say = 0
      const log = store.get('/log').slice()
      const pods = store.get('/podsTrend').slice(), restart = store.get('/restartTrend').slice(), err = store.get('/errTrend').slice(), p95 = store.get('/p95Trend').slice()
      const A = store.get('/restartsA').slice(), B = store.get('/restartsB').slice()
      setInterval(() => {
        cpu = walk(cpu, 30, 95, 7); mem = walk(mem, 50, 92, 3)
        store.set('/cpu', cpu); store.set('/mem', mem)
        pods.push(walk(pods.at(-1), 1200, 1350, 8)); pods.shift(); store.set('/podsTrend', pods.slice()); store.set('/pods', Math.round(pods.at(-1)))
        restart.push(walk(restart.at(-1), 5, 60, 8)); restart.shift(); store.set('/restartTrend', restart.slice()); store.set('/restartRate', Math.round(restart.at(-1)))
        err.push(walk(err.at(-1), 0.05, 1.5, 0.12)); err.shift(); store.set('/errTrend', err.slice()); store.set('/err', +err.at(-1).toFixed(2))
        p95.push(walk(p95.at(-1), 50, 220, 25)); p95.shift(); store.set('/p95Trend', p95.slice()); store.set('/p95', Math.round(p95.at(-1)))
        A.push(walk(A.at(-1), 0, 16, 5)); A.shift(); B.push(walk(B.at(-1), 0, 4, 1.4)); B.shift()
        store.set('/restartsA', A.slice()); store.set('/restartsB', B.slice())
        store.set('/queues', store.get('/queues').map((q) => ({ ...q, value: Math.round(walk(q.value, 5, 98, 10)) })))
      }, 1000)
      setInterval(() => {
        const [level, text] = logs[Math.floor(rnd(0, logs.length))]
        log.push({ ts: now(), level, text })
        store.set('/log', log.slice())
      }, 1300)
      setInterval(() => store.set('/active', ['gw', 'ctl', 'w1', 'w2', 'w3', 'db', 'q', 'mon'][Math.floor(rnd(0, 8))]), 2000)
      setInterval(() => {
        step = step >= plan.length ? 2 : step + 1
        say = (say + 1) % says.length
        store.set('/steps', plan.map(([label, meta, detail], i) => ({ label, meta: i < step ? meta || '0.8s' : '', detail, state: i < step ? 'done' : i === step ? 'active' : 'pending' })))
        store.set('/say', says[say])
        store.set('/presence', ['thinking', 'acting', 'thinking', 'idle'][say])
      }, 5000)
    },
    tree: () =>
      h('Shell', { fit: 'fill' },
        h('Panel', { title: '当前进展', meta: '步骤 3 / 6', span: 2 },
          h('Progress', { label: '诊断进度', value: 3, max: 6, text: '3 / 6' })),
        h('Panel', { title: '诊断计划', rows: 2 }, h('Steps', { items: S('/steps') })),
        h('Panel', { title: '关键指标', span: 2 },
          h('Grid', { min: 11 },
            h('Metric', { label: '运行中的 Pod', value: S('/pods'), trend: S('/podsTrend'), delta: '+12', hint: '较 1 小时前' }),
            h('Metric', { label: '重启 / 小时', value: S('/restartRate'), trend: S('/restartTrend'), tone: 'warn', delta: '+31', deltaTone: 'warn', hint: '集中在 1 个节点' }),
            h('Metric', { label: '错误率', value: S('/err'), unit: '%', trend: S('/errTrend') }),
            h('Metric', { label: 'p95 延迟', value: S('/p95'), unit: 'ms', trend: S('/p95Trend') }))),
        h('Panel', { title: '资源水位', meta: '全集群' },
          h('Grid', { min: 6.5, gap: 0.5 },
            h('Gauge', { label: 'CPU', value: S('/cpu'), unit: '%', thresholds: [70, 90] }),
            h('Gauge', { label: '内存', value: S('/mem'), unit: '%', thresholds: [70, 90] }),
            h('Gauge', { label: '磁盘', value: S('/disk'), unit: '%', thresholds: [75, 90] }))),
        h('Panel', { title: 'Pod 重启趋势', meta: '每分钟，最近 60 分钟', span: 2 },
          h('Chart', { kind: 'area', series: [{ name: 'edge-node-3', data: S('/restartsA') }, { name: '其他节点', data: S('/restartsB') }], labels: S('/labels') })),
        h('Panel', { title: '服务拓扑', meta: '8 个节点', span: 2, rows: 2 },
          h('Topology', {
            active: S('/active'),
            tiers: [
              [{ id: 'gw', label: 'Gateway', sub: 'ingress-nginx' }],
              [{ id: 'q', label: 'Queue', sub: 'redis' }, { id: 'ctl', label: 'Controller', sub: 'jobs-system', tone: 'ok' }, { id: 'mon', label: 'Prometheus', sub: 'monitoring' }],
              [{ id: 'w1', label: 'worker-a', sub: 'node-1', tone: 'err' }, { id: 'w2', label: 'worker-b', sub: 'node-3' , tone: 'warn' }, { id: 'w3', label: 'worker-c', sub: 'node-4', tone: 'ok' }, { id: 'db', label: 'Postgres', sub: 'cnpg', tone: 'ok' }],
            ],
            edges: [['gw', 'ctl'], ['q', 'ctl'], ['mon', 'ctl'], ['ctl', 'w1'], ['ctl', 'w2'], ['ctl', 'w3'], ['ctl', 'db']],
          })),
        h('Panel', { title: '事件流', meta: '实时', rows: 2 }, h('Log', { lines: S('/log') })),
        h('Panel', { title: '异常 Pod', meta: '5 个', span: 'full' },
          h('Table', {
            columns: [
              { key: 'pod', label: 'Pod' }, { key: 'ns', label: '命名空间' },
              { key: 'state', label: '状态', kind: 'status', tones: { Running: 'ok', CrashLoopBackOff: 'err', Pending: 'warn', Terminating: 'serious' } },
              { key: 'restarts', label: '重启', kind: 'num' }, { key: 'node', label: '节点' }, { key: 'age', label: '运行时长', kind: 'mono' },
            ],
            rows: [
              { pod: 'jobs-worker-7d9f6-x2kq9', ns: 'jobs-system', state: 'CrashLoopBackOff', restarts: 14, node: 'edge-node-3', age: '3h 12m' },
              { pod: 'sandbox-vm-4412', ns: 'jobs-sandbox', state: 'Pending', restarts: 0, node: '—', age: '8m' },
              { pod: 'controller-0', ns: 'jobs-system', state: 'Running', restarts: 6, node: 'edge-node-3', age: '1d 4h' },
              { pod: 'ci-runner-a-5c8b', ns: 'ci-runner', state: 'Terminating', restarts: 2, node: 'core-node-2', age: '22h' },
              { pod: 'grafana-6b7c8d-9fq2z', ns: 'monitoring', state: 'Running', restarts: 3, node: 'edge-node-3', age: '5d' },
            ],
          })),
        h('Panel', { title: '节点状态', meta: '24 个节点', span: 2 },
          h('Tiles', { items: Array.from({ length: 24 }, (_, i) => ({ label: String(100 + i), sub: i % 5 === 0 ? 'gpu' : undefined, tone: [11, 15].includes(i) ? 'err' : [4, 19, 21].includes(i) ? 'warn' : i === 8 ? 'accent' : 'ok' })) })),
        h('Panel', { title: 'Pod 状态' },
          h('Donut', { label: 'Pod', items: [{ label: '运行中', value: 1180, tone: 'ok' }, { label: '等待调度', value: 62, tone: 'warn' }, { label: '重启循环', value: 14, tone: 'err' }, { label: '终止中', value: 28, tone: 'serious' }] })),
        h('Panel', { title: '健康画像', meta: '对比基线' },
          h('Polar', { max: 100, axes: [{ label: '网络', value: 52 }, { label: '存储', value: 81 }, { label: '计算', value: 74 }, { label: '调度', value: 90 }, { label: '镜像', value: 68 }, { label: '权限', value: 95 }], compare: [80, 80, 80, 80, 80, 80] })),
        h('Panel', { title: '队列深度' }, h('BarList', { items: S('/queues'), unit: '%' })),
        h('Panel', { title: '初步结论', span: 2, tone: 'warn' },
          h('Callout', { tone: 'warn', title: '根因很可能在 GRE 隧道', text: 'edge-node-3 的 38 次重启全部落在隧道丢包超过 5% 的 30 秒窗口内。' }),
          h('Text', { text: '探针超时设置为 1 秒，对跨隧道的流量过于激进。建议先把 readinessProbe 的 timeoutSeconds 调到 3，再观察 30 分钟。' }),
          h('Row', {}, h('Button', { label: '查看 dry-run', kind: 'primary', action: 'show_dry_run' }), h('Button', { label: '继续排查', action: 'continue' })))),
  }

  // ---------------------------------------------------------------------------------------------
  // 2. Long text, long identifiers, wide tables.
  // ---------------------------------------------------------------------------------------------
  Scenarios.report = {
    window: { label: '事故复盘', presence: 'idle', status: '复盘已完成：根因是隧道丢包放大了过短的探针超时。' },
    init() {},
    tree: () =>
      h('Shell', {},
        h('Panel', { title: '摘要', span: 'full' },
          h('Heading', { text: '隧道丢包触发了探针级联失败', sub: '影响 38 个 Pod，持续 47 分钟，未造成数据丢失。' }),
          h('Text', { size: 'lg', text: '10 月 27 日 15:02，edge-node-3 与 transit-gw（192.0.2.10）之间的 GRE 隧道开始出现间歇性丢包，峰值 23%。节点上的 kubelet 探针超时被设置为 1 秒，无法容忍这种抖动，随即触发 CrashLoopBackOff，并通过 Service 摘除连锁影响了 jobs-system 下的 controller 与 worker。' }),
          h('Text', { text: 'The probe configuration is the amplifier, not the cause: the tunnel flaps were short (median 4.1s) and every affected pod recovered by itself once the tunnel returned. Raising timeoutSeconds from 1 to 3 would have absorbed 92% of the failures. 下面的 URL 没有任何断点，用来检验长字符串不会撑破布局：https://grafana.example.internal/d/abcdef0123456789/cluster-overview?orgId=1&var-node=edge-node-3&from=1788000000000&to=1788086400000&viewPanel=42' }),
          h('Callout', { tone: 'err', title: '需要立即处理', text: '同一探针配置仍然存在于另外 11 个 Deployment 中，下一次隧道抖动会再次触发相同的级联。' })),
        h('Panel', { title: '时间线', span: 2 },
          h('Steps', {
            items: [
              { label: '隧道开始丢包', state: 'done', meta: '15:02:11', detail: 'edge-node-3 的 gre0 接口 TX drop 从 0 升至 23%，ICMP 不受影响，TCP 重传明显增加。' },
              { label: 'kubelet 报告 NotReady', state: 'done', meta: '15:02:41', detail: 'node-lifecycle-controller 在 40 秒后将节点标记为 Unknown，但此时 Pod 尚未被驱逐。' },
              { label: 'readinessProbe 失败，Service 摘除', state: 'done', meta: '15:03:05', detail: '38 个 Pod 的 /healthz 超过 1 秒无响应。' },
              { label: '隧道恢复', state: 'done', meta: '15:49:30', detail: '安全组规则被重新加载后丢包消失，原因仍在确认。' },
              { label: '修复探针超时', state: 'active', meta: '进行中' },
              { label: '为其余 11 个 Deployment 补充同样的修复', state: 'pending' },
            ],
          })),
        h('Panel', { title: '影响范围' },
          h('KeyValue', {
            items: [
              { k: '受影响命名空间', v: 'jobs-system, jobs-sandbox, monitoring' },
              { k: '提交', v: 'a352220c9d1f4e6b8a0c7d3e5f2b1a9087654321', mono: true },
              { k: '日志位置', v: 'https://logs.example.com/k8s-log-c1234567890abcdef/kubelet', mono: true },
              { k: '持续时间', v: '47 分钟' },
            ],
          }),
          h('Progress', { label: '已自动恢复', value: 92, tone: 'ok' })),
        h('Panel', { title: '探针配置', span: 'full' },
          h('Code', { text: 'readinessProbe:\n  httpGet:\n    path: /healthz\n    port: 8080\n    httpHeaders:\n      - { name: X-Probe-Source, value: kubelet-edge-node-3-readiness-check-with-an-unreasonably-long-header-value-that-does-not-wrap }\n  timeoutSeconds: 1   # ← 应为 3\n  periodSeconds: 5\n  failureThreshold: 2' })),
        h('Panel', { title: '受影响的工作负载', span: 'full' },
          h('Table', {
            columns: [
              { key: 'name', label: '工作负载' }, { key: 'ns', label: '命名空间' }, { key: 'kind', label: '类型' }, { key: 'state', label: '状态', kind: 'status', tones: { 已恢复: 'ok', 待修复: 'warn', 失败: 'err' } },
              { key: 'restarts', label: '重启', kind: 'num' }, { key: 'impact', label: '影响' }, { key: 'owner', label: '负责人' }, { key: 'recovered', label: '恢复占比', kind: 'bar', tone: 'ok' },
            ],
            rows: [
              { name: 'jobs-controller', ns: 'jobs-system', kind: 'StatefulSet', state: '已恢复', restarts: 6, impact: '任务调度中断约 4 分钟，期间新任务排队', owner: 'zhangsan', recovered: 100 },
              { name: 'jobs-worker-sandbox-ubuntu-2204-gpu-pool-b', ns: 'jobs-sandbox', kind: 'Deployment', state: '待修复', restarts: 14, impact: '17 个评测任务失败并已自动重试，其中 2 个超过重试上限', owner: 'lisi', recovered: 78 },
              { name: 'grafana', ns: 'monitoring', kind: 'Deployment', state: '已恢复', restarts: 3, impact: '仪表盘短暂不可用', owner: 'wangwu', recovered: 100 },
              { name: 'ci-runner-a', ns: 'ci-runner', kind: 'Deployment', state: '失败', restarts: 2, impact: 'CI 作业 pending，已手动重启', owner: 'zhaoliu', recovered: 40 },
            ],
          })),
        h('Panel', { title: '重启归因', meta: '按原因' },
          h('BarList', { unit: '%', items: [{ label: 'readinessProbe 超时', value: 71 }, { label: 'livenessProbe 超时导致容器被杀', value: 18 }, { label: '节点 NotReady 后被驱逐', value: 7 }, { label: '其他', value: 4 }] })),
        h('Panel', { title: '下一步', span: 2 },
          h('Text', { text: '建议分两步处理：先修复 jobs-worker 的探针（风险低，可立即滚动），再用同样的补丁覆盖其余 11 个 Deployment。第二步会触发约 90 个 Pod 重建，需要在低峰期执行。' }),
          h('Row', {}, h('Button', { label: '应用到 jobs-worker', kind: 'primary', action: 'apply_worker' }), h('Button', { label: '列出其余 11 个', action: 'list_rest' }), h('Button', { label: '导出报告', action: 'export' })))),
  }

  // ---------------------------------------------------------------------------------------------
  // 3. Almost nothing to say: the layout should still look intentional.
  // ---------------------------------------------------------------------------------------------
  Scenarios.minimal = {
    window: { label: '构建完成', presence: 'idle', status: '镜像 app:v2610271805 已构建并推送到 ACR，部署后没有 Pod 滚动。' },
    init() {},
    tree: () =>
      h('Shell', {},
        h('Panel', { title: '结果', span: 2 },
          h('Metric', { label: '总耗时', value: '3m 12s', hint: '比上次快 41 秒', delta: '−41s', deltaTone: 'ok' })),
        h('Panel', { title: '步骤' },
          h('Steps', { items: [{ label: '构建镜像', state: 'done', meta: '2m 04s' }, { label: '推送到 ACR', state: 'done', meta: '38s' }, { label: '更新 Deployment', state: 'done', meta: '30s' }] }))),
  }

  // ---------------------------------------------------------------------------------------------
  // 4. Everything at once, with hostile content.
  // ---------------------------------------------------------------------------------------------
  Scenarios.overload = {
    window: { label: '压力测试', presence: 'alert', status: '一段特别长的状态，用来检查顶栏在两行之后会不会截断：worker-sandbox-ubuntu-2204-gpu-pool-b 的 17 个评测任务失败并已自动重试，其中 2 个超过重试上限，需要人工确认是否回滚到上一个版本。' },
    init() {},
    tree() {
      const r = mulberry(7)
      const pick = (a) => a[Math.floor(r() * a.length)]
      const values = ['0', '12', '3,482', '1,284,903,221,000', '99.99', '—', '待审批', '1.2e9', 'Pending approval from reviewer', '🚀 已发布', '−17.5', '9,999,999,999,999,999']
      const labels = ['QPS', '错误率', '一个相当长的指标名称用来检验省略与换行是否优雅', 'p99', 'GPU 显存', 'Queue depth', '活跃会话']
      const names = ['inference-worker-us-east-1-b-07', 'gateway', 'postgres-primary-0', 'redis-sentinel-2', '评测调度器', 'object-storage-proxy', 'auth']
      const tones = ['ok', 'ok', 'ok', 'warn', 'err', 'muted']
      const tiers = [1, 3, 8, 12, 6].map((n, t) => Array.from({ length: n }, (_, i) => ({ id: `n${t}-${i}`, label: `${pick(names)}-${i}`, sub: i % 3 ? `10.0.${t}.${i}` : undefined, tone: pick(tones) })))
      const edges = tiers.flatMap((tier, t) => (t ? tier.map((n) => [pick(tiers[t - 1]).id, n.id]) : []))
      const walkSeries = (seed, base) => { const q = mulberry(seed); let v = base; return Array.from({ length: 600 }, () => (v = Math.max(0, v + (q() - 0.48) * base * 0.08))) }
      const lines = Array.from({ length: 500 }, (_, i) => ({ ts: `18:${pad2(Math.floor(i / 60) % 60)}:${pad2(i % 60)}`, level: pick(['info', 'info', 'info', 'warn', 'err', 'ok']), text: `request ${i} ${pick(['完成', 'timed out after 30000ms while waiting for upstream', 'retrying (attempt 3/5) with exponential backoff 8s', 'GET /api/v1/namespaces/jobs-system/pods?labelSelector=app%3Dcontroller&limit=500&resourceVersion=948213'])}` }))
      const rows = Array.from({ length: 150 }, (_, i) => ({ id: `task-${1000 + i}`, name: `${pick(names)} ${pick(['评测', 'rollout', '同步'])}`, state: pick(['运行中', '排队', '失败', '完成']), cpu: Math.round(r() * 100), mem: Math.round(r() * 100), dur: `${Math.floor(r() * 59)}m ${Math.floor(r() * 59)}s`, node: `edge-node-${100 + Math.floor(r() * 30)}`, note: pick(['', '', 'OOMKilled 之后自动重试', 'waiting for a very long reason string that goes on and on and on']) }))
      return h('Shell', {},
        h('Panel', { title: '指标墙', meta: '24 项', span: 'full' },
          h('Grid', { min: 9 }, Array.from({ length: 24 }, (_, i) => h('Metric', { label: labels[i % labels.length], value: values[i % values.length], unit: i % 4 === 0 ? 'ms' : undefined, delta: i % 3 === 0 ? '+3.2%' : undefined, trend: i % 2 ? Array.from({ length: 20 }, () => r() * 10) : undefined })))),
        h('Panel', { title: '吞吐量', meta: '600 个采样点', span: 2 },
          h('Chart', { kind: 'line', series: [{ name: '成功', data: walkSeries(1, 900) }, { name: '失败', data: walkSeries(2, 120) }, { name: '重试', data: walkSeries(3, 300) }] })),
        h('Panel', { title: '对比', span: 1 }, h('Chart', { kind: 'bar', series: [{ name: 'A', data: Array.from({ length: 12 }, () => Math.round(r() * 100)) }, { name: 'B', data: Array.from({ length: 12 }, () => Math.round(r() * 100)) }] })),
        h('Panel', { title: '大型拓扑', meta: '30 个节点', span: 'full' }, h('Topology', { tiers, edges, active: tiers[2][0].id })),
        h('Panel', { title: '任务', meta: '150 行，只渲染前 100 行', span: 'full' },
          h('Table', {
            maxRows: 100,
            columns: [{ key: 'id', label: 'ID', kind: 'mono' }, { key: 'name', label: '名称' }, { key: 'state', label: '状态', kind: 'status', tones: { 运行中: 'accent', 排队: 'muted', 失败: 'err', 完成: 'ok' } }, { key: 'cpu', label: 'CPU', kind: 'bar' }, { key: 'mem', label: '内存', kind: 'bar', tone: 's3' }, { key: 'dur', label: '耗时', kind: 'mono' }, { key: 'node', label: '节点' }, { key: 'note', label: '备注' }],
            rows,
          })),
        h('Panel', { title: '日志', meta: '500 行', span: 2, rows: 2 }, h('Log', { lines })),
        h('Panel', { title: '十四维画像' }, h('Polar', { axes: Array.from({ length: 14 }, (_, i) => ({ label: `${pick(['网络延迟', 'Storage throughput', '调度公平性', 'cold start'])} ${i + 1}`, value: 30 + Math.round(r() * 70) })) })),
        h('Panel', { title: '长名称队列' }, h('BarList', { unit: '%', items: Array.from({ length: 14 }, (_, i) => ({ label: `${pick(names)}-${i}`, value: Math.round(r() * 100) })) })),
        h('Panel', { title: '元数据', span: 'full' }, h('KeyValue', { items: Array.from({ length: 16 }, (_, i) => ({ k: `${pick(['annotation', 'label', '环境变量'])}.${i}`, v: pick(['true', 'sha256:3f2a9c1d7e8b4a5f6c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b', '仅供内部使用的一段较长说明文字，用来检验键值对在窄容器里的换行。', 'x']), mono: i % 3 === 0 })) })))
    },
  }

  window.Scenarios = Scenarios
})()
