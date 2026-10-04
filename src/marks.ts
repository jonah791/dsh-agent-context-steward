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

// ─────────────────────────────────────────────────────────────────────────────
// 删除原语（2026-10-04 · 语义文档 I8「删除原语三件套」）
// 由来：主人 2026-10-03 点名「删除能力很弱」——标记此前只增不减（语义文档 U4 未决问题）。
// 设计：纯层只算「删哪些」，**不落盘**；写盘 / 拒绝 / 留痕的决策全在壳层（可离线单测）。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 删除选择器：`id` / `ids`（精确，二者互斥由壳层把关）与 `kind`（结构标签批量）可单用、可组合（AND）。
 * `tag` **不作**删除选择器（语义标签是主题标签，跨主题误伤面大）。
 */
export type MarkSelector = { id?: string; ids?: string[]; kind?: MarkKind }

/**
 * 选择器是否为空 —— 判据**只此一处**（壳层与纯层不各写一遍）。
 * 空 = 「没指名任何标记」，**不等于「全部」**（防无参全删）。
 */
export function isEmptySelector(sel: MarkSelector): boolean {
  return sel.id === undefined && !(sel.ids !== undefined && sel.ids.length > 0) && sel.kind === undefined
}

/** 选中匹配的标记（保持原序）。空选择器 → `[]`（保守：宁可不删，也不把「没指名」读成「全删」）。 */
export function matchMarks(marks: ContextMark[], sel: MarkSelector): ContextMark[] {
  if (isEmptySelector(sel)) return []
  return marks.filter((m) => {
    if (sel.id !== undefined && m.id !== sel.id) return false
    if (sel.ids !== undefined && sel.ids.length > 0 && !sel.ids.includes(m.id)) return false
    if (sel.kind !== undefined && m.kind !== sel.kind) return false
    return true
  })
}

/** 删除的三段结果：删掉的 / 留下的 / 指名却不存在的（后者 = fail-closed 判据）。 */
export type RemoveOutcome = {
  removed: ContextMark[]
  kept: ContextMark[]
  /** 指名（id/ids）却在侧车里找不到的 id —— 非空 ⇒ 壳层必须**整体拒绝**（I8 ②） */
  missing: string[]
  /** 空选择器 —— 壳层必须拒绝（防无参全删） */
  emptySelector: boolean
}

/**
 * 删除（纯函数，**不落盘**）：算出 removed/kept/missing，由壳层决定是否写盘。
 *   - 空选择器 → `emptySelector:true`，removed 空、kept 原样（壳层拒绝）
 *   - 指名 id 有缺失 → 仍算出 removed/kept **供干跑展示**，但 missing 非空 ⇒ 壳层拒绝写盘
 *   - 只按 kind 批量 → 无 missing 概念（kind 无匹配 = removed 空，不算「指名不存在」）
 */
export function removeMarks(marks: ContextMark[], sel: MarkSelector): RemoveOutcome {
  if (isEmptySelector(sel)) return { removed: [], kept: marks, missing: [], emptySelector: true }
  const named = sel.id !== undefined ? [sel.id] : (sel.ids ?? [])
  const present = new Set(marks.map((m) => m.id))
  const missing = named.filter((id) => !present.has(id))
  const chosen = new Set(matchMarks(marks, sel).map((m) => m.id))
  return {
    removed: marks.filter((m) => chosen.has(m.id)),
    kept: marks.filter((m) => !chosen.has(m.id)),
    missing,
    emptySelector: false,
  }
}
