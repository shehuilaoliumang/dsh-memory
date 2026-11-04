# @local/kb-engine

零依赖、与宿主无关的知识库规则引擎。v2.0 起从 DSH 插件中抽出：引擎不认识
DSH，只认识「一个 store 根目录 + `_meta/config.json`」。

## 用法

```text
node _meta/engine/bin/kb.mjs --root <store> validate
node _meta/engine/bin/kb.mjs --root <store> rebuild
node _meta/engine/bin/kb.mjs --root <store> add-atom --json-file spec.json --json
```

仓库内兼容入口保持 `_meta/scripts/kb.mjs`（默认 root = 本仓库 vault；2.2 起为薄包装）。

### 进程内 API（v2.2）

```js
import { runCli, createEngine } from './_meta/engine/lib/index.mjs';

const { code, stdout, stderr } = runCli(['validate'], { root: 'D:/kb' });
const kb = createEngine({ root: 'D:/kb' });
const stats = kb.run(['stats', '--json']);
```

- 返回捕获输出、**不触碰**宿主 `process.exitCode`/stdout/stderr；命令错误以 `code` 返回。
- **同步、单线程、单根顺序**：一个模块实例按调用顺序服务，`createEngine` 按 root 状态化；
  不要在命令内部再次 `run()`（禁止重入）。
- 一个 import 顺序可服务多个 root（每次 `runCli` 显式传 root；`createEngine` 固定一个 root）。

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
- `lib/injection-reasons.mjs` — 逐条注入原因（v2.4，纯函数/advisory）
- `lib/search/pinyin.mjs`、`lib/search/semantic.mjs` — 检索回退（v2.4；拼音 vendored tiny-pinyin 1.3.2 MIT，见 `PINYIN-NOTICE.md`）
- `lib/shared/frontmatter.mjs`、`lib/shared/work-sections.mjs` — 共享解析契约
- `bin/kb.mjs` → `lib/cli.mjs` — 校验/索引/写入/检索/整理/工作页/删除闸门/attach

引擎不 import 任何 DSH 或插件代码；插件只反向依赖引擎。**v2.1 起插件直接
`import _meta/engine/lib/*`（6 个 re-export shim 已删除），不再有兼容 shim 层。**

## 依赖方向与公开模块

- 依赖方向固定为 **engine ← plugin**：engine 零 DSH/插件依赖；插件、`_meta/scripts/`
  与文档都是下游。禁止在 engine 里 import DSH API 或 `_meta/plugin/`。
- 公开模块：`lib/index.mjs`（聚合导出）与 `package.json` 的 `exports` 子路径
  （`./context`、`./stores`、`./work-brief`、`./injection-reasons`、`./promote`、`./redact`、
  `./search/pinyin`、`./search/semantic`、`./shared/frontmatter`、`./shared/work-sections`）；CLI 入口 `bin/kb.mjs`。
  v2.4 的三个新模块只经 `exports` 子路径提供，`lib/index.mjs` 未再聚合导出。
- 上下文语义：`lib/context.mjs` 是唯一「会话能看哪些 store、能写哪个 store」的决策
  （`describeStore`/`resolveContext`/`resolveWriteTarget`，写权限 fail closed）。
- **policy 字段（v2.2）**：`describeStore` 的库存行为由 `policy` 表达——
  `scopeMode`（global/project）、`injectLimit`（5/3）、`trustedBy`（config/user）；
  legacy 用 `{ scopeMode:'global', injectLimit:5, trustedBy:'config' }`，不再是独立行为分支
  （`kind` 保留为标识/UI 标签）。registry 行携带 `policy`；`resolveContext`/
  `resolveWriteTarget` 输出 `role`/`trustedBy`。
- 兼容层：`_meta/scripts/kb.mjs` 是默认 root 的兼容包装；插件直接 import engine。
- **registry 跨进程锁**：`lib/stores.mjs` 的 `withRegistryLock(registryFile, fn)` 把
  读-改-写串行化（tmp+rename 之上），多进程/多路由并发写 registry 不再丢更新。
- **排名正确性（v2.3）**：`lib/work-brief.mjs` 的 `rankMemories(notes, accessRows, opts)`
  按 access 行 `how` 加权（`injectWeight` 默认 0.1，read/grep/manual×1），`lastAt` 取最大
  时间；`exploration`（默认 0）把最新未曝光条目移到位置 2，插件仅对项目 store 传 1。
- **catalog 字段（v2.3）**：`toRow` 增 `title`/`scope`/`subject`（clamp 60/40/60），
  `fitRow` 在 300B 预算内按 `summary → title → scope → subject` 缩短；注入优先读
  catalog，缺失/损坏回退逐文件扫描，手工改笔记后必须 `rebuild`。
- **检索字段权重（v2.3）**：`lib/cli.mjs` 的 BM25 文档为 `title×3`、`summary×2`、
  `tags/scope/body×1`；插件只读 `GET /kb/search.json`（同一实现 + 白名单过滤 + 不记 access）。
- **检索回退（v2.4）**：字面 BM25 永远优先；只有字面命中数 < `min(limit, 3)` 时才依次用
  拼音（查询全拼/首字母匹配标题与摘要，ASCII 查询；`Intl.Collator` 不可用时该路降级为空、
  不抛错）与同义词（`semantic.mjs` 的 21 组中英主题表，整词 ASCII / 中文 ≥2 字扩展，单组 ≤4、
  总 ≤10）补位；补位语义分 ×0.5，排在字面命中之后；`search` 响应带 `strategy: {pinyin, semantic}`
  与每行 `matchedBy`/`matchLabel`/`matchTerms`；检索仍不写 `access`。拼音库为 vendored
  tiny-pinyin 1.3.2（MIT，约 8KB、6763 常用字），归属见 `PINYIN-NOTICE.md`；多音字不支持，
  这是启发式而非语义检索。
- **注入原因（v2.4）**：`injection-reasons.mjs` 的 `explainInjection({ notes, entries, scope,
  viewKind, mutedIds, inSessionStore, limits })` 返回 `Record<id, { state, label, detail }>`，
  与 `selectInjection` 使用同一份输入但**不参与选择**（advisory）；优先级 other-store →
  injected → muted → status(inbox/review/archived/promoted/superseded) → canon/raw →
  topic/work/session → fail-closed scope → 同 subject 更新 → 预算满 → 本轮未入选。插件用它在
  `/kb/panel.json` 的 `notes[].injection` 展示原因。
- **多库只读视图（v2.4，插件层）**：`GET /kb/search.json?workspace=all` 由插件对每个可见
  store 各跑一次引擎检索并只保留本店 `scan` id 白名单内的行，结果带 `workspace`/`workspaceLabel`、
  全局最多 20 条、按 score 排序；只读、不跨库写、不写 access。引擎本身仍是单根/单进程语义。
- 闸门：`_meta/scripts/check-plugin-load.mjs` 校验 engine 清单/版本/语法
  （14 个 engine 文件、25 个 JS）；`context.test.mjs` 5 条 + `behavior-matrix.test.mjs`
  9 条 + `inject-ranking.test.mjs` 8 条 + `engine-api.test.mjs` 3 条 + `search-fallback.test.mjs`
  4 条覆盖上下文/路由/排序/进程内 API/检索回退，插件单测合计 185 条；`work-brief.test.mjs`
  31 条覆盖排名/预算/简报。

## 复核条件

- engine 出现 DSH/插件 import、或插件里重新长出第二份路径/kind 判断 → 视为解耦回退，
  重开 c-1002 并回滚相关改动。
- 插件重新引入 re-export shim 或私有副本 → 视为解耦回退；shim 如确需恢复，须先改 c-1002
  的「2.1 起无 shim」结论。
- registry 锁回归（并发读-改-写）失效或出现丢更新事故 → 复查 `withRegistryLock` 并重开
  c-1003 的写入边界。
- policy 回归（legacy 注入预算/过滤变化、registry 丢 `policy`、`kind` 重新变成行为分支）→
  重开 c-1004 并回退到 policy 前的表达。
- 排名回归（曝光重新主导、exploration 挤掉第一推荐或作用到 legacy/global）→ 重开 c-1005，
  补 access 权重与槽位测试。
- catalog 注入读到与笔记不一致的索引（未 rebuild 却不回退 scanNotes）→ 修回一致性规则并
  重开 c-1005。
- `runCli`/`createEngine` 污染宿主进程状态、或并发/重入调用出现串扰 → 收窄为显式单实例
  顺序使用，补回归并重开 c-1004 的进程内 API 边界。
- 检索回退回归（字面命中充足仍被回退结果插队、回退改变 access 写入、拼音/同义词典被替换为
  不可控来源）→ 重开 c-1006 并恢复「字面优先 + 只读」边界；同义词表或拼音库升级须保留
  `PINYIN-NOTICE.md` 归属。
- 注入原因与 `selectInjection` 不同源（标签与实际注入不符）→ 视为可解释性回退，重开 c-1006，
  补同源回归。
- 多库只读视图出现写操作、跨库写、或 `workspace=all` 返回白名单外条目 → 立即回滚该视图，
  重开 c-1006。
- 多库面合并为单库、或需要进程内长驻引擎时，重新评估 CLI/模块边界。
