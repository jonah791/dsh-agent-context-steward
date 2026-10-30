/**
 * health.ts — 上下文体检的**纯视图层**（无 IO、无 Date.now、阈值由调用方注入）。
 *
 * 为什么抽出来（2026-09-14 插件可维护性补课 · 技能 `dsh-plugin-testability`）：
 * `buildHealth` 原本就标注「纯函数」，却写在 `apply()` 闭包里——闭包捕获 `config` 阈值，
 * 于是「多少算高压力」「tools 占比多少算 dominant」这两条**会直接改变建议文案与健康等级**的判据
 * 无法离线验证（改错符号 = 高压力报成健康，不报错、只误导）。
 *
 * 抽取纪律：判据逐字照搬（阈值比较符号 `>=`、`NaN → low`、`sum || 1` 防零除、
 * `Math.round(x*100)`、`toolsDominant` 三条件 AND），只把 `config.highThreshold/mediumThreshold`
 * 换成显式参数。
 */

/** dsh-agent-context 的 ContextReport（宽松结构声明，跨包不 import——版本解耦） */
export interface ContextReportLoose {
  sessionId: string
  pressureTokens?: number
  projectedTokens?: number
  totalTokens: number
  surfaceTokens: number
  surfaceMessages: number
  contextWindow?: number
  usageTotal: number
  breakdown?: { systemTokens?: number; toolsTokens?: number; messageTokens?: number }
}

/** 健康分级阈值（使用率 0-1）。 */
export type HealthThresholds = {
  /** 中等压力阈值（超此给「主动审视」建议） */
  mediumThreshold: number
  /** 高压力阈值（超此给「压缩」建议） */
  highThreshold: number
}

/**
 * 体检报告 → 健康视图（纯函数）：
 *   - 容量缺失（contextWindow 0/undefined）→ usageRate = NaN → level 保守取 'low'
 *   - **占用取 `projectedTokens ?? totalTokens ?? 0`**，与官方 GUI 的
 *     `context-occupancy.ts`（`pressure?.projectedTokens ?? pressure?.pressureTokens`）同口径；
 *     等级与建议都挂在这个量上，所以「我报的百分比」必须等于「GUI 报的百分比」。
 *   - **`recentPromptTokens` ≠ 占用**：它是提供方实测的上次请求 prompt 规模
 *     （官方 `contextPressure.pressureTokens`），占用是「下一个请求将花多少」的预测。
 *     2026-10-30 修正：原实现把预测值改名成 `pressureTokens` 输出 ⇒ 字段名指向另一个量，
 *     与同插件的 `/context` 命令、与 GUI 天然对不上（主人当场发现）。故拆成两个字段。
 *   - 构成占比按 system/tools/message 三者之和归一（全零时 `|| 1` 防除零）；
 *     `breakdownSum` 一并返回，供「构成之和 vs 占用」的差额对账
 *     （官方口径：构成是固定启发式估算，**总和不会等于总量**）。
 *   - 建议文案只在 medium/high 时生成（low 只回一句「无需处理」）
 */
export function buildHealth(r: ContextReportLoose, thresholds: HealthThresholds) {
  const capacity = r.contextWindow ?? 0
  const used = r.projectedTokens ?? r.totalTokens ?? 0
  const usageRate = capacity > 0 ? used / capacity : NaN
  // 健康分级
  let level: 'low' | 'medium' | 'high'
  if (!isFinite(usageRate)) level = 'low'
  else if (usageRate >= thresholds.highThreshold) level = 'high'
  else if (usageRate >= thresholds.mediumThreshold) level = 'medium'
  else level = 'low'
  // 构成占比
  const b = r.breakdown ?? {}
  const bt = b.systemTokens ?? 0
  const tt = b.toolsTokens ?? 0
  const mt = b.messageTokens ?? 0
  const sum = bt + tt + mt || 1
  const breakdown = {
    systemTokens: bt, toolsTokens: tt, messageTokens: mt,
    systemPct: Math.round((bt / sum) * 100),
    toolsPct: Math.round((tt / sum) * 100),
    messagePct: Math.round((mt / sum) * 100),
    toolsDominant: tt > bt && tt > mt && tt / sum > 0.4,
  }
  // 主动管理建议（用户是你：审视→剪枝→压缩）
  const suggestions: string[] = []
  if (level === 'low') {
    suggestions.push('上下文健康，无需处理。可保持当前节奏。')
  } else {
    if (level === 'medium') {
      suggestions.push(`使用率 ${(usageRate * 100).toFixed(0)}%：主动审视（context-stewardship）——prune_candidates 看可剪候选，剪掉已完成任务的工具结果/过时内容。`)
    } else {
      suggestions.push(`使用率 ${(usageRate * 100).toFixed(0)}%：高压力——先剪噪音（prune_candidates→prune_apply），再 session_compact 压缩，别让 checkpoint 带垃圾。`)
    }
    if (breakdown.toolsDominant) {
      suggestions.push(`tools 占比 ${breakdown.toolsPct}%（dominant）：大块工具结果堆积——优先剪过时的工具输出（tail 优先，零缓存破坏）。`)
    }
    if (bt / sum > 0.5) {
      suggestions.push(`system 占比 ${breakdown.systemPct}%：系统提示/记忆注入占用高——检查记忆注入是否必要，精简注入。`)
    }
  }
  return {
    sessionId: r.sessionId,
    /** 占用（与 GUI 同口径）：`projectedTokens ?? totalTokens`；百分比与等级都挂在这个量上 */
    usedTokens: used,
    /** 最近一次提供方实测的请求 prompt 规模（真 pressureTokens）。缺样本时 null——**不是 0**（JSON 无 undefined） */
    recentPromptTokens: r.pressureTokens ?? null,
    contextWindow: capacity,
    usageRate: isFinite(usageRate) ? Math.round(usageRate * 100) / 100 : null,
    level,
    surface: { tokens: r.surfaceTokens, messages: r.surfaceMessages },
    usageTotal: r.usageTotal,
    breakdown,
    /** 构成之和（固定启发式估算）。官方口径：它**不会等于** usedTokens，差额即启发式误差 */
    breakdownSum: bt + tt + mt,
    suggestions,
  }
}

/**
 * 会话事件条数（防御式读取）：`events` 缺失/形状异常/访问抛错 → `null`（**不抛**）。
 * 与改动前同语义（原 `sessionEventsLength`）。
 */
export function eventsLengthOf(session: unknown): number | null {
  try { return (session as { events?: readonly unknown[] }).events?.length ?? null } catch { return null }
}
