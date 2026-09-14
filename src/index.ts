/** dsh-agent-context-steward：上下文管家（2026-08-29 主人定调，借鉴 ThoughtDAG「用户是你」）。
 *
 * ThoughtDAG 是「用户编辑画布，模型执行」；对我，用户是我，执行者也是我——
 * 上下文是我的画布，我是主编。本插件提供「审视视角」：
 *   - context_health：当前会话上下文体检（压力/构成/健康 + 主动管理建议），
 *     消费 dsh-agent-context 的 contextMeter 服务，以「编辑者」视角呈现，
 *     引导主动审视→剪枝→压缩（见技能 context-stewardship）。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
// 纯逻辑层（可离线单测，见 tests/health.test.mjs / tests/marks.test.mjs）
import { buildHealth, eventsLengthOf, type ContextReportLoose } from './health.ts'
import { MARK_KINDS, filterMarks, isMarkKind, marksFileName, parseMarks, type ContextMark, type MarkKind } from './marks.ts'

export const name = 'agent-context-steward'
export const inject = ['contextMeter', 'agents', 'tools'] as const

export interface Config {
  /** 中等压力阈值（使用率 0-1，超此给「主动审视」建议） */
  mediumThreshold: number
  /** 高压力阈值（使用率 0-1，超此给「压缩」建议） */
  highThreshold: number
}
export const Config = z.object({
  mediumThreshold: z.number().default(0.5),
  highThreshold: z.number().default(0.75),
})

/** 宽松访问 harness/他插件服务（agents 已被 harness 声明为 AgentRegistry、contextMeter 被 dsh-agent-context 声明——用结构读取避免类型冲突） */
interface StewardServices {
  contextMeter: { report(session: unknown): ContextReportLoose }
  agents: {
    list(): Array<{ id: unknown; session: unknown }>
    currentInitiator(): { id: unknown; session: unknown } | undefined
  }
}

export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger('context-steward')
  // 宽松获取 services（避免与 harness AgentRegistry / dsh-agent-context ContextMeter 类型冲突）
  const svc = ctx as unknown as StewardServices
  const meter = svc.contextMeter
  const agents = svc.agents

  // ── 侧车标记（方案 B：context_mark/context_marks） ──
  // 结构标签 kind（角色）+ 语义标签 tags（主题）+ note + seq（当时的日志位置，供剪枝参考）
  // 侧车路径：<DSH_HOME>/context-marks/<sessionId>.json —— 独立于会话事件流（规避 harness
  // 对自定义事件的 ignorable/seq 硬约束），压缩后 seq 失效但语义（kind/tags/note）仍有效。
  // 判据（白名单/文件名净化/容错解析/过滤）全在 marks.ts（纯函数，可离线单测）。
  const dshHome = process.env.DSH_HOME || process.cwd()
  const marksDir = resolve(join(dshHome, 'context-marks'))

  const marksFile = (sessionId: string): string => join(marksDir, marksFileName(sessionId))

  async function readMarks(sessionId: string): Promise<ContextMark[]> {
    const file = marksFile(sessionId)
    if (!existsSync(file)) return []
    try { return parseMarks(await readFile(file, 'utf8')) } catch { return [] }
  }
  async function writeMarks(sessionId: string, marks: ContextMark[]): Promise<void> {
    await mkdir(marksDir, { recursive: true })
    await writeFile(marksFile(sessionId), JSON.stringify(marks, null, 2), 'utf8')
  }

  /** 解析目标 session：参数 id > 当前发起 agent > 第一个 live agent（list 查找避免 SessionId branded 构造） */
  const resolveSession = (sessionId?: string): { id: unknown; session: unknown } | undefined => {
    const list = agents.list()
    if (sessionId) {
      const found = list.find((a) => String(a.id) === sessionId)
      if (found) return found
    }
    return agents.currentInitiator() ?? list[0]
  }

  /** 体检报告 → 健康视图：实现见 health.ts（纯函数，阈值显式传入——可离线单测等级/占比/建议判据） */
  const healthOf = (r: ContextReportLoose) =>
    buildHealth(r, { mediumThreshold: config.mediumThreshold, highThreshold: config.highThreshold })

  // ---- context_health：上下文体检（审视视角，用户是你） ----
  ctx.tools.register(defineTool({
    name: 'context_health',
    description: '上下文体检（用户是你——审视我的上下文画布）：当前会话的上下文压力/容量使用率/构成（system/tools/message 占比）/健康等级 + 主动管理建议（审视→剪枝→压缩）。主动管理纪律见技能 context-stewardship。',
    parameters: { sessionId: { type: 'string', description: '目标会话 id（缺省=当前活跃会话）' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, health: { type: 'json', required: true } } },
      render: (_a, v) => {
        const h = (v.health ?? {}) as { sessionId?: string; pressureTokens?: number; contextWindow?: number; usageRate?: number | null; level?: string; breakdown?: { systemPct?: number; toolsPct?: number; messagePct?: number; toolsDominant?: boolean }; suggestions?: string[] }
        const rate = h.usageRate === null || h.usageRate === undefined ? '?' : (h.usageRate * 100).toFixed(0) + '%'
        const lines = [
          `上下文体检 ${h.sessionId ?? ''} [${h.level}] 使用率 ${rate}（${h.pressureTokens ?? 0}/${h.contextWindow ?? '?'} tokens）`,
          `构成 system ${h.breakdown?.systemPct ?? 0}% / tools ${h.breakdown?.toolsPct ?? 0}% / message ${h.breakdown?.messagePct ?? 0}%`,
          ...(h.suggestions ?? []).map((s) => '· ' + s),
        ]
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const target = resolveSession(args.sessionId)
      if (!target) {
        return { ok: true, health: { sessionId: null, level: 'unknown', pressureTokens: 0, contextWindow: 0, usageRate: null, suggestions: ['无活跃会话'] } }
      }
      try {
        const report = meter.report(target.session)
        return { ok: true, health: healthOf(report) }
      } catch (err) {
        logger.warn(`context_health 失败: ${(err as Error).message}`)
        return { ok: true, health: { sessionId: String(target.id), level: 'unknown', pressureTokens: 0, contextWindow: 0, usageRate: null, suggestions: [`contextMeter 不可用: ${(err as Error).message}`] } }
      }
    },
  }))

  // ---- context_mark：给上下文卷轴打标记（结构+语义双维，方案 B 侧车） ----
  ctx.tools.register(defineTool({
    name: 'context_mark',
    description: '给当前上下文打标记（卷轴标记：结构+语义双维）。kind=结构标签（explore 探索/conclusion 结论/noise 噪音/key 关键/extracted 已提取/keep 保留）；tags=语义标签（主题，如 ["保活","guardian"]）；note=说明。打标记用于头脑风暴后剪枝——敲定结论标 conclusion+key，被否定想法标 noise，后续剪枝优先剪 noise/extracted。侧车存储（方案 B）。',
    parameters: {
      kind: { type: 'string', required: true, description: '结构标签：explore/conclusion/noise/key/extracted/keep' },
      tags: { type: 'array', description: '语义标签数组（主题，如 保活/guardian）', items: { type: 'string' } },
      note: { type: 'string', description: '说明（可选）' },
      sessionId: { type: 'string', description: '目标会话 id（缺省=当前活跃会话）' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, mark: { type: 'json', required: true } } },
      render: (_a, v) => {
        const m = (v.mark ?? {}) as { id?: string; kind?: string; tags?: string[]; seq?: number | null; note?: string }
        return [{ type: 'text', text: `标记 ${m.id} [${m.kind}] ${(m.tags ?? []).join(',')}${m.note ? ' — ' + m.note : ''}${m.seq !== null && m.seq !== undefined ? ' @seq' + m.seq : ''}` }]
      },
    },
    async execute(args) {
      const target = resolveSession(args.sessionId)
      const kind = isMarkKind(args.kind)
      if (!kind) return { ok: false, mark: { id: null, error: `kind 必须 ∈ ${MARK_KINDS.join('/')}` } }
      if (!target) return { ok: false, mark: { id: null, error: '无活跃会话可打标记' } }
      const sessionId = String(target.id)
      const mark: ContextMark = {
        id: randomUUID().slice(0, 8),
        kind,
        tags: Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === 'string') : [],
        note: args.note,
        seq: eventsLengthOf(target.session),
        sessionId,
        createdAt: new Date().toISOString(),
      }
      const marks = await readMarks(sessionId)
      marks.push(mark)
      await writeMarks(sessionId, marks)
      return { ok: true, mark }
    },
  }))

  // ---- context_marks：列出上下文标记（按会话/结构/语义过滤） ----
  ctx.tools.register(defineTool({
    name: 'context_marks',
    description: '列出上下文标记（卷轴标记，方案 B 侧车）：可过滤 sessionId/kind/tag。用于审视上下文结构——敲定后看哪些段标了 noise/extracted（可剪）、哪些是 conclusion/key（保留），辅助剪枝决策。',
    parameters: {
      sessionId: { type: 'string', description: '目标会话 id（缺省=当前活跃会话）' },
      kind: { type: 'string', description: '按结构标签过滤' },
      tag: { type: 'string', description: '按语义标签过滤' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, marks: { type: 'json', required: true }, count: { type: 'number', required: true } } },
      render: (_a, v) => {
        const ms = (v.marks ?? []) as Array<{ id?: string; kind?: string; tags?: string[]; note?: string; seq?: number | null }>
        if (ms.length === 0) return [{ type: 'text', text: '（无标记）' }]
        const lines = ms.map((m) => `· ${m.id} [${m.kind}] ${(m.tags ?? []).join(',')}${m.note ? ' — ' + m.note : ''}${m.seq !== null && m.seq !== undefined ? ' @seq' + m.seq : ''}`)
        return [{ type: 'text', text: `标记 ${ms.length} 条：\n` + lines.join('\n') }]
      },
    },
    async execute(args) {
      const target = args.sessionId ? { id: args.sessionId, session: null } : resolveSession()
      if (!target) return { ok: true, marks: [], count: 0 }
      const sessionId = String(target.id)
      const marks = filterMarks(await readMarks(sessionId), { kind: args.kind, tag: args.tag })
      return { ok: true, marks, count: marks.length }
    },
  }))

  logger.info('context-steward 就绪：context_health / context_mark / context_marks 已注册')
}
