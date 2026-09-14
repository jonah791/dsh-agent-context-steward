<!--
  DSH 插件生态公约声明（plugin-ecosystem-convention · 组合优先/声明清晰/兼容优先）
  purpose: 上下文管家（审视视角，借鉴 ThoughtDAG「用户是你」）：context_health 给当前会话做上下文体检（压力/容量使用率/构成/健康等级 + 主动管理建议）；context_mark / context_marks 以侧车（方案 B）给上下文卷轴打「结构标签 + 语义标签」，供剪枝决策参考
  inject: 'contextMeter','agents','tools'
  tools: context_health,context_mark,context_marks
  runtime: host-only
  envDeps: DSH_HOME（侧车目录根；缺省回落 process.cwd()）——无网络、无外部服务、无凭据
  boundary: 只读消费 contextMeter（不剪枝/不压缩/不算 token/不写会话事件）；标记只落侧车文件，不进 prompt、不参与任何自动判决
  compat: cordis ^4.0.1 / schemastery ^3.18.1-rc.1 / dsh-tools ^0.1.0-rc.6
-->
# dsh-agent-context-steward

<p align="center">
  <a href="https://github.com/jonah791/dsh-agent-context-steward"><img src="https://img.shields.io/badge/version-0.1.1-blue" alt="version"></a>
  <img src="https://img.shields.io/badge/License-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/TypeScript-3178C6" alt="TypeScript">
  <img src="https://img.shields.io/badge/tests-18%20passed-brightgreen" alt="tests">
</p>

**一句话**：给智能体一副「看自己上下文」的眼睛——`context_health` 把当前会话的上下文压力/容量使用率/构成翻译成健康等级与动作建议，`context_mark` / `context_marks` 用旁路文件给上下文卷轴打「结构 + 语义」标记。

**为什么值得用**：上下文治理若只靠「撞到阈值才被提醒」，我永远是**被治理的对象**；本插件把「审视」变成可查询的动作——`usageRate`、`system/tools/message` 三元占比、`level` 是**当下的数字**而不是感觉，建议直接指向下一步工具（`prune_candidates` → `prune_apply` → `session_compact`）。叠加标记后，「哪一段是结论、哪一段是噪音」在剪枝前已是**可枚举的清单**，不必回头重读整段历史。

## 能力

| 工具 | 用途 |
|------|------|
| `context_health` | 上下文体检（用户是你——审视我的上下文画布）：当前会话的上下文压力/容量使用率/构成（system/tools/message 占比）/健康等级 + 主动管理建议（审视→剪枝→压缩）。主动管理纪律见技能 context-stewardship |
| `context_mark` | 给当前上下文打标记（卷轴标记：结构+语义双维）。`kind` ∈ `explore`/`conclusion`/`noise`/`key`/`extracted`/`keep`；`tags` = 语义标签（主题）；`note` = 说明。侧车存储（方案 B） |
| `context_marks` | 列出上下文标记（卷轴标记，方案 B 侧车）：可按 `sessionId`/`kind`/`tag` 过滤。敲定后看哪些段标了 `noise`/`extracted`（可剪）、哪些是 `conclusion`/`key`（保留） |

（上表描述与 `src/index.ts` 的 `defineTool({ description })` 同源。）

**建议工作流**：头脑风暴中随手 `context_mark`（结论 `conclusion`+`key`，废弃想法 `noise`）→ 敲定后用 `context_marks` 拿清单 → 剪枝优先剪 `noise`/`extracted` → 压力仍高再 `session_compact`。

**响应形状**（`output.schema`）：`context_health` → `{ok, health}`；`context_mark` → `{ok, mark}`（非法 `kind` 时 `ok:false, mark.error`）；`context_marks` → `{ok, marks, count}`。三个工具**永不因依赖缺失而抛**：无活跃会话或 `contextMeter` 抛错时返回 `ok:true` + `level:'unknown'` + 原因。

## 快速开始

**1) 装依赖**（自研插件家园 `self-plugins/`，在目标 profile 的 `package.json` 加 link 依赖）：

```jsonc
"dsh-agent-context-steward": "link:<工作区>/self-plugins/dsh-agent-context-steward"
```

**2) 挂组合**（profile 的 `cordis.patch.yml`）：

```yaml
- insert:
    - id: agent-agent-context-steward
      name: dsh-agent-context-steward
      # 无 config：阈值用默认 0.5 / 0.75
```

**3) 30 秒验证**：调 `context_health` → 期望 `ok: true`，`health.level` ∈ `low`/`medium`/`high` 且 `health.usageRate` 非 `null`（`unknown` 表示依赖未就绪，见下）。再调 `context_mark`（`kind: "key"`）→ 返回 `ok: true` 且 `mark.id` 有值，`${DSH_HOME}/context-marks/<净化 sessionId>.json` 的 mtime 前进、条数 +1。

> **前置条件（激活门）**：`inject` 含 `contextMeter`——该服务由 `dsh-agent-context` 提供。它不在生效组合里时，本插件**整体不激活**，三个工具会一起消失（且不报错）。装本插件前先确认 `dsh-agent-context` 已挂载。

## 配置

`Config`（`src/index.ts` 的 `export const Config`）只有两个阈值，均为「使用率 0–1」：

| 项 | 默认 | 说明 |
|----|------|------|
| `mediumThreshold` | `0.5` | 中等压力阈值：`usageRate >= 0.5` → `level: 'medium'`，建议「主动审视（prune_candidates）」 |
| `highThreshold` | `0.75` | 高压力阈值：`usageRate >= 0.75` → `level: 'high'`，建议「先剪噪音再 session_compact」 |

阈值经 `buildHealth(report, {mediumThreshold, highThreshold})` **显式注入**（`src/health.ts`），改动即刻改变等级与建议文案——这是可离线单测的判据（`tests/health.test.mjs` 的「阈值可注入」用例）。当前线上组合**未写 config**，即用默认值。

## 落盘与自证（出问题时先看这里）

**唯一持久产物**：`${DSH_HOME}/context-marks/<净化后的 sessionId>.json`——`ContextMark[]` 的 **JSON 数组**（全量读改写；写入前 `mkdir -p`）。文件名净化规则 `sessionId.replace(/[^\w.-]/g,'_')`（`src/marks.ts`），不同会话不会写到同一文件。

| 字段 | 来源 / 含义 |
|------|------------|
| `id` | `randomUUID().slice(0,8)`，工具返回同一个 id |
| `kind` | 结构标签，白名单六值（非法值**拒收且不写盘**） |
| `tags` | 语义标签数组，只过滤出字符串元素 |
| `note` | 自由说明（可选） |
| `seq` | `eventsLengthOf(target.session)` = 打标记时的**事件条数快照**（可 `null`）——见下方缺口说明 |
| `sessionId` | 目标会话 id |
| `createdAt` | ISO 时间戳 |

真实样本（`2026-08-29`，303 B，字段形状逐字来自线上文件）：

```json
[{ "id": "d5bb5815", "kind": "key", "tags": ["验证", "上下文标记"],
   "note": "标记功能验证（方案 B 侧车落地）", "seq": 1343348,
   "sessionId": "session-207459bf-…", "createdAt": "2026-08-29T15:59:09.339Z" }]
```

**一条命令尽量答五问**：

```bash
f=$(ls -t "${DSH_HOME:-$HOME/.dsh}"/context-marks/*.json | head -1); stat -c '%y %n' "$f"; tail -c 600 "$f"
# ① 构建      → 文件里没有 build 字段（已知缺口）；改用 stat: lib/index.js 的 mtime 对照 web 进程启动时间
# ② 谁发起    → 每个元素自带 sessionId + createdAt = 「哪个会话在何时打的标」
# ③ 断在哪段  → 无阶段枚举（缺口）：条目没增加 ⇒ 工具没被调、或 kind 被白名单拒收、或 writeFile 抛错（后者会冒泡到工具层）
# ④ 结果质量  → kind 是否属六值白名单、tags/note 是否非空、条目数是否按预期 +1
# ⑤ 耗时预算  → 无 waitedMs 字段（缺口）；相邻条目 createdAt 之差 = 两次标记的间隔
```

**已知自证缺口（诚实声明）**：本插件**没有** `<DSH_HOME>/<机制>-trace.jsonl` 侧车轨迹层——既不落 `atMs/phase/build/waitedMs`，也不落「读失败」事件（侧车坏 JSON → `parseMarks` 返回 `[]`，标记看起来「凭空消失」）。因此五问只能答全 ②④，①③⑤ 依赖外部 mtime 对照与文件存在性。这与 AGENTS §5.22「机制必须自证」尚有差距，缺口见 [`docs/semantic.md`](docs/semantic.md) §10（U2）与 §8。

**行为级验证（无需读盘）**：`context_health` 返回真实数值（非 `unknown`）= `contextMeter` 通路活着；`context_mark` 返回 `ok:true` = 白名单与侧车写入通路活着。

## 生效判据与回退

**生效判据**（三选一，按可靠性排序）：

1. **进程级（最可靠）**：`lib/index.js` 的 mtime **早于** web 进程启动时间（`Get-Process node | Select StartTime`），且 `src/index.ts` 不新于 `lib/index.js`（源码改了没构建 = 跑的还是旧产物）。**本轮实测**：`lib/index.js` = `2026-09-14 10:32:38`，node 主进程 PID 14040 启动于 `2026-09-14 11:54:48` → **当前构建已在线上运行**。
2. **落盘物证**：调一次 `context_mark` 后侧车文件 mtime 前进、条目数 +1。
3. **工具面**：三个工具均已出现，且 `context_health` 返回 `level` 非 `unknown`。

> ⚠ **「重新构建 ≠ 生效」**：产物 mtime 新只证明「构建过」，不证明「进程在跑它」。判据是**进程启动时间 vs 产物 mtime**（AGENTS §5.11 §6）。
> 另注两点：① `npm test` 脚本**不含构建**，改完源码必须 `npm run build`；② 2026-09-14 的 testability 重构是「逐字等价搬移」——`health.ts` 与旧闭包实现**行为完全一致**，所以**不能靠行为差异判断重构是否生效**，只能靠 mtime 判据。日志行（`context-steward 就绪：…`）走宿主 logger、**不落盘**，不得作为唯一证据。

**回退**（三档）：

| 档 | 动作 | 后果 |
|----|------|------|
| 源码级 | `git revert <commit>` → `npm run build` → 预检 → 重启 | 回到上一版判据（本次重构是等价搬移，回退只回退可测性） |
| 组合级 | profile patch 该行加 `disabled: true`，或 `plugin_stop dsh-agent-context-steward` | 三个工具消失，`contextMeter` 不再被本插件读取；**侧车文件保留，数据不丢** |
| 运行期 | 无需动作（无内存状态、无定时器、无后台任务） | 侧车是纯数据文件；删某个 `<sessionId>.json` = 丢弃该会话的标记（不可逆，但不影响会话本身） |

## 测试

```bash
npm run build && npm test     # npm test = node --test "tests/*.test.mjs"
```

**18 例离线测试，全部 pass**（实测 `# tests 18 / # pass 18 / # fail 0`，`duration_ms ≈ 163`）。**跑的是构建产物**——两个测试文件均从 `../lib/*.js` 导入，所以改源码后**必须先构建**（`npm test` 脚本本身不含 `tsc`）。

| 文件 | 例数 | 覆盖 |
|------|------|------|
| `tests/health.test.mjs` | 10 | 等级边界（使用率 0.5 的真实常数）、`projectedTokens → totalTokens` 回落、占比四舍五入与 `surface`/`usageTotal` 透传、`toolsDominant` 三条件 AND、`system 占比 > 0.5` 追加建议、**阈值可注入**（同一报告两种分级）、**缺 `contextWindow` → `usageRate=null` 且保守判 `low`**、缺 `breakdown` 防除零、脏数据（负容量/NaN 压力/空对象）不抛、`eventsLengthOf` 对缺 `events`/形状异常/访问抛错一律回 `null` 不抛 |
| `tests/marks.test.mjs` | 8 | 白名单恰为六值且顺序固定、`isMarkKind` 对非法/非字符串一律拒收、文件名净化（`[^\w.-]` → `_`）、合法数组原样返回（时间序不变）、**空输入/坏 JSON/非数组 JSON → `[]` 且不抛**、`filterMarks` 无过滤返回全部 / `kind` 精确匹配 / `tag ∈ tags` / 两者 AND、无命中返回空数组（调用方 `.length` 安全） |

**无需网络、无需真实外部依赖**（纯函数 + `node:test`，不碰 `ctx`、不读侧车文件）。

**未覆盖**（显式标注）：ctx 级集成——假 `ctx` 跑 `apply()` 断言三个工具注册；`contextMeter.report` 抛错时的降级分支；侧车写失败（目录不可写）冒泡路径；`resolveSession` 的三级回落（`id > currentInitiator > list[0]`）。见 [`docs/semantic.md`](docs/semantic.md) §10。

## 设计要点

- **`inject` 是激活门，不是提示**：`inject = ['contextMeter','agents','tools']`——`dsh-agent-context` 不在组合时本插件**整体不激活**（三个工具一起消失、无显式报错）。这是「工具面永不因依赖缺失而炸」的代价：失败形态是**静默缺席**而非报错，装完必须用上面的「30 秒验证」确认存在。
- **侧车（方案 B）而非会话事件**：标记**不写进会话事件流**——自定义事件受 harness 的 `ignorable`/`seq` 硬约束，写进去会污染会话日志的物理层。代价是标记与会话解耦（压缩后 `seq` 失效，但 `kind`/`tags`/`note` 的语义仍有效）。
- **判据走纯函数，接线留在 `apply()`**：`health.ts`（体检视图）与 `marks.ts`（白名单/净化/容错/过滤）不引 `node:fs`、不碰 `ctx`。原因很具体：这三条判据**都不会报错，只会静默给出错误的剪枝建议**——阈值比较符号写反 = 高压力报成健康；净化正则写错 = 标记落到别的会话文件上。
- **降级作答，不炸工具面**：`contextMeter.report` 抛错 → `{ok:true, level:'unknown', suggestions:['contextMeter 不可用: …']}`；无活跃会话 → `level:'unknown'` + 「无活跃会话」。**相反地，侧车写失败是响亮失败**（`writeFile` 抛错冒泡到工具层）——写盘没成功不许装成成功。
- **观测不反噬**：`eventsLengthOf` 对缺 `events`/形状异常/访问抛错一律 `null`（不抛），`parseMarks` 对坏 JSON/非数组一律 `[]`（不抛）——取证路径绝不反噬主流程。
- **`seq` 语义已退化（诚实声明）**：`seq` 读的是 `session.events.length`，而 alpha.4 起 `Session.events` 已移除——该字段**大概率恒为 `null`**（线上旧样本仍有值 `1343348`，来自 2026-08-29 的会话对象）。字段保留、语义不再代表「当时的日志位置」，去留见 §10 U1。
- **反定位**：不剪枝（归 `dsh-agent-context` 的 `prune_*`）、不压缩（归 `dsh-agent-compact` / `session_compact`）、不算 token（归 `contextMeter`）、不写会话事件——**steward 负责「看」，context 负责「剪」**。
- **信任边界**：`tags`/`note` 是任意字符串（未做长度/内容限制），原样落盘并在 `context_marks` 输出——这些文本**只供人/模型阅读**，不进 prompt、不执行、不参与自动判决。`context_marks` 传任意 `sessionId` 即读该字符串对应的侧车文件（**未做活跃性校验**，见 §10 U3）。

## 相关文档

| 文档 | 内容 |
|------|------|
| [`docs/semantic.md`](docs/semantic.md) | **权威契约**：定位与反定位、术语表、概念模型与 7 条不变量、契约（含调用点清单）、边界与信任、可证伪验收清单（8 条）、实践修订记录、未决问题（5 条） |
| [alice-digital-life](https://github.com/jonah791/alice-digital-life) | 本插件所属生态的中心索引（全部自研插件） |
| 技能 `context-stewardship` | 本插件的**纪律面**：主动审视 → 编辑 → 前置清理的上下文管理方法论 |
| 技能 `plugin-maintainability` / `dsh-plugin-testability` / `semantic-doc-first` | 机制自证与五问判据、决策逻辑抽纯函数做离线单测、语义文档先行的开发方式 |

## License

MIT © jonah791

---

本插件属于我的数字生命爱丽丝（[alice-digital-life](https://github.com/jonah791/alice-digital-life)）的 DSH 自研插件生态——**50 个插件**按生命/认知/感知/行动/通信/治理/呈现七层组织。
