/**
 * tests/health.test.mjs — 上下文体检纯视图层的回归测试（跑 lib 产物，与运行时同源）。
 *
 * 覆盖：等级判据（阈值边界 / NaN 保守取 low）／构成占比与 toolsDominant 三条件 AND／
 * 退化路径（空 breakdown、零容量、缺字段必须**不抛**且保守）／事件条数防御式读取。
 * 跑法：node --test tests/health.test.mjs（先 tsc -p tsconfig.json 构建）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildHealth, eventsLengthOf } from '../lib/health.js'

const TH = { mediumThreshold: 0.5, highThreshold: 0.75 }
const report = (over = {}) => ({
  sessionId: 'session-abc123',
  totalTokens: 100_000,
  surfaceTokens: 60_000,
  surfaceMessages: 42,
  contextWindow: 200_000,
  usageTotal: 123_456,
  ...over,
})

test('buildHealth: 主路径——使用率 0.5 边界的等级与建议（真实常数）', () => {
  const low = buildHealth(report({ projectedTokens: 80_000, breakdown: { systemTokens: 10_000, toolsTokens: 20_000, messageTokens: 70_000 } }), TH)
  assert.equal(low.level, 'low')
  assert.equal(low.usageRate, 0.4)
  assert.deepEqual(low.suggestions, ['上下文健康，无需处理。可保持当前节奏。'])

  const medium = buildHealth(report({ projectedTokens: 100_000, breakdown: { systemTokens: 10_000, toolsTokens: 20_000, messageTokens: 70_000 } }), TH)
  assert.equal(medium.level, 'medium') // 0.5 >= mediumThreshold → medium（边界相等算达到）
  assert.equal(medium.usageRate, 0.5)
  assert.ok(medium.suggestions[0].includes('使用率 50%：主动审视'))

  const high = buildHealth(report({ projectedTokens: 150_000, breakdown: { systemTokens: 10_000, toolsTokens: 20_000, messageTokens: 70_000 } }), TH)
  assert.equal(high.level, 'high') // 0.75 >= highThreshold
  assert.ok(high.suggestions[0].includes('使用率 75%：高压力'))
})

test('buildHealth: 压力取 projectedTokens 优先，回落 totalTokens', () => {
  assert.equal(buildHealth(report({ projectedTokens: 40_000 }), TH).pressureTokens, 40_000)
  assert.equal(buildHealth(report({}), TH).pressureTokens, 100_000)
})

test('buildHealth: 构成占比四舍五入 + 透传 surface/usageTotal', () => {
  const h = buildHealth(report({ breakdown: { systemTokens: 25_000, toolsTokens: 25_000, messageTokens: 50_000 } }), TH)
  assert.deepEqual(
    { s: h.breakdown.systemPct, t: h.breakdown.toolsPct, m: h.breakdown.messagePct },
    { s: 25, t: 25, m: 50 },
  )
  assert.deepEqual(h.surface, { tokens: 60_000, messages: 42 })
  assert.equal(h.usageTotal, 123_456)
})

test('buildHealth: toolsDominant 需同时满足「多于 system、多于 message、占比 > 0.4」', () => {
  const dominant = buildHealth(report({ breakdown: { systemTokens: 10_000, toolsTokens: 60_000, messageTokens: 30_000 } }), TH)
  assert.equal(dominant.breakdown.toolsDominant, true)
  assert.ok(dominant.suggestions.some((s) => s.includes('tools 占比 60%（dominant）')))
  // 占比 0.4 恰好不满足 "> 0.4"（边界：严格大于）
  const exactly = buildHealth(report({ breakdown: { systemTokens: 10_000, toolsTokens: 40_000, messageTokens: 50_000 } }), TH)
  assert.equal(exactly.breakdown.toolsDominant, false)
  // 多于 message 但不多于 system → 不判 dominant
  const notMore = buildHealth(report({ breakdown: { systemTokens: 80_000, toolsTokens: 15_000, messageTokens: 5_000 } }), TH)
  assert.equal(notMore.breakdown.toolsDominant, false)
})

test('buildHealth: system 占比 > 0.5 时追加精简注入建议', () => {
  const h = buildHealth(report({ projectedTokens: 160_000, breakdown: { systemTokens: 60_000, toolsTokens: 30_000, messageTokens: 10_000 } }), TH)
  assert.ok(h.suggestions.some((s) => s.includes('system 占比 60%：系统提示/记忆注入占用高')))
  // 恰好 0.5 不加（判据是 > 0.5）
  const half = buildHealth(report({ projectedTokens: 160_000, breakdown: { systemTokens: 50_000, toolsTokens: 30_000, messageTokens: 20_000 } }), TH)
  assert.equal(half.suggestions.some((s) => s.includes('系统提示/记忆注入占用高')), false)
})

test('buildHealth: 阈值可注入（同一报告在不同阈值下分级不同）', () => {
  const r = report({ projectedTokens: 120_000, breakdown: { systemTokens: 1, toolsTokens: 1, messageTokens: 1 } })
  assert.equal(buildHealth(r, { mediumThreshold: 0.5, highThreshold: 0.75 }).level, 'medium')
  assert.equal(buildHealth(r, { mediumThreshold: 0.8, highThreshold: 0.9 }).level, 'low')
})

// ── 退化/失败路径：不抛 + 保守 ──────────────────────────────────────
test('buildHealth: 缺 contextWindow（零容量）→ 使用率 null、等级保守取 low，不抛', () => {
  const h = buildHealth({ sessionId: 's', totalTokens: 5_000, surfaceTokens: 1, surfaceMessages: 1, usageTotal: 1 }, TH)
  assert.equal(h.usageRate, null)
  assert.equal(h.level, 'low')
  assert.equal(h.contextWindow, 0)
  assert.deepEqual(h.suggestions, ['上下文健康，无需处理。可保持当前节奏。'])
})

test('buildHealth: 缺 breakdown → 全零占比（防除零），不抛', () => {
  const h = buildHealth(report({ breakdown: undefined }), TH)
  assert.deepEqual(
    { s: h.breakdown.systemPct, t: h.breakdown.toolsPct, m: h.breakdown.messagePct, d: h.breakdown.toolsDominant },
    { s: 0, t: 0, m: 0, d: false },
  )
})

test('buildHealth: 脏数据（负容量/NaN 压力/空对象）不抛且保守', () => {
  const negative = buildHealth(report({ contextWindow: -1, projectedTokens: 10 }), TH)
  assert.equal(negative.usageRate, null)
  assert.equal(negative.level, 'low')
  const nanPressure = buildHealth(report({ projectedTokens: Number.NaN }), TH)
  assert.equal(nanPressure.usageRate, null) // NaN 使用率 → 保守 low
  assert.equal(nanPressure.level, 'low')
  const empty = buildHealth({}, TH)
  assert.equal(empty.level, 'low')
  assert.equal(empty.pressureTokens, 0)
})

test('eventsLengthOf: 事件数组/缺失/形状异常/访问抛错 一律不抛（缺失回 null）', () => {
  assert.equal(eventsLengthOf({ events: [1, 2, 3] }), 3)
  assert.equal(eventsLengthOf({}), null)
  assert.equal(eventsLengthOf(null), null)
  assert.equal(eventsLengthOf(42), null)
  const thrower = { get events() { throw new Error('boom') } }
  let out
  assert.doesNotThrow(() => { out = eventsLengthOf(thrower) })
  assert.equal(out, null)
})
