/**
 * Unit tests for the step-3 judge's pure layer. The worker itself needs a Host
 * (llm + child process); everything that decides *what* reaches the knowledge
 * base is pure and covered here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  JUDGE_SYSTEM,
  clampText,
  similarity,
  dedupeAtoms,
  screeningMatches,
  selectExisting,
  parseVerdict,
  breakerOpen,
  breakerAfterFailure,
  breakerReset,
  buildJudgePrompt,
} from '../judge.js';

test('clampText: short text passes through unchanged', () => {
  assert.equal(clampText('中文标题', 40), '中文标题');
});

test('clampText: prefers a clause boundary over a hard cut', () => {
  const text = '用户要求界面文案一律用简体中文，代码与路径保持英文，这条要长期保留';
  const out = clampText(text, 24);
  assert.ok([...out].length <= 24);
  assert.ok(!out.endsWith('，'));
  assert.ok(text.startsWith(out));
});

test('clampText: never ends inside a latin token', () => {
  const text = '插件是 link: 安装，改源码后用 set_plugin 在 include:kb-panel 上禁用再启用';
  const out = clampText(text, 40);
  assert.ok([...out].length <= 40);
  // A cut inside `include:kb-panel` would leave `include:k` / `include:` behind.
  assert.ok(!/include:k/.test(out));
  assert.ok(!/[:;,，、；]$/.test(out));
});

test('clampText: short text is returned verbatim (no rewrite)', () => {
  assert.equal(clampText('决定：路径用英文。', 40), '决定：路径用英文。');
});

test('clampText: a truncated result drops trailing punctuation', () => {
  const text = '决定：路径用英文，界面显示中文，所有时间戳都取系统时钟不要模型估计';
  const out = clampText(text, 18);
  assert.ok([...out].length <= 18);
  assert.ok(!/[：:，,。；;！!？?]$/u.test(out));
});

test('similarity: identical text scores 1 regardless of punctuation', () => {
  assert.equal(similarity('用户喜欢简体中文', '用户喜欢简体中文。'), 1);
});

test('similarity: unrelated text scores 0', () => {
  assert.equal(similarity('用户喜欢简体中文', '原文层只收对话文本'), 0);
});

test('dedupeAtoms: drops an atom that restates a catalog row', () => {
  const known = [{ id: '2026-10-20-a-0001', summary: '补记修复记录时只追加，不重写已有内容' }];
  const atoms = [
    { title: '记录追加原则', summary: '补记修复记录时只追加，不重写已有内容' },
    { title: '全新偏好', summary: '用户要求界面文案一律用简体中文' },
  ];
  const { atoms: kept, dropped } = dedupeAtoms(atoms, known, 0.9);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].title, '全新偏好');
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].against, '2026-10-20-a-0001');
});

test('dedupeAtoms: drops a duplicate later in the same batch', () => {
  const atoms = [
    { title: '同一件事', summary: '用户要求界面文案一律用简体中文' },
    { title: '换了个标题', summary: '用户要求界面文案一律用简体中文' },
  ];
  const { atoms: kept, dropped } = dedupeAtoms(atoms, [], 0.9);
  assert.equal(kept.length, 1);
  assert.equal(dropped[0].against, 'batch');
});

test('dedupeAtoms: keeps everything when the threshold is unreachable', () => {
  const known = [{ id: 'x', summary: '完全不同的内容' }];
  const atoms = [{ title: 'a', summary: '用户要求界面文案一律用简体中文' }];
  assert.equal(dedupeAtoms(atoms, known, 0.9).atoms.length, 1);
});

test('screeningMatches: filters by floor, sorts desc, and caps the list', () => {
  const known = [
    { id: 'a1', summary: '用户要求界面文案一律用简体中文' },
    { id: 'a2', summary: '用户要求界面文案一律用简体中文并保持英文路径' },
    { id: 'a3', summary: '原文层只收对话文本' },
    { id: 'a4', summary: '无论什么内容都完全不相干' },
  ];
  const out = screeningMatches(['记一下：界面文案用简体中文'], known, 2, 0.2);
  assert.ok(out.length <= 2);
  assert.ok(out.every((row) => row.score >= 0.2));
  for (let i = 1; i < out.length; i += 1) assert.ok(out[i - 1].score >= out[i].score);
  assert.ok(!out.some((row) => row.id === 'a4'));
});

test('screeningMatches: returns nothing for unrelated candidates', () => {
  const known = [{ id: 'a1', summary: '原文层只收对话文本' }];
  assert.deepEqual(screeningMatches(['完全无关的一句话'], known, 8, 0.25), []);
});

test('selectExisting: canon rows are always shown, even at similarity 0', () => {
  const known = [
    { id: '2026-10-20-c-0007', summary: '裁判写入默认 inbox，必须显式确认才转为 active 进入注入', level: 'canon' },
    { id: '2026-10-20-a-0009', summary: '界面文案用中文', level: 'digest' },
  ];
  const out = selectExisting(known, ['自动抽取的记忆须用户确认后才注入']);
  assert.ok(out.some((row) => row.id === '2026-10-20-c-0007'));
});

test('selectExisting: fills remaining slots from screened matches without duplicates', () => {
  const known = [
    { id: 'c1', summary: '用户要求界面文案一律用简体中文', level: 'canon' },
    { id: 'a1', summary: '用户要求界面文案一律用简体中文', level: 'digest' },
    { id: 'a2', summary: '完全不相干的内容', level: 'digest' },
  ];
  const out = selectExisting(known, ['记一下：界面文案用简体中文'], { matchLimit: 4, floor: 0.2 });
  assert.equal(out.filter((row) => row.id === 'c1').length, 1);
  assert.equal(out.filter((row) => row.id === 'a1').length, 1);
  assert.equal(out.length, 2);
});

test('selectExisting: canon cap holds when the vault has many decisions', () => {
  const known = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, summary: `决策 ${i}`, level: 'canon' }));
  const out = selectExisting(known, ['无关'], { canonLimit: 3 });
  assert.equal(out.length, 3);
});

test('parseVerdict: accepts plain JSON', () => {
  const verdict = parseVerdict(JSON.stringify({ shouldRecord: true, reason: 'ok', atoms: [] }));
  assert.equal(verdict.shouldRecord, true);
  assert.equal(verdict.reason, 'ok');
  assert.deepEqual(verdict.atoms, []);
});

test('parseVerdict: strips a ```json fence', () => {
  const body = JSON.stringify({ shouldRecord: false, reason: '过程性信息', atoms: [] });
  const verdict = parseVerdict('```json\n' + body + '\n```');
  assert.equal(verdict.shouldRecord, false);
  assert.equal(verdict.reason, '过程性信息');
});

test('parseVerdict: salvages JSON embedded in prose', () => {
  const body = JSON.stringify({ shouldRecord: true, reason: '偏好', atoms: [] });
  const verdict = parseVerdict(`好的，这是结果：${body} 以上。`);
  assert.equal(verdict.shouldRecord, true);
});

test('parseVerdict: normalizes atoms and drops unusable ones', () => {
  const verdict = parseVerdict(
    JSON.stringify({
      shouldRecord: true,
      atoms: [
        { title: '缺 summary', type: 'fact', points: ['x'] },
        { title: '类型不认识', type: 'nonsense', summary: '会被降级成 fact', points: ['要点'] },
        { title: 'A', summary: 'B', type: 'preference', points: [], quote: '原话' },
      ],
    }),
  );
  assert.equal(verdict.atoms.length, 2);
  assert.equal(verdict.atoms[0].type, 'fact');
  // an atom with no points still survives when it carries a quote
  assert.equal(verdict.atoms[1].title, 'A');
});

test('parseVerdict: keeps valid subject/supersedes and drops malformed ones', () => {
  const verdict = parseVerdict(
    JSON.stringify({
      shouldRecord: true,
      atoms: [
        {
          title: '新结论',
          summary: '取代旧结论',
          type: 'fact',
          points: ['要点'],
          subject: 'ui-language-paths',
          supersedes: ['[[2026-10-20-a-0009]]', 'not-an-id'],
        },
        { title: '坏主题', summary: '主题格式不对', type: 'fact', points: ['要点'], subject: 'BAD Subject' },
      ],
    }),
  );
  assert.equal(verdict.atoms[0].subject, 'ui-language-paths');
  assert.deepEqual(verdict.atoms[0].supersedes, ['2026-10-20-a-0009']);
  assert.equal(verdict.atoms[1].subject, '');
});

test('parseVerdict: clamps summary length and caps atom count', () => {
  const atoms = Array.from({ length: 6 }, (_, i) => ({
    title: `t${i}`,
    summary: '很长的摘要'.repeat(20),
    type: 'fact',
    points: ['要点'],
  }));
  const verdict = parseVerdict(JSON.stringify({ shouldRecord: true, atoms }));
  assert.ok(verdict.atoms.length <= 2);
  for (const atom of verdict.atoms) assert.ok([...atom.summary].length <= 40);
});

test('parseVerdict: honours runtime limits instead of the defaults', () => {
  const atoms = [{ title: 'a', summary: '很长的摘要内容'.repeat(10), type: 'fact', points: ['要点'] }];
  const verdict = parseVerdict(JSON.stringify({ shouldRecord: true, atoms }), { summaryMaxChars: 8, maxAtomsPerJob: 1 });
  assert.equal(verdict.atoms.length, 1);
  assert.ok([...verdict.atoms[0].summary].length <= 8);
});

test('parseVerdict: rejects unparseable output with a useful message', () => {
  assert.throws(() => parseVerdict('完全不像是 JSON'), /不是 JSON/);
});

test('JUDGE_SYSTEM is exported and states the hard exclusions', () => {
  assert.equal(typeof JUDGE_SYSTEM, 'string');
  assert.ok(JUDGE_SYSTEM.length > 200);
  for (const phrase of ['对 AI 助手的操作指令', '尚未完成', '知识库系统自身的实现细节', '工具用法']) {
    assert.ok(JUDGE_SYSTEM.includes(phrase), `missing exclusion: ${phrase}`);
  }
  for (const field of ['scope', 'points', 'quote', 'confidence']) {
    assert.ok(JUDGE_SYSTEM.includes(field), `missing output field: ${field}`);
  }
});

test('breaker: opens only after the configured consecutive failures', () => {
  const now = Date.parse('2026-10-29T00:00:00Z');
  let state = {};
  state = breakerAfterFailure(state, { breakerThreshold: 3, breakerCooldownMs: 60_000 }, now);
  assert.equal(state.consecutiveFailures, 1);
  assert.equal(state.breakerUntil, null);
  state = breakerAfterFailure(state, { breakerThreshold: 3, breakerCooldownMs: 60_000 }, now);
  assert.equal(state.consecutiveFailures, 2);
  assert.equal(breakerOpen(state, now), false);
  state = breakerAfterFailure(state, { breakerThreshold: 3, breakerCooldownMs: 60_000 }, now);
  assert.equal(state.consecutiveFailures, 3);
  assert.equal(breakerOpen(state, now), true);
  assert.equal(breakerOpen(state, now + 60_001), false);
});

test('breaker: reset clears both failure count and open window', () => {
  const open = { consecutiveFailures: 3, breakerUntil: '2026-10-29T01:00:00.000Z' };
  assert.deepEqual(breakerReset(), { consecutiveFailures: 0, breakerUntil: null });
  assert.equal(breakerOpen(open, Date.parse('2026-10-29T00:30:00Z')), true);
  assert.equal(breakerOpen({}, Date.parse('2026-10-29T00:30:00Z')), false);
});

test('prompt redacts secrets before they reach the model', () => {
  const fakeSk = 'sk-' + 'proj-abcdefghijklmnopqrstuvwx';
  const prompt = buildJudgePrompt({
    sessionId: 's',
    raw: 'api_key = "abcdEFGH12345678"',
    candidates: [{ text: `token ${fakeSk}` }],
  }, [{ id: 'x', summary: 'password: hunter2long' }]);
  assert.doesNotMatch(prompt, /abcdEFGH12345678/);
  assert.equal(prompt.includes(fakeSk), false);
  assert.doesNotMatch(prompt, /hunter2long/);
  assert.match(prompt, /\[REDACTED/);
});
