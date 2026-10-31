---
title: 知识库导航
status: canon
updated: 2026-10-31
---

# 知识库导航

> 路径是英文，显示名是中文。映射见 `_meta/labels.yaml`。
> 本目录（`memory/`）就是 DSH 工作区根；Obsidian 库根只放你自己的项目和素材。

## 三层

- **原文层** `10_Raw/` — 对话记录与剪藏，只增不改
- **摘要层** `20_Digest/` — 原子记忆、主题页、工作页（项目状态，不注入）
- **结论层** `30_Canon/` — 方法论、决策、[[30_Canon/core|核心记忆]]

## 元数据

- 规范 → `_meta/schema.md`（v1.12.0）
- 变更日志 → `_meta/log.md`
- 显示名映射 → `_meta/labels.yaml`
- 抽取样例 → `_meta/rules/samples.md`；裁判黄金集 → `_meta/rules/golden.jsonl`（100 条）
- 规则层 → `_meta/scripts/README.md`（`kb.mjs`：校验 / 重建索引 / 追加原文 / 候选提取 / 工作页 / 只读检索 / 多库 init+attach）
- 关键决策 → `30_Canon/decisions/`（c-0001 分层架构 · c-0002 git 权威 · c-0003 ASCII 文件名 · c-0004 flash 裁判 · c-0005 规则层脚本 · c-0006 记忆隔离 · c-0007 写入与注入分离 · c-0008 架构总览 · c-0009 裁判 precision 评估 · c-0010 检索/边界/威胁模型 · c-0011 减债与共享契约 · c-0012 本机端口加固与故障注入 · c-0013 多项目记忆库与全局偏好 · c-0014 记忆库边界与备份策略 · c-0015 审计清偿与当前真相裁决）

## 当前状态

- 笔记数：以 `node _meta/scripts/kb.mjs stats` 为准（分层 / 状态 / 类型）
- 索引：`catalog.jsonl` 由 `kb.mjs rebuild` 生成，`validate` 通过（0 错误 0 警告）
- 规则层：v1.12.0 —— Phase 0–7 已完成；Phase 6 外部项目写入：`attach --write/--read-only`、按会话 cwd 的外部 ingestor/judge、宿主 `kb.mjs --root <store>`、面板项目状态；Phase 7 审计清偿：N5 同 subject 唯一 active、redact 补强、TTY 人闸、项目库裁判禁止 global、registry 故障注入。插件 122/122、冒烟 98/98；1.12.0 待发布；上一发布 1.11.0 commit `87f228b`、CI `41165962008` 全绿。默认仍只读，外部写入需显式 `attach --write`。
- 界面：`@local/kb-panel` 已启用 —— 记忆 chip、会话菜单、知识库页（含「工作页」徽标）、软刷新 + 排队完整重载
- 已定：项目内 `.dsh-memory/` + 显式 attach + 默认只读，外部写入需显式 `attach --write`（TTY 人闸）；`10_Raw/` 永不公开；完整库私有 bundle 备份已建立（`dsh-memory-private`），恢复演练通过；1.12.0 待发布，1.11.0 已发布。

## 怎么用

1. 正常聊天，原文进原文层（插件在 `turn/end` 自动追加）
2. 想立刻固化某条：直接说「记住：……」
3. 想整理：说「整理知识库」，跑 `kb.mjs consolidate` + 人工裁决
4. 想续接项目：`kb.mjs work-new --scope project:<slug>` 建工作页，之后每个新会话自动带一行「项目简报」
5. 想翻旧账：查 `_meta/catalog.archive.jsonl`
