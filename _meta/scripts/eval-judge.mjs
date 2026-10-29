#!/usr/bin/env node
/**
 * Phase 2 judge evaluation harness.
 *
 * It renders the same system prompt and candidate prompt the live judge uses,
 * then compares `shouldRecord` against a labelled golden set. The harness is
 * deliberately provider-agnostic:
 *
 *   --adapter fixture   deterministic local smoke; never a precision claim
 *   --adapter replay    read captured model outputs (JSONL id → output)
 *   --adapter predictions  read {id, shouldRecord, type} rows from the live bridge
 *   --adapter http      OpenAI-compatible chat-completions endpoint
 *
 * `--adapter http` reads the key from KB_JUDGE_API_KEY (never from argv) and
 * sends the prompt once per case, sequentially. Results are written to
 * `_meta/state/judge-eval-<stamp>.json`; `_meta/state` is gitignored.
 *
 * Usage:
 *   node _meta/scripts/eval-judge.mjs --golden _meta/rules/golden.jsonl --adapter fixture
 *   node _meta/scripts/eval-judge.mjs --golden ... --adapter http --base-url ... --model ...
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJudgePrompt, buildJudgeSystem, parseVerdict, DEFAULT_JUDGE } from '../plugin/kb-panel/judge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);

function arg(name, fallback = '') {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function has(name) {
  return args.includes(`--${name}`);
}

function readJsonl(file) {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${file}:${index + 1} 不是 JSON：${error.message}`);
      }
    });
}

function buildJob(caseRow) {
  return {
    id: caseRow.id,
    kind: 'extract-judge',
    sessionId: 'golden-set',
    raw: '(golden)',
    createdAt: '2026-10-29T00:00:00+08:00',
    cause: 'eval',
    candidates: [{ text: caseRow.text }],
    gate: { triggers: [] },
  };
}

function fixtureVerdict(caseRow) {
  // A deterministic baseline, not the judge: useful only to prove the harness
  // and metrics are wired and to detect golden-set drift in CI.
  const text = String(caseRow.text || '');
  const skip =
    /(施工日志|测试通过|本轮|刚改完|命令输出|不要碰|先做|再做|必须按|这是任务|怎么执行)/.test(text) ||
    /^(好的|收到|可以|嗯|行|ok)[。！，]?$/i.test(text.trim());
  const isPreference = /(我喜欢|我偏好|我不喜欢|我讨厌|以后|每次|记住|不要用|别用|界面|称呼)/.test(text);
  const isDecision = /(决定|定了|改成|以后就|我们采用|选择)/.test(text);
  const shouldRecord = !skip && (isPreference || isDecision);
  return {
    shouldRecord,
    reason: 'fixture baseline',
    atoms: shouldRecord
      ? [
          {
            title: 'fixture',
            type: isDecision ? 'decision' : 'preference',
            scope: caseRow.scope || 'global',
            summary: text.slice(0, 40),
            points: [],
            tags: [],
            quote: text.slice(0, 60),
            confidence: 0.5,
          },
        ]
      : [],
  };
}

async function httpVerdict(caseRow, prompt, opts) {
  const key = process.env.KB_JUDGE_API_KEY || '';
  if (!key) throw new Error('KB_JUDGE_API_KEY 未设置，不能使用 --adapter http');
  const endpoint = `${opts.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: opts.model,
      temperature: 0,
      max_tokens: opts.maxTokens,
      messages: [
        { role: 'system', content: buildJudgeSystem({ ...DEFAULT_JUDGE, promptVersion: opts.promptVersion }) },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('HTTP adapter 返回空文本');
  return parseVerdict(content, { ...DEFAULT_JUDGE, promptVersion: opts.promptVersion });
}

function replayVerdict(caseRow, replay) {
  const output = replay.get(caseRow.id);
  if (typeof output !== 'string' || !output.trim()) throw new Error(`replay 缺少 ${caseRow.id}`);
  return parseVerdict(output, { ...DEFAULT_JUDGE });
}

function predictionVerdict(caseRow, predictions) {
  const row = predictions.get(caseRow.id);
  if (!row) throw new Error(`predictions 缺少 ${caseRow.id}`);
  if (row.error) throw new Error(`${caseRow.id}: ${row.error}`);
  if (typeof row.shouldRecord !== 'boolean') throw new Error(`${caseRow.id}: shouldRecord 缺失`);
  return {
    shouldRecord: row.shouldRecord,
    reason: row.reason || '',
    atoms: row.shouldRecord && row.type ? [{ type: row.type }] : [],
  };
}

function ratio(a, b) {
  return b ? a / b : 0;
}

function summarize(cases, promptVersion, opts) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  const falsePositive = [];
  const falseNegative = [];
  const typeHits = { hit: 0, total: 0 };
  for (const row of cases) {
    const expected = row.case.shouldRecord === true;
    const predicted = row.predicted.shouldRecord === true;
    if (expected && predicted) {
      tp += 1;
      const expectedType = row.case.type || null;
      const predictedType = row.predicted.atoms?.[0]?.type || null;
      if (expectedType) {
        typeHits.total += 1;
        if (expectedType === predictedType) typeHits.hit += 1;
      }
    } else if (!expected && predicted) {
      fp += 1;
      falsePositive.push(row.case.id);
    } else if (expected && !predicted) {
      fn += 1;
      falseNegative.push(row.case.id);
    } else {
      tn += 1;
    }
  }
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 = ratio(2 * precision * recall, precision + recall);
  return {
    generatedAt: new Date().toISOString(),
    adapter: opts.adapter,
    promptVersion,
    model: opts.model || null,
    total: cases.length,
    confusion: { tp, fp, fn, tn },
    metrics: { precision, recall, f1, accuracy: ratio(tp + tn, cases.length), typeAccuracy: ratio(typeHits.hit, typeHits.total) },
    falsePositive,
    falseNegative,
  };
}

async function main() {
  const goldenFile = path.resolve(arg('golden', path.join(ROOT, '_meta', 'rules', 'golden.jsonl')));
  const adapter = arg('adapter', 'fixture');
  const outFile = path.resolve(arg('out', path.join(ROOT, '_meta', 'state', `judge-eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)));
  const opts = {
    adapter,
    baseUrl: arg('base-url', process.env.KB_JUDGE_BASE_URL || 'https://api.deepseek.com'),
    model: arg('model', process.env.KB_JUDGE_MODEL || 'deepseek-flash'),
    maxTokens: Math.max(128, Number(arg('max-tokens', 2000)) || 2000),
    timeoutMs: Math.max(5000, Number(arg('timeout-ms', 90000)) || 90000),
    promptVersion: arg('prompt-version', DEFAULT_JUDGE.promptVersion),
  };
  if (!fs.existsSync(goldenFile)) throw new Error(`黄金集不存在：${goldenFile}`);
  const golden = readJsonl(goldenFile);
  if (!golden.length) throw new Error('黄金集为空');
  if (has('min-cases') && golden.length < Number(arg('min-cases'))) {
    throw new Error(`黄金集只有 ${golden.length} 条，少于 --min-cases`);
  }

  let replay = new Map();
  let predictions = new Map();
  if (adapter === 'replay') {
    const replayFile = path.resolve(arg('replay', ''));
    if (!replayFile || !fs.existsSync(replayFile)) throw new Error('--adapter replay 需要 --replay FILE');
    replay = new Map(readJsonl(replayFile).map((row) => [row.id, row.output]));
  }
  if (adapter === 'predictions') {
    const predictionFile = path.resolve(arg('predictions', ''));
    if (!predictionFile || !fs.existsSync(predictionFile)) throw new Error('--adapter predictions 需要 --predictions FILE');
    predictions = new Map(readJsonl(predictionFile).map((row) => [row.id, row]));
  }

  const cases = [];
  for (const caseRow of golden) {
    if (!caseRow.id || typeof caseRow.text !== 'string' || !caseRow.id) throw new Error('黄金集每条需要 id/text');
    if (typeof caseRow.shouldRecord !== 'boolean') throw new Error(`${caseRow.id}: shouldRecord 必须是布尔值`);
    const prompt = buildJudgePrompt(buildJob(caseRow), []);
    let predicted;
    if (adapter === 'fixture') predicted = fixtureVerdict(caseRow);
    else if (adapter === 'replay') predicted = replayVerdict(caseRow, replay);
    else if (adapter === 'predictions') predicted = predictionVerdict(caseRow, predictions);
    else if (adapter === 'http') predicted = await httpVerdict(caseRow, prompt, opts);
    else throw new Error(`未知 adapter：${adapter}`);
    cases.push({ case: caseRow, prompt, predicted });
  }

  const result = summarize(cases, opts.promptVersion, opts);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify({ ...result, cases }, null, 2)}\n`, 'utf8');

  const m = result.metrics;
  console.log(`golden=${result.total} adapter=${adapter} prompt=${result.promptVersion}`);
  console.log(`precision=${m.precision.toFixed(3)} recall=${m.recall.toFixed(3)} f1=${m.f1.toFixed(3)} accuracy=${m.accuracy.toFixed(3)} typeAcc=${m.typeAccuracy.toFixed(3)}`);
  console.log(`confusion tp=${result.confusion.tp} fp=${result.confusion.fp} fn=${result.confusion.fn} tn=${result.confusion.tn}`);
  if (result.falsePositive.length) console.log(`false-positive: ${result.falsePositive.join(', ')}`);
  if (result.falseNegative.length) console.log(`false-negative: ${result.falseNegative.join(', ')}`);
  console.log(`report=${outFile}`);

  const floor = arg('fail-below', '');
  if (floor && Number.isFinite(Number(floor)) && m.precision < Number(floor)) {
    console.error(`precision ${m.precision.toFixed(3)} < --fail-below ${floor}`);
    process.exitCode = 1;
  }
  if (adapter === 'fixture') {
    console.error('[eval-judge] fixture 只是确定性基线，不能当作真实裁判 precision 声明');
  }
}

main().catch((error) => {
  console.error(`[eval-judge] ${error && error.stack ? error.stack : error}`);
  process.exitCode = 1;
});
