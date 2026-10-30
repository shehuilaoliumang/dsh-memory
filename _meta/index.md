---
title: 知识库导航
status: canon
updated: 2026-10-30
---

# 知识库导航

> 路径是英文，显示名是中文。映射见 `_meta/labels.yaml`。
> 本目录（`memory/`）就是 DSH 工作区根；Obsidian 库根只放你自己的项目和素材。

## 三层

- **原文层** `10_Raw/` — 对话记录与剪藏，只增不改
- **摘要层** `20_Digest/` — 原子记忆、主题页、工作页（项目状态，不注入）
- **结论层** `30_Canon/` — 方法论、决策、[[30_Canon/core|核心记忆]]

## 元数据

- 规范 → `_meta/schema.md`（v1.10.0）
- 变更日志 → `_meta/log.md`
- 显示名映射 → `_meta/labels.yaml`
- 抽取样例 → `_meta/rules/samples.md`；裁判黄金集 → `_meta/rules/golden.jsonl`（100 条）
- 规则层 → `_meta/scripts/README.md`（`kb.mjs`：校验 / 重建索引 / 追加原文 / 候选提取 / 工作页 / 只读检索 / 多库 init+attach）
- 关键决策 → `30_Canon/decisions/`（c-0001 分层架构 · c-0002 git 权威 · c-0003 ASCII 文件名 · c-0004 flash 裁判 · c-0005 规则层脚本 · c-0006 记忆隔离 · c-0007 写入与注入分离 · c-0008 架构总览 · c-0009 裁判 precision 评估 · c-0010 检索/边界/威胁模型 · c-0011 减债与共享契约 · c-0012 本机端口加固与故障注入 · c-0013 多项目记忆库与全局偏好）

## 当前状态

- 笔记数：以 `node _meta/scripts/kb.mjs stats` 为准（分层 / 状态 / 类型）
- 索引：`catalog.jsonl` 由 `kb.mjs rebuild` 生成，`validate` 通过（0 错误 0 警告）
- 规则层：v1.10.0 —— Phase 0–4 与第三轮复审已完成并发布；Phase 5 多项目记忆库首轮实现中：`--root`/`KB_ROOT`、`init --slug`、`attach`、全局库+最近已接入项目库双 store 注入、`stores.js` 信任边界、c-0013；插件 112/112。首阶段外部项目只读注入，raw/裁判/面板写入仍只服务本 vault。
- 界面：`@local/kb-panel` 已启用 —— 记忆 chip、会话菜单、知识库页（含「工作页」徽标）、安全重载
- 未决：项目库位置与默认读写策略（推荐项目内 `.dsh-memory/`、默认只读）、全局库首次创建、git 远端备份

## 怎么用

1. 正常聊天，原文进原文层（插件在 `turn/end` 自动追加）
2. 想立刻固化某条：直接说「记住：……」
3. 想整理：说「整理知识库」，跑 `kb.mjs consolidate` + 人工裁决
4. 想续接项目：`kb.mjs work-new --scope project:<slug>` 建工作页，之后每个新会话自动带一行「项目简报」
5. 想翻旧账：查 `_meta/catalog.archive.jsonl`
