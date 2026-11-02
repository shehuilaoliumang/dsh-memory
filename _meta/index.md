---
title: 知识库导航
status: canon
updated: 2026-11-02
---

# 知识库导航

> 路径是英文，显示名是中文。映射见 `_meta/labels.yaml`。
> 本目录（`memory/`）就是 DSH 工作区根；Obsidian 库根只放你自己的项目和素材。

## 三层

- **原文层** `10_Raw/` — 对话记录与剪藏，只增不改
- **摘要层** `20_Digest/` — 原子记忆、主题页、工作页（项目状态，不注入）
- **结论层** `30_Canon/` — 方法论、决策、[[30_Canon/core|核心记忆]]

## 元数据

- 规范 → `_meta/schema.md`（v1.19.2）
- 变更日志 → `_meta/log.md`
- 显示名映射 → `_meta/labels.yaml`
- 抽取样例 → `_meta/rules/samples.md`；裁判黄金集 → `_meta/rules/golden.jsonl`（100 条）
- 规则层 → `_meta/scripts/README.md`（`kb.mjs`：校验 / 重建索引 / 追加原文 / 候选提取 / 工作页 / 只读检索 / 多库 init+attach）
- 关键决策 → `30_Canon/decisions/`（重置后首条 **c-1001** 工作区记忆库的自动授权与迁移边界，新编号从 c-1001 起；更早历史 c-0001~c-0021 见 git 历史 `bdf14e3`）

## 当前状态

- **记忆层已重置（2026-11-02）**：物理删除 39 篇（9 raw 会话 + 9 digest 原子/主题/工作页 + 21 决策），仅保留 `30_Canon/core.md`；重置时 `catalog` 0 行、`validate` 1 篇（core.md）/0 行、0 警告；此后自动捕获的 `10_Raw` 会话行与首条决策 c-1001 另计（当前 3 篇/2 行、`validate` 仍 0 警告）；运行时状态已清、`access.jsonl` 已轮转、删除审计在 `_meta/state/delete-log.jsonl`；历史可从 git `bdf14e3` 找回。
- 笔记数：以 `node _meta/scripts/kb.mjs stats` 为准（分层 / 状态 / 类型）
- 索引：`catalog.jsonl` 由 `kb.mjs rebuild` 生成，`validate` 通过（0 错误 0 警告）
- 规则层：v1.19.2 —— Phase 0–15 已完成；Phase 6 外部项目写入、Phase 7 审计清偿、Phase 8 记忆交互改版、Phase 9 90+ 质量加固、Phase 10 多工作区隔离查看、Phase 11 工作区独立记忆库创建/接入、Phase 12 工作区记忆库自动创建与自动记录、Phase 13 全局记忆的显式提升、Phase 14 工作区改名与文件夹迁移、Phase 15 授权/迁移信任硬化：workspace 选择器与读写隔离、N6 跨库先仲裁再预算、删 TTY 环境旁路、项目库 global 泄漏告警、触发词短语化、新工作区自动 `init`+`attach`+`writable`（自忽略 `.gitignore`）、记忆页单条「提升为全局」、显示名改名只动 `project.json.title`、文件夹迁移按 `store_id` 重定位、1.18.1 自绘玻璃工作区选择器与 legacy 实际名称/改名、1.18.2 下拉菜单层叠修复、1.18.3 面板不透明度 92–96%、1.18.4 改名改用自绘玻璃对话框、1.18.5 check-plugin-load 加载形状闸门进 CI 与提升失败回滚、1.19.0 自动授权可配置（`provision.autoWritable`）与 registry `autoGranted` 审计/收回、文件夹迁移双信号（旧路径消失 + `folderBirthtimeMs` 容差 5s；复制/克隆人工确认）、决策 c-1001、1.19.1 导出遥测修复（`access*.jsonl` 家族排除 + publish 硬闸 + `--orphan` 干净重发）与决策编号避让（c-0001→c-1001、新编号从 c-1001 起）、1.19.2 公开可见卫生自审（公开 `_meta/log.md` 的 session UUID/原文文件名清洗 `stripRuntimeIds` + 导出断言、CI 导出快照禁止文件与 session id 检查、本地完整库/公开快照 validate 口径区分、旧决策悬空引用清理）。插件 144/144、冒烟 106/106（夹具自包含）、本地 `validate` 3 篇/2 行、公开快照 2 篇/1 行、0 警告；1.13.0 已发布（public commit `3f7e048`、CI `41190755461` 全绿）；1.14.0 已发布（public commit `3a70778`、CI `41195129561` 全绿）；1.14.1 为打包修复（去 `package.json` BOM）；1.16.0 已本地提交（`5131300`）；1.17.0 已本地提交（`640a07f`）；1.18.0 已本地提交（`73a88a0`）；1.18.1 已本地提交（`b36ad44`）；1.18.2 已本地提交（`1cb498a`）；1.18.3 已本地提交（`93c4042`）；1.18.4 已本地提交（`bdf14e3`）；1.18.5 已本地提交（`4abeaea`）；1.19.0 已本地提交（`14373fc` + 冒烟兼容修复 `f447592`）并已发布（public commit `506279b`、CI `41412459175` 全绿），后因遥测文件混入弃用、1.19.1 用干净快照重发；1.19.1 已发布（public commit `2cd38f6`、tree `3d0953e`、CI `41426653086` 全绿；main 历史由 `--orphan --force` 干净重开，旧 `506279b`/`dc43eb2` 不在可达历史）；随后自审发现公开可见卫生问题（公开 log 含 session UUID/原文文件名、数字口径、悬空引用），1.19.2 已发布（公开快照随本次提交重发；导出已清洗 session UUID/原文文件名，CI 在导出快照上复跑 validate=2 篇/1 行）。
- 界面：`@local/kb-panel` 已启用 —— 记忆 chip、会话菜单、记忆页（待确认/已记住/项目状态/全部，客户端 c36，自绘玻璃工作区选择器 `WorkspacePicker`（下拉浮于内容卡之上、玻璃表面不透明度 ≥90%）、“正在查看”工作区选择器、当前工作区创建/接入卡片、已确认原子「提升为全局」、project/legacy 「改名」（自绘玻璃对话框）与迁移确认卡片（区分「已迁移」/「未确认副本」两态））、软刷新 + 排队完整重载
- 已定：项目内 `.dsh-memory/`；v1.16 新工作区自动创建并默认记录（自忽略 `.gitignore`），已有库/克隆仓库自带库仍需显式接入；v1.17 全局记忆只经记忆页「提升为全局」增长（不自动/不批量，项目裁判不写 global）；v1.18 改名只动 `project.json.title`、文件夹迁移按 `store_id` 自动/人工重定位；v1.18.1 改名开放到 project 与 legacy（global 不可），选择器显示实际 title（legacy “DSH Memory”）；v1.18.2 修复下拉菜单层叠（状态条 z-index、触发钮去 focus 外框）；v1.18.3 玻璃表面不透明度提到 92–96%（≥90%，保留 blur）；v1.18.4 改名改为自绘玻璃对话框（Electron 无 window.prompt）；v1.18.5 CI 加载形状闸门（check-plugin-load：BOM/JSON/manifest/patch/语法）与提升失败回滚；v1.19.0 自动授权可配置（`provision.autoWritable`）+ `autoGranted` 审计/收回、迁移双信号（`folderBirthtimeMs` 容差 5s）与复制库人工确认；v1.19.1 公开快照排除 `access*.jsonl` 家族（export + publish 双闸、`--orphan` 干净重发）、新决策编号从 c-1001 起；v1.19.2 公开可见卫生自审（导出清洗 session UUID/原文文件名、CI 导出检查、本地/公开 validate 口径区分、悬空引用清理）；`10_Raw/` 永不公开；完整库私有 bundle 备份已建立（`dsh-memory-private`），恢复演练通过；1.13.0 已发布、1.14.0 已发布、1.14.1 打包修复。

## 怎么用

1. 正常聊天，原文进原文层（插件在 `turn/end` 自动追加）
2. 想立刻固化某条：直接说「记住：……」
3. 想整理：说「整理知识库」，跑 `kb.mjs consolidate` + 人工裁决
4. 想续接项目：`kb.mjs work-new --scope project:<slug>` 建工作页，之后每个新会话自动带一行「项目简报」
5. 想翻旧账：查 `_meta/catalog.archive.jsonl`
