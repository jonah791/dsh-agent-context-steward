/**
 * tests/marks.test.mjs — 上下文卷轴标记纯逻辑层的回归测试（跑 lib 产物，与运行时同源）。
 *
 * 覆盖：结构标签白名单（拒收非法）／文件名净化（防写到别的会话）／过滤语义（kind + tag 与）／
 * 退化路径（坏 JSON、非数组 JSON、空输入、脏标记必须**不抛**且保守）。
 * 跑法：node --test tests/marks.test.mjs（先 tsc -p tsconfig.json 构建）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MARK_KINDS, filterMarks, isEmptySelector, isMarkKind, marksFileName, matchMarks, parseMarks, removeMarks } from '../lib/marks.js'

const mark = (over = {}) => ({
  id: 'a1b2c3d4',
  kind: 'conclusion',
  tags: ['保活', 'guardian'],
  note: '敲定结论',
  seq: 9033,
  sessionId: 'session-879c4ae1',
  createdAt: '2026-09-14T00:00:00.000Z',
  ...over,
})

test('MARK_KINDS: 结构标签白名单是这 6 个（顺序即文档顺序）', () => {
  assert.deepEqual([...MARK_KINDS], ['explore', 'conclusion', 'noise', 'key', 'extracted', 'keep'])
})

test('isMarkKind: 白名单命中返回原值，非法/非字符串一律拒收（undefined）', () => {
  for (const k of MARK_KINDS) assert.equal(isMarkKind(k), k)
  assert.equal(isMarkKind('important'), undefined) // 自造标签不得入库
  assert.equal(isMarkKind('CONCLUSION'), undefined) // 大小写敏感
  assert.equal(isMarkKind(''), undefined)
  assert.equal(isMarkKind(undefined), undefined)
  assert.equal(isMarkKind(null), undefined)
  assert.equal(isMarkKind(3), undefined)
  assert.equal(isMarkKind({ kind: 'key' }), undefined)
})

test('marksFileName: 会话 id 净化——非法字符一律变 _，保留 [\\w.-]', () => {
  assert.equal(marksFileName('session-879c4ae1'), 'session-879c4ae1.json')
  assert.equal(marksFileName('a.b_c-d'), 'a.b_c-d.json')
  assert.equal(marksFileName('../../etc/passwd'), '.._.._etc_passwd.json') // 路径穿越被净化
  assert.equal(marksFileName('C:\\x/y z'), 'C__x_y_z.json')
})

test('parseMarks: 主路径——合法数组原样返回（时间序不变）', () => {
  const list = [mark(), mark({ id: 'e5f6', kind: 'noise' })]
  const out = parseMarks(JSON.stringify(list))
  assert.equal(out.length, 2)
  assert.equal(out[0].kind, 'conclusion')
  assert.equal(out[1].id, 'e5f6')
})

test('parseMarks: 空输入/坏 JSON/非数组 JSON → 空数组且不抛（脏数据保守）', () => {
  assert.deepEqual(parseMarks(null), [])
  assert.deepEqual(parseMarks(undefined), [])
  assert.deepEqual(parseMarks(''), [])
  assert.deepEqual(parseMarks('[{ 半截'), [])
  assert.deepEqual(parseMarks('{"kind":"key"}'), []) // 合法 JSON 但不是数组 → 保守取空（写入中断的残file）
  assert.deepEqual(parseMarks('null'), [])
  assert.deepEqual(parseMarks('42'), [])
})

test('filterMarks: 无过滤条件返回全部（顺序保持）', () => {
  const list = [mark({ id: '1', kind: 'noise' }), mark({ id: '2', kind: 'key' })]
  assert.deepEqual(filterMarks(list, {}).map((m) => m.id), ['1', '2'])
})

test('filterMarks: kind 精确匹配 / tag 属于 tags / 两者同时满足（AND）', () => {
  const list = [
    mark({ id: '1', kind: 'noise', tags: ['保活'] }),
    mark({ id: '2', kind: 'conclusion', tags: ['guardian'] }),
    mark({ id: '3', kind: 'conclusion', tags: ['保活', 'guardian'] }),
  ]
  assert.deepEqual(filterMarks(list, { kind: 'conclusion' }).map((m) => m.id), ['2', '3'])
  assert.deepEqual(filterMarks(list, { tag: 'guardian' }).map((m) => m.id), ['2', '3'])
  assert.deepEqual(filterMarks(list, { kind: 'conclusion', tag: 'guardian' }).map((m) => m.id), ['2', '3'])
  assert.deepEqual(filterMarks(list, { kind: 'noise', tag: 'guardian' }), []) // 空结果不抛
  assert.deepEqual(filterMarks([], { kind: 'key' }), []) // 空数组边界
})

test('filterMarks: 无命中返回空数组（不返回 undefined，调用方 .length 安全）', () => {
  const out = filterMarks([mark()], { tag: '不存在的主题' })
  assert.ok(Array.isArray(out))
  assert.equal(out.length, 0)
})

// ── 删除原语（I8 · 2026-10-04 · 主人点名「删除能力很弱」） ──

test('isEmptySelector: 「没指名」为真 —— undefined / 空 ids / 空对象都算空', () => {
  assert.equal(isEmptySelector({}), true)
  assert.equal(isEmptySelector({ id: undefined, kind: undefined }), true)
  assert.equal(isEmptySelector({ ids: [] }), true, '空数组 = 没指名（不是「全部」）')
  assert.equal(isEmptySelector({ id: 'm1' }), false)
  assert.equal(isEmptySelector({ ids: ['m1'] }), false)
  assert.equal(isEmptySelector({ kind: 'noise' }), false)
})

test('matchMarks: 空选择器返回 []（不返回全部 —— 防「没指名」被读成「全删」）', () => {
  const list = [mark({ id: '1' }), mark({ id: '2' })]
  assert.deepEqual(matchMarks(list, {}), [])
  assert.deepEqual(matchMarks(list, { ids: [] }), [])
})

test('matchMarks: id 精确 / ids 集合 / kind 批量 / 组合 AND（结果保持原序）', () => {
  const list = [
    mark({ id: '1', kind: 'noise' }),
    mark({ id: '2', kind: 'key' }),
    mark({ id: '3', kind: 'noise' }),
  ]
  assert.deepEqual(matchMarks(list, { id: '2' }).map((m) => m.id), ['2'])
  assert.deepEqual(matchMarks(list, { ids: ['3', '1'] }).map((m) => m.id), ['1', '3'], '原序而非入参序')
  assert.deepEqual(matchMarks(list, { kind: 'noise' }).map((m) => m.id), ['1', '3'])
  assert.deepEqual(matchMarks(list, { ids: ['1', '2'], kind: 'noise' }).map((m) => m.id), ['1'])
  assert.deepEqual(matchMarks(list, { kind: 'keep' }), [])
})

test('removeMarks: 空选择器 → emptySelector 标记、kept 原样（壳层据此拒绝）', () => {
  const out = removeMarks([mark({ id: '1' })], {})
  assert.equal(out.emptySelector, true)
  assert.deepEqual(out.removed, [])
  assert.equal(out.kept.length, 1)
  assert.deepEqual(out.missing, [])
})

test('removeMarks: 指名缺失 → missing 报出（fail-closed 判据），removed/kept 仍算好供干跑展示', () => {
  const out = removeMarks([mark({ id: '1' }), mark({ id: '2' })], { ids: ['1', 'nope'] })
  assert.deepEqual(out.missing, ['nope'])
  assert.deepEqual(out.removed.map((m) => m.id), ['1'])
  assert.deepEqual(out.kept.map((m) => m.id), ['2'])
  assert.equal(out.emptySelector, false)
})

test('removeMarks: 只按 kind 无匹配 → removed 空且 missing 空（kind 无「指名不存在」概念）', () => {
  const out = removeMarks([mark({ id: '1', kind: 'key' })], { kind: 'noise' })
  assert.deepEqual(out.removed, [])
  assert.deepEqual(out.missing, [])
  assert.equal(out.kept.length, 1)
})

test('removeMarks: 纯函数不得改入参（kept/removed 是新数组）', () => {
  const list = [mark({ id: '1', kind: 'noise' }), mark({ id: '2', kind: 'key' })]
  const snapshot = JSON.stringify(list)
  const out = removeMarks(list, { kind: 'noise' })
  assert.deepEqual(out.kept.map((m) => m.id), ['2'])
  assert.equal(out.removed.length, 1)
  assert.equal(JSON.stringify(list), snapshot, '入参未被就地修改')
})
