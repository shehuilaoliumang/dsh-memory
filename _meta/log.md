# 变更日志

格式：`日期 时间 | 动作 | 说明`。只追加，不删改。

2026-10-20 00:11 | session  | 首次对话：讨论 Obsidian 永久知识库的分级、归档与写入节奏
2026-10-20 00:29 | scaffold | 创建目录骨架、AGENTS.md、schema v1、labels.yaml、导航、抽取样例 20 条
2026-10-20 00:33 | restructure | 知识库整体移入 memory/ 子目录，作为独立 DSH 工作区；schema 与 labels 补充工作区根说明
2026-10-20 00:34 | trial-run | 首次端到端手动试跑：1 篇 session、7 条 atom、1 个主题、1 条 canon 决策；catalog 建立 10 行
2026-10-20 00:36 | patch | 规范补丁：type 枚举增加 session；id 编号豁免 core.md 与 _meta 固定文件
2026-10-20 00:37 | lesson | 试跑发现日志时间被模型臆造，已按系统时钟修正并新增 a-0008 约束
2026-10-20 00:56 | fix | 校验器发现首跑手工稿的 summary/tags 与笔记不一致：统一 summary 到 ≤40 字并补齐 tags，索引改由脚本重建、按 id 排序
2026-10-20 00:56 | script | 新增 _meta/scripts/kb.mjs + _meta/config.json：validate / rebuild / append-session / candidates / consolidate / log
2026-10-20 00:56 | patch | schema v1.1：补 status=canon、索引行上限 300B、新增 §11 规则层、未决 1-3 关闭
2026-10-20 00:56 | decision | c-0002 git 权威 / c-0003 ASCII 文件名 / c-0004 flash 裁判 / c-0005 规则层脚本
2026-10-20 00:56 | core | core.md 填写称谓/硬偏好/禁区；注入方式 v1.5 指令级、v2 插件
2026-10-20 00:56 | session | 本会话原文落 10_Raw/sessions/2026/10/2026-10-20-0055-kb-v15.md
2026-10-20 01:00 | plugin | 新增 @local/kb-panel（_meta/plugin/kb-panel）：composer 记忆 chip + GET /kb/panel.json + core.md 系统提示注入；已安装并启用
2026-10-20 01:00 | inject | core.md 真注入生效（systemPrompt.context）：禁用插件注入消失、启用恢复，双向验证
2026-10-20 01:00 | ui | 面板首版验证：/kb/panel.json 200（16 篇 / 索引 16 / 分层 2-9-5），conversation.composer.dock 的 kb-memory 已激活
2026-10-20 01:00 | fix | 面板快照排除 core.md 固定文件：重载后 notes 17→16
2026-10-20 01:00 | patch | schema v1.2：新增 _meta/plugin/ 与 §12 界面层插件，未决 6 关闭
2026-10-20 01:41 | extract | session-9560413c-746c-4c64-908c-9f4e09561a6f 候选 3 条 → judge 队列（idle）
2026-10-20 01:54 | extract | session-9560413c-746c-4c64-908c-9f4e09561a6f 候选 14 条 → judge 队列（idle）
2026-10-20 02:03 | extract | session-d169d7ed-f709-4bca-ae02-8ce7b4e08925 候选 20 条 → judge 队列（idle）
2026-10-20 02:07 | extract | session-2facb68e-3acb-4d19-8aec-1fe4b567f427 候选 9 条 → judge 队列（idle）
2026-10-20 02:08 | extract | session-4ec1b9de-efec-4651-bd7b-2c04e86f8a9c 候选 14 条 → judge 队列（idle）
2026-10-20 02:10 | extract | session-d169d7ed-f709-4bca-ae02-8ce7b4e08925 候选 16 条 → judge 队列（idle）
2026-10-20 20:21 | extract | session-9560413c-746c-4c64-908c-9f4e09561a6f 候选 16 条 → judge 队列（catch-up）
2026-10-20 20:31 | extract | session-d169d7ed-f709-4bca-ae02-8ce7b4e08925 候选 11 条 → judge 队列（idle）
2026-10-20 20:42 | extract | session-4ec1b9de-efec-4651-bd7b-2c04e86f8a9c 候选 7 条 → judge 队列（idle）
2026-10-20 20:44 | extract | session-9560413c-746c-4c64-908c-9f4e09561a6f 候选 8 条 → judge 队列（idle）
2026-10-20 20:46 | extract | session-d169d7ed-f709-4bca-ae02-8ce7b4e08925 候选 4 条 → judge 队列（idle）
2026-10-20 21:10 | extract | session-d169d7ed-f709-4bca-ae02-8ce7b4e08925 候选 8 条 → judge 队列（idle）
2026-10-20 22:08 | extract | session-d169d7ed-f709-4bca-ae02-8ce7b4e08925 候选 20 条 → judge 队列（manual）
2026-10-20 22:08 | atom | 2026-10-20-a-0009（preference）界面文案用简体中文，系统路径保持英文
2026-10-20 22:08 | atom | 2026-10-20-a-0010（decision）记忆条改为无边框紧凑按钮
2026-10-20 22:19 | extract | session-d169d7ed-f709-4bca-ae02-8ce7b4e08925 候选 14 条 → judge 队列（idle）
2026-10-20 22:25 | extract | session-d169d7ed-f709-4bca-ae02-8ce7b4e08925 候选 7 条 → judge 队列（idle）
2026-10-20 22:29 | atom | 2026-10-20-a-0011（preference）希望自行确认页面版本
2026-10-20 22:34 | atom | 2026-10-20-a-0012（task）kb-panel 三界面视觉对齐宿主
2026-10-20 22:34 | atom | 2026-10-20-a-0013（task）知识库触发器行为验证未完成
2026-10-20 22:35 | extract | session-d169d7ed-f709-4bca-ae02-8ce7b4e08925 候选 3 条 → judge 队列（idle）
2026-10-20 22:38 | atom | 2026-10-20-a-0014（decision）知识库校验改用二次确认
2026-10-20 22:38 | atom | 2026-10-20-a-0015（question）原子增多后自动提议晋升/降权
2026-10-20 22:47 | extract | session-d169d7ed-f709-4bca-ae02-8ce7b4e08925 候选 19 条 → judge 队列（idle）
2026-10-20 22:47 | atom | 2026-10-20-a-0016（principle）知识库不应沦为施工日志
2026-10-20 23:18 | consolidate | 整理：新增 c-0006/c-0007 记忆隔离决策；a-0001/2/3/4/5/6/7/8/16 晋升并补 up 回指；a-0012/13 归档；t-0001 主题页补全 21 条 related 与 v1.7 结论。uncovered 归零。
2026-10-20 23:22 | extract | session-d169d7ed-f709-4bca-ae02-8ce7b4e08925 候选 20 条 → judge 队列（max-delay）
2026-10-20 23:33 | extract | session-d169d7ed-f709-4bca-ae02-8ce7b4e08925 候选 20 条 → judge 队列（manual）
2026-10-20 23:37 | delete | 2026-10-20-a-0010, 2026-10-20-a-0012, 2026-10-20-a-0013, 2026-10-20-a-0014, 2026-10-20-a-0015（物理删除，票据 del-mvguiy37-ae1fdf）
2026-10-20 23:40 | delete | 2026-10-20-a-0001, 2026-10-20-a-0002, 2026-10-20-a-0003, 2026-10-20-a-0004, 2026-10-20-a-0005, 2026-10-20-a-0006, 2026-10-20-a-0007, 2026-10-20-a-0008（物理删除，票据 del-mvgumskp-d3c3fa）
2026-10-28 21:23 | extract | session-d169d7ed-f709-4bca-ae02-8ce7b4e08925 候选 17 条 → judge 队列（catch-up）
2026-10-28 21:28 | atom | 2026-10-28-a-0001（principle）知识库不物理删除，只降权或归档
2026-10-28 21:28 | atom | 2026-10-28-a-0002（decision）删除笔记须票据加人工输入密钥
2026-10-29 00:13 | extract | session-8c78f45e-d410-44e2-8d36-9c6ca997755c 候选 20 条 → judge 队列（idle）
2026-10-29 00:17 | atom | 2026-10-29-a-0001（decision）记忆写入需用户确认
2026-10-29 00:26 | work | 工作层落地：type=work + 20_Digest/work/ + work-new/work-brief + 恢复简报注入（不占记忆预算）+ 整理诊断；schema v1.4
2026-10-29 00:32 | extract | session-8c78f45e-d410-44e2-8d36-9c6ca997755c 候选 8 条 → judge 队列（idle）
2026-10-29 00:40 | archive | 2026-10-29-a-0001 归档（与 c-0007 语义重复，裁判去重已增加 canon 上下文）
2026-10-29 00:41 | extract | session-8c78f45e-d410-44e2-8d36-9c6ca997755c 候选 5 条 → judge 队列（idle）
2026-10-29 00:47 | work | 审计修复 1-6：validate 工作页唯一性、简报多条聚合、面板归档/恢复、注入规则单测、裁判 canon 上下文与审计字段、冒烟基线断言
2026-10-29 00:55 | extract | session-8c78f45e-d410-44e2-8d36-9c6ca997755c 候选 4 条 → judge 队列（catch-up）
2026-10-29 01:01 | work | 独立审查第 2 轮：工作页恢复冲突守卫、batch 预校验、brief 总长上限、状态变更写日志、validate 类型-id 校验、PS5.1 BOM/命令、文档一致性（id 格式/scope 口径/删除命令/模板）
2026-10-29 01:09 | write | c-0008 架构总览：分层+五步管线+双闸门注入+工作层+单写通道，串起 c-0001~c-0007
2026-10-29 01:15 | extract | session-8c78f45e-d410-44e2-8d36-9c6ca997755c 候选 13 条 → judge 队列（idle）
2026-10-29 01:18 | publish | GitHub public 脱敏快照已发布：https://github.com/shehuilaoliumang/dsh-memory（51 文件，无 10_Raw/state）
2026-10-29 01:18 | atom | 2026-10-29-a-0002（fact）知识库仓库公开前的敏感内容边界
2026-10-29 01:23 | extract | session-8c78f45e-d410-44e2-8d36-9c6ca997755c 候选 3 条 → judge 队列（idle）
2026-10-29 09:50 | extract | session-8c78f45e-d410-44e2-8d36-9c6ca997755c 候选 20 条 → judge 队列（catch-up）
2026-10-29 09:52 | status | 2026-10-29-a-0002 → archived
2026-10-29 11:25 | work | Phase 1 当前真相：subject/supersedes/superseded、pending 取代边、consolidate truth、shadow 排序；7 篇存量原子补 subject
2026-10-29 11:54 | phase2 | Phase 2: golden set 100, precision 1.000, promptVersion/breaker/feedback, tests 88/88, smoke 69/69
2026-10-29 12:05 | phase3 | Phase 3: search/BM25, rankMemories live, untrusted-memory, redaction, CSRF token, c-0010 threat model; tests 95/95, smoke 76/76
2026-10-29 12:12 | phase4 | Phase 4 减债：共享 parser/节名、append-session JSON、scope 回落、session id 去重、access 轮转、VERSION/CHANGELOG/init；测试 99/99、冒烟 80/80
2026-10-30 14:04 | recheck | 第三轮复审加固：loopback 拒绝、http-token 本机令牌、ingest 故障注入、22 条 FN 复核；测试 106/106、冒烟 81/81、v1.9.3
2026-10-30 18:05 | phase5 | 多项目记忆库首轮：--root/KB_ROOT、init/attach、stores 双库解析与注入、stores 测试 6 条；插件 112/112、冒烟 88/88
2026-10-31 10:20 | phase6 | 外部项目写入：attach --write/--read-only、按 cwd 的外部 ingestor/judge、面板项目状态；插件 114/114、冒烟 90/90、私有 bundle 恢复演练通过；v1.11.0
