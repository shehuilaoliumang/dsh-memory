/**
 * Step 3 of the write pipeline (`_meta/schema.md` §5): the semantic judge.
 *
 * It consumes `_meta/state/judge-queue.jsonl`, asks one small model call to
 * decide whether the candidate sentences are worth remembering and, if so, to
 * distil them into atom specs. This module NEVER writes to the vault itself:
 *  - `mode: 'dry'` (default) appends the verdict to `judge-dry-run.jsonl` so the
 *    output can be reviewed before it can ever reach `20_Digest/`.
 *  - `mode: 'write'` hands accepted specs to `kb.mjs add-atom`, which owns id
 *    allocation, duplicate detection, the schema and the index rebuild.
 *
 * The judge is deliberately synchronous-per-job and sequential: a slow or
 * failing model call must never overlap with itself or block a turn.
 */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_JUDGE = {
  enabled: false,
  mode: 'dry',
  intervalMs: 300000,
  batch: 3,
  timeoutMs: 90000,
  maxTokens: 6000,
  maxAttempts: 2,
  retryMaxAgeHours: 12,
  maxAtomsPerJob: 2,
  duplicateThreshold: 0.9,
  summaryMaxChars: 40,
  dryRunFile: 'judge-dry-run.jsonl',
};

const TYPES = ['fact', 'preference', 'decision', 'opinion', 'question', 'task', 'definition', 'principle'];

function buildJudgeSystem(cfg = DEFAULT_JUDGE) {
  return `你是知识库的抽取裁判。输入是某轮对话里被规则层挑出的候选句。

判断标准只有一条：**一年后回看，这句话还有用吗？** 只对「当时那次任务」有用的，一律不记。

该记（关于用户本人、他的项目、他的领域）：
- 用户偏好与习惯（称呼、语言、格式、明确说过喜欢/讨厌的做法）
- 已经定下的决策及其理由
- 事实约束（期限、依赖、环境限制、不能碰的边界）
- 术语与概念定义
- 长期未决的问题、待办
- 可复用的原则、方法论

绝对不记：
- **对 AI 助手的操作指令**（"不要碰某文件""必须按六段报告""先做 A 再做 B"）——这是任务指令，不是记忆
- **本次开发/调试过程本身**（某轮修了什么、某次验证得到什么结果、测试通过几次）
- **关于「进行中 / 待办 / 尚未完成」的进度描述**——它们只对当时有效。除非采集时间就在刚刚（几十分钟内），否则这类内容大概率已经过期，一律不记；这条最容易产生「写着还在做、其实早做完了」的过期记忆
- **知识库系统自身的实现细节**——触发器、裁判、校验、索引、schema 内部结构、插件机制、代码改动、参数调整，都属于「施工日志」而不是知识。**判断标准：这条知识，除了用来维护知识库本身，还对别的事有用吗？没有就不记。**
  例外（这类要记）：怎么使用知识库的规则、用户对知识库的偏好、知识库约定必须遵守的硬约束
- 工具用法、命令、文件路径、配置参数、接口签名
- 寒暄、过程叙述、临时状态、与已有条目重复的内容

输出严格 JSON，不要解释、不要代码块：
{"shouldRecord":true|false,"reason":"一句话","atoms":[{"title":"中文标题","type":"${TYPES.join('|')}","scope":"global|system|project:<slug>","subject":"可选小写主题 slug","supersedes":["被取代的旧条目 id"],"summary":"不超过 ${cfg.summaryMaxChars} 字","points":["要点"],"tags":["标签"],"quote":"候选原文片段","confidence":0.0}]}

若新陈述明确纠正/取代已有条目：subject 用稳定的 2–64 位小写字母/数字/连字符主题（同一主题的版本共用它）；supersedes 只填上面「已有条目」里真实出现、且确实被这句话取代的 id。只是措辞不同、补充细节或不确定时，省略这两个字段，绝不为了合并而乱填 supersedes。

每条 atom 必须给出 scope，它决定这条记忆会不会自动进入对话：
- global —— 跨项目通用的用户偏好、习惯、原则（只有这一档会自动注入）
- system —— 只用于维护知识库本身的建设与实现细节；这类通常整批就应该 shouldRecord=false
- project:<slug> —— 绑在某个具体项目上，slug 用项目名小写连字符
判不准就写 unclassified（不会被自动注入，等人确认）

约束：atoms 最多 ${cfg.maxAtomsPerJob} 条；每条 points 最多 3 行、每行不超过 30 字；summary 不超过 ${cfg.summaryMaxChars} 字且要能独立读懂；quote 必须逐字取自候选且不超过 60 字；整个输出必须是**单行紧凑 JSON**，不要换行缩进；拿不准就 shouldRecord=false。`;
}

export const JUDGE_SYSTEM = buildJudgeSystem(DEFAULT_JUDGE);

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return '';
  }
}

function readJsonl(file) {
  return readText(file)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

/** Truncate to `max` characters without inventing or splitting a token. */
export function clampText(value, max) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!max || [...text].length <= max) return text;
  const chars = [...text];
  const floor = Math.floor(max * 0.5);
  let end = max;
  // Prefer a clause boundary; then a space; then any boundary the caller allows.
  for (let i = max - 1; i >= floor; i -= 1) {
    if ('，。、；;,!.?！？：:'.includes(chars[i])) {
      end = i + 1;
      break;
    }
  }
  if (end === max) {
    for (let i = max - 1; i >= floor; i -= 1) {
      if (chars[i] === ' ') {
        end = i;
        break;
      }
    }
  }
  const isTokenChar = (c) => c !== undefined && /[A-Za-z0-9_]/.test(c);
  // Never end inside a latin/digit token: drop the partial token instead.
  if (isTokenChar(chars[end - 1]) && isTokenChar(chars[end])) {
    while (end > 1 && isTokenChar(chars[end - 1])) end -= 1;
  }
  return chars
    .slice(0, end)
    .join('')
    .replace(/[\s，,、；;：:]+$/, '')
    .trim();
}

/** Strip whitespace/punctuation so near-identical summaries compare equal. */
function normText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

/** Character-bigram set: language-agnostic and cheap enough to run per batch. */
function bigramSet(text) {
  const chars = [...text];
  const set = new Set();
  if (chars.length <= 1) {
    if (chars.length) set.add(chars[0]);
    return set;
  }
  for (let i = 0; i < chars.length - 1; i += 1) set.add(chars[i] + chars[i + 1]);
  return set;
}

export function similarity(a, b) {
  const left = bigramSet(normText(a));
  const right = bigramSet(normText(b));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * Drop atoms that restate something already in the index or earlier in the same
 * batch. `add-atom` only catches identical summaries; this catches paraphrase.
 */
export function dedupeAtoms(atoms, known, threshold) {
  const kept = [];
  const dropped = [];
  for (const atom of atoms) {
    let hit = null;
    for (const row of known) {
      const score = similarity(atom.summary, row.summary);
      if (score >= threshold) {
        hit = { against: row.id || 'catalog', score: Number(score.toFixed(2)) };
        break;
      }
    }
    if (!hit) {
      for (const previous of kept) {
        const score = Math.max(similarity(atom.summary, previous.summary), similarity(atom.title, previous.title));
        if (score >= threshold) {
          hit = { against: 'batch', score: Number(score.toFixed(2)) };
          break;
        }
      }
    }
    if (hit) dropped.push({ title: atom.title, summary: atom.summary, reason: 'near-duplicate', ...hit });
    else kept.push(atom);
  }
  return { atoms: kept, dropped };
}

/**
 * Cheap screening for the dedupe question. Character similarity cannot decide
 * paraphrase on short Chinese summaries (measured 0.2–0.4 on real duplicates),
 * so it only selects a handful of existing rows to SHOW the model, which then
 * decides. `dedupeAtoms` stays as a last-resort net for near-identical text.
 */
export function screeningMatches(texts, known, limit = 8, floor = 0.25) {
  const scored = [];
  for (const row of known) {
    let best = 0;
    for (const text of texts) {
      const score = similarity(text, row.summary);
      if (score > best) best = score;
    }
    if (best >= floor) scored.push({ id: row.id, summary: row.summary, score: best });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((row) => ({ ...row, score: Number(row.score.toFixed(2)) }));
}

/**
 * Rows shown to the judge as "already known". Character similarity is blind to
 * paraphrase (measured: a real duplicate of a canon decision scored 0.06), so
 * canon entries are ALWAYS included regardless of score, and the similarity
 * screen only fills the remaining slots. Without this the judge can mint a new
 * decision that the knowledge base already holds.
 */
export function selectExisting(known, probes, options = {}) {
  const canonLimit = Number(options.canonLimit) > 0 ? Number(options.canonLimit) : 20;
  const matchLimit = Number(options.matchLimit) > 0 ? Number(options.matchLimit) : 6;
  const floor = Number.isFinite(Number(options.floor)) ? Number(options.floor) : 0.25;
  const canon = known.filter((row) => row && row.level === 'canon').slice(0, canonLimit);
  const canonIds = new Set(canon.map((row) => row.id));
  const matches = screeningMatches(probes, known.filter((row) => !canonIds.has(row.id)), matchLimit, floor);
  const seen = new Set();
  return [...canon, ...matches].filter((row) => {
    if (!row || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function stripFence(text) {
  const trimmed = String(text || '').trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

export function parseVerdict(text, cfg = DEFAULT_JUDGE) {
  const raw = stripFence(text);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error(`裁判输出不是 JSON：${raw.slice(0, 120)}`);
    parsed = JSON.parse(raw.slice(start, end + 1));
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('裁判输出不是对象');
  const atoms = Array.isArray(parsed.atoms) ? parsed.atoms : [];
  return {
    shouldRecord: parsed.shouldRecord === true,
    reason: String(parsed.reason || '').slice(0, 200),
    atoms: atoms
      .filter((atom) => atom && typeof atom === 'object')
      .map((atom) => ({
        title: clampText(atom.title, 80),
        type: TYPES.includes(String(atom.type)) ? String(atom.type) : 'fact',
        scope: /^(global|system|unclassified|project:[a-z0-9][a-z0-9-]*)$/.test(String(atom.scope || ''))
          ? String(atom.scope)
          : 'unclassified',
        subject: /^[a-z0-9][a-z0-9-]{1,63}$/.test(String(atom.subject || ''))
          ? String(atom.subject)
          : '',
        supersedes: [...new Set(
          (Array.isArray(atom.supersedes) ? atom.supersedes : atom.supersedes ? [atom.supersedes] : [])
            .map((id) => String(id || '').replace(/^\[\[|\]\]$/g, '').trim())
            .filter((id) => /^\d{4}-\d{2}-\d{2}-[atw]-\d{4}$/.test(id)),
        )].slice(0, 3),
        summary: clampText(atom.summary, cfg.summaryMaxChars),
        points: (Array.isArray(atom.points) ? atom.points : []).map((p) => clampText(p, 120)).filter(Boolean).slice(0, 8),
        tags: (Array.isArray(atom.tags) ? atom.tags : []).map((t) => String(t).trim()).filter(Boolean).slice(0, 6),
        quote: String(atom.quote || '').trim().slice(0, 300),
        confidence: Number.isFinite(Number(atom.confidence)) ? Math.min(1, Math.max(0, Number(atom.confidence))) : 0.6,
      }))
      // Validate first, then cap: an unusable atom must not consume the budget
      // and push a good one out.
      .filter((atom) => atom.title && atom.summary && (atom.points.length > 0 || atom.quote))
      .slice(0, cfg.maxAtomsPerJob),
  };
}

function jobPrompt(job, existing = []) {
  const lines = [
    `会话：${job.sessionId}`,
    `原文：${job.raw || '(未记录)'}`,
    `采集时间：${job.createdAt || '(未知)'}`,
    `触发词：${(job.gate && job.gate.triggers ? job.gate.triggers : []).join(' / ') || '(无)'}`,
    '',
    '候选句：',
  ];
  for (const [index, candidate] of (job.candidates || []).entries()) {
    lines.push(`${index + 1}. ${String(candidate.text || candidate).trim()}`);
  }
  if (existing.length) {
    lines.push('', '知识库里已有下列条目。若你的候选与其中任一条表达同一件事，就不要输出该 atom，并在 reason 里注明 duplicate：');
    for (const row of existing) lines.push(`- ${row.id}｜${row.summary}`);
  }
  return lines.join('\n');
}

/**
 * Create the judge worker.
 * @param deps.root vault root (absolute)
 * @param deps.config resolved plugin config (ingest + judge sections)
 * @param deps.llm the Host `llm` service (may be undefined in a profile without it)
 * @param deps.runCommand async (args, timeoutMs) => { code, stdout, stderr } for kb.mjs
 * @param deps.log optional line logger
 */
export function createJudgeWorker(deps = {}) {
  const root = deps.root;
  const config = typeof deps.config === 'function' ? deps.config : () => deps.config || {};
  const log = deps.log || (() => {});
  const state = {
    enabled: false,
    mode: 'dry',
    running: false,
    lastRunAt: null,
    lastError: null,
    lastVerdictAt: null,
    lastVerdict: null,
    processed: 0,
    written: 0,
    skipped: 0,
  };
  let timer = null;
  let disposed = false;

  const readVaultConfig = () => {
    try {
      return JSON.parse(readText(path.join(root, '_meta', 'config.json'))) || {};
    } catch {
      return {};
    }
  };

  const settings = () => {
    const file = readVaultConfig();
    const plugin = typeof deps.config === 'function' ? deps.config() || {} : deps.config || {};
    const fileIngest = file.ingest || {};
    const fileJudge = file.judge || {};
    const pluginIngest = plugin.ingest || {};
    const pluginJudge = plugin.judge || {};
    // `_meta/config.json` wins over the profile patch: tunables live in the vault
    // and must be editable without reinstalling the plugin.
    return {
      ...DEFAULT_JUDGE,
      ...pluginJudge,
      ...fileJudge,
      enabled: (fileJudge.enabled ?? pluginJudge.enabled ?? DEFAULT_JUDGE.enabled) === true,
      mode: fileJudge.mode || pluginJudge.mode || DEFAULT_JUDGE.mode,
      stateDir: fileIngest.stateDir || pluginIngest.stateDir || '_meta/state',
    };
  };

  const stateDir = () => path.join(root, settings().stateDir);
  const queueFile = () => path.join(stateDir(), 'judge-queue.jsonl');
  const dryRunFile = () => path.join(stateDir(), settings().dryRunFile);

  const catalogFile = () => {
    const file = readVaultConfig();
    const rel = (file.paths && file.paths.catalog) || '_meta/catalog.jsonl';
    return path.join(root, rel);
  };

  /** Distilled memories already in the index; raw sessions and pages are not memories. */
  const loadKnownSummaries = () =>
    readJsonl(catalogFile())
      .filter(
        (row) =>
          row &&
          typeof row.summary === 'string' &&
          row.summary.trim() &&
          row.level !== 'raw' &&
          row.type !== 'session' &&
          // Pages (topic/work) describe state, not memories; offering them to
          // the dedupe screen would make the judge skip genuine new memories.
          row.type !== 'work' &&
          row.type !== 'topic',
      )
      .map((row) => ({ id: row.id, summary: row.summary, level: row.level }));

  async function callModel(prompt) {
    const cfg = settings();
    const llm = deps.llm;
    if (!llm || typeof llm.stream !== 'function') throw new Error('llm 服务不可用');
    const provider = String(settings().provider || '');
    const model = String(settings().model || '');
    if (!provider || !model) throw new Error('judge.provider / judge.model 未配置');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
    let text = '';
    const seen = new Set();
    try {
      const stream = llm.stream({
        provider,
        model,
        system: buildJudgeSystem(settings()),
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        maxTokens: Number(settings().maxTokens) || 3000,
        temperature: 0,
        signal: controller.signal,
      });
      for await (const chunk of stream) {
        if (!chunk || typeof chunk !== 'object') continue;
        if (chunk.type) seen.add(chunk.type);
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
        // Non-streaming adapters emit one finished text block instead of deltas.
        if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string') {
          if (!text) text = chunk.block.text;
        }
        if (chunk.type === 'finish') {
          const reason = chunk.reason || {};
          if (reason.kind === 'error' || reason.kind === 'aborted') {
            throw new Error(`模型调用失败：${reason.kind}${reason.failure && reason.failure.message ? `（${reason.failure.message}）` : ''}`);
          }
        }
      }
    } finally {
      clearTimeout(timeout);
    }
    if (!text.trim()) {
      throw new Error(`模型返回空文本（chunks: ${[...seen].join(',') || 'none'}）`);
    }
    return text;
  }

  /** Rewrite the queue with updated statuses, preserving unknown lines. */
  function updateQueue(updates) {
    const rows = readJsonl(queueFile());
    const next = rows.map((row) => {
      const patch = updates.get(row.id);
      return patch ? { ...row, ...patch } : row;
    });
    writeAtomic(queueFile(), next.map((row) => JSON.stringify(row)).join('\n') + (next.length ? '\n' : ''));
  }

  async function processJob(job) {
    const cfg = settings();
    if (!job.candidates || !job.candidates.length) {
      updateQueue(new Map([[job.id, { status: 'skipped', skippedReason: '候选为空', judgedAt: new Date().toISOString() }]]));
      state.skipped += 1;
      return { status: 'skipped' };
    }
    const known = loadKnownSummaries();
    const probes = (job.candidates || []).map((candidate) => String(candidate.text || candidate));
    const existing = selectExisting(known, probes);
    const text = await callModel(jobPrompt(job, existing));
    const verdict = parseVerdict(text, cfg);
    verdict.existing = existing.map((row) => row.id);
    // Safety net only: the model has already been shown the screened rows above.
    const deduped = dedupeAtoms(verdict.atoms, known, Number(cfg.duplicateThreshold) || 0.9);
    verdict.atoms = deduped.atoms;
    verdict.dropped = deduped.dropped;
    // The judge may only supersede rows it was actually shown. A hallucinated
    // id is dropped here instead of asking add-atom to touch an unseen note.
    const shownIds = new Set(existing.filter((row) => row.level === 'digest').map((row) => row.id));
    verdict.atoms = verdict.atoms.map((atom) => ({
      ...atom,
      supersedes: (atom.supersedes || []).filter((id) => shownIds.has(id)),
    }));
    state.lastVerdictAt = new Date().toISOString();
    state.lastVerdict = { jobId: job.id, ...verdict };

    const record = {
      at: state.lastVerdictAt,
      jobId: job.id,
      sessionId: job.sessionId,
      raw: job.raw,
      mode: cfg.mode,
      verdict,
    };

    if (cfg.mode !== 'write') {
      fs.appendFileSync(dryRunFile(), `${JSON.stringify(record)}\n`, 'utf8');
      updateQueue(new Map([[job.id, { status: 'judged-dry', judgedAt: record.at, atoms: verdict.atoms.length }]]));
      state.processed += 1;
      log(`[kb-judge] dry-run job ${job.id}: shouldRecord=${verdict.shouldRecord} atoms=${verdict.atoms.length}`);
      return { status: 'judged-dry', verdict };
    }

    let written = 0;
    let duplicates = 0;
    const writtenIds = [];
    for (const atom of verdict.shouldRecord ? verdict.atoms : []) {
      const spec = {
        title: atom.title,
        type: atom.type,
        scope: atom.scope,
        subject: atom.subject,
        supersedes: atom.supersedes,
        summary: atom.summary,
        points: atom.points,
        tags: atom.tags,
        quote: atom.quote,
        confidence: atom.confidence,
        // No `status`: add-atom defaults to `inbox`, so a fresh judgement never
        // reaches the model until someone confirms it.
        source: job.raw ? [`[[${job.raw.replace(/\.md$/, '')}]]`] : [],
      };
      const specFile = path.join(stateDir(), 'tmp', `atom-${job.id}-${written}.json`);
      writeAtomic(specFile, JSON.stringify(spec));
      try {
        const result = await deps.runCommand(['add-atom', '--json-file', specFile, '--json'], cfg.timeoutMs);
        if (result.code !== 0) throw new Error((result.stderr || result.stdout || '').trim().slice(0, 200));
        const parsed = JSON.parse(result.stdout);
        writtenIds.push(parsed.id);
        if (parsed.duplicate) duplicates += 1;
        else written += 1;
      } finally {
        try {
          fs.rmSync(specFile, { force: true });
        } catch {
          /* best effort */
        }
      }
    }
    state.written += written;
    state.processed += 1;
    updateQueue(
      new Map([
        [
          job.id,
          {
            status: verdict.shouldRecord ? 'written' : 'rejected',
            judgedAt: record.at,
            reason: verdict.reason,
            atoms: verdict.atoms.length,
            written,
            duplicates,
            ids: writtenIds,
            // Audit trail: which rows the judge was shown, and what the exact
            // near-duplicate net dropped. Without this a semantic duplicate is
            // indistinguishable from an honest new memory after the fact.
            existing: verdict.existing,
            dropped: verdict.dropped,
          },
        ],
      ]),
    );
    log(`[kb-judge] job ${job.id}: shouldRecord=${verdict.shouldRecord} written=${written} duplicates=${duplicates}`);
    return { status: 'written', verdict };
  }

  async function runOnce() {
    const cfg = settings();
    if (!cfg.enabled) return { skipped: 'disabled' };
    if (state.running) return { skipped: 'running' };
    state.running = true;
    state.lastRunAt = new Date().toISOString();
    const results = [];
    try {
      const maxAttempts = Math.max(1, Number(cfg.maxAttempts) || 1);
      const pending = readJsonl(queueFile())
        .filter((job) => job && (job.status === 'pending' || (job.status === 'judge-error' && Number(job.attempts || 0) < maxAttempts)))
        .slice(0, Math.max(1, cfg.batch));
      for (const job of pending) {
        if (disposed) break;
        try {
          results.push({ jobId: job.id, ...(await processJob(job)) });
        } catch (error) {
          const message = String(error && error.message ? error.message : error);
          state.lastError = message;
          updateQueue(
            new Map([
              [
                job.id,
                {
                  status: 'judge-error',
                  judgedAt: new Date().toISOString(),
                  judgeError: message,
                  attempts: Number(job.attempts || 0) + 1,
                },
              ],
            ]),
          );
          log(`[kb-judge] job ${job.id} failed: ${message}`);
        }
      }
      if (!results.length) state.lastError = null;
    } catch (error) {
      state.lastError = String(error && error.message ? error.message : error);
    } finally {
      state.running = false;
    }
    return { results };
  }

  /**
   * Put failed jobs back in the queue. Jobs older than `retryMaxAgeHours` are
   * marked expired instead: extracting a window from hours ago mostly yields
   * progress notes that are already stale by the time they would be written.
   */
  function retryErrored() {
    const cfg = settings();
    const maxAgeMs = Math.max(1, Number(cfg.retryMaxAgeHours) || 12) * 3600 * 1000;
    const now = Date.now();
    const rows = readJsonl(queueFile());
    let reset = 0;
    let expired = 0;
    const next = rows.map((row) => {
      if (!row || row.status !== 'judge-error') return row;
      const created = Date.parse(row.createdAt || '');
      if (Number.isFinite(created) && now - created > maxAgeMs) {
        expired += 1;
        return { ...row, status: 'expired', expiredAt: new Date().toISOString(), expiredReason: '采集窗口过旧，重试会产出过期记忆' };
      }
      reset += 1;
      return { ...row, status: 'pending', attempts: 0, retriedAt: new Date().toISOString() };
    });
    if (reset || expired) writeAtomic(queueFile(), next.map((row) => JSON.stringify(row)).join('\n') + '\n');
    return { reset, expired };
  }

  return {
    retryErrored,
    start() {
      const cfg = settings();
      state.enabled = cfg.enabled === true;
      state.mode = cfg.mode;
      if (!state.enabled || timer) return;
      // First drain happens after one interval so start-up stays cheap.
      timer = setInterval(() => {
        void runOnce();
      }, Math.max(30000, cfg.intervalMs));
      if (typeof timer.unref === 'function') timer.unref();
    },
    runOnce,
    snapshot() {
      const queue = readJsonl(queueFile());
      return {
        enabled: state.enabled,
        mode: state.mode,
        running: state.running,
        intervalMs: settings().intervalMs,
        batch: settings().batch,
        lastRunAt: state.lastRunAt,
        lastError: state.lastError,
        lastVerdictAt: state.lastVerdictAt,
        lastVerdict: state.lastVerdict,
        counters: { processed: state.processed, written: state.written, skipped: state.skipped },
        queue: {
          pending: queue.filter((job) => job.status === 'pending').length,
          rejected: queue.filter((job) => job.status === 'rejected').length,
          written: queue.filter((job) => job.status === 'written').length,
          dry: queue.filter((job) => job.status === 'judged-dry').length,
          errors: queue.filter((job) => job.status === 'judge-error').length,
        },
      };
    },
    dispose() {
      disposed = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
