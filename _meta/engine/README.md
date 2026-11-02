# @local/kb-engine

零依赖、与宿主无关的知识库规则引擎。v2.0 起从 DSH 插件中抽出：引擎不认识
DSH，只认识「一个 store 根目录 + `_meta/config.json`」。

## 用法

```text
node _meta/engine/bin/kb.mjs --root <store> validate
node _meta/engine/bin/kb.mjs --root <store> rebuild
node _meta/engine/bin/kb.mjs --root <store> add-atom --json-file spec.json --json
```

仓库内兼容入口保持 `_meta/scripts/kb.mjs`（默认 root = 本仓库 vault）。

## 任意根与约定根

- 引擎只要求根目录有 `_meta/config.json`（`init --root <dir>` 可创建）；它**不要求**
  根目录名必须是 `.dsh-memory`，也不是只能服务本仓库。
- `<project>/.dsh-memory` 是 DSH 适配层的约定（自动建库/接入的目标），不是引擎约束。
  对非约定根，引擎按普通 store 处理，宿主可自行决定如何命名与发现。
- 因此「仓库外任意目录跑通全链路」是设计内能力；警告只表示宿主约定未满足，不是失败。

## 模块

- `lib/stores.mjs` — 多库 registry、store_id、attach/relocate、自动建库目标判定
- `lib/work-brief.mjs` — 注入排序/预算/项目简报渲染
- `lib/promote.mjs` — 单条原子提升为全局
- `lib/redact.mjs` — 写原文/裁判 prompt 前的脱敏
- `lib/shared/frontmatter.mjs`、`lib/shared/work-sections.mjs` — 共享解析契约
- `bin/kb.mjs` → `lib/cli.mjs` — 校验/索引/写入/检索/整理/工作页/删除闸门/attach

引擎不 import 任何 DSH 或插件代码；插件只反向依赖引擎（`_meta/plugin/kb-panel/*.js`
里的同名文件是兼容 shim）。

## 依赖方向与公开模块

- 依赖方向固定为 **engine ← plugin**：engine 零 DSH/插件依赖；插件、`_meta/scripts/`
  与文档都是下游。禁止在 engine 里 import DSH API 或 `_meta/plugin/`。
- 公开模块：`lib/index.mjs`（聚合导出）与 `package.json` 的 `exports` 子路径
  （`./context`、`./stores`、`./work-brief`、`./promote`、`./redact`、
  `./shared/frontmatter`、`./shared/work-sections`）；CLI 入口 `bin/kb.mjs`。
- 上下文语义：`lib/context.mjs` 是唯一「会话能看哪些 store、能写哪个 store」的决策
  （`describeStore`/`resolveContext`/`resolveWriteTarget`，写权限 fail closed）。
- 兼容层：`_meta/scripts/kb.mjs`（默认 root=本仓库）与插件同名文件是包装/shim；
  新集成直接用 engine 路径。
- 闸门：`_meta/scripts/check-plugin-load.mjs` 校验 engine 清单/版本/语法
  （11 个 engine 文件、25 个 JS）；`_meta/plugin/kb-panel/test/context.test.mjs` 覆盖
  context 决策，单测合计 149 条。

## 复核条件

- engine 出现 DSH/插件 import、或插件里重新长出第二份路径/kind 判断 → 视为解耦回退，
  重开 c-1002 并回滚相关改动。
- shim 被外部长期依赖而无法清理 → 评估把 shim 定为长期公开 API 并补文档。
- 多库面合并为单库、或需要进程内长驻引擎时，重新评估 CLI/模块边界。
