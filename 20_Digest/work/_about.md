# 工作页（工作层）

> 这里放**项目状态**，不放记忆，也不放指令。

- 一个 scope 一页：`global`（全局焦点）或 `project:<slug>`（某个项目）。
- 页面是**可覆写的活文档**：阶段 / 在办 / 未决 / 下一步 / 关联。
- **永不注入**：注入只看记忆（不包含 `type: work`），工作页只会在新会话里被渲染成一行「项目简报」。
- **不存指令**：你让我干活的指令只进原文层，不进这里；这里只沉淀“做到哪、下一步”。
- 新建：`node _meta/scripts/kb.mjs work-new --scope project:my-app`
- 简报：`node _meta/scripts/kb.mjs work-brief --scope project:my-app`
- 整理时 `consolidate` 会提示：工作页过期（>14 天未更新）或某项目有记忆但没有工作页。
