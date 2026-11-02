---
id: core
title: dsh-memory 项目核心记忆
level: canon
type: principle
status: canon
summary: 本项目不变量：不删除、不搬家、索引派生物、raw 与公开快照边界
updated: 2026-10-30
---

# dsh-memory 项目核心记忆

> 只放本项目不变量；全局称谓/偏好由全局库注入。

## 硬规则

- 不删除、不搬家、不手改 `_meta/*.jsonl`；索引只能 rebuild。
- `10_Raw/` 只增不改；raw 不进入公开快照。
- 公开快照是单向脱敏导出，不得含 raw/state/access/PROJECT_PLAN。
- 写入默认只在项目工作区内；全局路径须 Lu 授权。

## 当前真相

- 旧结论经 `superseded` 退场，不靠热度。
