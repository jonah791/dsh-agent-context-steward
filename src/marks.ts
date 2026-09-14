/**
 * marks.ts — 上下文卷轴标记（侧车）的**纯逻辑层**：标签枚举、路径文件名、容错解析、过滤。
 *
 * 为什么抽出来（2026-09-14 插件可维护性补课 · 技能 `dsh-plugin-testability`）：
 * 三处判据原先埋在两个工具的 execute 回调里——① 结构标签白名单（非法 kind 必须拒收，
 * 否则脏标签写进侧车后剪枝决策被污染）② 会话 id → 文件名净化（`[^\w.-]` → `_`，
 * 改错了会把标记写到别的会话文件上）③ 过滤语义（kind 精确匹配 / tag 属于 tags 数组）。
 * 这三条都不会报错，只会**静默给出错误的剪枝建议**。
 *
 * 抽取纪律：白名单、正则、过滤顺序逐字照搬；IO（读写侧车文件）留在 index.ts 接线层。
 */

/** 结构标签 kind（角色）白名单——与改动前逐字一致。 */
export const MARK_KINDS = ['explore', 'conclusion', 'noise', 'key', 'extracted', 'keep'] as const

/** 结构标签类型。 */
export type MarkKind = (typeof MARK_KINDS)[number]

/**
 * 一条卷轴标记。必须是 **type 别名**：工具 output schema 的 `JsonValue` 依赖隐式索引签名
 * （interface 会 tsc 报 TS2322）。
 */
export type ContextMark = {
  id: string
  kind: MarkKind
  tags: string[]
  note?: string
  seq: number | null
  sessionId: string
  createdAt: string
}

/**
 * 结构标签校验：命中白名单 → 返回规范化值，否则 `undefined`（调用方据此拒收）。
 * `kind` 非字符串（数字/对象/undefined）同样返回 `undefined`，**不抛**。
 */
export function isMarkKind(k: unknown): MarkKind | undefined {
  return MARK_KINDS.find((x) => x === k)
}

/** 会话 id → 侧车文件名（净化 `[^\w.-]` → `_`，防路径穿越/非法字符）。 */
export function marksFileName(sessionId: string): string {
  return sessionId.replace(/[^\w.-]/g, '_') + '.json'
}

/**
 * 侧车文件原文 → 标记数组（容错解析）：
 *   - 空/未提供 → `[]`
 *   - 坏 JSON → `[]`（**不抛**）
 *   - 合法 JSON 但不是数组（手改坏了/写入中断）→ `[]`（保守：宁可从空开始，也不把非数组
 *     带进 `push`/`filter` 而在工具层炸开）
 * 数组内的元素形状不做校验（与改动前一致：只做「是数组」这一层）。
 */
export function parseMarks(raw: string | null | undefined): ContextMark[] {
  if (raw === null || raw === undefined) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as ContextMark[]) : []
  } catch {
    return []
  }
}

/**
 * 标记过滤（与原 `context_marks` 的 execute 逐字等价）：
 * `kind` 精确匹配；`tag` 属于该标记的 tags（同一标记须同时满足两个条件）。
 * 空过滤条件 = 不过滤（返回全部，顺序保持时间序）。
 */
export function filterMarks(marks: ContextMark[], filter: { kind?: string; tag?: string }): ContextMark[] {
  let out = marks
  if (filter.kind) out = out.filter((m) => m.kind === filter.kind)
  if (filter.tag) out = out.filter((m) => m.tags.includes(filter.tag as never))
  return out
}
