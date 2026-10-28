---
title: 知识库导航
status: canon
updated: 2026-10-29
---

# 知识库导航

> 路径是英文，显示名是中文。映射见 `_meta/labels.yaml`。
> 本目录（`memory/`）就是 DSH 工作区根；Obsidian 库根只放你自己的项目和素材。

## 三层

- **原文层** `10_Raw/` — 对话记录与剪藏，只增不改
- **摘要层** `20_Digest/` — 原子记忆、主题页、工作页（项目状态，不注入）
- **结论层** `30_Canon/` — 方法论、决策、[[30_Canon/core|核心记忆]]

## 元数据

- 规范 → `_meta/schema.md`（v1.4）
- 变更日志 → `_meta/log.md`
- 显示名映射 → `_meta/labels.yaml`
- 抽取样例 → `_meta/rules/samples.md`
- 规则层 → `_meta/scripts/README.md`（`kb.mjs`：校验 / 重建索引 / 追加原文 / 候选提取 / 工作页）
- 关键决策 → `30_Canon/decisions/`（c-0001 分层架构 · c-0002 git 权威 · c-0003 ASCII 文件名 · c-0004 flash 裁判 · c-0005 规则层脚本 · c-0006 记忆隔离 · c-0007 写入与注入分离 · c-0008 架构总览）

## 当前状态

- 笔记数：以 `node _meta/scripts/kb.mjs stats` 为准（分层 / 状态 / 类型）
- 索引：`catalog.jsonl` 由 `kb.mjs rebuild` 生成，`validate` 通过（0 错误 0 警告）
- 规则层：v1.4 已落地 —— 裁判（deepseek-flash 直调）+ 静默/兜底/轮数触发 + 工作页 + 恢复简报
- 界面：`@local/kb-panel` 已启用 —— 记忆 chip、会话菜单、知识库页（含「工作页」徽标）、安全重载
- 未决：晋升确认界面 / 冲突裁决形态 / git 远端备份

## 怎么用

1. 正常聊天，原文进原文层（插件在 `turn/end` 自动追加）
2. 想立刻固化某条：直接说「记住：……」
3. 想整理：说「整理知识库」，跑 `kb.mjs consolidate` + 人工裁决
4. 想续接项目：`kb.mjs work-new --scope project:<slug>` 建工作页，之后每个新会话自动带一行「项目简报」
5. 想翻旧账：查 `_meta/catalog.archive.jsonl`
