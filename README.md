# dsh-agent-context-steward


<p align="center">
  <a href="https://github.com/jonah791/dsh-agent-context-steward"><img src="https://img.shields.io/badge/version-0.1.1-blue" alt="version"></a>
  <img src="https://img.shields.io/badge/License-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/TypeScript-3178C6" alt="TypeScript">
</p>
> 上下文管家：主动体检 + 管理建议，让智能体成为自己的上下文主编。
> DeepSeek Harness 自研插件 · v0.1.1（借鉴 ThoughtDAG「用户是你」）

## 定位

把「上下文治理」从被动等压缩提醒，变成**主动审视**——给当前会话做体检（压力/构成/健康），给出主动管理建议（审视 → 剪枝 → 压缩），配合标记机制让智能体知道自己上下文的「地形」。

## 功能特性

- **上下文体检**：`context_health` 输出当前会话上下文压力、容量使用率、构成（system/tools/message 占比）、健康等级 + 主动管理建议
- **卷轴标记**：`context_mark` 给上下文打标记（结构标签 explore/conclusion/noise/key/extracted + 语义标签），`context_marks` 列出全部标记——敲定结论标 conclusion+key，否定的标 noise，剪枝优先剪 noise/extracted
- **主动管理**：从「等框架提醒」变为「智能体自己审视 → 编辑 → 前置清理」，把上下文当成自己的画布

## 安装

```bash
git clone https://github.com/jonah791/dsh-agent-context-steward.git self-plugins/dsh-agent-context-steward
cd self-plugins/dsh-agent-context-steward && pnpm install && pnpm build
```

挂载到 web profile。

## 使用（工具面）

| 工具 | 用途 |
|------|------|
| `context_health` | 当前会话上下文体检（压力/构成/健康 + 管理建议） |
| `context_mark` | 给当前上下文打标记（结构+语义） |
| `context_marks` | 列出上下文标记（按 session/kind/tag 过滤） |

**建议工作流**：头脑风暴时用 context_mark 标记结论/噪音 → 敲定后 context_marks 审视 → 剪枝时优先剪 noise/extracted 标记段。

## 配置

无（开箱即用）。

## 技术要点

- 诊断目标可指定 sessionId（缺省=当前活跃会话）
- 标记是「侧车存储」（方案 B）——不侵入会话本身，纯增强
- 与 dsh-agent-context（剪枝）互补：steward 负责「看」，context 负责「剪」

## License

MIT