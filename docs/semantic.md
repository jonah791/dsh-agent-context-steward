# 语义文档：dsh-agent-context-steward（上下文管家 · 审视视角 + 卷轴标记）

> 版本 v0.1 · 2026-09-14 · 作者：爱丽丝 · 状态：**draft**
> 开发方式：语义文档优先（本份是 2026-09-14 可维护性工程的**补课**文档）
> 实现落点：`self-plugins/dsh-agent-context-steward/src/index.ts`（+ 纯视图 `src/health.ts`、纯逻辑 `src/marks.ts`）

| 项 | 值 |
|----|----|
| 能力名 | dsh-agent-context-steward（上下文体检 `context_health` + 卷轴标记 `context_mark`/`context_marks` + **删除原语 `context_unmark`**） |
| 主副本路径 | `self-plugins/dsh-agent-context-steward/docs/semantic.md`（本文件） |
| 实现落点 | `src/index.ts`（工具接线 + 侧车读写 + 删除留痕）、`src/health.ts`（体检报告 → 健康视图纯函数）、`src/marks.ts`（标记白名单/文件名净化/容错解析/过滤/**删除选择器**纯函数） |
| 版本 | **0.2.0**（`package.json` / `dsh-plugin.json` 同步；上一版 0.1.1 = 增 `context_unmark` 之前） |
| 挂载位置 | `.dsh/profiles/web/cordis.patch.yml` 行 id `agent-agent-context-steward` + name `dsh-agent-context-steward`（2026-10-04 实测在 **:200–201**；行号随 patch 改动漂移，**以行 id 为准**）；**无 config**（阈值用默认 0.5 / 0.75） |
| 状态 | **draft**（`context_unmark` 的**线上验收待重启**：代码已构建、测试 35/35 绿，但运行中的 web 仍加载旧构建 ⇒ 重启前它不在工具面里） |
| 测试 | `tests/health.test.mjs`、`tests/marks.test.mjs`（含删除纯层判据）、`tests/unmark-shell.test.mjs`（**壳层真注册**）—— 合计 35 例，2026-10-04 全绿 |

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
        ├──context_marks(sessionId?,kind?,tag?)──▶ readMarks → filterMarks（kind 精确 / tag ∈ tags）
        │
        └──context_unmark(id|ids|kind, apply?)──▶ removeMarks（纯函数 marks.ts:123）
                                              ├─ 空选择器          → ok:false（防无参全删）
                                              ├─ missing 非空      → ok:false（fail-closed，不写盘）
                                              ├─ removed 为空      → ok:false（不静默成功）
                                              ├─ apply 缺省 false  → ok:true 干跑（不写盘、不留痕）
                                              └─ apply=true        → writeMarks(kept) → appendUnmarkTrace
                                                                     （留痕失败 ⇒ traced:false，删除照常）

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
8. **I8 删除原语三件套（2026-10-04 新立 —— 主人点名「删除能力很弱」）**：`context_unmark` 是标记的**撤销**原语，与 `kg_del_node`/`kg_del_edge`、`plugin_purge` **同形**，三条缺一不可：
   - ① **默认干跑**：`apply` 缺省 `false` —— 只回答「将删哪些 + 删后剩几条」，**不写盘**；
   - ② **fail-closed**：`id`/`ids` 指名的标记**有任一不存在** ⇒ **整体拒绝**（`ok:false` + `missing[]`），**不做部分删除**（宁可不删，也不留「以为删了」的错觉）；
   - ③ **必留痕**：每次 `apply:true` 追加一行到 `<DSH_HOME>/context-marks/unmark-trace.jsonl`（时间 / 会话 / 选择器 / 删掉的 id 与 kind / 条数变化）；留痕失败**不阻塞**删除（吞错返回 `false`，§5.22 观测不反噬）。
   - **选择器语义**：`id` 或 `ids`（精确）与 `kind`（结构标签批量）可单用、可组合（组合 = 同时满足）；**无任何选择器 ⇒ 拒绝**（防「无参全删」）；`tag` **不作**删除选择器（语义标签是主题标签，跨主题误伤面大）。
   - **边界（与 kg 的差异，必须显式）**：标记侧车**无引用完整性风险** —— 2026-10-04 全库 grep 证实**只有本插件读** `<DSH_HOME>/context-marks/`（`dsh-agent-self-rewrite/src/probe.ts`、`dsh-prompt-defense/src/detect.ts` 里的 `context_marks` 是**工具名枚举**，非数据消费）。故 fail-closed 只针对「指名的标记不存在」，不涉及跨实体悬空引用；mark id **不被任何东西引用**，删除不产生悬空边。
   - **replay-safe 不受影响**：标记存**侧车**（方案 B），不在会话事件流内 ⇒ 增删标记都不改变事件流、不影响 `prune_apply` 的 append-only 回放语义。

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
| `context_marks` | `src/index.ts:157`（`name` `:158`）；过滤 `:178` | 工具面 |
| `context_unmark` | `src/index.ts:205`（`name` `:206`）；纯层 `marks.ts:123 removeMarks`；选择器判据 `marks.ts:92 isEmptySelector` | 工具面 |
| 侧车 / 留痕路径 | `src/index.ts:56 marksDir`（`<DSH_HOME>/context-marks`）；`:185 unmarkTracePath`（`unmark-trace.jsonl`） | apply |
| 留痕写入 | `src/index.ts:191 appendUnmarkTrace`（吞错返回 bool，**不反噬删除**） | 每次 `apply:true` 删除 |
| 落盘产物 | `<DSH_HOME>/context-marks/<sessionId>.json`（标记全量）+ `<DSH_HOME>/context-marks/unmark-trace.jsonl`（删除留痕，**追加**） | — |
| 消费方 | 我（剪枝决策）；`dsh-agent-context` 的 `prune_*` 工具（下游动作）；`dsh-agent-context` 的 `contextMeter`（被读，非本插件）。**标记侧车无其他消费者**（2026-10-04 全库 grep 证实） | — |
| 测试 | `tests/health.test.mjs`、`tests/marks.test.mjs`（含删除纯层判据）、`tests/unmark-shell.test.mjs`（**壳层真注册**，含 I8 三件套 + 留痕尸体样本） | `npm test`（35 例，2026-10-04 全绿） |

> 行号为 2026-10-04 快照；改动 `index.ts` 后行号会漂移，**以符号名为准**。

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
| A2 | 三种工具均已注册 | `plugin_inspect dsh-agent-context-steward` / 调 `context_health` 返回 `ok:true` | ✓ 2026-10-05（线上真调：`上下文体检 session-432d493e… [low] 使用率 19%（187825/1000000 tokens）`） |
| A3 | 等级判据与占比口径 | `node --test tests/health.test.mjs` | ✓ 2026-10-05（10 pass / 0 fail） |
| A4 | 白名单/净化/容错/过滤 | `node --test tests/marks.test.mjs` | ✓ 2026-10-05（15 pass / 0 fail） |
| A5 | 非法 kind 被拒且不写盘 | 调 `context_mark(kind:'bogus')` → `ok:false`；侧车文件 mtime **不变** | ✓ **完整通过 2026-10-05**：不写盘（本会话侧车未创建）+ **渲染复验（web 重启后）输出 `✗ kind 必须 ∈ explore/conclusion/noise/key/extracted/keep`**；缺陷（把失败显示成「标记 null [undefined]」）已修并由 A19 守住 |
| A6 | 容量缺失时保守判 low | 构造 `contextWindow` 缺失的 report → `level='low'`、`usageRate=null` | ✓ 2026-10-05（`tests/health.test.mjs:81`「缺 contextWindow（零容量）→ 使用率 null、等级保守取 low，不抛」，绿） |
| A7 | contextMeter 不可用时降级 | 停用 `dsh-agent-context` → `context_health` 仍返回 `ok:true` + `level:'unknown'` + 原因 | ⏸ **有意未验**（2026-10-05）：需停用 `dsh-agent-context` ⇒ **动线上组合**，代价大于收益；代码路径已由 `src/index.ts:110-113` 的 try/catch 显式实现（可读性验收），**不冒充已验** |
| A8 | 运行中的 web 加载的是当前构建 | 比 `lib/index.js` mtime 与 web 进程启动时间 | ✓ 2026-10-05（`lib/index.js` mtime=1791081870 **早于** web 启动 1791114066 达 ~8.9h ⇒ **已生效**；推翻了原文「须重启才生效」的旧判断——那是 10-04 当时的时点结论） |
| A9 | **I8① 默认干跑**：不传 `apply` 不写盘、不留痕 | `node --test tests/unmark-shell.test.mjs`「I8① 默认干跑」：逐字节比对侧车 + 零留痕 | ✓ 已实测 |
| A10 | **I8② fail-closed**：指名 id 有缺失 ⇒ 整体拒绝、**不做部分删除** | 同文件「I8② 尸体样本」：`ids:['m1','nope']` ⇒ `ok:false` + `missing:['nope']` + 文件不变 + 零留痕 | ✓ 已实测 |
| A11 | **I8③ 必留痕**：真实删除追加一行（含 before/after/removedIds） | 同文件「I8③ 正路径」：`traced:true` + 留痕字段逐项断言 | ✓ 已实测 |
| A12 | 无选择器 ⇒ 拒绝（防无参全删） | 同文件：`{}` / `{apply:true}` / `{ids:[]}` 三种**合法 JSON** 的空选择器全拒 | ✓ 已实测 |
| A13 | 按 kind 批量删 + 组合选择器 AND 语义 | 同文件「按 kind 批量删」：noise 全清；`ids+kind` 无交集 ⇒ 无匹配 | ✓ 已实测 |
| A14 | 无匹配 ⇒ `ok:false`（不静默成功，与 `kg_del_edge` 同形） | 同文件「无匹配」 | ✓ 已实测 |
| A15 | 删到空 ⇒ 侧车落成 `[]`、**文件保留**（不删文件本体） | 同文件「删到空」 | ✓ 已实测 |
| A16 | **留痕失败不阻塞删除**（观测不反噬 · §5.22 规则 3） | 同文件「I8③ 尸体样本」：把留痕路径占成**目录** ⇒ `ok:true` + `applied:true` + `traced:false`（失败可见）+ 盘上确已删除 | ✓ 已实测 |
| A17 | 纯层删除判据（空选择器 / 缺失 / 无匹配 / 入参不可变） | `node --test tests/marks.test.mjs` | ✓ 已实测 |
| A18 | 全量回归（四个测试文件） | `node --test "tests/*.test.mjs"` ⇒ **38 pass / 0 fail**（2026-10-05；10-04 为 35 例，2026-10-05 新增 `mark-shell.test.mjs` 3 例） | ✓ 已实测 |
| A19 | **失败必须响亮**：`ok:false` 的 render 必须显示 `error` 原因 | `tests/mark-shell.test.mjs` M1（尸体样本：`kind:'bogus'` ⇒ 渲染含 `kind 必须`、**不含** `标记 null`、侧车未创建）+ M3（两种失败来源都显示原因） | ✓ 2026-10-05（先红后绿；缺陷见 §9） |

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
  - 组合面：`plugin_stop dsh-agent-context-steward`（patch `disabled:true` + 预检 + 哨兵重启）——四个工具消失，侧车文件保留（数据不丢）。
  - 代码面：`git revert <commit>`（head `c3de023`）+ `pnpm build` + 重启 web（**注意**：本次 testability 重构是「逐字等价搬移」，回退代码不改变行为，只回退可测性）。
  - 数据面：删除某个 `<sessionId>.json` = 丢弃该会话的标记（**不可逆**，但标记只是剪枝参考，不影响会话本身）；误删风险低。

## 9 · 实践修订记录

**2026-09-14 补课：本插件此前无语义文档（可维护性工程）**

- 语义**被确认**：
  - 侧车方案（方案 B）真的在用：`<DSH_HOME>/context-marks/` 目录存在且含真实标记文件。
  - 「steward 看 / context 剪」的职责分离在工具面成立（本插件四个工具**没有任何**剪枝动作）。
- 语义**被补充**（本文首次写清的部分）：
  - **`inject` 含 `contextMeter` = 激活门**：`dsh-agent-context` 不在组合时，本插件四个工具会**整体消失**（且无显式报错）。
  - **`mark.seq` 的语义已退化**：`Session.events` 在 alpha.4 移除 → `eventsLengthOf` 返回 `null` → `seq` 不再代表「当时的日志位置」（字段保留、值为 null）。
  - `contextMeter` 不可用时**降级作答**（`level:'unknown'` + 原因）而不是失败——这是「工具面永不因依赖缺失而炸」的设计。
- 语义**被修正**：无（未发现实现与文档冲突）。
- 教训（同时回写技能 `semantic-doc-first`）：**「harness 版本变化导致的语义退化」要在文档里显式标注**——字段还在、代码没改、行为静悄悄变了（`seq` 恒 null）。这类退化只能靠「文档写明每个字段的**来源与失效条件**」来暴露。

**2026-10-04：删除原语 `context_unmark`（主人 2026-10-03 点名「删除能力很弱」）**

- 语义**被补充**：
  - **I8「删除原语三件套」**：默认干跑 / fail-closed / 必留痕 —— 与 `kg_del_node`/`kg_del_edge`、`plugin_purge` **同形**，构成插件家族的通则（不在两处各发明一套）。
  - **fail-closed 的适用面随风险定**：标记**无引用完整性风险**（2026-10-04 全库 grep：`<DSH_HOME>/context-marks/` 只被本插件读；`probe.ts`/`detect.ts` 里出现的 `context_marks` 是**工具名枚举**）⇒ 本插件的 fail-closed 只针对「点名的标记不存在」，**不涉及悬空边**。这是对三件套的**范围限定**：三件套是形态不是教条 —— 它去掉的是「能删」，加上的是「删得可见、删不干净就整单拒绝」。
  - **`tag` 不作删除选择器**：语义标签是主题标签，跨主题误伤面大（写进 I8）。
  - **`undefined` 不是 lossless JSON**：`{id: undefined}` 这类参数在 **harness 参数校验层**就被拒（`ToolArgsError INVALID_ARGS`），根本走不到工具 —— 「空选择器」判据只需覆盖 `{}` / `{ids:[]}` 这类**合法 JSON**。
- 语义**被修正**：
  - §8 的「未生效」结论已过期（2026-09-14 的 mtime 判据 vs 当时的 web 启动时间）—— 2026-10-04 重新构建后该判据**须重新测量**，A8 已改为「待验收」。
  - 本插件工具数 **3 → 4**：README frontmatter `tools:` 自述与正文措辞（共 9 处「三个工具」）同批更新 —— **自述与清单必须同步**（`plugin_audit` 的漂移判据正是这一项）。
- **实践读数（诚实标注）**：侧车自 2026-08-29 起**只有 1 个文件、1 条标记**，一个多月未新增 ⇒ 本工具的**预期使用率极低**。它补的是**能力完整性**（只增不减的结构缺口 + §10 U4），不是当下的高频痛点。这个区分本身有价值：**「删除能力弱」的后果取决于资产是否真在增长** —— kg 图在长（删不掉 = 真痛点），标记侧车基本不长（缺删除 = 理论缺口）。
- 教训：**「只增不减」的根源不只是缺删除工具，还有「创建门槛低而使用场景少」** —— 补删除只解决前者；后者要由「这个设施到底该不该存在」来回答，不由本次改造回答。

**2026-10-05：A2–A8 接线级验收 —— 抓出「失败被渲染成成功」的呈现缺陷**

- **触发**：任务 `t-10a1817f`「删除能力线收尾」。核实发现 `context_unmark` 已实现且 I8 十条验收全绿，**但 A2–A8 七条「待验收」一直空着**——其中 A3/A4 尤其说明问题：**测试文件早就存在，只是「未在本轮执行」（从没人跑过）**。
- **验完**（读数逐条见 §7）：A2 / A3（10 pass）/ A4（15 pass）/ A6 / A8 ✓ 实测；A5 **半通过**（**不写盘 ✓**，但**渲染错**）；A7 **有意不验**（需停用线上 `dsh-agent-context`，代价 > 收益——**不冒充已验**）。
- **语义被修正（真缺陷，先红后绿）**：`context_mark` 的 render **不看 `ok`**——非法 kind 时实现层已正确返回 `{ok:false, mark:{id:null, error:'kind 必须 ∈ …'}}`，却被渲染成「`标记 null [undefined]`」，**错误原因整条丢失**，看起来像打标成功了。修法：`if (v?.ok === false) return ✗ ${error}`。新增 `tests/mark-shell.test.mjs`：M1 尸体样本（并含「**不得**出现 `标记 null`」的防修过头判据）/ M2 正路径仍正常 / M3 两种失败来源都显示原因。
- **可迁移教训（与同日 `dsh-knowledge-graph` 两处缺陷同族）**：**执行层判定正确 ≠ 呈现层传对**。三次实测三种形状：① 渲染方向与数据相反（遍历对、展示错）；② 成功出参多带 `undefined` ⇒ 整包被管线拒（**报错但数据已变**）；③ 失败出参少传 `ok` ⇒ 原因丢失（**失败被显示成成功**）。共同修法都是「**让呈现层忠于执行层的判定**」；共同盲区都是「**单测只看值、不看用户最终读到什么**」。
- 语义**被补充**：A18 例数口径 35 → **38**（四文件）；A8 的旧结论「须重启才生效」经实测**推翻**（`lib/index.js` mtime 早于 web 启动 8.9h ⇒ 已生效）——**结论有时点性，复验时必须重测，不能沿用旧判断**。

## 10 · 未决问题

- **U1 `seq` 字段去留**：既然 `Session.events` 已移除，`seq` 是否该改为从会话日志按 `session-<id>` 读真实事件数？或直接删字段（改契约）？
- **U2 侧车读失败静默返回 `[]`**：与「坏数据放行 + 落 issue」纪律不符（标记看起来凭空消失）。倾向：读失败记 warn + 落盘 issue 计数。
- **U3 `context_marks` 无活跃性校验**：传任意 `sessionId` 可读任意侧车文件。倾向：限定为「当前活跃会话 ∪ 本会话历史」，或至少在无该文件时返回明确「无标记记录」而非空数组（两者当前不可区分）。
- **U4 侧车无容量上限**：✅ **2026-10-04 已解**（`context_unmark` 提供**人工**回收；**不做自动回收** —— 自动清理违反「禁止任何自动决策机制」）。剩余开放项：是否要**硬上限**（同会话最多 N 条）—— 倾向不加（上限会在最需要标记的长上下文会话里先失效）。
- **U5 建议闭环缺失**：`suggestions` 发出后没有采纳/效果度量——是否与 `dsh-agent-context` 的剪枝统计（`prune_stats`）联动，让「建议 → 动作 → 上下文下降」可验证？
