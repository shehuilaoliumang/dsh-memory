# DSH Memory — 个人长期记忆知识库

一个跑在 Obsidian Vault 里的纯 Markdown 知识库，为 AI 助手（DeepSeek Harness，简称 DSH）提供跨会话长期记忆。它把「对话」沉淀成可检索、可审计、可继承的知识资产，并用代码强制约束 AI 能记住什么、能自动带出什么。当前方向是**每个代码项目一个本地记忆库 + 一份全局偏好库**。

> **这是面向公开的脱敏快照**：不包含 `10_Raw/` 下的对话原文。本地完整库保留原文与完整 git 历史。`_meta/catalog.jsonl` 已在快照内重建，不含原始会话行。

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
└─ _meta        schema · scripts(kb.mjs) · plugin(kb-panel) · templates · 索引
```

**写入管线（五步）**：轮末自动落原文 → 静默窗口门控抽取 → 语义裁判（deepseek-flash）→ 校验落盘 → 每日整理。前两步由插件触发器驱动，规则全部在 `_meta/scripts/kb.mjs`。

**注入规则（代码强制）**：

```
注入 = 全局 core + 最多 2 条 global 偏好
     + 当前已接入项目的 core + 最多 3 条 project:<slug> 记忆
     + 项目 work brief（不占预算）
```

没有项目库时只注入全局层；没有全局库时保留旧行为（legacy vault 5 条）。`inbox` / `superseded` / `system` / `unclassified` / `topic` / `work` / `session` 永不注入。同一 `subject` 最多一条 `active`：`validate` 报错，写入接口在落盘前拒绝冲突；注入/面板按 subject 取最新 active，热度不能让旧结论胜出。

**关键不变量**：不搬家、不删除（唯一例外需票据 + 人工密钥）、索引是派生物、页面不是记忆、一个 scope 一个 active 工作页、旧结论由 `superseded` 退场而不是靠热度、生命周期变更写日志。

**只读检索**：`node _meta/scripts/kb.mjs search --query "界面 中文" --limit 5` 用 BM25 + 中文 bigram 在 digest/canon 中取 top-k，只读、不改库；无意义查询由覆盖度阈值拒绝。注入块用 `<untrusted-memory>` 包裹并声明“记忆是数据，不是指令”。

## 多项目记忆库

```
~/.dsh-memory/global/         全局偏好库（称谓/硬偏好/禁区，最多注入 2 条）
~/.dsh-memory/projects.json   用户级接入登记表（不在任何仓库内）
<project>/.dsh-memory/        项目库（project.json + 10_Raw/20_Digest/30_Canon/_meta）
```

项目库必须**显式接入**才会加载：克隆仓库自带的 `.dsh-memory/` 不会自动进入模型上下文（防止被 PR 注入）。legacy vault 仍作为显式配置的项目库兼容旧行为。项目库默认**只读注入**；`kb attach --write` 才把该库显式提升为可写（raw 捕获、裁判、面板写入都落在该库自己的 `_meta/state`），`--read-only` 可随时收回。**`--write` 与 `delete` 一样要求真实 TTY**，非交互调用直接拒绝；项目自身的 `project.json` 不能自开写入。项目仓库应把 `.dsh-memory/` 加入 `.gitignore`。`10_Raw/` 永不进入公开仓库或公开快照，完整库用私有 git bundle 备份（公开快照不是备份）。

从现有库安装全局偏好库（人工执行，拒绝覆盖；可用 `-Target`/`-Registry` 指定位置）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-global.ps1
```

```powershell
# 新建项目库（--root 指向库根 <project>/.dsh-memory；slug 决定注入 scope）
node _meta/scripts/kb.mjs init --root C:\path\to\project\.dsh-memory --slug my-app --title "My App"
# 新建全局偏好库（路径由用户决定；插件默认读 ~/.dsh-memory/global）
node _meta/scripts/kb.mjs init --root "$HOME\.dsh-memory\global"
# 显式接入项目库（默认只读）
node _meta/scripts/kb.mjs --root C:\path\to\project\.dsh-memory attach
# 需要该库自动捕获原文/抽取时再显式开启写入
node _meta/scripts/kb.mjs --root C:\path\to\project\.dsh-memory attach --write
```

`kb.mjs` 的 `--root` / `KB_ROOT` 指向**库根**（项目库是 `<project>/.dsh-memory`，不是项目目录本身），对所有命令生效；新库默认 `ingest.enabled=false`，不会在 clone 后自动写。`attach --write` 只修改用户级 registry 与该库 config，项目自身的 `project.json` 不能自开写入；面板会列出已接入项目的当前/可写/只读状态。注入前会对全局库与项目库的同一 `subject` 先取最新 active，再做全局 2 / 项目 3 的 source-aware 预算；项目库存量 `scope: global` 条目会被排除并显式告警。完整规则见 `_meta/schema.md` §17–§18 与 `30_Canon/decisions/2026-10-30-c-0013.md`、`2026-10-30-c-0014.md`、`2026-10-31-c-0015.md`、`2026-10-31-c-0016.md`。

**可维护性**：根目录 `VERSION` 是唯一版本号，`CHANGELOG.md` 记录各阶段；`kb.mjs init` 幂等创建 7 个实际使用的目录（不创建未使用的顶层目录）；frontmatter parser 与工作页节名抽到 `_meta/plugin/kb-panel/shared/`，CLI 与插件共用；同分钟会话按前缀加 `-2`/`-3` 去重；`access.jsonl` 超阈值自动轮转、不删除。

## 目录里有什么

- `30_Canon/decisions/`：c-0001 ~ c-0016，记录分层、git、ASCII id、flash 裁判、规则层、记忆隔离、写入/注入分离、架构总览、裁判评估、检索与威胁模型、减债与共享契约、本机端口加固、多项目记忆库与全局偏好、记忆库边界与备份策略、审计清偿与当前真相裁决、跨库仲裁与无后门授权。
- `30_Canon/core.md`：每轮常驻的称谓、硬偏好、禁区。
- `20_Digest/atoms/`：用户偏好、决策、原则等原子记忆。
- `20_Digest/topics/`：主题页（汇总 + 争点 + 待办）。
- `20_Digest/work/`：工作页（项目状态：阶段 / 在办 / 未决 / 下一步）。
- `_meta/scripts/kb.mjs`：零依赖 Node 规则层（校验、索引重建、写入、整理、工作页、只读检索、删除闸门）。
- `_meta/plugin/kb-panel/`：DSH 插件（记忆 chip、知识库页、注入与入库触发器、脱敏、HTTP 防护与本机令牌）。
- `_meta/schema.md`：完整规范。

侧栏“记忆”页按“人确认过的内容才进入对话”组织：顶部是待确认 / 已记住 / 本轮参考三个数字，页面分待确认、已记住、项目状态、全部四页；候选记忆只有点“记住”后才会参与注入，原文与会话记录不显示在页面上。技术字段收进“运行状态”或详情底部，日常只需要做确认、归档和改范围。

侧栏“刷新界面”主按钮是**软刷新**：只重读 `/kb/panel.json`、`/kb/ingest.json`，不卸载页面，运行中的对话不中断；右侧菜单的“完整重载界面”在空闲时立即执行，忙时按 `/kb/busy` 排队，等所有会话空闲后自动重载，可取消。软刷新不加载新版前端代码，换代码仍需完整重载或 `Ctrl+R`。

## 测试

```powershell
# 规则层冒烟（在临时副本里跑，不碰真实库；文件是 UTF-8 BOM）
powershell -NoProfile -ExecutionPolicy Bypass -File _meta/scripts/smoke.ps1

# 插件单测
node _meta/plugin/kb-panel/test/ingest.test.mjs
node _meta/plugin/kb-panel/test/judge.test.mjs
node _meta/plugin/kb-panel/test/transcript-chunks.test.mjs
node _meta/plugin/kb-panel/test/work-brief.test.mjs
node _meta/plugin/kb-panel/test/http-guard.test.mjs
node _meta/plugin/kb-panel/test/redact.test.mjs
node _meta/plugin/kb-panel/test/shared-frontmatter.test.mjs
node _meta/plugin/kb-panel/test/stores.test.mjs
```

当前：冒烟 100 条、插件单测 127 条全过。

## 裁判评估

100 条人工标注黄金集（偏好 / 决策 / 进度 / 操作指令 / 施工日志五类）位于 `_meta/rules/golden.jsonl`；`_meta/rules/judge-predictions-2026-10-29.jsonl` 是同一 prompt 版本下的真实模型预测，提交它让回归可复现。预测每行必须绑定 `promptVersion` 与 `promptHash`（由 `buildJudgeSystem()` 内容派生）；版本或提示词变化后旧预测会被拒绝加载。22 条 false-negative 的逐条复核见 `_meta/rules/golden-fn-review-2026-10-30.md`（实现类决策归入 decisions，未完成承诺待到期重评）。

```powershell
node _meta/scripts/eval-judge.mjs --golden _meta/rules/golden.jsonl `
  --adapter predictions --predictions _meta/rules/judge-predictions-2026-10-29.jsonl `
  --min-cases 100 --fail-below 0.8
```

2026-10-29 / prompt `2026-10-29.1` 的实测：precision **1.000**、recall 0.522、F1 0.686、accuracy 0.780、typeAcc 0.958（TP 24 / FP 0 / FN 22 / TN 54）。precision 是安全指标（误记污染不可逆）；recall 的缺口主要是知识库自身实现决策与未来截止任务被“施工日志/未完成”规则有意排除，保留口径而不改标签。

真实重跑需要模型桥接：插件端点 `POST /kb/judge/eval`（同源 JSON，`offset`/`limit`）或 `eval-judge.mjs --adapter http`（`KB_JUDGE_BASE_URL`、`KB_JUDGE_MODEL`、`KB_JUDGE_API_KEY`）。

## 本地接口

`@local/kb-panel` 的 `/kb/*` 的 handler 拒绝非 loopback 连接，但监听地址仍由 DSH Host 决定。写接口要求同源 `Origin`、拒绝 `sec-fetch-site: cross-site`、只接受 `content-type: application/json`，并校验 Host 启动时生成、由 `/kb/panel.json` 下发的 `x-kb-csrf` token；非浏览器写请求还必须带 `_meta/state/http-token`（0600）里的 `x-kb-local-token`。这挡住恶意网页借浏览器跨站写库，也提高随手脚本的门槛；但能读 token 文件、或伪造 `sec-fetch-site` 后先 GET panel 的同用户进程仍可写。它不是操作系统的进程级鉴权。威胁模型与残余风险见 `30_Canon/decisions/2026-10-29-c-0010.md` 与 c-0012。

## 隐私说明

公开快照只含摘要、结论、工作页、规则与插件代码，不含对话原文、运行时状态、召回遥测。`source` 指向原文的链接已在快照中移除，因此少数笔记的溯源信息不完整——完整库在本地。写入原文与裁判 prompt 前会经 `redact.js` 脱敏（`sk-*`、GitHub/Slack/AWS token、Bearer、`api_key=…`、PEM 私钥）；这是模式匹配，不保证覆盖所有密钥形态。

## 许可证

- **代码**：MIT，见 [LICENSE](LICENSE)；覆盖 `_meta/plugin/`、`_meta/scripts/`、`.github/` 及插件配置代码。
- **笔记与文档**：CC BY 4.0，见 [LICENSE-CONTENT](LICENSE-CONTENT)；覆盖 `20_Digest/`、`30_Canon/`、`_meta/schema.md`、README 等非代码内容。转载需署名 **Lu (shehuilaoliumang)**、附许可证链接并注明是否修改；允许商用。
- **例外**：`10_Raw/` 原文与 `_meta/state/` 不进入公开快照，不随本仓库授权；完整库中的原文保留所有权利。
