/**
 * 壳层验收：**真调 apply 注册的工具**（mock ctx + 临时 DSH_HOME，零真实资产）。
 * 覆盖 I8（默认干跑 / fail-closed / 必留痕）在**真实 IO 链路**上的行为。
 *
 * ⚠ 未覆盖（诚实标注）：profile 挂载、工具面可见性 —— 待挂载后线上验收。
 * ⚠ 为什么不用真 DSH_HOME：`apply()` 在调用时读 `process.env.DSH_HOME`，harness 在设好
 *    临时 home 之后才 apply，且 cleanup 时还原 —— 真实标记文件（.dsh/context-marks/）零接触。
 * 跑法：node --test tests/unmark-shell.test.mjs（先 tsc -p tsconfig.json 构建）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../lib/index.js'

const SID = 'session-test-0001'

const mkMark = (over = {}) => ({
  id: 'm1',
  kind: 'noise',
  tags: ['测试'],
  note: null,
  seq: null,
  sessionId: SID,
  createdAt: '2026-10-04T00:00:00.000Z',
  ...over,
})

function harness() {
  const home = mkdtempSync(join(tmpdir(), 'ctx-unmark-'))
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = home // 必须在 apply 之前设：marksDir 在 apply 时 resolve

  const tools = new Map()
  // cordis 的 ctx.logger 既可被调用（取子 logger）也可直接 .info ⇒ mock 同时满足两种形状
  const logger = Object.assign(() => logger, { info() {}, warn() {}, error() {}, debug() {} })
  const agents = {
    list: () => [{ id: SID, session: { events: [] } }],
    currentInitiator: () => ({ id: SID, session: { events: [] } }),
  }
  const contextMeter = { report: () => ({ sessionId: SID, totalTokens: 0, usageTotal: 0 }) }
  apply({ tools: { register: (t) => tools.set(t.name, t) }, logger, agents, contextMeter }, { mediumThreshold: 0.5, highThreshold: 0.75 })

  const dir = join(home, 'context-marks')
  const marksPath = join(dir, SID + '.json')
  const tracePath = join(dir, 'unmark-trace.jsonl')
  return {
    home,
    tools,
    marksPath,
    seed: (marks) => {
      mkdirSync(dir, { recursive: true })
      writeFileSync(marksPath, JSON.stringify(marks, null, 2), 'utf-8')
    },
    marksRaw: () => readFileSync(marksPath, 'utf-8'),
    marks: () => JSON.parse(readFileSync(marksPath, 'utf-8')),
    traceLines: () => (existsSync(tracePath) ? readFileSync(tracePath, 'utf-8').trim().split('\n').filter(Boolean) : []),
    cleanup: () => {
      if (prevHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prevHome
      rmSync(home, { recursive: true, force: true })
    },
  }
}

test('apply 注册 4 个工具（含删除原语 context_unmark）', () => {
  const h = harness()
  assert.equal(h.tools.size, 4)
  assert.deepEqual([...h.tools.keys()].sort(), ['context_health', 'context_mark', 'context_marks', 'context_unmark'])
  h.cleanup()
})

test('I8① 默认干跑：不传 apply 时文件与留痕都不动，但报出将删清单', async () => {
  const h = harness()
  h.seed([mkMark({ id: 'm1' }), mkMark({ id: 'm2', kind: 'key' })])
  const before = h.marksRaw()
  const r = await h.tools.get('context_unmark').execute({ id: 'm1' })
  assert.equal(r.ok, true)
  assert.equal(r.result.applied, false, '缺省必须干跑')
  assert.deepEqual(r.result.removed.map((m) => m.id), ['m1'])
  assert.equal(r.result.kept, 1)
  assert.equal(h.marksRaw(), before, '干跑不得改文件')
  assert.equal(h.traceLines().length, 0, '干跑不得留痕')
  h.cleanup()
})

test('I8② 尸体样本：点名 id 不存在 ⇒ 整体拒绝，文件与留痕都不动', async () => {
  const h = harness()
  h.seed([mkMark({ id: 'm1' }), mkMark({ id: 'm2', kind: 'key' })])
  const before = h.marksRaw()
  const r = await h.tools.get('context_unmark').execute({ ids: ['m1', 'nope'], apply: true })
  assert.equal(r.ok, false, 'fail-closed：必须整体拒绝')
  assert.deepEqual(r.result.missing, ['nope'])
  assert.match(r.result.error, /不存在/)
  assert.equal(h.marksRaw(), before, '拒绝时不得改文件（不做部分删除）')
  assert.equal(h.traceLines().length, 0, '拒绝不得留痕')
  h.cleanup()
})

test('I8③ 正路径：apply=true 真删 + 盘上少一条 + 留痕一行', async () => {
  const h = harness()
  h.seed([mkMark({ id: 'm1' }), mkMark({ id: 'm2', kind: 'key' })])
  const r = await h.tools.get('context_unmark').execute({ id: 'm1', apply: true })
  assert.equal(r.ok, true)
  assert.equal(r.result.applied, true)
  assert.equal(r.result.traced, true, '留痕应成功')
  assert.deepEqual(h.marks().map((m) => m.id), ['m2'], '盘上只剩 m2')
  const tr = h.traceLines()
  assert.equal(tr.length, 1, 'I8③：真实变更必须留痕')
  const rec = JSON.parse(tr[0])
  assert.equal(rec.sessionId, SID)
  assert.deepEqual(rec.removedIds, ['m1'])
  assert.deepEqual(rec.removedKinds, ['noise'])
  assert.equal(rec.before, 2)
  assert.equal(rec.after, 1)
  h.cleanup()
})

test('按 kind 批量删：noise 全清、其余保留（组合选择器 AND）', async () => {
  const h = harness()
  h.seed([mkMark({ id: 'n1', kind: 'noise' }), mkMark({ id: 'n2', kind: 'noise' }), mkMark({ id: 'k1', kind: 'key' })])
  const dry = await h.tools.get('context_unmark').execute({ kind: 'noise' })
  assert.equal(dry.result.removed.length, 2)
  assert.equal(h.marks().length, 3, '干跑不改')
  const real = await h.tools.get('context_unmark').execute({ kind: 'noise', apply: true })
  assert.equal(real.ok, true)
  assert.deepEqual(h.marks().map((m) => m.id), ['k1'])
  // ids + kind 组合 = 同时满足：m1(key) 不在 ids 里 ⇒ 不删
  h.seed([mkMark({ id: 'a', kind: 'key' }), mkMark({ id: 'b', kind: 'noise' })])
  const combo = await h.tools.get('context_unmark').execute({ ids: ['a'], kind: 'noise', apply: true })
  assert.equal(combo.ok, false, '组合选择器无交集 ⇒ 无匹配 ⇒ 不静默成功')
  assert.equal(h.marks().length, 2, '无匹配不得改文件')
  h.cleanup()
})

test('无选择器 ⇒ 拒绝（防无参全删）', async () => {
  const h = harness()
  h.seed([mkMark({ id: 'm1' })])
  const before = h.marksRaw()
  // ⚠ 只测「合法 JSON 的空选择器」：`{ id: undefined }` 这类**不是 lossless JSON**，会在
  //    harness 参数校验层被拒（ToolArgsError INVALID_ARGS），根本走不到本工具 —— 那不是本工具的判据。
  for (const args of [{}, { apply: true }, { ids: [] }]) {
    const r = await h.tools.get('context_unmark').execute(args)
    assert.equal(r.ok, false, '空选择器必须拒绝：' + JSON.stringify(args))
    assert.match(r.result.error, /选择器/)
  }
  assert.equal(h.marksRaw(), before, '拒绝不得改文件')
  h.cleanup()
})

test('id 与 ids 互斥 / 非法 kind ⇒ 拒绝（参数校验在写盘之前）', async () => {
  const h = harness()
  h.seed([mkMark({ id: 'm1' })])
  const both = await h.tools.get('context_unmark').execute({ id: 'm1', ids: ['m1'], apply: true })
  assert.equal(both.ok, false)
  assert.match(both.result.error, /互斥/)
  const badKind = await h.tools.get('context_unmark').execute({ kind: 'important', apply: true })
  assert.equal(badKind.ok, false)
  assert.match(badKind.result.error, /kind 必须/)
  assert.equal(h.marks().length, 1, '两种拒绝都不得改文件')
  assert.equal(h.traceLines().length, 0)
  h.cleanup()
})

test('无匹配 ⇒ ok:false（不静默成功，与 kg_del_edge 同形）', async () => {
  const h = harness()
  h.seed([mkMark({ id: 'm1', kind: 'key' })])
  const r = await h.tools.get('context_unmark').execute({ kind: 'noise', apply: true })
  assert.equal(r.ok, false)
  assert.match(r.result.error, /无匹配/)
  h.cleanup()
})

test('删到空 ⇒ 侧车落成空数组（不是删文件），且再删一次为无匹配', async () => {
  const h = harness()
  h.seed([mkMark({ id: 'only' })])
  const r = await h.tools.get('context_unmark').execute({ id: 'only', apply: true })
  assert.equal(r.ok, true)
  assert.deepEqual(h.marks(), [], '文件保留、内容为空数组')
  assert.ok(existsSync(h.marksPath), '不删文件本身')
  const again = await h.tools.get('context_unmark').execute({ id: 'only', apply: true })
  assert.equal(again.ok, false, '第二次点同一个 id ⇒ 不存在 ⇒ 整体拒绝')
  assert.deepEqual(again.result.missing, ['only'])
  h.cleanup()
})

test('I8③ 尸体样本：留痕不可写 ⇒ 删除照常完成、traced:false（观测不反噬，§5.22 规则 3）', async () => {
  const h = harness()
  h.seed([mkMark({ id: 'm1' }), mkMark({ id: 'm2', kind: 'key' })])
  // 尸体构造：把留痕路径占成【目录】⇒ appendFile 必失败（比改权限更可移植）
  mkdirSync(join(h.home, 'context-marks', 'unmark-trace.jsonl'), { recursive: true })
  const r = await h.tools.get('context_unmark').execute({ id: 'm1', apply: true })
  assert.equal(r.ok, true, '留痕失败不得阻塞删除')
  assert.equal(r.result.applied, true)
  assert.equal(r.result.traced, false, '留痕失败必须【可见】（traced:false），不静默')
  assert.deepEqual(h.marks().map((m) => m.id), ['m2'], '盘上仍已删除')
  h.cleanup()
})
