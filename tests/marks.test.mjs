/**
 * tests/marks.test.mjs — 上下文卷轴标记纯逻辑层的回归测试（跑 lib 产物，与运行时同源）。
 *
 * 覆盖：结构标签白名单（拒收非法）／文件名净化（防写到别的会话）／过滤语义（kind + tag 与）／
 * 退化路径（坏 JSON、非数组 JSON、空输入、脏标记必须**不抛**且保守）。
 * 跑法：node --test tests/marks.test.mjs（先 tsc -p tsconfig.json 构建）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MARK_KINDS, filterMarks, isMarkKind, marksFileName, parseMarks } from '../lib/marks.js'

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
