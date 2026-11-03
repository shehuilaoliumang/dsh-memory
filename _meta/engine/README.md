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

引擎不 import 任何 DSH 或插件代码；插件只反向依赖引擎。**v2.1 起插件直接
`import _meta/engine/lib/*`（6 个 re-export shim 已删除），不再有兼容 shim 层。**

## 依赖方向与公开模块

- 依赖方向固定为 **engine ← plugin**：engine 零 DSH/插件依赖；插件、`_meta/scripts/`
  与文档都是下游。禁止在 engine 里 import DSH API 或 `_meta/plugin/`。
- 公开模块：`lib/index.mjs`（聚合导出）与 `package.json` 的 `exports` 子路径
  （`./context`、`./stores`、`./work-brief`、`./promote`、`./redact`、
  `./shared/frontmatter`、`./shared/work-sections`）；CLI 入口 `bin/kb.mjs`。
- 上下文语义：`lib/context.mjs` 是唯一「会话能看哪些 store、能写哪个 store」的决策
  （`describeStore`/`resolveContext`/`resolveWriteTarget`，写权限 fail closed）。
- 兼容层：`_meta/scripts/kb.mjs` 是默认 root 的兼容包装；插件直接 import engine。
- **registry 跨进程锁**：`lib/stores.mjs` 的 `withRegistryLock(registryFile, fn)` 把
  读-改-写串行化（tmp+rename 之上），多进程/多路由并发写 registry 不再丢更新。
- 闸门：`_meta/scripts/check-plugin-load.mjs` 校验 engine 清单/版本/语法
  （11 个 engine 文件、21 个 JS）；`context.test.mjs` 5 条 + `behavior-matrix.test.mjs`
  9 条覆盖上下文与路由，插件单测合计 159 条。

## 复核条件

- engine 出现 DSH/插件 import、或插件里重新长出第二份路径/kind 判断 → 视为解耦回退，
  重开 c-1002 并回滚相关改动。
- 插件重新引入 re-export shim 或私有副本 → 视为解耦回退；shim 如确需恢复，须先改 c-1002
  的「2.1 起无 shim」结论。
- registry 锁回归（并发读-改-写）失效或出现丢更新事故 → 复查 `withRegistryLock` 并重开
  c-1003 的写入边界。
- 多库面合并为单库、或需要进程内长驻引擎时，重新评估 CLI/模块边界。
