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
2026-10-20 00:56 | session | 本会话原文落 10_Raw/sessions/<redacted>.md
2026-10-20 01:00 | plugin | 新增 @local/kb-panel（_meta/plugin/kb-panel）：composer 记忆 chip + GET /kb/panel.json + core.md 系统提示注入；已安装并启用
2026-10-20 01:00 | inject | core.md 真注入生效（systemPrompt.context）：禁用插件注入消失、启用恢复，双向验证
2026-10-20 01:00 | ui | 面板首版验证：/kb/panel.json 200（16 篇 / 索引 16 / 分层 2-9-5），conversation.composer.dock 的 kb-memory 已激活
2026-10-20 01:00 | fix | 面板快照排除 core.md 固定文件：重载后 notes 17→16
2026-10-20 01:00 | patch | schema v1.2：新增 _meta/plugin/ 与 §12 界面层插件，未决 6 关闭
2026-10-20 01:41 | extract | session-<redacted> 候选 3 条 → judge 队列（idle）
2026-10-20 01:54 | extract | session-<redacted> 候选 14 条 → judge 队列（idle）
2026-10-20 02:03 | extract | session-<redacted> 候选 20 条 → judge 队列（idle）
2026-10-20 02:07 | extract | session-<redacted> 候选 9 条 → judge 队列（idle）
2026-10-20 02:08 | extract | session-<redacted> 候选 14 条 → judge 队列（idle）
2026-10-20 02:10 | extract | session-<redacted> 候选 16 条 → judge 队列（idle）
2026-10-20 20:21 | extract | session-<redacted> 候选 16 条 → judge 队列（catch-up）
2026-10-20 20:31 | extract | session-<redacted> 候选 11 条 → judge 队列（idle）
2026-10-20 20:42 | extract | session-<redacted> 候选 7 条 → judge 队列（idle）
2026-10-20 20:44 | extract | session-<redacted> 候选 8 条 → judge 队列（idle）
2026-10-20 20:46 | extract | session-<redacted> 候选 4 条 → judge 队列（idle）
2026-10-20 21:10 | extract | session-<redacted> 候选 8 条 → judge 队列（idle）
2026-10-20 22:08 | extract | session-<redacted> 候选 20 条 → judge 队列（manual）
2026-10-20 22:08 | atom | 2026-10-20-a-0009（preference）界面文案用简体中文，系统路径保持英文
2026-10-20 22:08 | atom | 2026-10-20-a-0010（decision）记忆条改为无边框紧凑按钮
2026-10-20 22:19 | extract | session-<redacted> 候选 14 条 → judge 队列（idle）
2026-10-20 22:25 | extract | session-<redacted> 候选 7 条 → judge 队列（idle）
2026-10-20 22:29 | atom | 2026-10-20-a-0011（preference）希望自行确认页面版本
2026-10-20 22:34 | atom | 2026-10-20-a-0012（task）kb-panel 三界面视觉对齐宿主
2026-10-20 22:34 | atom | 2026-10-20-a-0013（task）知识库触发器行为验证未完成
2026-10-20 22:35 | extract | session-<redacted> 候选 3 条 → judge 队列（idle）
2026-10-20 22:38 | atom | 2026-10-20-a-0014（decision）知识库校验改用二次确认
2026-10-20 22:38 | atom | 2026-10-20-a-0015（question）原子增多后自动提议晋升/降权
2026-10-20 22:47 | extract | session-<redacted> 候选 19 条 → judge 队列（idle）
2026-10-20 22:47 | atom | 2026-10-20-a-0016（principle）知识库不应沦为施工日志
2026-10-20 23:18 | consolidate | 整理：新增 c-0006/c-0007 记忆隔离决策；a-0001/2/3/4/5/6/7/8/16 晋升并补 up 回指；a-0012/13 归档；t-0001 主题页补全 21 条 related 与 v1.7 结论。uncovered 归零。
2026-10-20 23:22 | extract | session-<redacted> 候选 20 条 → judge 队列（max-delay）
2026-10-20 23:33 | extract | session-<redacted> 候选 20 条 → judge 队列（manual）
2026-10-20 23:37 | delete | 2026-10-20-a-0010, 2026-10-20-a-0012, 2026-10-20-a-0013, 2026-10-20-a-0014, 2026-10-20-a-0015（物理删除，票据 del-mvguiy37-ae1fdf）
2026-10-20 23:40 | delete | 2026-10-20-a-0001, 2026-10-20-a-0002, 2026-10-20-a-0003, 2026-10-20-a-0004, 2026-10-20-a-0005, 2026-10-20-a-0006, 2026-10-20-a-0007, 2026-10-20-a-0008（物理删除，票据 del-mvgumskp-d3c3fa）
2026-10-28 21:23 | extract | session-<redacted> 候选 17 条 → judge 队列（catch-up）
2026-10-28 21:28 | atom | 2026-10-28-a-0001（principle）知识库不物理删除，只降权或归档
2026-10-28 21:28 | atom | 2026-10-28-a-0002（decision）删除笔记须票据加人工输入密钥
2026-10-29 00:13 | extract | session-<redacted> 候选 20 条 → judge 队列（idle）
2026-10-29 00:17 | atom | 2026-10-29-a-0001（decision）记忆写入需用户确认
2026-10-29 00:26 | work | 工作层落地：type=work + 20_Digest/work/ + work-new/work-brief + 恢复简报注入（不占记忆预算）+ 整理诊断；schema v1.4
2026-10-29 00:32 | extract | session-<redacted> 候选 8 条 → judge 队列（idle）
2026-10-29 00:40 | archive | 2026-10-29-a-0001 归档（与 c-0007 语义重复，裁判去重已增加 canon 上下文）
2026-10-29 00:41 | extract | session-<redacted> 候选 5 条 → judge 队列（idle）
2026-10-29 00:47 | work | 审计修复 1-6：validate 工作页唯一性、简报多条聚合、面板归档/恢复、注入规则单测、裁判 canon 上下文与审计字段、冒烟基线断言
2026-10-29 00:55 | extract | session-<redacted> 候选 4 条 → judge 队列（catch-up）
2026-10-29 01:01 | work | 独立审查第 2 轮：工作页恢复冲突守卫、batch 预校验、brief 总长上限、状态变更写日志、validate 类型-id 校验、PS5.1 BOM/命令、文档一致性（id 格式/scope 口径/删除命令/模板）
2026-10-29 01:09 | write | c-0008 架构总览：分层+五步管线+双闸门注入+工作层+单写通道，串起 c-0001~c-0007
2026-10-29 01:15 | extract | session-<redacted> 候选 13 条 → judge 队列（idle）
2026-10-29 01:18 | publish | GitHub public 脱敏快照已发布：https://github.com/shehuilaoliumang/dsh-memory（51 文件，无 10_Raw/state）
2026-10-29 01:18 | atom | 2026-10-29-a-0002（fact）知识库仓库公开前的敏感内容边界
2026-10-29 01:23 | extract | session-<redacted> 候选 3 条 → judge 队列（idle）
2026-10-29 09:50 | extract | session-<redacted> 候选 20 条 → judge 队列（catch-up）
2026-10-29 09:52 | status | 2026-10-29-a-0002 → archived
2026-10-29 11:25 | work | Phase 1 当前真相：subject/supersedes/superseded、pending 取代边、consolidate truth、shadow 排序；7 篇存量原子补 subject
2026-10-29 11:54 | phase2 | Phase 2: golden set 100, precision 1.000, promptVersion/breaker/feedback, tests 88/88, smoke 69/69
2026-10-29 12:05 | phase3 | Phase 3: search/BM25, rankMemories live, untrusted-memory, redaction, CSRF token, c-0010 threat model; tests 95/95, smoke 76/76
2026-10-29 12:12 | phase4 | Phase 4 减债：共享 parser/节名、append-session JSON、scope 回落、session id 去重、access 轮转、VERSION/CHANGELOG/init；测试 99/99、冒烟 80/80
2026-10-30 14:04 | recheck | 第三轮复审加固：loopback 拒绝、http-token 本机令牌、ingest 故障注入、22 条 FN 复核；测试 106/106、冒烟 81/81、v1.9.3
2026-10-30 18:05 | phase5 | 多项目记忆库首轮：--root/KB_ROOT、init/attach、stores 双库解析与注入、stores 测试 6 条；插件 112/112、冒烟 88/88
2026-10-31 10:20 | phase6 | 外部项目写入：attach --write/--read-only、按 cwd 的外部 ingestor/judge、面板项目状态；插件 114/114、冒烟 90/90、私有 bundle 恢复演练通过；v1.11.0
2026-10-31 11:50 | publish | 1.11.0 公开快照：发布 commit 87f228b、tree da0591a、77 文件；CI run 41165962008 全绿
2026-10-31 13:50 | ui | 安全刷新：软刷新（不卸载页面）+ 完整重载空闲执行/忙时排队；客户端 c21；v1.11.1；插件 114/114、冒烟 90/90
2026-10-31 15:49 | phase7 | 审计清偿：N5 同 subject 唯一 active、redact 中文/短值/URL/手机/身份证、attach --write/delete TTY、项目库裁判禁止 global、registry 故障注入；插件 122/122、冒烟 98/98；c-0015；v1.12.0 待发布
2026-10-31 17:26 | extract | session-<redacted> 候选 1 条 → judge 队列（idle）
2026-10-31 17:32 | extract | session-<redacted> 候选 2 条 → judge 队列（idle）
2026-10-31 17:49 | phase8 | 记忆交互改版与 90+ 质量加固完成；N6 跨库仲裁、TTY 无后门、触发词短语化；测试 127/100
2026-10-31 18:50 | phase10 | 多工作区隔离查看：workspace 读/写解析、前端选择器、只读目标 403、legacy 5 条补位、init 默认触发词 20/meta 10；插件 129/129、冒烟 102/102；c-0017；1.14.0 已发布（public `3a70778`，CI `41195129561`）
2026-11-02 10:50 | phase11 | 工作区独立记忆库创建/接入：POST /kb/workspace/attach、session.workspace、UI 创建/接入卡片、默认只读、c-0018；测试 129/129、冒烟 102/102；1.15.0 待发布
2026-11-02 13:25 | status | 2026-11-02-c-0018 → superseded
2026-11-02 13:30 | phase12 | Phase 12 工作区记忆库自动创建/自动记录：agent/created 自动 init+attach(writable)、turn/end 兜底补建、kb init 写自忽略 .gitignore、已有库仍显式接入；已补建 3 个工作区（p-6ed6171e/p-cb5c6b03/p-26552439）；插件 133/133、冒烟 102/102、validate 37 篇/34+2 0 警告；c-0019 取代 c-0018；1.15.0+1.16.0 合并待发布
2026-11-02 13:50 | phase13 | Phase 13 全局记忆显式提升：POST /kb/atom/to-global 单条已确认 digest 原子复制到全局库并把源条置 promoted、跨库链接不复制只写来源备注、同 summary duplicate 复用 id；promote.js + 5 条单测；add-atom 支持 note 写备注、log.md 缺失自动创建；客户端 c30；c-0020；插件 138/138、冒烟 102/102、validate 39 篇/36+2 0 警告；1.17.0 待发布
2026-11-02 13:58 | phase14 | Phase 14 工作区改名与文件夹迁移：显示名改名只改 project.json.title（POST /kb/workspace/rename）；project.json 稳定 store_id + registry storeId，文件夹改名旧路径消失自动重定位（保留 writable、title 跟随）、旧路径仍在需面板确认（POST /kb/workspace/relocate）；插件启动 syncRegistryStoreIds 补写；客户端 c31；c-0021；插件 143/143、冒烟 102/102、validate 40 篇/37+2 0 警告；1.18.0 待发布
2026-11-02 14:19 | ui | 记忆页工作区选择器玻璃化 + legacy 命名修正：WorkspacePicker 替代原生 select（客户端 c32）、卡片圆角 20/状态条 18；legacy 名称读 project.json.title（DSH Memory）并允许改名、global 仍 400；1.18.1 待发布
2026-11-02 14:26 | ui | 记忆页工作区下拉菜单层叠修复：statusStrip 加 position:relative+zIndex:40 让下拉浮于列表卡之上、pickerTrigger 去原生 focus 外框；客户端 c33；无逻辑变更；1.18.2 待发布
2026-11-02 14:38 | ui | 面板不透明度提到 90% 以上：所有半透明玻璃表面底统一 92–96%（卡片 93%、菜单 96/92），保留 backdrop-filter 与内高光，hover 90%；客户端 c34；无逻辑变更；1.18.3 待发布
2026-11-02 14:45 | ui | 改名功能修复：Electron 无 window.prompt 导致点击无反应，改为自绘玻璃命名对话框（遮罩 z-index 200、Enter 保存/Escape 或遮罩取消、空名提示），保存仍走 POST /kb/workspace/rename；客户端 c35；无后端变更；1.18.4 待发布
2026-11-02 14:54 | delete | 2026-10-20-0011, 2026-10-20-0055, 2026-10-20-0110, 2026-10-20-0131, 2026-10-20-0136, 2026-10-20-0201, 2026-10-20-0203, 2026-10-20-a-0009, 2026-10-20-a-0011, 2026-10-20-a-0016, 2026-10-20-c-0001, 2026-10-20-c-0002, 2026-10-20-c-0003, 2026-10-20-c-0004, 2026-10-20-c-0005, 2026-10-20-c-0006, 2026-10-20-c-0007, 2026-10-20-t-0001, 2026-10-28-a-0001, 2026-10-28-a-0002, 2026-10-29-0002, 2026-10-29-a-0001, 2026-10-29-a-0002, 2026-10-29-c-0008, 2026-10-29-c-0009, 2026-10-29-c-0010, 2026-10-29-c-0011, 2026-10-29-w-0001, 2026-10-30-c-0012, 2026-10-30-c-0013, 2026-10-30-c-0014, 2026-10-31-c-0015, 2026-10-31-c-0016, 2026-10-31-c-0017, 2026-11-02-1341, 2026-11-02-c-0018, 2026-11-02-c-0019, 2026-11-02-c-0020, 2026-11-02-c-0021（物理删除，票据 del-mvywjjys-d5a8e5）
2026-11-02 15:52 | reset | 记忆层重置：物理删除 39 篇（9 raw 会话 + 9 digest + 21 决策），仅保留 30_Canon/core.md；catalog 归零、运行时状态清空、access.jsonl 轮转；历史可从 git bdf14e3 找回
2026-11-02 15:59 | audit | 第 9 轮审计遗留关闭：新增 check-plugin-load 加载形状闸门（5 JSON 禁 BOM/14 manifest 文件/2 locale/patch 形状/14 JS 语法）进 CI（validate 前）；提升为全局失败回滚（源条 promoted 失败时非 duplicate 全局副本置 archived）；1.18.5 待发布
2026-11-02 16:03 | smoke | smoke 夹具自包含化：副本内自建 canon 2026-01-01-c-9999 与第二个原子，不再依赖重置前存量笔记；复跑 106/106 通过（0 失败）；1.18.5 文档 smoke 数字回填为 106/106
2026-11-02 16:11 | phase15 | Phase 15 授权/迁移信任硬化：provision.autoWritable（默认 true；false 只读等授权）、registry autoGranted 审计与 --read-only 收回、folderBirthtimeMs 双信号迁移（旧路径消失 + 创建时间容差 5s；复制/克隆人工确认）、启动 sync 补写；客户端 c36 两态迁移卡片；决策 c-0001；插件 144/144、冒烟 106/106、validate 3 篇/2 行 0 警告；1.19.0 待发布
2026-11-02 16:19 | smoke | 冒烟兼容全新检出：副本内补建空目录（10_Raw/sessions、20_Digest/atoms|topics|work、30_Canon/decisions|principles、_meta/state）；公开仓库首次 CI 因缺 20_Digest/atoms 失败，修正后 106/106；1.19.0 重新发布
2026-11-02 16:22 | release | 1.19.0 公开快照已发布：public commit 506279b（tree 95546a0）、CI run 41412459175 全绿（load-shape/validate/144 单测/双 shell smoke 106/fresh snapshot 均通过）；本地 14373fc + 冒烟兼容 f447592；上一提交 dc43eb2 的 CI 因公开快照缺 20_Digest/atoms 空目录失败，已修复后重新发布
2026-11-02 18:00 | ci | 1.19.1 导出遥测修复：export-public 排除 access*.jsonl 家族（与 gitignore 同源）+ 导出禁止文件断言；publish-public 发布前硬闸（access*/state/10_Raw/PROJECT_PLAN）+ --orphan/--force 干净树重开 main；1.19.0 公开快照 506279b 因混入 access-20261102-1552.jsonl（220 行）弃用
2026-11-02 18:00 | docs | 决策编号避让：重置后首条决策 2026-11-02-c-0001 → 2026-11-02-c-1001（新系列从 c-1001 起，旧号停用；正文补与 c-0015 适用范围）；代码注释与 schema/AGENTS/README/index/PROJECT_PLAN 引用同步；1.19.1 待发布
2026-11-02 18:12 | release | 1.19.1 公开快照已用孤儿提交重发：public commit 2cd38f6（tree 3d0953e）、CI run 41426653086 全绿；main 历史由 --orphan --force 重开，1.19.0 的 506279b/dc43eb2 不在可达历史；导出已排除 access*.jsonl/state/10_Raw，公开树复核无禁止路径
2026-11-02 18:33 | release | 1.19.1 发布记录回填已推送：public commit 0ab310b（tree af20108，父 2cd38f6）、CI run 41429548520 全绿；公开 main 头=0ab310b，README 已无
2026-11-02 18:56 | audit | 1.19.2 自审公开可见卫生：公开 _meta/log.md 清洗 session UUID/原文路径（export stripRuntimeIds + 导出后断言）；CI 导出快照新增禁止文件与 session id 检查；README/schema 区分本地完整库 3 篇/2 行与公开快照 2 篇/1 行；README/CHANGELOG 旧决策悬空引用清理与 c-0001→c-1001 改名说明；fixture 真实 session 片段改合成 id session-<redacted>；1.19.2 待发布
2026-11-02 19:03 | release | 1.19.2 公开快照已发布：public commit 55844c3（tree b8aa813）、CI run 41433455297 全绿；自审修复（log session UUID/原文路径清洗+导出断言、CI 快照禁止文件/session id 检查、数字口径、悬空引用、fixture/文本去真实标识）；远端复核 log 无 session id、README 无待发布、树无禁止路径
2026-11-02 19:05 | audit | 第十二轮四条小缝清偿：export/publish 对 access* 任意后缀（含 .jsonl.bak）拒绝 + CI 植入式负向回归；validate 本地/公开口径已在 1.19.2 拆分关闭；df14e3 集中声明为本地私有历史（公开仓库不可解析）；orphan/force-push 对象残余披露（只保证 main 可达历史）；1.19.3 待发布
2026-11-02 19:05 | audit | 修正上条转义：`bdf14e3` 为本地私有历史（公开仓库不可解析）；第十二轮四条小缝 = access* 任意后缀闸门 + CI 植入式负向回归、validate 口径已在 1.19.2 关闭、本地历史声明、orphan 对象残余披露；1.19.3 待发布
