# ingest 故障注入证据（N2 复审回应）

复审 N2 的问题不是“代码太长”，而是“为什么这些机制不能删”。ingest 的体量主要来自 4 个不可替代的故障路径；每一项都有一个**可复现的故障注入测试**。删掉对应机制，测试会失败，而不是只少了防御性代码。

运行方式（Node 的 test runner 在本机会尝试 spawn 子进程并被沙箱拒绝，直接跑文件）：

```powershell
node _meta/plugin/kb-panel/test/ingest.test.mjs
```

| 机制 | 为什么不能删 | 故障注入测试（`ingest.test.mjs`） |
|---|---|---|
| 接管已有笔记（takeover） | 状态目录是 gitignored 运行时状态，清理/回滚后不能重放整段历史，也不能把同一条用户消息写两遍 | `state present but session untracked resumes after the existing note`；`lost cursor state plus an existing note writes nothing from history`；`corrupt state falls back to structural takeover and never replays history` |
| 按身份去重（role+seq） | append 可能部分成功：只补缺失块，不能重复已写块 | `a partial append failure retries only the missing chunk by identity`；`concurrent turn/end deliveries for one session are serialized` |
| 写后自检（self-check） | kb.mjs 可能“成功但静默丢块”；必须从 warning 升级到 error，不能静默缺口 | `post-write self-check warns once, then escalates to an error` |
| 失败窗口恢复/重试 | 抽取失败不能丢窗口；恢复后下一次调度重试 | `a failed extraction restores the window and retries after the floor` |

结论：这些不是“防御性装饰”。它们是 append-only raw 层的正确性条件；在保留 raw 追加最小路径的前提下，ingest 的其余复杂度已经被 Phase 2/4 削减（队列满丢新 job、pending 窗口记 warning、配置 mtime 缓存、JSON 契约）。继续删除会直接破坏上表中的不变量，因此本轮不做删减，只补上“损坏状态”这一条此前未覆盖的故障注入测试。
