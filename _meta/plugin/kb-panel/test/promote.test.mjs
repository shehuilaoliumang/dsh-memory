import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMORY_TYPES,
  extractPoints,
  globalAtomSpec,
  isGlobalPromotable,
  localDateStamp,
} from '../../../engine/lib/promote.mjs';

function atom(overrides = {}) {
  return {
    id: '2026-11-02-a-0001',
    title: '界面文案用简体中文',
    level: 'digest',
    type: 'preference',
    status: 'active',
    scope: 'project:demo',
    summary: '界面文案统一简体中文，系统路径保持英文',
    tags: ['ui'],
    ...overrides,
  };
}

test('isGlobalPromotable accepts only confirmed digest atoms', () => {
  assert.equal(isGlobalPromotable(atom()), true);
  assert.equal(isGlobalPromotable(atom({ scope: 'global' })), true);
  assert.equal(isGlobalPromotable(atom({ status: 'inbox' })), false);
  assert.equal(isGlobalPromotable(atom({ level: 'canon' })), false);
  assert.equal(isGlobalPromotable(atom({ type: 'session' })), false);
  assert.equal(isGlobalPromotable(atom({ type: 'work' })), false);
  assert.equal(isGlobalPromotable(null), false);
  assert.equal(MEMORY_TYPES.has('topic'), false);
});

test('extractPoints reads only the 要点 section and caps at eight items', () => {
  const body = [
    '## 要点',
    '',
    '- 第一条要点',
    '- 第二条要点',
    '',
    '## 备注',
    '',
    '- 这不是要点',
  ].join('\n');
  assert.deepEqual(extractPoints(body), ['第一条要点', '第二条要点']);
  const many = ['## 要点', ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `- 要点 ${n}`)].join('\n');
  assert.equal(extractPoints(many).length, 8);
  assert.deepEqual(extractPoints('没有章节'), []);
});

test('globalAtomSpec builds a global active atom without cross-store links', () => {
  const spec = globalAtomSpec(atom(), '## 要点\n\n- 要点一\n- 要点二\n', {
    sourceLabel: '插件制作',
    date: '2026-11-02',
  });
  assert.equal(spec.scope, 'global');
  assert.equal(spec.status, 'active');
  assert.equal(spec.type, 'preference');
  assert.deepEqual(spec.points, ['要点一', '要点二']);
  assert.equal(spec.tags.length, 1);
  assert.match(spec.note, /2026-11-02-a-0001/);
  assert.match(spec.note, /插件制作/);
  for (const field of ['source', 'related', 'up', 'supersedes']) {
    assert.equal(spec[field], undefined, `${field} must not leak across stores`);
  }
});

test('globalAtomSpec falls back to summary and validates subject', () => {
  const spec = globalAtomSpec(atom({ summary: '', title: '标题兜底' }), '', {});
  assert.equal(spec.summary, '标题兜底');
  assert.deepEqual(spec.points, ['标题兜底']);
  assert.equal(globalAtomSpec(atom({ subject: 'ui-language' }), '', {}).subject, 'ui-language');
  assert.equal(globalAtomSpec(atom({ subject: 'Not A Slug' }), '', {}).subject, undefined);
});

test('localDateStamp returns a local YYYY-MM-DD date', () => {
  assert.equal(localDateStamp(new Date(2026, 10, 2)), '2026-11-02');
});
