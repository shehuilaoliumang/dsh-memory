# Changelog

## 1.9.0 — 2026-10-29

- Phase 0：信任与止血。索引原子写/坏行容错、删除闸 TTY-only、元关键词冻结、HTTP 同源与 JSON 写入口、CI 双环境冒烟、公开快照脱敏。
- Phase 1：当前真相模型。原子可选 `subject`/`supersedes`、`superseded` 终态、pending 取代边（确认 active 才退旧条）、`consolidate` 真相报告、7 篇存量原子补 subject。
- Phase 2：裁判评估回路。100 条黄金集、`eval-judge.mjs`、真实模型 precision 1.000/recall 0.522、反馈标签、prompt 版本、熔断与队列降级。
- Phase 3：检索与边界。`kb search` BM25 + 中文 bigram、注入衰减热度排序、`<untrusted-memory>` 边界、CSRF token、raw/judge 脱敏、四类威胁模型。
- Phase 4：减债。`append-session --json`、共享 frontmatter parser、工作页节名常量、空目录 scope 回落 `unclassified`、同分钟会话 id 去重、access 轮转、judge 配置 mtime 缓存、`kb init`/`kb version`、公开快照更新脚本。

公开快照默认不含 `10_Raw/`。未决事项见 `PROJECT_PLAN.md` 与 `20_Digest/work/2026-10-29-w-0001.md`。
