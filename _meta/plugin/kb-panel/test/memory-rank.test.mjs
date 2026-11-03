import test from 'node:test';
import assert from 'node:assert/strict';

import { matchTokens, relevanceScore, reorderByRelevance } from '../memory-rank.mjs';

const note = (over = {}) => ({ id: 'n', title: '', summary: '', tags: [], scope: 'global', type: 'fact', ...over });

test('matchTokens: ASCII words are kept whole, CJK becomes bigrams', () => {
  const tokens = matchTokens('KB Panel 记忆库');
  assert.equal(tokens.has('kb'), true);
  assert.equal(tokens.has('panel'), true);
  assert.equal(tokens.has('记忆'), true);
  assert.equal(tokens.has('忆库'), true);
});

test('matchTokens: single CJK char and single ASCII char behavior', () => {
  const tokens = matchTokens('库 a');
  assert.equal(tokens.has('库'), true);
  assert.equal(tokens.has('a'), false, 'single ASCII chars are dropped');
});

test('relevanceScore: title hit beats no hit, coverage in [0,1]', () => {
  const target = note({ title: '界面 中文 版本', summary: '面板显示版本' });
  const score = relevanceScore('界面 中文', target);
  assert.ok(score > 0 && score <= 1);
  assert.equal(relevanceScore('界面', note({ title: '完全无关' })), 0);
});

test('relevanceScore: summary and tags count as note text', () => {
  assert.ok(relevanceScore('记忆库', note({ summary: '关于记忆库的说明' })) > 0);
  assert.ok(relevanceScore('发布', note({ tags: ['发布', '流程'] })) > 0);
});

test('relevanceScore: empty query or note yields 0', () => {
  assert.equal(relevanceScore('', note({ title: 'x' })), 0);
  assert.equal(relevanceScore('x', null), 0);
});

test('reorderByRelevance: relevant notes first, rest keep heat order', () => {
  const list = [
    note({ id: 'hot-irrelevant', title: '竞对商品', summary: '数据匹配' }),
    note({ id: 'relevant', title: '界面 中文', summary: '文案使用简体中文' }),
    note({ id: 'also-relevant', title: '中文 界面', summary: '路径英文' }),
    note({ id: 'cold-irrelevant', title: '插件制作' }),
  ];
  const ordered = reorderByRelevance(list, '界面 中文');
  assert.deepEqual(ordered.slice(0, 2).map((item) => item.id).sort(), ['also-relevant', 'relevant']);
  assert.deepEqual(ordered.slice(2).map((item) => item.id), ['hot-irrelevant', 'cold-irrelevant']);
});

test('reorderByRelevance: empty query returns the same order', () => {
  const list = [note({ id: 'b' }), note({ id: 'a' })];
  assert.deepEqual(reorderByRelevance(list, '').map((item) => item.id), ['b', 'a']);
  assert.deepEqual(reorderByRelevance(list, ' ').map((item) => item.id), ['b', 'a']);
});
