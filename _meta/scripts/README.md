# _meta/scripts

知识库规则层。零依赖，Node ≥ 20（DSH 自带运行时即可）。

## 命令

| 命令 | 作用 | 写什么 |
|---|---|---|
| `validate [--json]` | 校验 schema / id 唯一 / 链接可解析 / 索引与笔记一致 | 不写 |
| `rebuild [--dry-run]` | 从笔记重建 `catalog.jsonl` / `catalog.archive.jsonl` | 索引 |
| `stats [--json]` | 分层、状态、类型统计 | 不写 |
| `id-next --kind a\|t\|c\|w` | 生成下一个唯一 id | 不写 |
| `work-new --scope global\|project:S [--title T] [--json]` | 新建工作页（`type: work`，一个 scope 一页；已存在则返回原页） | 摘要层 |
| `work-brief --scope global\|project:S [--json]` | 生成一条「项目简报」供注入；工作页不是记忆，不占 5 条预算 | 不写 |
| `search --query Q [--limit N] [--json]` | 只读检索：BM25 + 中文 bigram，查 digest/canon，供按需回查 | 不写 |
| `append-session --slug S --title T [--role user\|assistant] [--text ...] [--json]` | 追加本轮原文；同 `session_id` 续写，否则新建；`--json` 返回 `{ok,created,action,role,file}`。日常由插件触发器自动调用 | 原文层 |
| `candidates [--file F\|--text ...] [--json]` | 门控 + 候选句提取，输出喂给裁判 | 不写 |
| `add-atom --json-file F [--json] [--dry-run]` | 按 schema 写入原子：分配 id、同 type+summary 去重（重复复用已有 id）、默认 `inbox`、重建索引；可选 `note` 写正文「## 备注」（默认裁判来源说明；显式提升写来源） | 摘要层 |
| `set-status --id ID --status S [--scope SC] [--clear-scope]` | 状态/范围迁移；`inbox→active` 即确认，`--clear-scope` 删除 scope 字段 | 摘要层 + 日志 |
| `batch-status --ids A,B --status S [--scope SC]` | 批量迁移：先整批校验再写，最后统一重建一次索引 | 摘要层 + 日志 |
| `promote --id ID --to CANON_ID` | 晋升：加 `up:` 回指并置 `promoted`，**文件不移动** | 摘要层 + 日志 |
| `access --id ID [--how inject\|read\|grep\|manual] [--score N]` | 追加召回记录；热度的唯一来源；文件超阈值自动轮转 | `access.jsonl`（遥测） |
| `version` | 打印根目录 `VERSION`（唯一版本号） | 不写 |
| `init [--slug S] [--title T]` | 幂等创建知识库目录骨架；带 `--slug` 时写 `project.json`（项目库另写自忽略 `.gitignore`），新库默认 `ingest.enabled=false` | 目录 + `project.json` + `.gitignore` |
| `attach [--registry F] [--write\|--read-only]` | 把当前根的项目库登记到用户级 `projects.json`；插件只加载已登记项目；`--write` 需真实 TTY | 用户 registry |
| `--root DIR` / `KB_ROOT` | 全局参数：所有命令对指定库根执行（必须写在子命令前） | 按子命令 |
| `delete-request --ids A,B [--json]` | 生成一次性删除票据与随机密钥（物理删除第一步，§8.1） | `_meta/state/`（票据） |
| `delete --ticket T --key K [--json]` | 凭票据 + 人输入的密钥删除，并清理悬空链接、记日志 | 笔记 + 索引 + 日志 |
| `consolidate [--json]` | 每日整理：review 到期 / stale 候选 / 未归主题 / 重复 summary / 热度 Top10 / 读过的待确认 / 工作页过期或缺失 | 不写 |
| `eval-judge --golden F --adapter predictions --predictions F [--fail-below 0.8]` | 裁判黄金集回归：precision/recall/F1/confusion；`fixture`/`replay`/`predictions`/`http` 四种适配器 | `_meta/state/`（报告） |
| `log --action X --note Y` | 追加 `_meta/log.md`，时间取系统时钟；文件缺失时自动创建（新项目库首次写入不再 ENOENT） | 日志 |

```powershell
node _meta/scripts/kb.mjs validate
node _meta/scripts/kb.mjs rebuild --dry-run
node _meta/scripts/kb.mjs init --root C:\path\to\project\.dsh-memory --slug my-app --title "My App"
node _meta/scripts/kb.mjs --root C:\path\to\project\.dsh-memory attach
node _meta/scripts/kb.mjs --root C:\path\to\project\.dsh-memory attach --write
```

## 多项目库

- 全局偏好库默认 `~/.dsh-memory/global`；项目库默认 `<project>/.dsh-memory/`（`project.json.slug` 决定注入 scope）。
- 项目库必须 `attach` 到用户级 `~/.dsh-memory/projects.json` 才被插件加载；克隆仓库自带的 `.dsh-memory/` 不自动信任。v1.16 起本机新工作区由宿主在首次会话时自动 `init` + `attach`（`writable:true`）并写自忽略 `.gitignore`；已有库仍需显式接入。v1.19 起自动授权可配置：插件配置 `provision.autoWritable`（默认 `true`；`false` 时只建只读库、等面板授权），自动授权在 registry 记 `autoGranted: true`（人工 `attach` 清除），收回用 `attach --read-only`；权限仍只看 `writable`。
- 稳定身份与迁移（v1.18，v1.19 双信号）：插件为 `project.json` 幂等补写 `store_id`、registry 行补 `storeId` 与 attach 时的目录创建时间 `folderBirthtimeMs`；只有「旧路径已消失 **且** 目录创建时间一致（容差 5s）」才按 `store_id` 自动把 registry 指向新路径（保留 writable/autoGranted）；复制/克隆（新创建时间或旧路径仍在）或旧行无 `folderBirthtimeMs` 时必须面板人工确认（确认后保留 writable、去 autoGranted）；显示名改名只改 `project.json.title`，不改 slug（c-1001；与历史 c-0015 的适用范围见该决策）。
- 默认只读注入；`attach --write` 在 registry 写 `writable:true` 并同步该库 `_meta/config.json` 的 ingest/judge，插件才会按会话 cwd 为该库建外部 ingestor/judge；`--read-only` 收回。`--write` 与 `delete` 要求真实 TTY，非交互拒绝，**没有环境变量旁路**。规则见 `_meta/schema.md` §17–§18、决策 `2026-10-30-c-0013` / `2026-10-31-c-0015` / `2026-10-31-c-0016`。
- 全局库只经记忆页「提升为全局」显式增长（v1.17）：Host 把单条已确认 digest 原子经 `add-atom --json-file` 写到全局库（`scope: global`、`active`），源库 `set-status --status promoted`；跨库链接不复制，备注写来源；全局库同 type+summary 命中 duplicate 时复用 id（c-0020）。

## 设计约束

- **只写派生物和原文追加**：不删除、不移动、不改已有正文；summary/tags 这类元数据修正需人工确认后单独提交。
- **时间取系统时钟**：`updated`、日志、会话文件名都由脚本生成，模型不参与。
- **索引禁止手改**：改笔记 → `rebuild`。`validate` 会指出索引与笔记不一致的每一行。
- **会话续写**：`append-session` 先按 `session_id` 找已有会话文件（frontmatter 字段），找不到才新建。
- **唯一的原子写入通道**：裁判只经 `add-atom` 落盘，id 分配/去重/schema/索引都在这一个地方，避免多处实现漂移。
- **工作页不是记忆**：`work-new` 只建骨架（`type: work`），正文由人确认后覆写；它不注入、不计入未归主题，`work-brief` 只读不写。
- **ingest 减债先看故障注入**：接管、role+seq 去重、自检、失败窗口恢复的测试映射见 `_meta/plugin/kb-panel/test/FAULT-INJECTION.md`；没有替代实现覆盖同等故障前不删代码。

## 冒烟测试

`smoke.ps1` 把 vault 复制到临时目录，跑一遍 validate / rebuild / id-next / add-atom（dry-run + 真实 + 去重）/ set-status / clear-scope / batch-status / promote / access / consolidate / 当前真相（supersedes 与反馈）/ 裁判黄金集回归 / work-new / work-brief / 工作页唯一性、状态守卫、归档恢复与批量预校验 / 只读检索 / 触发词误伤 / append-session 脱敏 / Phase 4 契约（JSON 输出、同分钟会话、version、init）/ Phase 5 多项目库（`--root init`、project.json、attach、registry、缺配置根报错）/ Phase 6 attach `--write`/`--read-only` 开关 / N5 同 subject 冲突 / TTY 无环境旁路，共 106 条断言（夹具自包含：副本内自建 canon `2026-01-01-c-9999` 与第二个原子，不依赖真实库存量笔记，记忆层重置后仍可完整回归），结束清理。**不触碰真实库。**

```powershell
# 文件是 UTF-8 BOM，PowerShell 5.1 与 pwsh 都能直接 -File；执行策略可能需 Bypass
powershell -NoProfile -ExecutionPolicy Bypass -File _meta/scripts/smoke.ps1
# 若执行策略禁止 .ps1（-Encoding UTF8 是 PS 5.1 必需）：
$env:KB_REPO = (Get-Location).Path; Invoke-Expression (Get-Content _meta/scripts/smoke.ps1 -Raw -Encoding UTF8)
```

用 PowerShell 而非 `node:test`：DSH 沙箱禁止 node 子进程用管道 stdio 再 spawn（EPERM），而 kb.mjs 是独立脚本、需要真实执行。

管理页（`@local/kb-panel` v1.19.1，客户端 c36，工作区选择器为自绘玻璃下拉并显示各库实际名称、下拉浮于内容卡之上、玻璃表面不透明度 92–96%；改名用自绘玻璃对话框；迁移卡片区分「已迁移」/「未确认副本」）在本机新工作区第一次开会话时自动创建并接入 `<cwd>/.dsh-memory`：Host 调 `kb.mjs init --slug`（含自忽略 `.dsh-memory/.gitignore`）后写用户级 registry 并默认允许记录；已有库与克隆仓库自带库仍需在记忆页显式创建/接入。目标只认 live 会话 cwd，legacy 根、任意路径一律拒绝；不自动扫描磁盘、不批量创建所有工作区。已确认原子详情另有「提升为全局」（`POST /kb/atom/to-global`，§17.10）：复制到 `~/.dsh-memory/global` 并把源条置 `promoted`，人工单条、不自动/不批量。project 与 legacy（知识库本体）的「改名」（`POST /kb/workspace/rename`）只改显示名（global 不可）；文件夹迁移时「重新定位到当前路径」（`POST /kb/workspace/relocate`）人工确认 registry（§17.11）。

## 发布

```powershell
# 1) 生成脱敏公开快照（排除 10_Raw/、_meta/state/、access*.jsonl、PROJECT_PLAN.md，重建索引）
node _meta/scripts/export-public.mjs --out D:\dsh-memory-public
# 2) 通过 GitHub REST API 发布该目录（blob/tree/commit/ref 更新，再检一次本地路径泄漏）
node _meta/scripts/publish-public.mjs --dir D:\dsh-memory-public [--repo owner/name]
# 3) 若公开历史已混入运行时文件，用干净树重开 main 历史（丢弃可达旧历史）
node _meta/scripts/publish-public.mjs --dir D:\dsh-memory-public --orphan
```

`export-public.mjs` 的排除名单与 `.gitignore` 同源：`access*.jsonl` 整个家族、`_meta/state/`、`10_Raw/`、`PROJECT_PLAN.md` 都不进公开快照；导出后还会断言这些文件不存在，发现即中止。`publish-public.mjs` 在发布前再跑一遍硬闸（同样拒绝上述文件），并支持 `--orphan`（等价 `--force`）用干净树新建无父提交、重置 `main` 历史——用于清除已泄漏的遥测文件；`--force` 也可单独用。

## 加载形状闸门

`node _meta/scripts/check-plugin-load.mjs`（零依赖；CI 第一步，在 validate 之前）：严格解析仓库内全部 JSON 配置并禁止 UTF-8 BOM（对应 1.14.0 的 BOM outage 类问题）；校验插件 manifest 的 `name`/`type`/`dsh.bundle.patch`/`dsh.client.platform`/`version`（与根 `VERSION` 一致），并确认 `exports`/`files` 指向的 14 个文件都存在；校验 bundle patch 无 BOM、形如 loader patch 列表且含 `@local/kb-panel`；对引擎与插件的 15 个 JS 跑 `node --check`。它是**静态加载形状检查**（不启动 DSH Host），保证“loader 会碰的东西都存在且能解析”；CI 在 `validate` 前先跑它，本地改插件/清单后也应先跑一次。

## 插件单测

插件的纯逻辑测试（不依赖 Host，直接跑）：

```powershell
node _meta/plugin/kb-panel/test/ingest.test.mjs
node _meta/plugin/kb-panel/test/judge.test.mjs
node _meta/plugin/kb-panel/test/transcript-chunks.test.mjs
node _meta/plugin/kb-panel/test/work-brief.test.mjs
node _meta/plugin/kb-panel/test/http-guard.test.mjs
node _meta/plugin/kb-panel/test/redact.test.mjs
node _meta/plugin/kb-panel/test/shared-frontmatter.test.mjs
node _meta/plugin/kb-panel/test/stores.test.mjs
node _meta/plugin/kb-panel/test/promote.test.mjs
# 共 144 条：ingest 34 / judge 30 / promote 5 / transcript 6 / work-brief 26 / http-guard 11 / redact 8 / shared-frontmatter 4 / stores 20
```

不要用 `node --test`：沙箱不允许它用管道 stdio 再 spawn 子进程。

## 已知限制

- frontmatter 解析只支持单行 `key: value` 与行内数组 `[a, b]`；不支持多行字符串、嵌套对象。
- 第 3 步裁判需要 LLM，脚本只产候选，不调用模型。第 1/2 步的触发与调度在 `@local/kb-panel`（`_meta/plugin/kb-panel/ingest.js`）：轮末 `turn/end` 自动 `append-session`，静默/兜底定时跑 `candidates`；裁判在 `judge.js` 里直调 `llm.stream`。
- `consolidate` 已接召回日志：stale 判定取「最后编辑」与「最后召回」较晚者，并输出 `hot` Top10 与 `readCandidates`（被读过 ≥2 次的 inbox 条目建议确认）。
