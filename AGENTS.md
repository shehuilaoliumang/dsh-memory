# 知识库协议（所有 AI agent 必读）

这个 Vault 是**永久知识库**。进入前先读这页；完整规范在 `_meta/schema.md`，中文显示名在 `_meta/labels.yaml`。

## 分工

- `10_Raw/` 原文层：对话原文、剪藏。**只增、不改、不删、不移**。
- `20_Digest/` 摘要层：原子记忆（一条一文件）+ 主题页 + 工作页（`work/`，项目状态，不注入）。
- `30_Canon/` 结论层：方法论、决策记录、`core.md`（核心记忆）。
- `_meta/` 元层：索引与日志。**默认只读 `catalog.jsonl`，不读正文**。

## 三条硬规则

1. **不搬家**：文件出生在哪层就永远待在。晋升 = 在更高层新建一篇并用 `up:` 指回低层，低层改 `status: promoted`。
2. **不删除**：只降权、只归档，永不删。**唯一例外**：用户明确要求物理删除时，必须走两道闸——`kb.mjs delete-request --ids …` 生成一次性票据与随机密钥（密钥只显示一次、不落盘明文），再由人把密钥原样输入 `kb.mjs delete --ticket T --key K`，校验票据、哈希与 10 分钟有效期后才执行。删除会自动清理指向被删条目的悬空链接，并记入 `_meta/log.md`。**未拿到人输入的密钥，任何 agent 都不得删除。**
3. **索引是派生物**：`_meta/*.jsonl` 可从笔记重建，禁止手改；冲突时以笔记为准。

## 写

- 每轮对话原文由 `@local/kb-panel` 触发器在 `turn/end` **自动追加**，模型不需要手动 `append-session`（手动仅作兜底）。
- 抽取由静默窗口触发，语义裁判（deepseek-flash 直调）判定后经 `kb.mjs add-atom` 写入 `20_Digest/atoms/`。
- **裁判写入默认 `status: inbox`，不会进入对话**；必须显式确认（`set-status --status active`）才可能被注入。
- 原子应带 `scope`：`global`（跨项目适用）/ `project:<slug>` / `system`（知识库自身建设）/ `unclassified`（判不准）；**缺失 scope = 永不注入（fail closed）**，手工“取消范围”会产生这种条目。
- **工作页**（`type: work`，一个 scope 一页，`validate` 强制唯一 active）只写项目状态（阶段/在办/未决/下一步）；操作指令只进原文层，不进工作页。新建用 `kb.mjs work-new`，正文由人确认后覆写；归档用「归档 / 恢复为活跃」。
- 参数与五步管线见 `_meta/schema.md#写入管线`。

## 读

1. `grep` `_meta/catalog.jsonl` 找候选（一行一篇），**不要递归扫目录**。
2. 命中后只读 3–5 篇正文，先看 `summary` 和「要点」。
3. `status: archived` 默认不读；翻旧账查 `_meta/catalog.archive.jsonl`。
4. **自动注入的只有**：`30_Canon/core.md` + `status=active` 且 `scope ∈ {global, 本会话选定的 project}` 且 `type ∉ {topic, work, session}` 的摘要（最多 5 条，按召回热度排序）。`inbox` / `system` / `unclassified` 一律不进上下文——这是代码强制的，不是提示词约定。
5. **项目范围**：显式选择优先；库外会话未选择时按工作目录名自动推断 `project:<dir-slug>`，vault 内会话恒为 `global`。
6. **工作页**（`20_Digest/work/`，`type: work`）不是记忆：它永不进那 5 条预算，只在新会话里贡献一条「项目简报」（summary + 下一步/未决各最多 3 项）。工作指令只留在原文层，被抽取门控与裁判明确排除。

## 工具

规则层在 `_meta/scripts/kb.mjs`（零依赖 Node，DSH 自带运行时）：

```powershell
node _meta/scripts/kb.mjs validate              # 改协议/索引后必跑
node _meta/scripts/kb.mjs rebuild               # 索引禁止手改，只能重建
node _meta/scripts/kb.mjs consolidate --json    # 每日整理：review/stale/未归主题/重复/热度
node _meta/scripts/kb.mjs add-atom --json-file F --json   # 唯一原子写入通道
node _meta/scripts/kb.mjs set-status --id ID --status S [--scope SC|--clear-scope]
node _meta/scripts/kb.mjs batch-status --ids A,B --status S [--scope SC]
node _meta/scripts/kb.mjs promote --id ID --to CANON_ID   # 加 up 回指并置 promoted，文件不动
node _meta/scripts/kb.mjs access --id ID --how inject|read|grep|manual   # 召回日志（热度来源）
node _meta/scripts/kb.mjs work-new --scope global|project:S   # 新建工作页（type: work，不注入）
node _meta/scripts/kb.mjs work-brief --scope global|project:S --json   # 恢复简报（新会话接上文）
```

规则层冒烟测试（把 vault 复制到临时目录跑全部命令，不碰真实库）：

```powershell
# smoke.ps1 存为 UTF-8 BOM；本机没有 pwsh 时用 powershell（5.1），执行策略可能需 Bypass
powershell -NoProfile -ExecutionPolicy Bypass -File _meta/scripts/smoke.ps1
# 若执行策略禁止 .ps1：
$env:KB_REPO = (Get-Location).Path; Invoke-Expression (Get-Content _meta/scripts/smoke.ps1 -Raw -Encoding UTF8)
```

## 界面插件

`@local/kb-panel`（源码 `_meta/plugin/kb-panel/`）：composer 记忆 chip、会话「⋯」菜单行、侧栏知识库页、侧栏「重新加载」按钮。

只读接口：`/kb/panel.json`（快照 + 会话模式/范围 + 热度）、`/kb/note.json?id=`、`/kb/ingest.json`（cursor/队列/裁判/整理/客户端版本）。
操作接口（POST）：`/kb/mode`（会话记忆开关）、`/kb/scope`（会话项目范围）、`/kb/extract`（立即抽窗口）、`/kb/judge`（排空裁判队列）、`/kb/judge/retry`、`/kb/consolidate`、`/kb/atom`（单条状态）、`/kb/atoms/batch`、`/kb/ui`（客户端版本自报）。

改源码后：`plugin_manager set_plugin` 在 `include:kb-panel` 上禁用→启用即可热加载（**profile 全局操作**，会瞬时撤掉所有会话的 core.md 注入，需排在空档）。

## 写权限

- **单写通道**：只有 DSH 写入。`10_Raw/`、`_meta/catalog*.jsonl`、`_meta/log.md` 由 `@local/kb-panel` 的入库触发器（`ingest.js`）与裁判（`judge.js`）经 `kb.mjs` 自动写入。
- `20_Digest/`、`30_Canon/` 由五步管线产出；人工修改也走 DSH。
- `_meta/state/`（运行时状态）与 `_meta/access.jsonl`（召回遥测）不进 git。
- Claudian / Workbuddian 默认只读，除非用户明确要求。

版本权威是 git（`memory/` 内仓库）：自动化写入靠 commit 才能撤销；Pickpen 只读，不写库。
