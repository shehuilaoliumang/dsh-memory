# DSH Memory — 个人长期记忆知识库

一个跑在 Obsidian Vault 里的纯 Markdown 知识库，为 AI 助手（DeepSeek Harness，简称 DSH）提供跨会话长期记忆。它把「对话」沉淀成可检索、可审计、可继承的知识资产，并用代码强制约束 AI 能记住什么、能自动带出什么。

> **这是面向公开的脱敏快照**：不包含 `10_Raw/` 下的对话原文。本地完整库另有 8 篇会话原文与完整 git 历史。`_meta/catalog.jsonl` 已在快照内重建，不含原始会话行。

## 它解决什么问题

| 问题 | 通用 AI 的做法 | 这里的机制 |
|---|---|---|
| 失忆 | 新会话从零开始 | 每轮注入 `core.md` + 最多 5 条已确认记忆 + 项目简报 |
| 记太多 | 把整段对话塞回上下文 | 抽成「一条一文件」的原子记忆，按 scope 隔离 |
| 记错污染 | 模型自行判断，判错就带着错跑 | 裁判写入默认 `inbox`，人确认后才可能注入 |
| 不可回滚 | 记忆是黑盒 | 原文只增、索引可重建、git 权威、归档不删文件 |

## 架构

```
Obsidian Vault/memory
├─ 10_Raw       原文：会话、剪藏（只增不改；公开快照中省略）
├─ 20_Digest    摘要：atoms/（原子记忆）· topics/（主题页）· work/（工作页）
├─ 30_Canon     结论：decisions/（决策）· core.md（核心记忆）
├─ 90_Archive   出口（默认不用，归档在索引层）
└─ _meta        schema · scripts(kb.mjs) · plugin(kb-panel) · templates · 索引
```

**写入管线（五步）**：轮末自动落原文 → 静默窗口门控抽取 → 语义裁判（deepseek-flash）→ 校验落盘 → 每日整理。前两步由插件触发器驱动，规则全部在 `_meta/scripts/kb.mjs`。

**注入规则（代码强制）**：

```
注入 = core.md
     + active 且 scope ∈ {global, 本会话项目} 且 type ∉ {topic, work, session} 的摘要（最多 5 条）
     + 工作页的一条「项目简报」（≤3 项/节、总长 ≤420 字，不占 5 条预算）
```

**关键不变量**：不搬家、不删除（唯一例外需票据 + 人工密钥）、索引是派生物、页面不是记忆、一个 scope 一个 active 工作页、生命周期变更写日志。

## 目录里有什么

- `30_Canon/decisions/`：c-0001 ~ c-0008，记录分层、git、ASCII id、flash 裁判、规则层、记忆隔离、写入/注入分离、整体架构总览。
- `30_Canon/core.md`：每轮常驻的称谓、硬偏好、禁区。
- `20_Digest/atoms/`：用户偏好、决策、原则等原子记忆。
- `20_Digest/topics/`：主题页（汇总 + 争点 + 待办）。
- `20_Digest/work/`：工作页（项目状态：阶段 / 在办 / 未决 / 下一步）。
- `_meta/scripts/kb.mjs`：零依赖 Node 规则层（校验、索引重建、写入、整理、工作页、删除闸门）。
- `_meta/plugin/kb-panel/`：DSH 插件（记忆 chip、知识库页、注入与入库触发器）。
- `_meta/schema.md`：完整规范。

## 测试

```powershell
# 规则层冒烟（在临时副本里跑，不碰真实库；文件是 UTF-8 BOM）
powershell -NoProfile -ExecutionPolicy Bypass -File _meta/scripts/smoke.ps1

# 插件单测
node _meta/plugin/kb-panel/test/ingest.test.mjs
node _meta/plugin/kb-panel/test/judge.test.mjs
node _meta/plugin/kb-panel/test/transcript-chunks.test.mjs
node _meta/plugin/kb-panel/test/work-brief.test.mjs
```

当前：冒烟 55 条、插件单测 75 条全过。

## 隐私说明

公开快照只含摘要、结论、工作页、规则与插件代码，不含对话原文、运行时状态、召回遥测。`source` 指向原文的链接已在快照中移除，因此少数笔记的溯源信息不完整——完整库在本地。
