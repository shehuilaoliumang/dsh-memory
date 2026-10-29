---
title: 知识库规范 v1.5
status: canon
updated: 2026-10-29
---

# 知识库规范 v1.5

> 规范文档：agent 必须遵守，人按它维护。协议摘要见根目录 `AGENTS.md`，这里是完整版。

## 0. 一句话设计

**文件是真相，索引是派生物；目录管抽象层级，frontmatter 管生命周期；归档发生在索引层，不在文件层。**

> 工作区根 = `Obsidian Vault/memory`。本文所有路径都相对它；Obsidian 库根（`Obsidian Vault/`）只放你自己的项目和素材，知识库所有内容都收在 `memory/` 里。

## 1. 目录契约

| 路径 | 中文名 | 层级 | 可变性 | 说明 |
|---|---|---|---|---|
| `00_Inbox/` | 收件箱 | 入口 | 当天清空 | 未判断层级的临时存放，不长期放东西 |
| `10_Raw/sessions/` | 对话记录 | 原文 | 只追加 | `<年>/<月>/<YYYY-MM-DD>-<slug>.md`，一会话一文件，按年月分片 |
| `10_Raw/clippings/` | 剪藏 | 原文 | 只追加 | 网页、文档导入 |
| `20_Digest/atoms/` | 原子记忆 | 摘要 | 改状态不改正文 | 一条一文件 |
| `20_Digest/topics/` | 主题 | 摘要 | 可改 | MOC：汇总 + 争点 + 未决 |
| `20_Digest/work/` | 工作页 | 摘要 | 可覆写 | 项目状态页（`type: work`）：阶段/在办/未决/下一步；不注入，见 §13 |
| `30_Canon/principles/` | 方法论 | 结论 | 少改 | 稳定结论、可复用方法 |
| `30_Canon/decisions/` | 决策 | 结论 | 少改 | 一条决策一文件（含理由与放弃的替代方案） |
| `30_Canon/core.md` | 核心记忆 | 结论 | 手工 | 称谓/助手名/硬偏好/禁区，每轮常驻 |
| `90_Archive/` | 归档 | 出口 | 手工 | 默认不使用（归档在索引层，见 §8） |
| `_meta/` | 元数据 | 元层 | 脚本 | 索引、日志、映射、样例 |
| `_meta/scripts/` | 规则层 | 元层 | 可改 | 管线规则脚本（`kb.mjs`）与参数（`config.json`），见 §11 |
| `_meta/plugin/` | 界面层 | 元层 | 可改 | DSH 插件源码（`kb-panel`：记忆 chip + 面板 + 核心记忆注入），见 §12 |
| `_meta/templates/` | 模板 | 元层 | 可改 | 手工新建笔记的参考骨架（工作页等）；脚本 `work-new` 另有同一套节名，改任一处要同步 |

**硬规则：文件出生在哪层，就永远待在哪层。不做物理移动。**

## 2. 状态（frontmatter.status）

| 值 | 含义 | 进入条件 | 谁可以设 |
|---|---|---|---|
| `inbox` | 刚捕获未整理 | 自动 | 脚本 |
| `active` | 正常 | 默认 | 脚本 |
| `review` | 待复查 | `review_after` 到期 | 脚本 |
| `stale` | 长期未引用 | 逾期 180 天且未被召回 | 脚本 + 人确认 |
| `promoted` | 已向上层提炼 | 更高层新建了引用它的笔记 | 脚本 |
| `archived` | 归档 | stale 后 180 天未召回 + 人确认 | 人 |
| `canon` | 结论层定稿 | 晋升到 `30_Canon/` 或规范/核心记忆本身 | 人 |

迁移**只改字段，不搬文件**。

## 3. frontmatter 规范

### 必填

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | `YYYY-MM-DD-{a,t,c,w}-NNNN`，全库唯一 |
| `title` | string | 中文标题（给人看的可读名） |
| `level` | enum | `raw` / `digest` / `canon` |
| `type` | enum | 见下 |
| `scope` | enum / 可缺省 | `system` / `global` / `project:<slug>` / `unclassified`——决定能否自动注入；**缺失 = 永不注入（fail closed）**。可注入的记忆必须带；工作页/主题页另见 §13 |
| `status` | enum | 见 §2 |
| `summary` | string | ≤40 字，一行讲清，供 grep 与注入用 |
| `updated` | date | 最后修改日 |

### 可选

| 字段 | 说明 |
|---|---|
| `confidence` | 0–1，抽取置信度，冲突裁决时参考 |
| `source` | 数组，指回原文：`[""]` |
| `up` | 指向提炼后的上层笔记 |
| `related` | 相关笔记链接 |
| `supersedes` | 被本条取代的旧条目（纠正 / 推翻时用） |
| `tags` | 标签数组 |
| `valid_from` / `review_after` | 有效期与复查日 |

`type` 取值：`fact` 事实、`preference` 偏好、`decision` 决策、`opinion` 观点、`question` 未决问题、`task` 待办、`definition` 术语定义、`topic` 主题页、`work` 工作页、`principle` 原则、`session` 会话原文。

### 模板 · 原子记忆

```markdown
---
id: 2026-10-20-a-0009
title: 目录用英文路径，界面显示中文
level: digest
type: preference
scope: global
status: active
confidence: 0.9
summary: 用户选定英文路径 + 中文显示名方案
source: [""]
tags: [知识库, 显示]
valid_from: 2026-10-20
review_after: 2027-01-18
updated: 2026-10-20
---

## 要点

- 路径一律英文（跨 agent / git / CLI 更稳）
- 界面显示名走 `_meta/labels.yaml` 映射

## 原文

（引用 source 里的关键句）

## 备注

（可选：上下文、反例）
```

### 模板 · 主题页

```markdown
---
id: 2026-10-20-t-0001
title: 知识库分层方案
level: digest
type: topic
status: active
summary: 永久知识库的分层、归档与写入节奏
related: ["[[2026-10-20-a-0009]]"]
updated: 2026-10-20
---

## 结论

（一两句现状判断）

## 相关原子

（链接列表）

## 争点

（还没定的）

## 待办

- [ ]
```

### 模板 · 决策

```markdown
---
id: 2026-10-20-c-0001
title: 归档只在索引层做
level: canon
type: decision
status: canon
summary: 归档=把索引行移到 archive.jsonl，文件不动
updated: 2026-10-20
---

## 决策

## 理由

## 放弃的替代方案

## 复审条件
```

## 4. 命名与 ID

- `id`：`YYYY-MM-DD-{a|t|c|w}-NNNN`（a=atom，t=topic，c=canon，w=work），四位序号按天递增；入库前查 `catalog.jsonl` 保证唯一。
- 文件名 = `id` + `.md`，**全 ASCII**；中文标题放 `title` 字段。
- 例外：`30_Canon/core.md`、`_meta/` 下的规范与日志用固定名，不参与 id 编号（校验器需跳过）。
- 会话文件：`YYYY-MM-DD-HHmm-<ascii-slug>.md`。
- 理由：路径全 ASCII 避开 CLI 编码坑；可读性由 `title` 和界面映射补回来。

## 5. 写入管线（五步）

| 步 | 触发 | 做什么 | 归属 | 成本 |
|---|---|---|---|---|
| 1 | 每轮结束（插件监听 `session/event` 的 `turn/end`） | 原文追加到 `10_Raw/sessions/...` | 脚本 | 0 |
| 2 | 静默 300s / 1200s 兜底 / 20 轮兜底（插件调度） | 门控 + 候选提取 + 找邻居 | 规则 | 0 |
| 3 | 同上 | 语义裁判：定 `type`、值不值得记、合并、判冲突 | `judge.js` 直调 deepseek-flash | 1 次小调用 |
| 4 | 同上 | 校验落盘：schema、id 唯一、链接、去重、写日志 | 规则 | 0 |
| 5 | 每日 03:30 或 `/整理` | 合并、晋升提议、重建索引 | 规则 | 批量 |

### 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `extract_idle` | 300s | 静默这么久才抽取（最小可调单元 60s） |
| `extract_max_delay` | 1200s | 连续对话时最长多久必抽一次 |
| `extract_every_turns` | 20 | 或满 20 轮必抽，先到先触发 |
| `extract_meta_keywords` | 10 个元词 | 知识库自身建设窗口的识别词（`知识库`、`kb.mjs`、`_meta/`、`catalog`、`schema.md`、`插件`、`冒烟`、`工作页`、`原子`、`裁判`） |
| `extract_meta_threshold` | 2 | 窗口命中元词达到该数即冻结抽取，只保留原文，不写原子；改词表/阈值只改 `_meta/config.json` |
| `consolidate_daily` | 03:30 | 每日整理 |
| `auto_commit` | — | git 批量提交（未实现，参数未外置） |
| `catalog_max_rows` | 3000 | 超过则考虑归档 |
| `stale_days` | 180 | 未引用多久转 stale |
| `archive_days` | 180 | stale 后再多久转 archived |

> 以上参数已外置到 `_meta/config.json`：改参数不改脚本。

### 门控细则（第 2 步）

先判「这一轮有没有新信息」。以下情况直接跳过、不调 LLM：纯寒暄与确认（"好""嗯""收到"）、工具调用轮、命令输出粘贴、与上轮重复度 > 90%、只问不答。

触发词（命中任一才进候选）：记 / 记住 / 以后 / 不要 / 别 / 喜欢 / 讨厌 / 决定 / 改成 / 其实是 / 不对 / 每周 / 每月 / 截止 / 交付 / 我的 / 我用 / 所谓 / 定义为。

完整样例见 `_meta/rules/samples.md`（20 条：该抽 13 条，该跳 7 条）。

**元窗口冻结**：当待抽取窗口命中 `extract.meta_keywords` 达到 `meta_threshold` 时，第 2 步直接跳过并记录原因「知识库建设窗口」，不生成候选、不写裁判队列、不写原子。理由见 c-0006 / 2026-10-20-a-0016：知识库建设对话是施工日志，不是跨项目记忆；原文仍按第 1 步落入 `10_Raw/`，需要时人工回捞。

### 触发实现（v1.3）

第 1、2 步**不再依赖模型自觉**，由 `@local/kb-panel` 的宿主半边（`_meta/plugin/kb-panel/ingest.js`）驱动；插件只在会话工作目录位于 `memory/` 内时生效，判据与 core.md 注入共用同一个 `modeOf`。

| 步 | 触发点 | 行为 |
|---|---|---|
| 1 | `session/event` 中 `event.type === 'turn/end'`（post-commit 数据流，fire-and-forget） | 按 cursor 读 `session.snapshotEvents(fromSeq)`，取本轮全部 `user/message` + 最后一个有文本的 `assistant/message`，经 `kb.mjs append-session`（`--session-id`）落盘；推进并持久化 cursor；索引缺行或 `updated` 过期时跑 `kb.mjs rebuild`；写后自检用户块数 |
| 2 | 静默 / 兜底定时器（参数取 `_meta/config.json` 的 `extract.*`） | 待抽取窗口写进 `_meta/state/pending/<session>.md`；触发时跑 `kb.mjs candidates --file … --json`，门控通过则入裁判队列 |

- **状态**：`_meta/state/`（已 gitignore）——`ingest-state.json` 存 cursor 与计数器，`pending/` 存待抽取窗口，`judge-queue.jsonl` 是第 3 步队列；插件热重载后按状态重新计时并补抽逾期窗口。
- **cursor 是唯一权威**：已写范围只由 cursor 决定；文本比对只在「首次接管已存在的手写文件」时做一次，且按**结构块**（`## 用户`/`## 助手结论`，跳过 fenced code）做 role + 全文精确匹配，不再做任何子串匹配。引用、复述、代码块里的同文不会影响去重。
- **部分失败重试按身份**：写入前把成功 chunk 的 `role+seq` 记进 `written`；重试用它跳过已写块，不靠文本匹配，避免重复或丢块。
- **写后自检（不再静默）**：每批落盘后，按结构块统计 raw 中「接管后新增的 `## 用户` 块」vs 会话里 `seq >= trackFromSeq` 的真人消息数；缺失 → `lastError` + 日志；多出（手工/补录）→ `lastWarning`；结果在 `/kb/ingest.json` 的 `sessions[id].check` 暴露。
- **只收人类原文**：`user/message` 里 DSH 会混入 runtime-context、`<system-reminder>`、skill-catalog、goal 等系统注入，触发器只接受 `source.kind === 'user'`；未知 kind 一律**不写**，但会记入 `lastWarning` 做审计（白名单默认丢弃：漏记可暴露、可补录，污染不可逆）。
- **格式稳定**：助手正文行首 `##` 写入时降为 `###`（用户文本逐字保留）；标题在 30 字内回退到最近标点/空格边界并去尾空白（catalog 行 300B 硬约束）。
- **跳过**：不在 vault 内的会话、`origin: subagent` / `parentSession` / `delegationDepth > 0` 的子会话都不入库；没有人类输入的自动续跑轮整轮跳过。
- **第 3 步接口**：`judge.js` 直调 deepseek-flash，不经过子代理会话；`judge-queue.jsonl` 只用于重试与审计，一行一个 job：

```json
{"v":1,"kind":"extract-judge","id":"job-…","createdAt":"…","cause":"idle|max-delay|every-turns|catch-up|manual",
 "sessionId":"session-…","raw":"10_Raw/sessions/…md","gate":{"skip":false,"triggers":["决定"]},
 "candidates":[{"text":"…","triggers":["决定"]}],"neighbors":[],
 "judge":{"provider":"deepseek-account","model":"deepseek-flash"},"status":"pending"}
```

消费方（v2）按 `sessionId` 用 `ctx.agents.get(sessionId)` 取 live parent 起子代理（裁判没有 agent-less 形态），完成后写原子记忆并跑第 4 步 `validate`。`neighbors` 在 v1.3 恒为空数组——「找邻居」留给第 3 步实现。

- **去重与审计（v1.4）**：裁判先做字符相似度筛选，再**固定附带全部 canon 摘要**给模型比对——字符相似度对中文改写不敏感（真实重复对照实测 0.06），只靠相似度会漏。队列记录保留 `existing`（给模型看过的已有条目）与 `dropped`（被精确去重网丢弃的原子），事后可审计。去重只对照主索引（canon + active 摘要）；**已归档条目视为降权，允许被重新记录**（完全相同的 summary 仍由 `add-atom` 兜住）。

- **已知限制**：同一分钟内新建两个会话会撞 `id`（脚本按 `YYYY-MM-DD-HHmm` 生成）；写入发生在 `turn/end` 提交之后，但 `/kb/ingest.json` 只反映本进程看到的状态；cursor 状态目录被 clean 掉时从启动时刻重新开始（宁漏不重）；写后自检发现缺失只报错、不自动补写（补录需人工确认后追加）。
- **历史勘误**：v1.3 触发器首版（2026-10-20 首 10 分钟运行）曾把系统注入块当作人类输入，向 `2026-10-20-0110-kb-ui-scope.md` 与 `2026-10-20-0131-session-8f9b2dfd77e6.md` 写入共 18 处注入区块；按只增原则未删除，已在两篇文件尾部追加勘误说明，这些区块不参与抽取。

## 6. 读取与召回

| 场景 | 读什么 | 预算 |
|---|---|---|
| 日常对话 | `core.md` 全量 + grep catalog 命中 3–5 条 atom | ≤800 token |
| 深入讨论 | 上面 + topics 2 页 + canon 2 篇 | ≤2500 token |
| 翻旧账 | `catalog.archive.jsonl` 再 grep | 按需 |

顺序：`core.md` → catalog grep → 命中笔记的 `summary`/要点 → 必要时才读全文。**不要递归扫目录。**

### 6.1 记忆隔离（注入的硬规则）

自动注入**不是**「所有原子都进上下文」，而是由代码强制的三重合取：

```
注入 = core.md（全局硬约束）
     + level=digest 且 status=active 且 type ∉ {topic, work, session}
       且 scope ∈ {global, 本会话选定的 project:<slug>} 的条目（最多 5 条）
       排序：召回热度（access.jsonl 计数）优先，其次 updated，再次 id 序号
     + 工作页简报（§13，每节最多 3 项、单项 60 字、总长 ≤420 字，不占上面 5 条预算）
```

| 字段 | 允许注入 | 含义 |
|---|---|---|
| `scope: global` | ✅ | 跨项目通用的用户偏好、习惯、原则 |
| `scope: project:<slug>` | ✅（仅当本会话选中该 slug） | 绑在具体项目；`POST /kb/scope` 按会话选择，未选则完全不注入 |
| `scope: system` | ❌ | 知识库自身的建设/实现记录，属于施工日志 |
| `scope: unclassified` | ❌ | 裁判没判准，失败即关闭，等人确认 |
| 无 scope | ❌ | 视同 fail closed：不注入（UI 的「取消范围」会产生这种条目） |

| 字段 | 允许注入 | 含义 |
|---|---|---|
| `status: active` | ✅ | 已确认 |
| `status: inbox` | ❌ | 裁判刚写入、**未经确认**，默认值 |
| `status: review` | ❌ | 待人工复查（含过期待办） |
| 其他状态 | ❌ | 见 §2 |

**为什么这样设计**：`scope` 挡住「知识库建设日志污染对话」，`status` 挡住「裁判误判直接进上下文」。两者都是代码规则，不依赖模型是否听话。写入侧（裁判提示词）只负责分类，不做最终裁决。

**页面不是记忆**：`type: topic` / `type: work` 无论 `status` / `scope` 如何，都不会进入上面 5 条预算。工作页只贡献一条「项目简报」（§13），主题页只供人读。这样工作状态与长期记忆不争预算，也不会把知识库自身的施工细节混进对话。


**项目范围的来源**：显式选择（POST /kb/scope）优先；未显式选择时，**库外会话按其工作目录名自动推断** project:<dir-slug>（如 D:\my-app → project:my-app），vault 内会话恒为 global。这样在外部项目里显式启用记忆后，自动只带该项目与全局的记忆。

确认一条记忆 = `node _meta/scripts/kb.mjs set-status --id <id> --status active`（可在知识库页操作，或由第 5 步整理时批量提议）。

## 7. 索引格式

`_meta/catalog.jsonl`：一行一篇，单行 ≤300 字节（中文按 3 字节计；当前实测 253–300，接近上限时 `fitRow` 只缩短索引里的 summary，不动笔记正文），便于 grep。

```json
{"id":"2026-10-20-a-0009","path":"20_Digest/atoms/2026-10-20-a-0009.md","level":"digest","type":"preference","status":"active","tags":["知识库"],"summary":"英文路径+中文显示","updated":"2026-10-20"}
```

`_meta/access.jsonl`：召回日志，只追加，是热度的唯一来源。**由 Host 插件在两次真实召回时写入**：每次注入 `global/project` 条目（`how: inject`，10 分钟内同一会话同一篇不重复记），以及在知识库页打开一篇笔记（`how: read`）。它是遥测而非笔记，已被 `.gitignore` 排除；`consolidate` 用阅读它的热度：stale 判定同时看「最后召回时间」，并输出 `hot` Top 10。命令行可用 `kb.mjs access --id … --how …` 补记。

```json
{"t":"2026-10-20T23:52:11+08:00","id":"2026-10-20-a-0009","how":"grep","score":0.82,"provenance":"session:xxxx"}
```

`_meta/log.md`：人读，一行一变更。

```
2026-10-20 23:50 | scaffold | 初始化目录骨架与规范
```

## 8. 归档（在索引层，不动文件）

- `archived` 的条目从 `catalog.jsonl` **移到** `catalog.archive.jsonl`，笔记文件原地不动。
- 收益：grep 主索引天然不命中；双链不断；git 无 rename 记录。
- 复活：把行挪回主索引 + `status: active`。
- **重复合并归档**：整理时发现与 canon/已确认条目语义重复的条目，可经人确认直接置 `archived`（记 `log.md` 与原因），不必等 stale / 180 天——这是「降权」而非删除，仍可恢复。
- 触发指标：主索引 > 3000 行 / 单次 grep > 200ms / 注入结果里 archived 占比 > 5%。
- **默认永不删除**；确需物理删除时见 §8.1（唯一破例，需人输入随机密钥）。

## 8.1 物理删除（唯一破例）

默认「不删除」，物理删除是唯一例外，且必须由**人**完成确认：

```powershell
node _meta/scripts/kb.mjs delete-request --ids a-0010,a-0014 --json
# → 返回 ticket 与一次性 key（key 只输出一次，磁盘只存 sha256）
node _meta/scripts/kb.mjs delete --ticket <ticket> --key <key> --json
```

规则：

- 票据与密钥哈希写在 `_meta/state/delete-ticket.json`，**10 分钟过期、一次性**；密钥只存哈希，明文不落盘。
- `delete-request` 只在**交互终端**显示明文密钥：非 TTY 退出码非 0，`--json` 返回体也不含 key，避免 agent 从工具输出里直接拿到密钥。冒烟测试直接构造一次性票据文件来验证 `delete`，不经过 `delete-request`。
- 只允许删除 `10_Raw/`、`20_Digest/`、`30_Canon/` 下的笔记，其他路径一律拒绝。
- 删除后自动清理其余笔记里指向被删条目的 `related` 与正文链接，再重建索引，保证 `validate` 不红。
- 每次删除追加一行到 `_meta/log.md`，并记 `_meta/state/delete-log.jsonl`（含票据号与被清理的笔记数）。
- 文件仍在 git 历史中，可 `git checkout <commit> -- <path>` 找回。

**agent 约束**：`delete-request` 必须由用户在交互终端运行并把密钥原样输入 `delete`；agent 不得代跑 `delete-request`、不得从任何输出猜测/缓存密钥，也不得把密钥写进笔记或命令历史。若 agent 的终端不是 TTY，命令会直接拒绝。

## 9. 治理

- **单写通道**：只允许一个 agent（DSH）写，其它 agent 默认只读。DSH 的 Host 插件经 `kb.mjs` 代写 `10_Raw/`、`_meta/catalog*.jsonl`、`_meta/log.md`（当前 `@local/kb-panel`，迁移目标 `@local/kb-writer`）；插件不直接改笔记正文。
- **Pickpen 与 git 二选一**：已定 git 为唯一权威，Pickpen 只读（c-0002）。
- **索引禁止手改**：`catalog*.jsonl` 由脚本重建。
- **每周复查**：`status: review` 的条目要么修、要么降级。

## 10. 未决问题

1. ~~文件名是否改中文~~ → 已定：保持 ASCII id（c-0003）。
2. ~~是否 `git init`~~ → 已定：`memory/` 下 git init，git 权威（c-0002）。
3. ~~抽取用哪个轻量模型~~ → 已定：`deepseek-flash` 子代理（c-0004）。
4. 冲突裁决做成界面还是只写日志。
5. 第 5 步「晋升提议」的确认界面（v2）。
6. ~~核心记忆如何"真正注入"~~ → 已定：`@local/kb-panel` 插件用 `systemPrompt.context()` 注入（§12）。

## 12. 界面层插件（v1.2 新增）

| 项 | 内容 |
|---|---|
| 包名 | `@local/kb-panel`（本地目录安装，源码 `_meta/plugin/kb-panel/`） |
| Host | `systemPrompt.context()` 注入 `30_Canon/core.md` + 工作页简报（§13）；`GET /kb/panel.json` 提供派生快照；`GET /kb/ingest.json` 提供触发器状态（cursor/窗口/队列） |
| 触发器 | `ingest.js`：监听 `session/event` 的 `turn/end` → 第 1 步原文追加（复用 `modeOf` 判据，跳过子会话）；静默/兜底/轮数 → 第 2 步 `candidates` 调度；第 3 步由 `judge.js` 直调 deepseek-flash，队列只用于重试/审计 |
| Client | `conversation.composer.dock` 的 `kb-memory` 条目：折叠时显示篇数/索引数，展开显示分层、状态、最近更新、核心记忆摘要 |
| 数据 | 阅读：只读遍历三层目录 + 读索引行数。写入：只经 `kb.mjs`（append-session / rebuild / candidates / log），不直接改笔记与 `_meta/*.jsonl`；运行状态在 `_meta/state/`（gitignore） |
| 迭代 | 改源码后在插件管理器 `include:kb-panel` 上禁用→启用才能热加载；`plugin_manager install_bundle` 重装可能需重启 |
| 验证 | `cordis_inspect_query`（client `Slots.listSubTree` 找 `kb-memory`）+ `GET /kb/panel.json`、`GET /kb/ingest.json` 200；单测 `node _meta/plugin/kb-panel/test/{ingest,judge,work-brief,transcript-chunks,http-guard}.test.mjs`（共 82 条） |

已知限制：Client 文案目前是简体中文硬编码，未接 Client locale 服务；面板 UI 只读（自动写入在 Host 侧触发器，不在面板操作里）。触发器单测的临时目录用系统 temp（`os.tmpdir()`），不写 `_meta/state/`。

`/kb/*` 只监听本机 Harness 端口。所有路由经 `http-guard.js`：带 `Origin` 时必须与 `Host` 同源，`sec-fetch-site: cross-site` 一律拒绝，写端点只接受 `content-type: application/json`。这挡浏览器跨站请求，不等于操作系统进程级鉴权——同机其它进程仍可访问端口。

## 11. 规则层（v1.1 新增）

实现：`_meta/scripts/kb.mjs`（零依赖 Node ≥ 20）+ `_meta/config.json`（参数外置）。决策见 c-0005。

| 命令 | 管线步骤 | 说明 |
|---|---|---|
| `append-session` | 1 | 追加本轮原文；按 `session_id` 续写，找不到才新建。**日常由插件触发器自动调用**（见 §5 触发实现），手动调用只作兜底 |
| `candidates` | 2 | 门控 + 候选句提取，输出 JSON 喂给裁判 |
| `add-atom` | 3 | 按 schema 写入一条原子：分配 id、同 type+summary 去重、默认 `inbox`、重建索引。裁判只经此通道落盘 |
| `set-status` | — | 状态/范围迁移：`inbox→active` 即「确认」；`--clear-scope` 删除 scope 字段；变更记入 `_meta/log.md` |
| `promote` | 5 | 晋升：给低层笔记加 `up:` 回指并置 `promoted`，**文件不移动**；记日志 |
| `batch-status` | — | 批量状态/范围迁移：先整批校验再写，最后统一重建索引；记日志 |
| `access` | — | 追加一条召回记录（`inject` / `read` / `grep` / `manual`），热度的唯一入口 |
| `delete-request` | — | 生成一次性删除票据与随机密钥（物理删除第一步，§8.1） |
| `delete` | — | 凭票据 + 人输入的密钥物理删除，并清理悬空链接、记日志（§8.1） |
| `work-new` | — | 新建工作页（`type: work`，一个 scope 一页；已存在则不重复建） |
| `work-brief` | — | 生成一条「项目简报」供注入，不占记忆预算（§13） |
| `validate` | 4 | schema / id 唯一 / 链接可解析 / 索引一致性 |
| `rebuild` | 4 | 从笔记重建 `catalog*.jsonl`（索引禁止手改） |
| `consolidate` | 5 | review 到期、stale 候选（跳过工作页）、未归主题（跳过 archived/promoted/页面）、重复 summary |
| `stats` / `id-next` / `log` | — | 统计、id 生成、变更日志 |

验收（每次改协议或索引后必跑）：

```powershell
node _meta/scripts/kb.mjs validate
node _meta/scripts/kb.mjs rebuild --dry-run
```

已知限制：frontmatter 解析只支持单行 `key: value` 与行内数组；裁判需要 LLM，脚本只产候选；`consolidate` 的 stale 判定用 `updated` 与最近召回时间中较晚的一个（`access.jsonl` 已接召回）。第 1/2 步的触发在插件里（§5 触发实现），脚本本身不感知会话生命周期。

## 13. 工作层（工作页，v1.4 新增）

**定位**：工作页是「项目状态的活页面」，不是记忆、不是原文台账。它回答一个问题：*新会话打开这个项目时，做到哪、下一步是什么？*

| 项 | 约定 |
|---|---|
| 位置 | `20_Digest/work/`，文件 `YYYY-MM-DD-w-NNNN.md` |
| frontmatter | `type: work`、`level: digest`、`status: active`（结束用 `archived`）、`scope: global` 或 `project:<slug>`、`summary` ≤40 字 |
| 正文 | `## 当前阶段` / `## 在办` / `## 未决` / `## 下一步` / `## 关联` |
| 一个 scope 一页 | 同一 scope 只保留一篇 active 工作页；`validate` 强制，`work-new` 已存在时返回原页；恢复归档页时若已有别的 active 页会被拒绝 |
| 注入 | **永不进入 5 条记忆预算**；只贡献一条「项目简报」（summary + 下一步/未决各最多 3 项，单项截断 60 字，总长 ≤420 字） |
| 归档 | 项目结束把 `status` 设为 `archived`（文件保留、可恢复）；面板的「归档 / 恢复为活跃」走同一通道 |
| 写入 | 人工/agent 经确认后覆写正文；`consolidate` 只提示「过期 / 缺页」，不自动改正文；骨架节名以 `_meta/templates/work.md` 为准 |
| 不存什么 | 操作指令、过程日志、一次性任务细节——那些只留在原文层 |

**与原文层/原子层的边界**：

- 原文层是只增台账，保留全部指令与过程（可查、不注入）。
- 原子层是长期复用的结论（有 scope/status 双闸门，最多 5 条注入）。
- 工作层是当前项目的状态摘要（可覆写、不注入、只做简报）。

**恢复简报**：插件在 `systemPrompt.context()` 里按会话 scope 读取对应工作页，追加一条（每节最多 3 项、单项 60 字、总长 ≤420 字），例如：

```
【项目简报 · my-app】阶段摘要；下一步：修登录回归；未决：是否换 ORM
```

**整理提示**：`kb.mjs consolidate --json` 的 `work` 字段给出 `pages` / `stale`（超过 `limits.work_stale_days`，默认 14 天）/ `missing`（有 `project:<slug>` 记忆但没有工作页）。起草由人确认后写入，脚本不自动落盘。

**整理时怎么起草（agent 流程）**：`consolidate` 报 `stale`/`missing` → 读该 scope 最近 2–3 篇原文的结尾与相关原子 → 只改写「当前阶段 / 在办 / 未决 / 下一步」四节 → 人确认后覆写正文。**不要**把执行指令、命令输出、调试过程写进工作页（它们属于原文层）。

**验收**：

```powershell
node _meta/scripts/kb.mjs validate
node _meta/scripts/kb.mjs work-new --scope project:my-app --json
node _meta/scripts/kb.mjs work-brief --scope project:my-app --json
```
