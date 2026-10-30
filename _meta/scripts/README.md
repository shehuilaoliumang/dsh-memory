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
| `add-atom --json-file F [--json] [--dry-run]` | 按 schema 写入原子：分配 id、同 type+summary 去重、默认 `inbox`、重建索引 | 摘要层 |
| `set-status --id ID --status S [--scope SC] [--clear-scope]` | 状态/范围迁移；`inbox→active` 即确认，`--clear-scope` 删除 scope 字段 | 摘要层 + 日志 |
| `batch-status --ids A,B --status S [--scope SC]` | 批量迁移：先整批校验再写，最后统一重建一次索引 | 摘要层 + 日志 |
| `promote --id ID --to CANON_ID` | 晋升：加 `up:` 回指并置 `promoted`，**文件不移动** | 摘要层 + 日志 |
| `access --id ID [--how inject\|read\|grep\|manual] [--score N]` | 追加召回记录；热度的唯一来源；文件超阈值自动轮转 | `access.jsonl`（遥测） |
| `version` | 打印根目录 `VERSION`（唯一版本号） | 不写 |
| `init [--slug S] [--title T]` | 幂等创建知识库目录骨架；带 `--slug` 时写 `project.json`，新库默认 `ingest.enabled=false` | 目录 + `project.json` |
| `attach [--registry F]` | 把当前根的项目库登记到用户级 `projects.json`；插件只加载已登记项目 | 用户 registry |
| `--root DIR` / `KB_ROOT` | 全局参数：所有命令对指定库根执行（必须写在子命令前） | 按子命令 |
| `delete-request --ids A,B [--json]` | 生成一次性删除票据与随机密钥（物理删除第一步，§8.1） | `_meta/state/`（票据） |
| `delete --ticket T --key K [--json]` | 凭票据 + 人输入的密钥删除，并清理悬空链接、记日志 | 笔记 + 索引 + 日志 |
| `consolidate [--json]` | 每日整理：review 到期 / stale 候选 / 未归主题 / 重复 summary / 热度 Top10 / 读过的待确认 / 工作页过期或缺失 | 不写 |
| `eval-judge --golden F --adapter predictions --predictions F [--fail-below 0.8]` | 裁判黄金集回归：precision/recall/F1/confusion；`fixture`/`replay`/`predictions`/`http` 四种适配器 | `_meta/state/`（报告） |
| `log --action X --note Y` | 追加 `_meta/log.md`，时间取系统时钟 | 日志 |

```powershell
node _meta/scripts/kb.mjs validate
node _meta/scripts/kb.mjs rebuild --dry-run
node _meta/scripts/kb.mjs init --root C:\path\to\project\.dsh-memory --slug my-app --title "My App"
node _meta/scripts/kb.mjs --root C:\path\to\project\.dsh-memory attach
```

## 多项目库

- 全局偏好库默认 `~/.dsh-memory/global`；项目库默认 `<project>/.dsh-memory/`（`project.json.slug` 决定注入 scope）。
- 项目库必须 `attach` 到用户级 `~/.dsh-memory/projects.json` 才被插件加载；克隆仓库自带的 `.dsh-memory/` 不自动信任。
- 首阶段外部项目只读注入；raw 捕获、裁判、面板写入仍只服务 legacy vault。规则见 `_meta/schema.md` §17、决策 `2026-10-30-c-0013`。

## 设计约束

- **只写派生物和原文追加**：不删除、不移动、不改已有正文；summary/tags 这类元数据修正需人工确认后单独提交。
- **时间取系统时钟**：`updated`、日志、会话文件名都由脚本生成，模型不参与。
- **索引禁止手改**：改笔记 → `rebuild`。`validate` 会指出索引与笔记不一致的每一行。
- **会话续写**：`append-session` 先按 `session_id` 找已有会话文件（frontmatter 字段），找不到才新建。
- **唯一的原子写入通道**：裁判只经 `add-atom` 落盘，id 分配/去重/schema/索引都在这一个地方，避免多处实现漂移。
- **工作页不是记忆**：`work-new` 只建骨架（`type: work`），正文由人确认后覆写；它不注入、不计入未归主题，`work-brief` 只读不写。
- **ingest 减债先看故障注入**：接管、role+seq 去重、自检、失败窗口恢复的测试映射见 `_meta/plugin/kb-panel/test/FAULT-INJECTION.md`；没有替代实现覆盖同等故障前不删代码。

## 冒烟测试

`smoke.ps1` 把 vault 复制到临时目录，跑一遍 validate / rebuild / id-next / add-atom（dry-run + 真实 + 去重）/ set-status / clear-scope / batch-status / promote / access / consolidate / 当前真相（supersedes 与反馈）/ 裁判黄金集回归 / work-new / work-brief / 工作页唯一性、状态守卫、归档恢复与批量预校验 / 只读检索 / append-session 脱敏 / Phase 4 契约（JSON 输出、同分钟会话、version、init）/ Phase 5 多项目库（`--root init`、project.json、attach、registry、缺配置根报错），共 88 条断言，结束清理。**不触碰真实库。**

```powershell
# 文件是 UTF-8 BOM，PowerShell 5.1 与 pwsh 都能直接 -File；执行策略可能需 Bypass
powershell -NoProfile -ExecutionPolicy Bypass -File _meta/scripts/smoke.ps1
# 若执行策略禁止 .ps1（-Encoding UTF8 是 PS 5.1 必需）：
$env:KB_REPO = (Get-Location).Path; Invoke-Expression (Get-Content _meta/scripts/smoke.ps1 -Raw -Encoding UTF8)
```

用 PowerShell 而非 `node:test`：DSH 沙箱禁止 node 子进程用管道 stdio 再 spawn（EPERM），而 kb.mjs 是独立脚本、需要真实执行。

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
# 共 112 条：ingest 33 / judge 29 / transcript 6 / work-brief 18 / http-guard 11 / redact 5 / shared-frontmatter 4 / stores 6
```

不要用 `node --test`：沙箱不允许它用管道 stdio 再 spawn 子进程。

## 已知限制

- frontmatter 解析只支持单行 `key: value` 与行内数组 `[a, b]`；不支持多行字符串、嵌套对象。
- 第 3 步裁判需要 LLM，脚本只产候选，不调用模型。第 1/2 步的触发与调度在 `@local/kb-panel`（`_meta/plugin/kb-panel/ingest.js`）：轮末 `turn/end` 自动 `append-session`，静默/兜底定时跑 `candidates`；裁判在 `judge.js` 里直调 `llm.stream`。
- `consolidate` 已接召回日志：stale 判定取「最后编辑」与「最后召回」较晚者，并输出 `hot` Top10 与 `readCandidates`（被读过 ≥2 次的 inbox 条目建议确认）。
