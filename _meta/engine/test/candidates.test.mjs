import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_AUTO_ACTIVATE,
  autoActivateDecision,
  candidateNote,
  detectExplicitMemory,
  enrichCandidate,
  resolveAutoActivateConfig,
  summarizeFeedback,
  textSimilarity,
} from '../lib/candidates.mjs';

const atom = () => ({
  title: '项目使用中文界面',
  type: 'preference',
  scope: 'project:demo',
  subject: 'ui-language',
  supersedes: [],
  summary: '项目界面一律中文，路径英文',
  points: ['界面中文'],
  tags: ['language'],
  confidence: 0.6,
});

test('detectExplicitMemory: strong request scores 1', () => {
  const result = detectExplicitMemory('请记住：这个项目以后都用中文界面。');
  assert.equal(result.explicit, true);
  assert.equal(result.score, 1);
});

test('detectExplicitMemory: soft convention scores 0.7', () => {
  const result = detectExplicitMemory('以后不要用英文写界面。');
  assert.equal(result.explicit, true);
  assert.equal(result.score, 0.7);
});

test('detectExplicitMemory: ordinary progress is not explicit', () => {
  assert.equal(detectExplicitMemory('今天先把搜索改成向量召回。').explicit, false);
});

test('summarizeFeedback: counts accepted/rejected and rate', () => {
  const stats = summarizeFeedback([
    { atomId: 'a', from: 'inbox', to: 'active', accepted: true, at: '2026-01-01T00:00:00Z' },
    { atomId: 'b', from: 'inbox', to: 'active' },
    { atomId: 'c', from: 'inbox', to: 'archived', accepted: false },
    { atomId: 'd', from: 'inbox', to: 'review' },
  ]);
  assert.equal(stats.samples, 3);
  assert.equal(stats.accepted, 2);
  assert.equal(stats.rejected, 1);
  assert.equal(stats.acceptRate, 0.667);
  assert.equal(stats.lastAt, '2026-01-01T00:00:00Z');
});

test('summarizeFeedback: malformed rows do not throw', () => {
  const stats = summarizeFeedback([null, 'x', {}]);
  assert.equal(stats.samples, 0);
  assert.equal(stats.acceptRate, 0);
});

test('resolveAutoActivateConfig: disabled by default and merges thresholds', () => {
  assert.equal(DEFAULT_AUTO_ACTIVATE.enabled, false);
  const cfg = resolveAutoActivateConfig({ enabled: true, minConfidence: 0.9 });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.minConfidence, 0.9);
  assert.equal(cfg.minFeedback, 5);
});

test('enrichCandidate: explicit memory raises confidence and records hint', () => {
  const out = enrichCandidate({
    atom: atom(),
    text: '请记住，项目界面一律中文。',
    knownRows: [],
    sessionScope: 'project:demo',
    storeKind: 'project',
  });
  assert.equal(out.explicit, true);
  assert.ok(out.confidence >= 0.8);
  assert.ok(out.suggestions.some((item) => item.kind === 'explicit'));
  assert.match(candidateNote(out), /显式记忆/);
});

test('enrichCandidate: suggests subject from a similar existing row', () => {
  const out = enrichCandidate({
    atom: { ...atom(), subject: '', title: '界面语言统一中文', summary: '项目界面一律中文，路径英文' },
    text: '界面语言用中文。',
    knownRows: [
      { id: '2026-01-01-a-0001', status: 'active', level: 'digest', subject: 'ui-language', title: '界面语言', summary: '项目界面一律中文' },
    ],
    sessionScope: 'project:demo',
    storeKind: 'project',
  });
  const subject = out.suggestions.find((item) => item.kind === 'subject');
  assert.ok(subject);
  assert.equal(subject.value, 'ui-language');
});

test('enrichCandidate: same-subject older row gets a supersedes suggestion', () => {
  const out = enrichCandidate({
    atom: atom(),
    text: '项目界面以后只用中文。',
    knownRows: [
      { id: '2026-01-01-a-0001', status: 'active', level: 'digest', subject: 'ui-language', summary: '项目界面一律中文' },
    ],
    sessionScope: 'project:demo',
    storeKind: 'project',
  });
  assert.ok(out.suggestions.some((item) => item.kind === 'supersedes' && item.id === '2026-01-01-a-0001'));
});

test('autoActivateDecision: disabled by default', () => {
  const out = autoActivateDecision({
    atom: { ...atom(), explicit: true, confidence: 0.95 },
    feedback: { samples: 10, acceptRate: 1 },
    config: {},
    storeKind: 'project',
    sessionScope: 'project:demo',
  });
  assert.equal(out.status, 'inbox');
});

test('autoActivateDecision: explicit project atom with reliable feedback activates', () => {
  const out = autoActivateDecision({
    atom: { ...atom(), explicit: true, confidence: 0.9 },
    feedback: { samples: 8, acceptRate: 0.9 },
    config: { enabled: true },
    storeKind: 'project',
    sessionScope: 'project:demo',
  });
  assert.equal(out.status, 'active');
});

test('autoActivateDecision: global atoms stay manual', () => {
  const out = autoActivateDecision({
    atom: { ...atom(), scope: 'global', explicit: true, confidence: 0.95 },
    feedback: { samples: 20, acceptRate: 1 },
    config: { enabled: true },
    storeKind: 'project',
    sessionScope: 'project:demo',
  });
  assert.equal(out.status, 'inbox');
});

test('autoActivateDecision: insufficient feedback keeps inbox', () => {
  const out = autoActivateDecision({
    atom: { ...atom(), explicit: true, confidence: 0.95 },
    feedback: { samples: 2, acceptRate: 1 },
    config: { enabled: true },
    storeKind: 'project',
    sessionScope: 'project:demo',
  });
  assert.equal(out.status, 'inbox');
  assert.match(out.reason, /feedback/i);
});

test('autoActivateDecision: non-explicit candidate stays manual', () => {
  const out = autoActivateDecision({
    atom: { ...atom(), explicit: false, confidence: 0.95 },
    feedback: { samples: 20, acceptRate: 1 },
    config: { enabled: true },
    storeKind: 'project',
    sessionScope: 'project:demo',
  });
  assert.equal(out.status, 'inbox');
  assert.match(out.reason, /explicit/i);
});

test('textSimilarity: paraphrases beat unrelated text', () => {
  assert.ok(textSimilarity('项目界面一律中文', '项目界面只用中文') > textSimilarity('项目界面一律中文', '数据库迁移步骤'));
});
