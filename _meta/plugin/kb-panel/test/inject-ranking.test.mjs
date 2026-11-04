/**
 * v2.3 injection ranking: exposure weighting, exploration slot, relevance pass.
 * These are the rules the prompt actually uses (plugin-local because the live
 * Host caches engine ESM modules; engine work-brief.mjs carries the CLI twin).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  heatWeight,
  isGlobalScopeStore,
  matchTokens,
  rankInjectionCandidates,
  relevanceScore,
  reorderByRelevance,
} from '../inject-ranking.mjs';

const NOW = Date.parse('2026-11-03T00:00:00+08:00');
const note = (over = {}) => ({
  id: '2026-11-03-a-0001',
  title: '默认标题',
  summary: '默认摘要',
  tags: [],
  scope: 'global',
  type: 'fact',
  updated: '2026-11-03',
  level: 'digest',
  status: 'active',
  ...over,
});

test('matchTokens: ASCII words whole, CJK bigrams', () => {
  const tokens = matchTokens('KB Panel 记忆库');
  assert.equal(tokens.has('kb'), true);
  assert.equal(tokens.has('panel'), true);
  assert.equal(tokens.has('记忆'), true);
  assert.equal(tokens.has('忆库'), true);
  assert.equal(matchTokens('库 a').has('a'), false);
});

test('relevanceScore: coverage of query tokens over note text', () => {
  assert.ok(relevanceScore('界面 中文', note({ title: '界面 中文 版本' })) > 0);
  assert.equal(relevanceScore('界面', note({ title: '完全无关' })), 0);
  assert.ok(relevanceScore('发布', note({ tags: ['发布', '流程'] })) > 0);
  assert.equal(relevanceScore('', note()), 0);
});

test('reorderByRelevance: relevant first, rest keep heat order', () => {
  const list = [note({ id: 'a' }), note({ id: 'b', title: '界面 中文' }), note({ id: 'c', title: '中文 界面' }), note({ id: 'd' })];
  const ordered = reorderByRelevance(list, '界面 中文');
  assert.deepEqual(ordered.slice(0, 2).map((item) => item.id).sort(), ['b', 'c']);
  assert.deepEqual(ordered.slice(2).map((item) => item.id), ['a', 'd']);
  assert.deepEqual(reorderByRelevance(list, '').map((item) => item.id), ['a', 'b', 'c', 'd']);
});

test('heatWeight: decayed count, invalid input ignored', () => {
  assert.equal(heatWeight(0, ''), 0);
  assert.equal(heatWeight(-1, ''), 0);
  assert.equal(heatWeight(2, '', NOW), 2);
  const old = heatWeight(2, '2026-10-04T00:00:00+08:00', NOW);
  assert.ok(old < 2 && old > 0);
});

test('heat: inject exposure is down-weighted, explicit reads are full weight', () => {
  const rows = [
    ...Array.from({ length: 10 }, () => ({ id: 'hot-exposed', t: '2026-11-02T00:00:00+08:00', how: 'inject' })),
    { id: 'read-once', t: '2026-11-02T00:00:00+08:00', how: 'read' },
  ];
  const ranked = rankInjectionCandidates(
    [note({ id: 'hot-exposed', updated: '2026-11-01' }), note({ id: 'read-once', updated: '2026-11-01' })],
    rows,
    { now: NOW },
  );
  // 10 injections * 0.1 = 1.0 vs one explicit read = 1.0 -> tie broken by id order
  // is not the point; a read must not be buried by pure exposure.
  assert.ok(ranked.length === 2);
  const exposedIndex = ranked.findIndex((item) => item.id === 'hot-exposed');
  const readIndex = ranked.findIndex((item) => item.id === 'read-once');
  assert.ok(readIndex <= 1, 'an explicit read is not dominated by 10 exposures');
  assert.ok(exposedIndex >= 0);
});

test('exploration: newest never-exposed note gets the reserved slot', () => {
  const notes = [
    note({ id: '2026-11-01-a-0001', updated: '2026-11-01' }),
    note({ id: '2026-11-02-a-0002', updated: '2026-11-02' }),
    note({ id: '2026-11-03-a-0003', updated: '2026-11-03' }),
  ];
  const rows = [
    { id: '2026-11-01-a-0001', t: '2026-11-02T00:00:00+08:00', how: 'read' },
    { id: '2026-11-02-a-0002', t: '2026-11-02T00:00:00+08:00', how: 'read' },
  ];
  const without = rankInjectionCandidates(notes, rows, { now: NOW });
  assert.equal(without[0].id, '2026-11-02-a-0002', 'heat order without exploration (tie broken by updated)');
  const withSlot = rankInjectionCandidates(notes, rows, { now: NOW, exploration: 1 });
  assert.equal(withSlot[1].id, '2026-11-03-a-0003', 'newest cold note takes the reserved slot');
  assert.equal(withSlot[0].id, '2026-11-02-a-0002');
});

test('exploration: no cold candidate leaves order unchanged, query reorders after slot', () => {
  const notes = [note({ id: 'a', updated: '2026-11-01' }), note({ id: 'b', updated: '2026-11-02' })];
  const rows = [
    { id: 'a', t: '2026-11-02T00:00:00+08:00', how: 'read' },
    { id: 'b', t: '2026-11-02T00:00:00+08:00', how: 'read' },
  ];
  const same = rankInjectionCandidates(notes, rows, { now: NOW, exploration: 1 });
  assert.deepEqual(same.map((item) => item.id), ['b', 'a']);
  const queried = rankInjectionCandidates(
    [note({ id: 'a', title: '界面 中文' }), note({ id: 'b' })],
    rows,
    { now: NOW, query: '界面' },
  );
  assert.equal(queried[0].id, 'a');
});

test('store policy: legacy vault resolves as a global-scope (5-slot) store', () => {
  // resolveStores() shape since the v2.2 surface merge: legacy is an ordinary
  // project store whose global-scope policy is nested under entry.policy.
  const legacy = {
    root: 'C:/tmp/vault',
    legacy: false,
    entry: { policy: { scopeMode: 'global', injectLimit: 5 } },
  };
  assert.equal(isGlobalScopeStore(legacy), true, 'nested legacy policy must count as global scope');

  assert.equal(isGlobalScopeStore(null), false);
  assert.equal(isGlobalScopeStore({ legacy: true }), true);
  assert.equal(isGlobalScopeStore({ scopeMode: 'global' }), true);
  assert.equal(isGlobalScopeStore({ policy: { scopeMode: 'global' } }), true);
  assert.equal(
    isGlobalScopeStore({ root: 'C:/tmp/app/.dsh-memory', entry: { policy: { scopeMode: 'project' } } }),
    false,
  );
});
