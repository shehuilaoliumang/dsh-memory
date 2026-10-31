# Changelog

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
