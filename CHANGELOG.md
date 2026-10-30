# Changelog

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
