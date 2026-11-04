# Changelog

> 编号说明：记忆层已于 2026-11-02 重置。本文件 1.18.x 及更早版本提到的 `2026-10-xx-c-00xx` 决策编号是历史记录，指向已随重置删除的笔记（仅存 git `bdf14e3`；**该哈希是本地私有仓库历史，公开仓库不可解析**）；重置后的新决策编号从 `c-1001` 起（1.19.0 曾用 `c-0001`，1.19.1 起改为 `c-1001`，避免「同号不同事」）。

## 3.0.0 — 2026-11-04

结构周期（major：内部架构重构，无用户可见功能删除；写入授权/注入预算/fail-closed 边界不变；对应第 16 轮外审结构项与 ADR `30_Canon/decisions/2026-11-04-c-1007.md`）。

**统一读面（engine read model）**

- `_meta/engine/lib/injection.mjs`：注入排序规则从插件归位到引擎（曝光加权热度、探索槽、relevance、scope policy、`reduceInjection` 预算），插件只留薄适配。
- `_meta/engine/lib/read-model.mjs`：`createSurface()` 统一候选/选择/解释/检索/全库快照；`selectInjection` 返回跨库候选，`notesWithInjection` 的解释与选择同源；`search({workspace:'all'})` 在引擎内单进程合并，不再逐库 spawn CLI。
- 插件 snapshot、注入解释、`/kb/search.json` 全部改走 `createSurface`；`/kb/panel.json?workspace=all` 由服务端一次返回合并快照，客户端 c45 优先单次读取，保留旧合并路径回退。`_meta/config.json` 新增 `surface.unified`（默认 true），false 回退 2.x 行为。
- 效果：多入口导致的解释/选择漂移类缺陷在结构上收口；5 库 × 300 条全库检索走进程内路径。

**宿主契约与 MCP 第二宿主**

- `_meta/engine/lib/host.mjs`：`createHost()` 提供 context/search/remember/status/validate 五个宿主动作；无 DSH import，写权限仍由 `resolveWriteTarget` fail closed。
- `_meta/engine/hosts/mcp.mjs`：零依赖 JSON-RPC 2.0 over stdio 宿主，暴露 `kb_context`/`kb_search`/`kb_remember`/`kb_status`/`kb_validate`；工具只回 JSON-RPC，诊断走 stderr；`kb_validate` 只接受已关注库根。
- 证明：`host.test.mjs` 6/6；真实 stdio 冒烟（initialize/tools/list/kb_status，6 库计数）通过。DSH 插件从此只是宿主适配层之一。

**闸门与验证**

- 新增 `_meta/engine/test/compare-parity.mjs`（对 2.4.1 基线做行为 parity；当前 3 条内容漂移、0 回归）与 `bench-read-model.mjs`（5 库 × 300 条：全库检索中位 ~407ms < 500ms、统一面板快照 ~139ms < 300ms、零 spawn），均进 CI。
- 数字：插件 187/187、引擎 read-model 6/6、host 6/6、脚本 17/17、smoke 106/106、`check-plugin-load` 7 JSON / 9 manifest / 18 engine / 2 locale / 34 JS；本地 `validate` 14 篇（core + raw + work + 4 atoms + 7 canon，主索引 12 + 归档 1）、0 警告。
- 公开快照：3.0.0 已发布（public commit `e141a6d`，tree `fa1dffa`，CI `41793193678` 全绿；快照 13 篇/主索引 11 + 归档 1、0 警告；首轮 `f0ebe1f`/`fdd3789` 因 CI Node 22 参数与 parity 需夹具回退已重发）。

## 2.4.1 — 2026-11-04

注入解释同源修复（patch：无新功能，选择/预算/写入边界不变；对应外部复审第 15 轮 B1/B2）。

- **B2 同源**：`/kb/panel.json` 的 `notes[].injection` 改为消费 `selectInjection` 使用的同一份 catalog-backed 跨库候选（`catalogInjectionNotes()`），不再另读磁盘 `scanNotes()`；手工改原子、尚未 `rebuild` 的窗口内，标签与真实注入仍一致。
- **B1 跨库仲裁**：`explainInjection` 新增 `candidates` 参数，同 subject 取代判断与 `currentTruthEntries` 的跨库仲裁同源；被其他库新结论取代的条目正确标为「同主题有更新」，不再误标「本轮未入选」。
- 回归：`work-brief.test.mjs` 36 条（新增「陈旧 catalog 下标签跟随选择快照」「跨库取代标签正确」），插件合计 187/187。
- 公开快照：2.4.1 已发布（public commit `e78be02`，tree `ce71803`，CI `41779872772` 全绿；快照 12 篇/主索引 10 + 归档 1、0 警告）。

## 2.4.0 — 2026-11-04

检索回退、注入可解释与多库统一视图（行为 minor：新增只读能力与解释层，写入授权/注入预算/fail-closed 不变）。

**全文检索回退：拼音 + 同义词**

- vendored tiny-pinyin 1.3.2 字典与算法到 `_meta/engine/lib/search/pinyin.mjs`（MIT，附 `PINYIN-NOTICE.md`；无运行时依赖，约 8 KB，6763 常用字）；ASCII 查询（如 `jiyi`）在字面 BM25 无结果时回退全拼/首字母匹配。
- 新增 `_meta/engine/lib/search/semantic.mjs`：21 组中英同义主题（发布/上线/deploy、删除/移除、检索/搜索、注入/上下文…），保守扩展（整词/≥2 字、单组 ≤4、总计 ≤10）。
- 排序规则：字面结果始终在前；回退结果只在字面结果不足 `min(limit,3)` 时补位，语义分 ×0.5，逐行标 `matchedBy`/`matchLabel`/`matchTerms`；响应带 `strategy:{pinyin,semantic}`，记忆页提示「拼音兜底/同义扩展」。回退只读，不写 access、不改注入。

**逐条注入原因（为什么没注入）**

- 新纯函数 `_meta/engine/lib/injection-reasons.mjs#explainInjection`：消费同一份注入 manifest、同一套 `isInjectable` 与预算，给每条笔记下发 `notes[].injection = {state,label,detail}`。
- 覆盖：其他库视图、已注入、本会话静音、status、canon/raw、topic/work/session、无 scope/项目隔离/范围不符、同 subject 有更新、预算已满、本轮未入选；只解释、不参与选择。
- 记忆页列表显示短标签，详情显示「标签：原因」；预算文案带「全局 G / 项目 P / 总计 5」。

**多库统一只读视图**

- 选择器在 >1 个工作区时提供「全部记忆库」：客户端并发拉取各库 `panel.json`，按 `uid = workspaceId::noteId` 合并；`view.kind='all'`、只读，隐藏记一条/整理/改名/接入；列表标来源库，详情标「来源：…」。
- 深度搜索支持 `workspace=all`：服务端遍历各库、每库仍走 engine + scan id 白名单，结果带 `workspace/workspaceLabel`，最多 20 条；不新增跨库写入接口，不改注入计数与写权限。
- 修正 legacy 的展示 id（`legacy`）与内部 slug（`dsh-memory`）不一致导致的选择/uid 漂移；客户端 build `2026-11-04-c44`。
- 修复：v2.2 库面合并后 `resolveStores()` 把 legacy policy 嵌套在 `entry.policy`，插件只认顶层 `scopeMode`，导致 vault 会话注入长期为空；现由 `isGlobalScopeStore()` 统一识别并加回归测试。

**未做（backlog）**

- embedding/向量检索；拼音多音字与词库扩展；同义词表自动学习；跨库写入/批量迁移；all 搜索并行化；DSH 适配层仍在插件。

- 数字：插件 185/185、脚本 17/17、smoke 106/106、`check-plugin-load` 6 JSON / 9 manifest / 14 engine / 2 locale / 25 JS；本地 `validate` 13 篇（core + raw + work + 4 atoms + 6 canon，主索引 11 + 归档 1）、0 警告；ADR `30_Canon/decisions/2026-11-04-c-1006.md`。
- 公开快照：2.4.0 已发布（public commit `26b6171`，tree `97ec543`，CI `41756688319` 全绿；快照 12 篇/主索引 10 + 归档 1、0 警告）。

## 2.3.0 — 2026-11-03

算法正确性与规模化：曝光降权、冷启动槽、access 缓存、catalog 驱动注入与字段化检索（行为 minor，默认安全边界不变）。

**热度自反馈修正（曝光降权）**

- `rankMemories`（engine）与插件 `inject-ranking.mjs` 按 access 行 `how` 加权：`inject` 曝光默认 **0.1**，`read`/`grep`/`manual` 全权重 1；`lastAt` 取最大时间，30 天半衰期不变。实测旧全局日志 99% 是 `inject`（257 次中 250 次），修正后曝光不再主导排序。

**exploration 槽（冷启动通道）**

- 排序后把「最新且从未曝光」的 note 移到**位置 2**（0 基 index 1，保留第一推荐）；每轮 1 个槽，**仅项目 store 使用**；不改变预算总数与安全过滤。

**access 热度聚合缓存**

- 插件按 `access.jsonl` 的 mtime+size 缓存解析结果（含 `how`），重复 prompt 不再全量重读/解析遥测。

**catalog 驱动注入（派生索引扩展）**

- `toRow` 增加 `title`/`scope`/`subject`（clamp 60/40/60 字符）；`fitRow` 在 300B 行预算内按 `summary → title → scope → subject` 缩短索引值，不动正文。
- 注入优先读 `_meta/catalog.jsonl`（mtime+size 缓存），缺失/损坏回退 `scanNotes`；`subject` 进入注入仲裁。**手工改原子后必须 `rebuild`**（与既有索引规则一致）。

**字段化 BM25 与深度搜索**

- engine BM25 文档改为 `title×3`、`summary×2`、`tags/scope/body×1`（替代原 `title×2`）。
- 新增只读 `GET /kb/search.json?workspace&q&limit`：调用 engine `search`，结果用本店 scan id 白名单过滤、**不记录 access**；记忆页新增「深度搜索」按钮与清除（客户端 c40，服务端 BM25 顺序展示，本地输入仍子串过滤）。

**未做（backlog）**

- embedding/向量检索（零依赖约束下不做）；`inject.rankMode` 默认切 `relevance`（仍默认 `heat`，待 A/B）；多库面真正合并为单库（2.2 仅 policy 表达）；DSH 适配层仍在插件。

- 数字：插件 174/174、脚本 17/17、smoke 106/106、`check-plugin-load` 6 JSON / 9 manifest / 11 engine / 2 locale / 22 JS；本地 `validate` 12 篇（core + raw + work + 4 atoms + 5 canon，主索引 10 + 归档 1）、0 警告；ADR `30_Canon/decisions/2026-11-03-c-1005.md`。
- 公开快照：2.2.0 已发布（public commit `02f4442`，tree `d49e58e`，CI `41563752460` 全绿）。

## 2.2.0 — 2026-11-03

记忆控制、相关性注入、整理动作与库面策略化（行为 minor：P2 剩余 + P3 进程内 API/多库面 policy 合并）。

**P2 每会话记忆控制（pin / mute）**

- 新增 `POST /kb/session/memory`：只认 live session、校验笔记 id、`pinned`/`muted` 互斥、支持取消；控制是 **ephemeral**（Host 内存态，重启即清），不改笔记 `status`/`scope`/正文。panel 快照新增 `session.memoryControls`，注入卡给固定标识；详情页可「本会话固定/排除」。引擎 `pickBySourceControls` + 3 单测。

**P2 相关性注入（带开关，默认关）**

- 插件纯模块 `memory-rank.mjs`（CJK bigram/ASCII token、覆盖率评分、相关性优先 + 热度兜底，7 单测）；仅经 `session/event` 捕获最近人类 user 消息（≤800 字、最多 100 会话、默认 30 分钟过期）。
- `_meta/config.json` 新增 `inject.rankMode: heat|relevance`（默认 `heat`，A/B 后再切）与 `relevanceMaxAgeMs`；prompt 与 panel `injection` manifest 共用同一排序。

**P2 整理动作与筛选**

- `/kb/consolidate` 返回明细（`stale`、`duplicateSummaries.items`、`readCandidates`、`work`），报告只读；记忆页「整理」对话框一键归档过期 / 归档重复旧副本 / 确认热候选，全部走 `/kb/atoms/batch`，无后台自动整理。引擎 `duplicateSummaries` 增加 `items`（id+updated，`ids` 保留）。
- 记忆页类型筛选 chips（含计数）+ 既有搜索；客户端 build `2026-11-03-c39`。

**P3 engine 进程内 API**

- `runCli(argv, { root })` 返回 `{ code, stdout, stderr }`、不污染宿主 `process.exitCode`/stdout；`createEngine({ root }).run(argv)` 为状态化门面；**同步、单线程、单根顺序**，禁止命令内重入。
- `bin/kb.mjs` 与 `_meta/scripts/kb.mjs` 退化为薄入口；`lib/index.mjs` 导出进程内 API 并补上 `stripFrontmatter`；`engine-api.test.mjs` 3 用例（命令、错误码不泄漏、一个 import 顺序服务两个根）。

**P3 多库面 policy 合并**

- `describeStore` 的注入行为改由 `policy` 表达：legacy = `{ scopeMode: 'global', injectLimit: 5, trustedBy: 'config' }`，project = `scopeMode: 'project'`；`kind` 仅作标识（legacy 是 UI/身份标签），registry 行携带 `policy`，`findProjectStore` 为 legacy 根合成 config 策略 entry，`writableProjectStore` 不再排除 legacy；`resolveContext`/`resolveWriteTarget` 输出 `role`/`trustedBy`；插件预算/过滤/简报/core 标签统一读 policy（`globalScopeStore` 兼容旧引擎缓存直到 Host 重启）。

**未做（backlog）**

- FEATURES §10 算法优化（热度自反馈 inject 降权、exploration 槽、access 热度聚合、字段化 BM25 等）与记忆页服务端 BM25 检索仍未做，转 2.3 评估；DSH 适配层仍在插件。

- 数字：插件 172/172、脚本 17/17、smoke 106/106、`check-plugin-load` 6 JSON / 9 manifest / 11 engine / 2 locale / 22 JS；本地 `validate` 11 篇（core + raw + work + 4 atoms + 4 canon，主索引 9 + 归档 1）、0 警告；ADR `30_Canon/decisions/2026-11-03-c-1004.md`。
- 公开快照：2.1.0 已发布（public commit `6fae504`，tree `e7bf960`，CI `41560776728` 全绿）。

## 2.1.0 — 2026-11-03

记忆启用、工程护栏与注入可解释（行为版本；P0/P1 完成，P2 部分完成，其余转 2.2）。

**P0 记忆启用**

- 新增 `POST /kb/remember`：记忆页「记一条」对话框 + 空态引导按钮；写入当前查看的可写库（复用 `workspaceWriteTarget`，最终写权限仍由 `context.resolveWriteTarget` 决定），默认 **inbox**、必须人工确认后才可能注入；legacy/global 视图 → `scope: global`，项目视图 → `project:<slug>`；正文 ≤4000 字，标题/summary 自动缺省，`tags: ['manual']`；不经过裁判、不绕过确认/注入闸门。
- 建立 legacy 全局工作页 `20_Digest/work/2026-11-03-w-0001.md`（简报指向 v2.1）与 3 个项目库工作页（插件制作 / 竞对商品筛取及数据匹配 / 友商招商加盟信息收集研究，占位待填）。
- 首批 3 条 inbox 原子待确认：项目全景入口 FEATURES.md、公开快照发布流程、记忆写入与删除边界（另有 1 条测试原子已 archived）。

**P1 工程护栏**

- 新增 `_meta/plugin/kb-panel/test/behavior-matrix.test.mjs` 9 用例（legacy / 项目可写 / 项目只读 / 未接入 / 改名双信号 / 复制确认 / 复制且旧路径已删 / 多轮路由序列 / `describeStore` 契约）。
- 导出安全规则抽为纯函数 `_meta/scripts/lib/export-rules.mjs` + `_meta/scripts/test/export-rules.test.mjs` 17 用例（旧/新导出 75 文件 SHA256 一致）；CI 新增「Script unit tests (export rules)」步骤。
- engine `stores.mjs` 增加跨进程 registry 锁 `withRegistryLock`（读-改-写串行化）+ 1 条回归；删除 6 个插件 shim（`stores`/`work-brief`/`redact`/`promote`/`shared/*`），插件改为**直接 import engine**。

**P2 注入可解释**

- `/kb/panel.json` 新增 `injection` manifest（`total`/`global`/`project`/`entries`：`id`/`summary`/`scope`/`store`），与 prompt 注入/计数共用同一 `selectInjection`；记忆页新增「本轮注入」折叠卡；客户端 build `2026-11-02-c37`。

**未做（转 2.2，FEATURES §9 标注）**：pin/exclude 每会话记忆控制、相关性注入（带开关）、consolidate 一键动作、多库面合并、engine 进程内 API。

- 数字：插件 159/159、脚本 17/17、smoke 106/106、`check-plugin-load` 6 JSON / 9 manifest / 11 engine / 2 locale / 21 JS；`validate` 本地 10 篇（core + raw + work + 4 atoms + 3 canon，主索引 8 + 归档 1）、0 警告；ADR `30_Canon/decisions/2026-11-03-c-1003.md`。
- 公开快照：2.1.0 随本次发布用干净快照重发（提交/CI 见 `main` 历史）。

## 2.0.0 — 2026-11-02

结构性 major：A 面收敛（单一上下文与写权限）与 B 引擎解耦（`@local/kb-engine`）；用户数据、CLI 命令与注入行为不变。

- **B：引擎解耦**：规则层从 DSH 插件抽出为宿主无关的 `_meta/engine/`（`@local/kb-engine`）：`bin/kb.mjs` → `lib/cli.mjs`（CLI 全量迁移），`lib/stores.mjs`/`work-brief`/`redact`/`promote`/`context`/`shared/*`/`index.mjs` + `package.json`/README；零 DSH import，root 由 `--root`/`KB_ROOT`/`KB_DEFAULT_ROOT` 决定；CLI 与模块导出双接口。
- **兼容包装/shim**：`_meta/scripts/kb.mjs` 变 20 行包装（默认 root = 本仓库 vault，转 engine CLI）；`_meta/plugin/kb-panel/{stores,work-brief,redact,promote}.js` 与 `shared/*.mjs` 变 re-export shim；依赖方向固定为 **engine ← plugin**。
- **A：上下文收敛**：`_meta/engine/lib/context.mjs` 成为唯一上下文/写权限决策：`describeStore()` 统一 global/legacy/project 同形描述（`root`/`kind`/`slug`/`scope`/`writable`），`resolveContext()` 返回 stores + scope + writeTarget，`resolveWriteTarget()` 单一写权限（可写 project 优先、其次 legacy、否则 `null` fail closed）；插件 mode/scope 路由、turn-end 写入路由、external ingestor 谓词、attach/relocate、workspaceState 全部改用它；删除插件本地的 `within` 复制与 `writableProjectStore` 重复判断。
- **行为不变量**：vault 内 5 条注入、外部项目 core+3+brief+global 2、写入路由、rename/relocate/promote/delete 语义不变；两个 ingestor 实例仍按 store 各建一个（实现细节），路由只由 context 决定。
- **路径变化（breaking，仅内部实现位置）**：旧实现路径变为包装/shim——`_meta/scripts/kb.mjs` 是兼容包装；插件 `stores.js`/`work-brief.js`/`redact.js`/`promote.js`/`shared/*.mjs` 是 engine 的 re-export shim。CLI 命令、`--json` 输出与用户数据不变；major 的原因是模块位置与依赖方向 breaking（外部按旧路径 import 会拿到 shim 而非实现）。
- **闸门/测试**：`check-plugin-load.mjs` 增加 engine 清单/版本/语法检查（当前 6 JSON / 14 manifest / 11 engine / 2 locale / 25 JS）；新增 `context.test.mjs` 5 条 → 单测 149/149；冒烟 106/106；`validate` 本地 4 篇/3 行（core.md + 自动捕获的 `10_Raw` 会话 + c-1001 + c-1002）、公开快照 3 篇/2 行、0 警告。
- ADR `30_Canon/decisions/2026-11-02-c-1002.md`《记忆模型 v2：单一上下文解析与引擎解耦》。

## 1.19.4 — 2026-11-02

第十三轮复审唯一理论缝关闭：短 session id 下限。**这是最后一个补丁版；程序性项全部关闭，下一步是结构性方向（架构面/可继承性）**，不再以 patch 线推进。

- **短 session id 缝**：`SESSION_ID_PATTERN` 与 forbidden 断言原要求 `session-` 后至少 8 位 hex，6–7 位短 id（如 `session-<redacted>`）会同时穿过清洗与断言。已把 export 的清洗正则与断言下限降到 `{6}`，CI 快照检查同步 `session-[0-9a-f]{6}`。
- **CI 植入式负向回归扩展**：除 `_meta/access-test.jsonl` 与 `.jsonl.bak` 外，再植入 `_meta/rules/session-test.md`（内容含短 id `session-<redacted>` 与长 id `session-<redacted>fd77e6`）；导出后断言该文件仍存在且内容不再含 `session-[0-9a-f]{6}`（即已被清洗），随后清理。
- **状态**：第十一至十三轮复审列出的四条小缝、自审类问题与这条理论缝均已关闭；程序性项完结，后续进入结构性方向（架构面/可继承性）。
- 版本 1.19.4；插件 144/144、冒烟 106/106、本地 `validate` 3 篇/2 行、公开快照 2 篇/1 行、0 警告。

## 1.19.3 — 2026-11-02

第十二轮复审小缝清偿（对 1.19.1 打出 74→76 的四条）：闸门后缀绑定、validate 口径、本地历史指针、orphan 对象残余。

- **access 家族闸门后缀宽容**（①）：`_meta/access.jsonl.bak` 曾可穿过 allow-list/forbidden。`export-public.mjs` 的 allow-list 与 forbidden、`publish-public.mjs` 的发布硬闸统一改为拒绝 `access*` 任意后缀（`/^_meta\/access[^/]*$/i`、`/(^|\/)access[^/]*$/i`）；CI 快照检查改 `-like 'access*'`，并在「Build sanitized public snapshot」加入**永久负向回归**：先植入 `_meta/access-test.jsonl` 与 `.jsonl.bak` → 导出后断言两者都不在快照 → 再清理。
- **validate 数字口径**（②）：1.19.2 已把 README 拆为「本地完整库 3 篇/2 行 / 公开快照（无 `10_Raw/`）2 篇/1 行（CI 在导出快照上复跑）」，本轮确认无残留、记为关闭。
- **`bdf14e3` 指针**（③）：公开文档里的 `bdf14e3` 是**本地私有仓库历史，公开仓库不可解析**；已在 README 公开快照说明、CHANGELOG 顶部编号说明、决策 c-1001「关联」集中声明，保留 id 不逐条展开。
- **orphan 对象存储残余**（④）：force-push/`--orphan` 只保证 `main` 可达历史不含泄漏文件；已泄漏提交的 GitHub 对象与既有 clone 不会因此消失（README 公开快照说明已披露）。
- 版本 1.19.3；插件 144/144、冒烟 106/106、本地 `validate` 3 篇/2 行、公开快照 2 篇/1 行、0 警告。

## 1.19.2 — 2026-11-02

公开可见卫生自审：修复公开快照里的运行时标识泄漏、数字口径与历史悬空引用（与第十一轮复审同类问题）。

- **公开 `_meta/log.md` 泄漏 session UUID 与原文文件名**：公开快照含约 30 处 `session-<uuid>` / `10_Raw/sessions/...`。`export-public.mjs` 增加 `stripRuntimeIds`（session UUID → `session-<redacted>`、裸 UUID → `<uuid>`、原文路径 → `10_Raw/sessions/<redacted>.md`）并在导出后断言；CI「Build sanitized public snapshot」步骤新增禁止文件检查（`access*`/`_meta/state/`/`10_Raw/`/`PROJECT_PLAN.md`）与 session id 泄漏检查。
- **数字口径**：README 原写公开快照 `validate` 3 篇/2 行，但公开仓库无 `10_Raw/`，实测 **2 篇/1 行**（core.md + c-1001）；已改为区分「本地完整库 3 篇/2 行 / 公开快照 2 篇/1 行（CI 在导出快照上跑同一 validate）」。
- **旧决策悬空引用**：README 移除指向已删除笔记的路径（原 c-0010/c-0012/c-0020 等），统一改为「历史决策编号，笔记已随 2026-11-02 重置删除，见 git `bdf14e3`」；CHANGELOG 1.19.0 条目补注「1.19.1 起文件名/id 改为 `2026-11-02-c-1001.md`」。
- **同一类泄漏的自审补充**（本轮自审额外发现）：测试 fixture 曾用真实 session 片段 → 改为合成 id（`session-<fixture>`，不含真实标识）；schema「历史勘误」段去掉两个真实原文文件名（改为“两篇早期原文（`10_Raw/sessions/…`，具体文件名不随公开快照分发）”）。
- 版本 1.19.2；插件 144/144、冒烟 106/106、本地 `validate` 3 篇/2 行、公开快照 2 篇/1 行、0 警告。

## 1.19.1 — 2026-11-02

导出卫生与编号避让：公开快照曾混入运行时遥测（第十一轮复审），本轮修复导出/发布两道闸并重开干净历史；重置后首条决策改用 c-1001。

- **遥测泄漏修复**：1.19.0 公开发布 `506279b` 中混入 `_meta/access-20261102-1552.jsonl`（220 行召回遥测）。根因是 `.gitignore` 已覆盖 `access-*.jsonl`，但 `export-public.mjs` 只排除精确 `_meta/access.jsonl`。现导出排除 `access*.jsonl` 整个家族（与 gitignore 同源），导出后若发现 `access*`/`_meta/state/`/`10_Raw/`/`00_Inbox/` 直接中止；`publish-public.mjs` 增加发布前硬闸（`access*`/`_meta/state/`/`10_Raw/`/`PROJECT_PLAN.md` 一律拒绝），并支持 `--orphan --force` 用干净树重开 main 历史（清除可达历史里的泄漏文件）。
- **决策编号避让**：重置后首条决策从 `2026-11-02-c-0001` 改名为 `2026-11-02-c-1001`（id 同步；正文补「与历史 c-0015『授权与破坏同权』的适用范围」）；重置前旧编号已停用，新系列从 c-1001 起。代码注释 3 处同步（`index.js`/`stores.js`/`client.js`）。
- **README 公开快照说明**：公开仓库只分发规则层/代码/文档与最小 canon（`core.md` + 新决策）；`10_Raw/`、`20_Digest/` 笔记层与重置前旧决策不随公开仓库分发，README 架构图描述的是本地完整库。
- **版本号纪律**：UI 补丁走 patch，只有行为变更才 minor（写入 README 可维护性段与 schema）。
- 版本 1.19.1（1.19.0 公开快照因遥测文件弃用，已用干净快照 `--orphan` 重发：public commit `2cd38f6`、tree `3d0953e`、CI `41426653086` 全绿；旧 `506279b`/`dc43eb2` 不在 main 可达历史）；插件 144/144、冒烟 106/106、`validate` 3 篇/2 行、0 警告。

## 1.19.0 — 2026-11-02

信任硬化：自动建库的授权边界与文件夹迁移的自动重绑定都收紧，并补上可审计、可收回路径；同时记下记忆层重置后的首条架构决策。

- 自动建库/自动记录授权：插件配置 `provision.autoWritable`（默认 `true`）。`false` 时自动建库只建**只读**库、等待面板点击授权；自动授权在用户级 registry 记 `autoGranted: true`（审计来源），人工显式 `attach` 会清除该标记；收回用 `kb.mjs --root <库> attach --read-only`（无需 TTY）或面板。
- 文件夹迁移改为**双信号**自动重定位：旧路径已不存在 **且** 工作区目录创建时间与 attach 时记录的 `folderBirthtimeMs` 一致（容差 5s）才自动。改名保留创建时间 → 自动，保留 `writable` 与 `autoGranted`；复制/克隆（新创建时间或旧路径仍在）→ 不自动，面板显示「检测到一个未确认的记忆库副本」，人工确认后重定位（保留 `writable`、去掉 `autoGranted`）。
- 旧 registry 行首次迁移一律人工确认（无 `folderBirthtimeMs` 时 fail safe）；插件启动 `syncRegistryStoreIds` 为仍存在的已接入库补写创建时间。
- 客户端 build `2026-11-02-c36`：迁移卡片区分「已迁移」与「未确认副本」两种文案/按钮。
- 新增决策 `30_Canon/decisions/2026-11-02-c-0001.md`「工作区记忆库的自动授权与迁移边界」（status canon、scope global；记忆层重置后的首条架构决策；1.19.1 起文件名/id 改为 `2026-11-02-c-1001.md`）。
- 新增 `_meta/scripts/publish-public.mjs`（GitHub REST API 发布路径，替代沙箱内不可用的本机 git HTTPS 凭据；读 export 产物、只做 blob/tree/commit/ref 更新并再检一次本地路径泄漏，需 `GH_TOKEN`）。
- 插件单测 144/144（stores 20，新增 `autoGranted`、`folderBirthtimeMs`、复制且旧路径消失需确认等）；冒烟 106/106（夹具自包含）；`validate` 3 篇/2 行/0 警告。
- 冒烟兼容全新检出：副本内先补建 `10_Raw/sessions`、`20_Digest/atoms|topics|work`、`30_Canon/decisions|principles`、`_meta/state` 空目录，公开快照/新克隆（git 不跟踪空目录）也能回归（公开仓库首次 CI 曾因缺 `20_Digest/atoms` 失败，修正后 106/106）。

## 1.18.5 — 2026-11-02

CI 硬化：关闭审计第 9 轮遗留的插件加载盲区，并补上「提升为全局」的失败回滚。

- 新增 `_meta/scripts/check-plugin-load.mjs`（零依赖）：严格解析仓库内全部 5 个 JSON 配置并禁止 UTF-8 BOM；校验插件 manifest（`name`/`type`/`dsh.bundle.patch`/`dsh.client.platform`/`version` 与根 `VERSION` 一致，`exports`/`files` 指向的 14 个文件都存在）；校验 bundle patch 无 BOM、是 loader patch 列表且含 `@local/kb-panel`；对 14 个引擎/插件 JS 跑 `node --check`。负向自测：临时放一个带 BOM 的 JSON → exit 1 并报出具体文件；移除后 exit 0。
- `.github/workflows/kb.yml` 在 setup-node 后、validate 前新增 step「Plugin package and bundle load check」，先过加载形状闸门再跑功能测试。
- 边界：这是**静态加载形状检查**（JSON 解析/BOM/文件存在/patch 形状/语法），不是真实 DSH Host 启动；CI 无法启动 Host，它保证的是“loader 会碰的东西都存在且能解析”。
- `POST /kb/atom/to-global` 失败回滚：全局副本写入成功、源条 `set-status promoted` 失败时，fail-closed 把**刚写入的非重复全局副本**置为 `archived`（duplicate 情况不回滚，避免改动既有全局条目），避免源条与全局条双活；随后把失败返回给调用方，可重试。
- 插件 143/143；`check-plugin-load` ok；记忆层重置后 `validate` 0 警告（主索引当前仅含 `core.md` 与自动捕获的 `10_Raw` 会话行）。冒烟 106/106 全过。
- smoke 夹具自包含化：`smoke.ps1` 不再依赖真实库存量笔记，在副本内自建 canon 夹具 `2026-01-01-c-9999` 与第二个原子，覆盖 promote / batch-status / delete / search 等用例；记忆层重置后仍可完整回归（断言数 102 → 106）。

## 1.18.4 — 2026-11-02

修复：Electron 不支持 `window.prompt`，导致「改名」看似无反应。

- 原因：Electron 未实现 `window.prompt()`，点击「改名」返回 null，页面没有任何变化。
- 修复：记忆页改为自绘玻璃命名对话框（遮罩 `z-index: 200`、卡片 96/94% 不透明度、20px 圆角、`blur 28px`；输入框预填当前 title，Enter 保存 / Escape 或点遮罩取消，空名提示）；保存仍走 `POST /kb/workspace/rename`，只改 `project.json.title`，成功后刷新面板并 toast「工作区名称已更新」。按钮显示条件不变（project/legacy 可写，global 不可）。
- 客户端 build `2026-11-02-c-35`；无后端/接口变更，插件 143/143、冒烟 102/102、validate 40 篇/37+2、0 警告不变。

## 1.18.3 — 2026-11-02

UI 调整：记忆页面板不透明度提升到 90% 以上。

- 所有半透明玻璃表面底统一提到 92–96%（状态条/头部统计/工作区触发钮/下拉菜单/搜索框/标签栏/列表卡/详情卡/设置卡片/只读提示等；卡片底 93%、菜单底 96/92），保留 `backdrop-filter` 模糊与内高光做玻璃质感；hover 项维持 90%。
- 起因：用户反馈原玻璃面透明度过高、内容可读性受影响。
- 客户端 build `2026-11-02-c34`；无逻辑/接口变更，插件 143/143、冒烟 102/102、validate 40 篇/37+2、0 警告不变。

## 1.18.2 — 2026-11-02

UI 修复：记忆页工作区下拉菜单被下方搜索/列表卡盖住（显示层级）。

- 根因：状态条与列表/详情卡都用了 `backdrop-filter`，各自形成层叠上下文，DOM 靠后的卡片压住状态条里的绝对定位菜单。
- 修复：`statusStrip` 增加 `position: relative` + `zIndex: 40`，把工作区下拉提到页面主体之上；`pickerTrigger` 加 `outline: none`，去掉展开时的原生 focus 灰框，只保留品牌色光晕。
- 客户端 build `2026-11-02-c33`；无逻辑/接口变更，插件 143/143、冒烟 102/102、validate 40 篇/37+2、0 警告不变。

## 1.18.1 — 2026-11-02

UI 补丁：记忆页工作区选择器玻璃化 + 旧工作区名称修正。

- 原生 `<select>` 换成自绘玻璃下拉 `WorkspacePicker`（客户端 build `2026-11-02-c32`）：胶囊触发钮（圆角 999、半透明、backdrop blur 26px、内高光）、玻璃菜单（18px 圆角、选项 12px 圆角、选中品牌色、hover 洗色、只读标记、✓）；点击外部或 Escape 关闭，带 `aria-haspopup/listbox/option`。
- 记忆页列表/详情卡片圆角 16→20px，状态条圆角 12→18px 并加强玻璃内高光。
- 旧工作区（legacy vault）名称不再硬编码“当前工作区（旧版）”，改为读 `project.json.title`（当前 “DSH Memory”）；`POST /kb/workspace/rename` 允许 legacy 改名（project 仍可），global 仍拒绝（400“全局记忆没有工作区名称”）；改名只写 `title`，slug / scope / `store_id` 不变。
- 无新增单测，插件仍 143/143；冒烟 102/102、validate 40 篇/37+2、0 警告。
- 决策 c-0021 追加「v1.18.1 调整」小节；schema v1.18.1、AGENTS、README、PROJECT_PLAN、work 页同步。

## 1.18.0 — 2026-11-02

工作区改名同步：显示名可改，文件夹改名后记忆库自动跟随；复制/克隆场景必须人工确认。

- 记忆页“正在查看”旁新增「改名」（仅 project 且可写）：`POST /kb/workspace/rename {workspace,title}` 只改 `project.json.title`（去换行、≤60 字），slug、`project:<slug>` scope、目录与索引都不变。
- `project.json` 新增稳定 `store_id`（`ensureStoreId` 幂等补写，`store-<12hex>`）；用户级 registry 行新增 `storeId`；插件启动时 `syncRegistryStoreIds` 为已接入库（含 legacy vault）补写，旧库无需手工迁移。
- 文件夹改名自动重定位：`agent/created`、`turn/end`、面板 snapshot 经 `ensureWorkspaceBinding` 检查 live cwd；旧路径已消失时自动把 registry 指向新路径（保留 `writable`，title 未自定义则跟随新文件夹名）。
- 复制/克隆导致旧路径仍在时不自动重定位：面板显示“检测到已迁移的记忆库”卡片，点「重新定位到当前路径」调 `POST /kb/workspace/relocate {session}`（只认 live cwd，不接受客户端路径）；迁移保留 slug 与写授权，删除旧路径行与同 `storeId` 的重复行。
- 安全边界不变：不扫描磁盘、不批量修复、未登记 clone 库仍需显式接入；legacy vault 仍由配置 `workspaceRoot` 绑定；改 slug 不在本版范围。
- 客户端 build `2026-11-02-c31`；Host 热重载后需刷新页面才见按钮。
- 决策 c-0021（subject `workspace-rename-sync`，related c-0019/c-0020/c-0014）；schema v1.18.0、AGENTS、README、PROJECT_PLAN、work 页同步；插件 143/143、冒烟 102/102、validate 40 篇/37+2、0 警告。

## 1.17.0 — 2026-11-02

全局记忆的显式提升：全局偏好库现在有一个受控的人工入口——在记忆页把单条已确认的项目原子「提升为全局」，跨项目共享；除此之外项目库不会自动写全局。

- 新增 `POST /kb/atom/to-global`：只接受**已确认的 digest 原子**（fact/preference/decision/opinion/question/task/definition/principle），把该条复制到 `~/.dsh-memory/global`（`scope: global`、`status: active`），源库条目 `set-status --status promoted`、不再注入；源库不可写、全局库缺失/只读、inbox/工作页/只读目标一律拒绝。
- 跨库链接（`source`/`related`/`up`/`supersedes`）不复制，避免全局库出现悬空链接；新全局原子的「## 备注」写来源：`由 <源 id>（<库名>）提升为全局记忆（<日期>）`。全局库已有同 type+summary 时复用已有 id（duplicate），源条仍置 `promoted`。
- 新增 `_meta/plugin/kb-panel/promote.js`（`isGlobalPromotable`/`extractPoints`/`globalAtomSpec`/`localDateStamp`）与 5 条单测；客户端 build `2026-11-02-c30` 在已确认原子详情显示「提升为全局」，热重载后需刷新页面。
- `kb.mjs add-atom` 支持可选 `note` 字段写入正文「## 备注」（默认仍为裁判来源说明）；`appendChangeLog` 在 `_meta/log.md` 缺失时自动创建，修复新项目库首次 `set-status` 的 ENOENT。
- 项目裁判仍 `allowGlobal=false`；全局库唯一增长通道就是这次人工点击，不自动、不批量。
- 决策 c-0020（subject `global-memory-promotion`，related c-0019/c-0014）；schema v1.17.0、AGENTS、README、PROJECT_PLAN、work 页同步；插件 138/138、冒烟 102/102、validate 39 篇/36+2、0 警告。

## 1.16.0 — 2026-11-02

工作区记忆库自动创建与自动记录：新项目工作区第一次开会话就自动拥有自己的记忆库并开始记录，不再依赖手动建库和点“允许记录”；已有库（含克隆仓库自带）仍必须显式接入。

- 宿主在 `agent/created`（插件加载前已存在的会话在下一次 `turn/end` 兜底）检查当前 live 会话 cwd：不在 legacy/全局库内、`<cwd>/.dsh-memory` 还没有库、且目录像项目（`.git`，或 `package.json`/`pyproject.toml`/`Cargo.toml`/`go.mod`/`AGENTS.md`/`pom.xml`/`composer.json`/`Gemfile` 等标记，或一级子目录带 `.git`/`package.json`）→ 自动 `kb.mjs init` 建库 → 写入用户级 registry（`writable: true`）→ 开启该库 `ingest`/`judge`。
- 已存在的库（包括克隆仓库自带的 `.dsh-memory/`）不自动接入、不改写授权；仍需用户在记忆页显式点击。clone 注入防线不变。
- `kb.mjs init` 新建项目库时写自忽略 `.dsh-memory/.gitignore`（忽略库内全部内容），防止 `10_Raw/` 被项目仓库误提交；项目仓库仍建议忽略 `.dsh-memory/`。
- 不后台扫描磁盘，只处理 live 会话 cwd；系统/临时/HOME 根目录与下载/桌面等临时位置不建库；管理页保留手动创建/接入卡片给已有库与仓库自带库。
- 存量三个工作区已按同规则补建并验证：`插件制作`（`p-6ed6171e`）、`竞对商品筛取及数据匹配`（`p-cb5c6b03`）、`友商招商加盟信息收集研究`（`p-26552439`）；registry `writable: true`、ingest/judge 开启、`.dsh-memory/.gitignore` 自忽略生效，面板 workspaces 已列出。原文捕获待下一次真实会话 `turn` 验证。
- 决策 c-0019（取代 c-0018）；schema v1.16.0、AGENTS、README、PROJECT_PLAN、work 页同步；插件 133/133、冒烟 102/102、validate 37 篇/34+2、0 警告。

## 1.15.0 — 2026-11-02

工作区独立记忆闭环：除了查看已接入的库，现在可以由管理页为当前会话所在的工作区创建或接入它自己的记忆库。

- 新增 `POST /kb/workspace/attach`：只使用当前 live 会话的 cwd，目标固定为 `<cwd>/.dsh-memory`；创建走宿主 `kb.mjs init`，随后写入用户级 registry。客户端不能传路径，legacy 根拒绝创建。
- 快照新增 `session.workspace`（legacy、storeRoot、hasStore、attached、writable、slug），记忆页在外部工作区未接入或只读时显示创建/接入卡片；创建默认只读，写权限必须由用户点击“允许记录”显式授予。
- registry 接入后立即同步目标库 `_meta/config.json` 的 `ingest.enabled`/`judge.enabled`，查看其他工作区仍只读且不启动 ingestor/judge。
- `listProjects()` 过滤 legacy/global 同根、非法或缺失 project.json 的条目，避免无效项目出现在工作区选择器。
- 客户端构建 `2026-10-31-c29`；插件 129/129、冒烟 102/102、validate 36 篇/33+2、0 警告。

## 1.14.1 — 2026-11-02

- 打包修复：`_meta/plugin/kb-panel/package.json` 去除误加的 UTF-8 BOM。1.14.0 的该文件以 `EF BB BF` 开头，DSH profile 启动时 `JSON.parse` 失败，插件被标记为 unaddressable/拒绝加载；去 BOM 后 JSON 可解析，`/kb/*` 恢复 200。
- 无功能变更；1.14.0 的多工作区隔离与审计 P1 修复不变。

## 1.14.0 — 2026-10-31

多工作区隔离查看 + 审计 P1 修复：管理页可以查看不同工作区的记忆，但当前会话的注入/抽取不受浏览目标影响。

- 新增 `resolveWorkspaceStore`：workspace 只接受 `global` / `legacy` / 已接入项目 slug；路径、未知 id、未登记 `.dsh-memory/` 一律拒绝。
- `/kb/panel.json`、`/kb/note.json` 接受 `workspace`；snapshot 返回 `view`（正在查看的库）与 `session`（当前会话），notes/counts/core/work 全部来自 `view`，不同库数据不混合。
- `/kb/atom`、`/kb/atoms/batch` 按目标 workspace 写入，写前校验 `writable`；只读项目返回 403。
- 记忆页顶部新增“正在查看”选择器；只读目标隐藏写操作并显示只读提示；切换工作区会重置选择/详情/搜索。
- 修复审计 P1-1：跨库同 id 先去重（保留较新副本）再按 subject 仲裁；候选先按 scope 过滤再排序；legacy 保持 5 条总预算（全局最多 2，项目补足），不会因全局库为空降到 3 条。
- 修复审计 P1-2：`init` 默认触发词 20 项、meta 关键词 10 项，与仓库 config/schema/samples 一致；smoke 新增默认值断言。
- 可访问性：tabs 使用 tablist/tab/aria-selected，搜索有 aria-label，toast 使用 role=status。
- 客户端构建 `2026-10-31-c28`；插件 129/129、冒烟 102/102、validate 35 篇/32+2、0 警告。
- 未做：进程级认证、跨库锁/队列（沿用 c-0015 的“不做 + 理由”）；浏览其他工作区不会为它启动 ingestor/judge。

## 1.13.0 — 2026-10-31

记忆交互改版 + 90+ 质量加固：侧栏“知识库”改为“记忆”，按“人确认过的内容才进入对话”组织；同时清偿第八轮复审的 N6/TTY/触发词问题。

- 页面从“笔记/索引/索引状态”改为四页签：待确认 / 已记住 / 项目状态 / 全部；默认打开待确认，没有待确认时自动落到已记住。
- 顶部只显示“待确认 N · 已记住 N · 本轮参考 N”；原文层与会话记录不再出现在记忆页。
- 列表卡片只显示标题、摘要、范围与状态；详情页按状态给主操作：候选记忆可“记住到本项目/所有项目”或“不需要”，已记住可改范围/归档，项目状态页可归档/恢复。
- 技术字段（id、文件、层、队列、build）收进“运行状态”或详情底部；会话栏改为“本会话会参考记忆”，项目栏只显示当前项目及只读/可写状态。
- composer chip 与会话菜单改为“记忆/本会话记忆”，弹层展示待确认、已记住、本轮参考与最近记住；弹层收窄为 380px，移除时间戳和核心记忆原文，只保留三项计数与最近 3 条。
- 主页面 c27：应用式两栏卡片、独立滚动的 Markdown 详情、运行状态折叠、空/错误状态与 toast；纯白底改为低饱和品牌渐变与半透明玻璃卡片，全部使用主题 token。
- N6 跨库仲裁：全局库与项目库候选先合并，按 subject 取最新 active，再做全局 2 / 项目 3 的 source-aware 预算；注入与 `injected` 计数共用 `selectInjection`，不再先单库截断再拼接。
- 删除 `KB_NONINTERACTIVE_TEST` 后门：`attach --write` 与 `delete` 只认真实 TTY；smoke 改为只验证拒绝，并断言旧环境变量不能放行。
- 非 legacy 项目库的 `scope: global` active 条目从注入中排除并显式告警；`trigger_words` 移除 `记`/`别`/`我的`/`我用` 等单字与泛代词。
- 客户端构建 `2026-10-30-c27`；插件 127/127、冒烟 100/100、validate 34 篇/31+2、0 警告。

## 1.12.0 — 2026-10-31

审计清偿版：冻结新功能，处理六轮复审的必改项。

- N5 当前真相：`validate` 拒绝同一 `subject` 的多条 `active`；`add-atom`/`set-status`/`batch-status` 写入前守卫，只允许显式 `supersedes` 退场旧条；`work-brief.mjs` 的 `currentTruthNotes` 让注入与面板计数统一按 subject 取最新 active。顺带修复裸 id `supersedes` 不退场的旧 bug。
- Redaction：补 URL 内嵌密码、中文键名/短值、手机号、18 位身份证；新增 raw 落盘端到端断言。
- 人闸：`attach --write` 与 `delete` 要求真实 TTY，非 TTY 拒绝；1.12.0 的测试用环境变量旁路已在 1.13.0 删除。
- H4：项目库裁判不允许产出 `scope: global`，降级 `unclassified`；注入层过滤只作防御，不再承担去重语义。
- H3：新增 registry 损坏不授权、未登记 nested 不劫持父库两类故障注入。
- 测试：插件 122/122、冒烟 98/98；schema v1.12.0。
- 审计回应：第六轮 69 分中的 N5 安全洞、redact 覆盖、TTY 不对称、H4 层次问题本轮清偿；进程级认证、跨库锁/队列仍明确不做，理由见 [[2026-10-31-c-0015]]。

## 1.11.1 — 2026-10-31

- 侧栏刷新改为两层语义：主按钮“刷新界面”是软刷新，只重读 `/kb/panel.json` / `/kb/ingest.json`，不卸载页面、不中断运行中的对话；右侧菜单“完整重载界面”空闲时立即执行，忙时按 `/kb/busy` 排队，全部会话空闲后自动重载，可随时取消。
- 软刷新同时作用于 composer 记忆 chip 与侧栏知识库页；客户端构建 `2026-10-29-c21`。旧版“两次点击 + 忙时阻止”不再使用。
- 说明：软刷新不加载新版前端代码；需要换代码仍要完整重载或 `Ctrl+R`。`Ctrl+R` 仍可绕过 busy 检查，本功能不改变浏览器原生行为。

## 1.11.0 — 2026-10-31

- 外部项目写入：`kb attach --write` 在用户级 registry 写 `writable: true`，并同步该库的 `_meta/config.json` 的 `ingest.enabled`/`judge.enabled`；`--read-only` 反向关闭。项目自身 `project.json` 不能自开写入，默认仍只读。
- 插件按会话 cwd 选择可写项目库，懒建外部 ingestor + judge；外部库命令统一经宿主 `kb.mjs --root <store>`，无需在项目里复制引擎；会话记忆开关 `off` 优先于 cwd，外部只读库不会把原文写进 legacy vault。
- 面板显示已接入项目、当前项目与读写状态（客户端 c20）；snapshot 增加 `globalRoot`/`registryFile`/`projects`。
- 测试：新增 `stores` 显式写授权、`ingest` 外部 `--root` 命令路由测试；插件 114 条、冒烟 90 条全过；私有 bundle 恢复演练通过。

## 1.10.1 — 2026-10-30

- 双库注入去重：legacy 项目库中的 `scope: global` 偏好不再与全局库重复注入；项目注入只保留项目本地 claim（验证现场从“全局 2 / 项目 2”变为“全局 2 / 项目 0”）。
- 全局/项目 core 拆分：全局 core 只保留跨项目称谓、硬偏好、禁区；项目 core 只保留知识库不变量，避免两次注入同一份内容。
- 迁移落地：用户级全局库 `~/.dsh-memory/global` 与 `projects.json` 已通过 `scripts/install-global.ps1` 安装；安装器、`project.json` 和多项目文档进入公开快照。

## 1.10.0 — 2026-10-30

- Phase 5 首轮：多项目记忆库。`kb.mjs` 支持 `--root`/`KB_ROOT`，新增 `init --slug/--title` 与 `attach`（用户级 `projects.json` 登记）；新增 `stores.js` 解析全局库与最近已接入项目库，插件改为双库合并注入（全局 core+2 偏好、项目 core+3 记忆、项目简报），未接入的 `.dsh-memory/` 不加载。新增 `stores.test.mjs` 6 条与 c-0013；插件 112/112。
- 首阶段外部项目库只读注入；raw 捕获、裁判、面板写入仍只服务 legacy vault。全局库/registry 由用户显式创建。

## 1.9.3 — 2026-10-29

- 本机端口加固（N4/S5）：`/kb/*` handler 拒绝非 loopback 连接；新增每次启动生成的 local token 写 `_meta/state/http-token`（0600），非浏览器写请求需 `x-kb-local-token`；浏览器仍用 CSRF token。
- 不盲删 ingest（N2）：新增 `_meta/plugin/kb-panel/test/FAULT-INJECTION.md`，把接管、role+seq 去重、自检、失败窗口恢复映射到故障注入测试；新增状态损坏接管测试。
- FN 复核（S4）：新增 `_meta/rules/golden-fn-review-2026-10-30.md`，逐条解释 22 条 false-negative，不改 judge prompt 与黄金标签。
- 测试：插件 106 条、冒烟 81 条；新增 [[2026-10-30-c-0012]] 决策记录。

## 1.9.2 — 2026-10-29

- 许可证拆分：代码采用 MIT（`LICENSE`），笔记与文档采用 CC BY 4.0（`LICENSE-CONTENT`）；`10_Raw/` 与 `_meta/state/` 不在公开快照、不随仓库授权。README 增加许可证边界说明。

## 1.9.1 — 2026-10-29

- 裁判评估门禁：`predictions` 每行必须带 `promptVersion` 与 `promptHash`；`promptHash` 由 `buildJudgeSystem()` 的 sha256 前 16 位派生，版本标签或提示词变化都会让旧预测在加载时失败。新增单测与冒烟负向断言。
- 文档去漂移：`CHANGELOG` 不再引用公开快照中不存在的 `PROJECT_PLAN.md`；移除 `kb init` 不创建的 `00_Inbox/`、`90_Archive/` 文档条目；README 目录树同步。
- 测试：插件 101 条、冒烟 81 条全过；黄金集回归仍为 precision 1.000 / recall 0.522。

## 1.9.0 — 2026-10-29

- Phase 0：信任与止血。索引原子写/坏行容错、删除闸 TTY-only、元关键词冻结、HTTP 同源与 JSON 写入口、CI 双环境冒烟、公开快照脱敏。
- Phase 1：当前真相模型。原子可选 `subject`/`supersedes`、`superseded` 终态、pending 取代边（确认 active 才退旧条）、`consolidate` 真相报告、7 篇存量原子补 subject。
- Phase 2：裁判评估回路。100 条黄金集、`eval-judge.mjs`、真实模型 precision 1.000/recall 0.522、反馈标签、prompt 版本、熔断与队列降级。
- Phase 3：检索与边界。`kb search` BM25 + 中文 bigram、注入衰减热度排序、`<untrusted-memory>` 边界、CSRF token、raw/judge 脱敏、四类威胁模型。
- Phase 4：减债。`append-session --json`、共享 frontmatter parser、工作页节名常量、空目录 scope 回落 `unclassified`、同分钟会话 id 去重、access 轮转、judge 配置 mtime 缓存、`kb init`/`kb version`、公开快照更新脚本。

公开快照默认不含 `10_Raw/`。未决事项见 `20_Digest/work/2026-10-29-w-0001.md`；`PROJECT_PLAN.md` 仅存在于本地仓库，不随公开快照导出。
