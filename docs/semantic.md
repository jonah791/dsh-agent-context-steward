# 语义文档：dsh-agent-context-steward（上下文管家 · 审视视角 + 卷轴标记）

> 版本 v0.1 · 2026-09-14 · 作者：爱丽丝 · 状态：**draft**
> 开发方式：语义文档优先（本份是 2026-09-14 可维护性工程的**补课**文档）
> 实现落点：`self-plugins/dsh-agent-context-steward/src/index.ts`（+ 纯视图 `src/health.ts`、纯逻辑 `src/marks.ts`）

| 项 | 值 |
|----|----|
| 能力名 | dsh-agent-context-steward（上下文体检 `context_health` + 卷轴标记 `context_mark`/`context_marks`） |
| 主副本路径 | `self-plugins/dsh-agent-context-steward/docs/semantic.md`（本文件） |
| 实现落点 | `src/index.ts`（工具接线 + 侧车读写）、`src/health.ts`（体检报告 → 健康视图纯函数）、`src/marks.ts`（标记白名单/文件名净化/容错解析/过滤纯函数） |
| 版本 | 0.1.1（git head `c3de023`） |
| 挂载位置 | `.dsh/profiles/web/cordis.patch.yml` **行 213–215** `insert` 块：行 id `agent-agent-context-steward`（:214）、name `dsh-agent-context-steward`（:215）；**无 config**（阈值用默认 0.5 / 0.75） |
| 状态 | **draft** |
| 测试 | `tests/health.test.mjs`、`tests/marks.test.mjs` |

## 1 · 定位与反定位

**定位**：让我**看见并标注自己上下文的「地形」**（借鉴 ThoughtDAG「用户是你」——用户是我，主编也是我）：
① `context_health` 把当前会话的上下文压力/容量使用率/构成（system/tools/message 占比）翻译成**健康等级 + 主动管理建议**；
② `context_mark` / `context_marks` 用**侧车**给上下文卷轴打「结构标签 + 语义标签」标记，供剪枝决策参考。

**反定位（本文不管什么）**：
- **不剪枝**：剪枝归 `dsh-agent-context`（`prune_candidates` / `prune_apply`）——**steward 负责「看」，context 负责「剪」**
- **不压缩**：压缩归 `dsh-agent-compact` / `session_compact`（本插件只在建议文案里指向它）
- **不计量**：token 计量归 `dsh-agent-context` 的 `contextMeter` 服务——本插件是它的**消费者**
- **不写会话事件**：标记存**侧车文件**（方案 B），不侵入会话事件流（规避 harness 对自定义事件的 `ignorable`/`seq` 硬约束）

## 2 · 术语表

| 术语 | 含义 |
|------|------|
| contextMeter | `dsh-agent-context` 提供的宿主服务：`report(session) → ContextReport`（本插件**只读消费**） |
| 体检（health） | `ContextReport` → `{sessionId, pressureTokens, contextWindow, usageRate, level, breakdown, suggestions}` |
| level | 健康等级 `low` / `medium` / `high`（阈值 `mediumThreshold=0.5`、`highThreshold=0.75`） |
| dominant（tools） | `toolsTokens > systemTokens && toolsTokens > messageTokens && toolsTokens/sum > 0.4` ——「大块工具结果堆积」 |
| 卷轴标记（mark） | `{id, kind, tags[], note?, seq, sessionId, createdAt}`；`seq` 是打标记时的**事件条数快照** |
| 结构标签 kind | 白名单六值：`explore` / `conclusion` / `noise` / `key` / `extracted` / `keep` |
| 语义标签 tags | 自由字符串数组（主题，如 `["保活","guardian"]`） |
| 侧车（方案 B） | 标记存 `<DSH_HOME>/context-marks/<净化后的 sessionId>.json`，与会话事件流解耦 |
| 净化 | `sessionId.replace(/[^\w.-]/g,'_')`（防路径穿越/非法字符） |

## 3 · 概念模型

```
 我 ──context_health(sessionId?)──▶ resolveSession(id > currentInitiator > list[0])
        │                              └─▶ ctx.contextMeter.report(target.session)
        │                                    └─▶ buildHealth(report, {medium,high})  ← 纯函数 health.ts:42
        │                                          └─▶ {level, usageRate, breakdown, suggestions[]}
        │
        ├──context_mark(kind,tags,note)──▶ isMarkKind 白名单校验（非法 → ok:false）
        │                                   └─▶ readMarks(sessionId) → push(mark) → writeMarks
        │                                         mark.seq = eventsLengthOf(target.session)（可 null）
        │
        └──context_marks(sessionId?,kind?,tag?)──▶ readMarks → filterMarks（kind 精确 / tag ∈ tags）

  建议文案指向的下一步（不由本插件执行）：
    medium → prune_candidates 看候选     high → prune_candidates→prune_apply 再 session_compact
    toolsDominant → 优先剪过时工具输出（tail 优先，零缓存破坏）
```

不变量（invariants）：
1. **I1 只读消费 contextMeter**：本插件不修改报告、不改会话、不算 token——`report` 抛错时返回 `level:'unknown'` + 建议写明原因（`index.ts:110-113`）。
2. **I2 结构标签白名单**：非法 `kind` → `{ok:false, mark:{id:null, error:'kind 必须 ∈ …'}}`，**不写盘**（`index.ts:137`）。
3. **I3 文件名净化**：侧车文件名由 `marksFileName` 生成，`[^\w.-]` → `_`（不同 sessionId 不会写到同一文件）。
4. **I4 侧车容错解析**：坏 JSON / 非数组 → `[]`（不抛、不把非数组带进 push/filter）。
5. **I5 阈值比较符号固定为 `>=`**：`usageRate >= highThreshold → high`；容量缺失（`contextWindow` 0/undefined）→ `usageRate=NaN` → **保守判 `low`**（`health.ts:45-51`）。
6. **I6 占比归一防零除**：`sum = bt+tt+mt || 1`（全零时占比 0%，不产生 NaN）。
7. **I7 观测不反噬**：`eventsLengthOf` 对缺 `events`/形状异常/访问抛错 → `null`（不抛，`health.ts:99`）。

## 4 · 契约

### 4.1 数据结构 / 文件 / 服务

| 名称 | 路径 / 形状 | 语义 |
|------|------------|------|
| 侧车标记 | `<DSH_HOME>/context-marks/<sanitized sessionId>.json` → `ContextMark[]` | 全量读改写（`readMarks`/`writeMarks`，`index.ts:60-68`）；写入前 `mkdir -p`；读失败 → `[]` |
| ContextReport（**消费**） | `{sessionId, pressureTokens?, projectedTokens?, totalTokens, surfaceTokens, surfaceMessages, contextWindow?, usageTotal, breakdown?{systemTokens,toolsTokens,messageTokens}}` | 宽松结构声明（跨包不 import，版本解耦），由 `dsh-agent-context` 提供 |
| 服务依赖 | `ctx.contextMeter`（**必需**，见 inject）、`ctx.agents.list()/currentInitiator()` | 激活门 |

### 4.2 裁决（纯函数优先）

`buildHealth(report, {mediumThreshold, highThreshold})`（`health.ts:42`）：

| 输入状态 | level | suggestions（摘要） | 语义依据 |
|---------|-------|-------------------|---------|
| `contextWindow` 缺失/0（`usageRate=NaN`） | `low`（保守） | 「上下文健康，无需处理」 | I5 |
| `usageRate < 0.5` | `low` | 同上 | 默认阈值 |
| `0.5 ≤ usageRate < 0.75` | `medium` | 「主动审视：prune_candidates 看可剪候选…」 | 配置 |
| `usageRate ≥ 0.75` | `high` | 「高压力——先剪噪音（prune_candidates→prune_apply），再 session_compact 压缩，别让 checkpoint 带垃圾」 | 配置 |
| 附：`toolsDominant` | 追加建议 | 「tools 占比 N%（dominant）：优先剪过时的工具输出（tail 优先，零缓存破坏）」 | `health.ts:63` |
| 附：`systemTokens/sum > 0.5` | 追加建议 | 「system 占比 N%：检查记忆注入是否必要，精简注入」 | `health.ts:78` |

`isMarkKind(k)`（`marks.ts:37`）：命中白名单 → 返回规范化值；否则 `undefined`（**非字符串同样 undefined，不抛**）。
`filterMarks(marks, {kind?, tag?})`（`marks.ts:69`）：`kind` 精确匹配；`tag` 属于该标记 `tags`；同一标记须同时满足两个条件；空条件 = 不过滤（保持时间序）。

### 4.3 调用点清单 `[MUST]`

| 调用方 | 调用点（文件:符号 / 行号） | 时机 |
|-------|--------------------------|------|
| web profile 组合 | `.dsh/profiles/web/cordis.patch.yml:213-215`（行 id `agent-agent-context-steward`） | web 启动 |
| inject 声明 | `src/index.ts:21` `inject = ['contextMeter','agents','tools']` | **激活门**：`contextMeter` 由 `dsh-agent-context` 提供，缺失则本插件不激活 |
| 服务获取 | `src/index.ts:46-48` 宽松读取 `ctx.contextMeter` / `ctx.agents` | apply |
| 目标会话解析 | `src/index.ts:71 resolveSession(sessionId?)`：`id > currentInitiator() > list()[0]` | 每个工具调用 |
| `context_health` | `src/index.ts:85 ctx.tools.register(defineTool(...))`；`meter.report` `:108` | 工具面 |
| `context_mark` | `src/index.ts:118`；白名单校验 `:136`；侧车写 `:149-151` | 工具面 |
| `context_marks` | `src/index.ts:157`；过滤 `:178` | 工具面 |
| 落盘产物 | `<DSH_HOME>/context-marks/<sessionId>.json` | — |
| 消费方 | 我（剪枝决策）；`dsh-agent-context` 的 `prune_*` 工具（下游动作）；`dsh-agent-context` 的 `contextMeter`（被读，非本插件） | — |
| 测试 | `tests/health.test.mjs`（等级/占比/建议判据）、`tests/marks.test.mjs`（白名单/净化/容错/过滤） | `pnpm test` |

## 5 · 边界与信任

- **能力边界 ≠ 沙箱**：`context_mark` 写入的 `tags`/`note` 是**任意字符串**（未做长度/内容限制），会被原样存进侧车并在 `context_marks` 输出——**这些文本只供我阅读**，不参与任何自动判决（无注入风险面：不进 prompt、不执行）。
- **不越界清单**：不剪枝、不压缩、不改会话、不算 token、不写会话事件；`context_marks` 传入任意 `sessionId` 只读该字符串对应的侧车文件（**未做「必须是活跃会话」的校验**——见 U3）。
- **失败面**：
  - `contextMeter.report` 抛错 → `{ok:true, health:{level:'unknown', suggestions:['contextMeter 不可用: …']}}`（**降级作答 + 说明原因**，不抛、不炸工具面）。
  - 无活跃会话 → `{ok:true, health:{sessionId:null, level:'unknown', suggestions:['无活跃会话']}}`（不抛）。
  - 侧车读失败/坏 JSON → `[]`（**放行**）：标记看起来「消失了」，实际是解析失败——见 U2。
  - 侧车写失败（目录不可写/磁盘满） → `writeFile` 抛错冒泡到工具层（**响亮失败**）。
  - `session.events` 缺失 → `mark.seq = null`（**显式 null，不抛**）。

## 6 · 与既有机制的关系

| 机制 | 关系与顺序约束 |
|------|--------------|
| 技能 `context-stewardship` | 本插件是该技能的**工具面**（「主动审视 → 编辑 → 前置清理」中的「审视」）；技能讲怎么做，本插件提供可见性 |
| AGENTS.md §5.20 / §5.22 | 侧车（方案 B）是「机制必须自证、观测不反噬主流程」的实例：标记独立落盘、读失败不抛 |
| `dsh-agent-context` | 上游服务（`contextMeter`）+ 下游动作（`prune_candidates`/`prune_apply`）；本插件**只读**它 |
| `dsh-agent-compact` | `high` 建议的直接指向（先剪后压）；本插件不触发压缩 |
| 记忆注入 | `system 占比 > 50%` 的建议指向记忆注入（`dsh-agent-memory`）——本插件只提示，不改注入 |
| 会话事件流 | **不写自定义事件**（侧车方案 B，规避 `ignorable`/`seq` 硬约束）——与 `dsh-session-eject` 之类的物理层工具互不干扰 |

## 7 · 可证伪验收清单

| # | 可证伪命题 | 证据（命令/文件/日志行） | 状态 |
|---|-----------|------------------------|------|
| A1 | 侧车目录真的在用 | `Get-ChildItem .dsh/context-marks` → 至少 1 个 `<sessionId>.json`（实测：`session-207459bf-….json` 303B，mtime 2026-08-29 23:59） | ✓ 已实测 |
| A2 | 三种工具均已注册 | `plugin_inspect dsh-agent-context-steward` / 调 `context_health` 返回 `ok:true` | 待验收 |
| A3 | 等级判据与占比口径 | `node --test tests/health.test.mjs` | 待验收（未在本轮执行） |
| A4 | 白名单/净化/容错/过滤 | `node --test tests/marks.test.mjs` | 待验收（未在本轮执行） |
| A5 | 非法 kind 被拒且不写盘 | 调 `context_mark(kind:'bogus')` → `ok:false`；侧车文件 mtime **不变** | 待验收 |
| A6 | 容量缺失时保守判 low | 构造 `contextWindow` 缺失的 report → `level='low'`、`usageRate=null` | 待验收 |
| A7 | contextMeter 不可用时降级 | 停用 `dsh-agent-context` → `context_health` 仍返回 `ok:true` + `level:'unknown'` + 原因 | 待验收 |
| A8 | 运行中的 web 加载的是当前构建 | `lib/index.js` mtime **2026-09-14 10:23:57 晚于** web 启动 10:05:47 → **当前重构产物未生效**（见 §8 生效判据） | ⚠ 已实测（结论：**未生效**，待重启） |

## 8 · 与实现的关系

- **主实现**：`src/index.ts`（接线 + 侧车 IO）。**纯逻辑层**（2026-09-14 可维护性补课抽出，`dsh-plugin-testability` 模式）：`src/health.ts`、`src/marks.ts`。
- **同语义副本（I1）**：无。标记数据只有一处（侧车文件），本文件是其唯一语义主副本。
- **未实现 / 未验证部分（显式标注）**：
  1. **`mark.seq` 在当前 harness 上大概率恒为 `null`**：`eventsLengthOf` 读 `session.events`，而 alpha.4 起 `Session.events` 已移除（同款适配见 `dsh-agent-reflection` 的注释）——`seq` 字段的「当时的日志位置」语义**已退化**；未验证是否仍有旧会话对象带 `events`。
  2. 侧车**无写入上限**：`context_mark` 无限追加，同一会话可无限增长（当前仅 1 个文件 303B）。
  3. `context_marks` 传任意 `sessionId` 即读该文件（无活跃性校验）。
  4. 「建议文案」→「实际剪枝」之间**没有闭环度量**（不知道建议是否被采纳、采纳后是否改善）。
- **生效判据**（改了代码后怎么证明真的生效）：
  1. **产物 vs 进程**：`lib/index.js` mtime 必须早于 web 进程启动时间。**当前实测（2026-09-14）：lib mtime 10:23:57 > web 进程启动 10:05:47 → 2026-09-14 的 testability 重构（`health.ts`/`marks.ts` 抽取 + 两个测试文件）已构建但**未生效**；需重启 web（归队长/主人执行）。**
  2. **落盘物证**：调一次 `context_mark` 后 `<DSH_HOME>/context-marks/<sessionId>.json` 的 mtime 前进、条目数 +1。
  3. **工具可答**：`context_health` 返回 `level` 与 `usageRate`（非 `unknown`）——`health.ts` 的新判据若未生效，等级计算会走旧闭包实现（两者当前逐字等价，故**不能靠行为差异判断**，只能靠 mtime 判据）。
- **回退**：
  - 组合面：`plugin_stop dsh-agent-context-steward`（patch `disabled:true` + 预检 + 哨兵重启）——三个工具消失，侧车文件保留（数据不丢）。
  - 代码面：`git revert <commit>`（head `c3de023`）+ `pnpm build` + 重启 web（**注意**：本次 testability 重构是「逐字等价搬移」，回退代码不改变行为，只回退可测性）。
  - 数据面：删除某个 `<sessionId>.json` = 丢弃该会话的标记（**不可逆**，但标记只是剪枝参考，不影响会话本身）；误删风险低。

## 9 · 实践修订记录

**2026-09-14 补课：本插件此前无语义文档（可维护性工程）**

- 语义**被确认**：
  - 侧车方案（方案 B）真的在用：`<DSH_HOME>/context-marks/` 目录存在且含真实标记文件。
  - 「steward 看 / context 剪」的职责分离在工具面成立（本插件三个工具**没有任何**剪枝动作）。
- 语义**被补充**（本文首次写清的部分）：
  - **`inject` 含 `contextMeter` = 激活门**：`dsh-agent-context` 不在组合时，本插件三个工具会**整体消失**（且无显式报错）。
  - **`mark.seq` 的语义已退化**：`Session.events` 在 alpha.4 移除 → `eventsLengthOf` 返回 `null` → `seq` 不再代表「当时的日志位置」（字段保留、值为 null）。
  - `contextMeter` 不可用时**降级作答**（`level:'unknown'` + 原因）而不是失败——这是「工具面永不因依赖缺失而炸」的设计。
- 语义**被修正**：无（未发现实现与文档冲突）。
- 教训（同时回写技能 `semantic-doc-first`）：**「harness 版本变化导致的语义退化」要在文档里显式标注**——字段还在、代码没改、行为静悄悄变了（`seq` 恒 null）。这类退化只能靠「文档写明每个字段的**来源与失效条件**」来暴露。

## 10 · 未决问题

- **U1 `seq` 字段去留**：既然 `Session.events` 已移除，`seq` 是否该改为从会话日志按 `session-<id>` 读真实事件数？或直接删字段（改契约）？
- **U2 侧车读失败静默返回 `[]`**：与「坏数据放行 + 落 issue」纪律不符（标记看起来凭空消失）。倾向：读失败记 warn + 落盘 issue 计数。
- **U3 `context_marks` 无活跃性校验**：传任意 `sessionId` 可读任意侧车文件。倾向：限定为「当前活跃会话 ∪ 本会话历史」，或至少在无该文件时返回明确「无标记记录」而非空数组（两者当前不可区分）。
- **U4 侧车无容量上限**：是否加「同会话最多 N 条」+ `extracted`/`noise` 类标记的回收策略？
- **U5 建议闭环缺失**：`suggestions` 发出后没有采纳/效果度量——是否与 `dsh-agent-context` 的剪枝统计（`prune_stats`）联动，让「建议 → 动作 → 上下文下降」可验证？
