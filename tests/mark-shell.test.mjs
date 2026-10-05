/**
 * 壳层验收：context_mark 的**失败呈现**（M1–M3）。
 *
 * 起因（2026-10-05 接线级验收 A5）：非法 `kind` 时实现**正确**返回 `ok:false` + error，
 * 但 `render` 不看 `ok` ⇒ 终端显示成 `标记 null [undefined]`，**错误原因整条丢失**。
 *
 * 与同日抓到的另外两处属同一族——**执行层判定正确，呈现/传输层失真**：
 *   ① kg_walk `direction=in` 遍历对、渲染成反向；
 *   ② kg_del_* 成功出参多带 `undefined` ⇒ 整包被管线拒（报错但数据已变）；
 *   ③ 本条：失败出参少传 `ok` ⇒ 错误原因丢失。
 *
 * 跑法：node --test tests/mark-shell.test.mjs（先 npx tsc -p tsconfig.json）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../lib/index.js'

const SID = 'session-mark-0001'

function harness() {
  const home = mkdtempSync(join(tmpdir(), 'ctx-mark-'))
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = home // 必须在 apply 之前设：marksDir 在 apply 时 resolve
  const tools = new Map()
  const logger = Object.assign(() => logger, { info() {}, warn() {}, error() {}, debug() {} })
  const agents = {
    list: () => [{ id: SID, session: { events: [] } }],
    currentInitiator: () => ({ id: SID, session: { events: [] } }),
  }
  const contextMeter = { report: () => ({ sessionId: SID, totalTokens: 0, usageTotal: 0 }) }
  apply({ tools: { register: (t) => tools.set(t.name, t) }, logger, agents, contextMeter }, { mediumThreshold: 0.5, highThreshold: 0.75 })
  return {
    tools,
    marksPath: join(home, 'context-marks', SID + '.json'),
    text: (v, args) => tools.get('context_mark').output.render(args ?? {}, v).map((s) => s.text).join('\n'),
    cleanup: () => {
      if (prevHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prevHome
      rmSync(home, { recursive: true, force: true })
    },
  }
}

test('M1 尸体样本：非法 kind ⇒ 渲染必须显示原因（不得渲染成「标记 null」）', async () => {
  const h = harness()
  const tool = h.tools.get('context_mark')
  const args = { kind: 'bogus' }
  const r = await tool.execute(args)
  assert.equal(r.ok, false, '实现层本就正确拒绝')
  const text = h.text(r, args)
  assert.match(text, /kind 必须/, '失败必须把原因显示出来')
  assert.doesNotMatch(text, /标记 null/, '不得把失败渲染成看似成功的畸形输出')
  assert.equal(existsSync(h.marksPath), false, '非法 kind 不得写盘')
  h.cleanup()
})

test('M2 正路径：合法 kind ⇒ 渲染含 id/[kind]，且真写盘', async () => {
  const h = harness()
  const tool = h.tools.get('context_mark')
  const args = { kind: 'noise', tags: ['测试'], note: 'M2' }
  const r = await tool.execute(args)
  assert.equal(r.ok, true)
  assert.match(h.text(r, args), /\[noise\]/)
  assert.ok(existsSync(h.marksPath), '正路径必须写盘')
  const saved = JSON.parse(readFileSync(h.marksPath, 'utf-8'))
  assert.equal(saved.length, 1)
  assert.equal(saved[0].kind, 'noise')
  h.cleanup()
})

test('M3 render 契约：ok:false 的两种来源都必须显示 error', async () => {
  const h = harness()
  assert.match(h.text({ ok: false, mark: { id: null, error: '无活跃会话可打标记' } }, {}), /无活跃会话/)
  assert.match(h.text({ ok: false, mark: { id: null, error: 'kind 必须 ∈ explore/…' } }, {}), /kind 必须/)
  h.cleanup()
})
