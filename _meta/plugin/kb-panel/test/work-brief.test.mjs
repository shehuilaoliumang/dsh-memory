/**
 * Unit tests for the shared memory rules (work-brief.js): what may be injected
 * and how a work page becomes a resume brief. These are the two rules that the
 * panel counters and the actual prompt context both depend on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { briefText, clampText, currentTruthEntries, currentTruthNotes, heatWeight, isInjectable, pickBySource, pickBySourceControls, rankMemories, scopeLabel, sectionItems } from '../../../engine/lib/work-brief.mjs';
import { explainInjection } from '../../../engine/lib/injection-reasons.mjs';

const atom = (over = {}) => ({ level: 'digest', status: 'active', type: 'preference', scope: 'global', ...over });

test('isInjectable: confirmed global memory is visible', () => {
  assert.equal(isInjectable(atom(), 'global'), true);
});

test('isInjectable: inbox is never injected', () => {
  assert.equal(isInjectable(atom({ status: 'inbox' }), 'global'), false);
});

test('isInjectable: superseded truth is never injected', () => {
  assert.equal(isInjectable(atom({ status: 'superseded', subject: 'ui-language' }), 'global'), false);
});

test('heatWeight: recent recall outranks a much older hot note', () => {
  const now = Date.parse('2026-10-29T00:00:00Z');
  assert.ok(heatWeight(2, '2026-10-28T00:00:00Z', now, 30) > heatWeight(5, '2026-06-01T00:00:00Z', now, 30));
  assert.equal(heatWeight(0, '2026-10-28T00:00:00Z', now), 0);
});

test('rankMemories: superseded notes are excluded before ranking', () => {
  const notes = [
    atom({ id: '2026-10-20-a-0001', status: 'active', summary: 'old claim' }),
    atom({ id: '2026-10-29-a-0002', status: 'superseded', summary: 'new claim' }),
  ];
  const ranked = rankMemories(notes, [], 'global');
  assert.deepEqual(ranked.map((note) => note.id), ['2026-10-20-a-0001']);
});

test('currentTruthNotes: one active claim per subject, newest wins', () => {
  const notes = [
    atom({ id: '2026-10-20-a-0001', updated: '2026-10-20', subject: 'ui-language', summary: 'old' }),
    atom({ id: '2026-10-29-a-0002', updated: '2026-10-29', subject: 'ui-language', summary: 'new' }),
    atom({ id: '2026-10-28-a-0003', updated: '2026-10-28', summary: 'no subject' }),
  ];
  const picked = currentTruthNotes(notes, 'global');
  assert.deepEqual(picked.map((note) => note.id).sort(), ['2026-10-28-a-0003', '2026-10-29-a-0002']);
});

test('currentTruthNotes: newest subject claim beats a hotter older claim', () => {
  const notes = [
    atom({ id: '2026-10-20-a-0001', updated: '2026-10-20', subject: 'ui-language', summary: 'old' }),
    atom({ id: '2026-10-29-a-0002', updated: '2026-10-29', subject: 'ui-language', summary: 'new' }),
  ];
  const heat = [
    { id: '2026-10-20-a-0001', t: '2026-10-29T00:00:00Z' },
    { id: '2026-10-20-a-0001', t: '2026-10-29T00:00:00Z' },
    { id: '2026-10-20-a-0001', t: '2026-10-29T00:00:00Z' },
    { id: '2026-10-20-a-0001', t: '2026-10-29T00:00:00Z' },
  ];
  const ranked = rankMemories(notes, heat, 'global', { now: Date.parse('2026-10-29T00:00:00Z') });
  assert.deepEqual(ranked.map((note) => note.id), ['2026-10-29-a-0002']);
});

test('currentTruthEntries: newer project claim beats older global claim across stores', () => {
  const olderGlobal = atom({ id: '2026-10-20-a-0001', updated: '2026-10-20', subject: 'ui-language', summary: 'old global' });
  const newerProject = atom({
    id: '2026-10-29-a-0002',
    updated: '2026-10-29',
    subject: 'ui-language',
    scope: 'project:my-app',
    summary: 'new project',
  });
  const picked = currentTruthEntries([
    { note: olderGlobal, source: 'global' },
    { note: newerProject, source: 'project' },
  ], 'project:my-app');
  assert.deepEqual(picked.map((entry) => entry.note.id), ['2026-10-29-a-0002']);
});

test('currentTruthEntries: newer global claim beats older project claim across stores', () => {
  const olderProject = atom({
    id: '2026-10-20-a-0001',
    updated: '2026-10-20',
    subject: 'ui-language',
    scope: 'project:my-app',
    summary: 'old project',
  });
  const newerGlobal = atom({ id: '2026-10-29-a-0002', updated: '2026-10-29', subject: 'ui-language', summary: 'new global' });
  const picked = currentTruthEntries([
    { note: olderProject, source: 'project' },
    { note: newerGlobal, source: 'global' },
  ], 'project:my-app');
  assert.deepEqual(picked.map((entry) => entry.note.id), ['2026-10-29-a-0002']);
});

test('currentTruthEntries: subject-less memories from both stores survive', () => {
  const picked = currentTruthEntries([
    { note: atom({ id: '2026-10-20-a-0001', summary: 'global no subject' }), source: 'global' },
    { note: atom({ id: '2026-10-21-a-0002', summary: 'project no subject', scope: 'project:my-app' }), source: 'project' },
  ], 'project:my-app');
  assert.deepEqual(picked.map((entry) => entry.source), ['global', 'project']);
});

test('currentTruthEntries: a duplicate id from two stores keeps the newer copy only', () => {
  const staleProject = atom({
    id: '2026-10-20-a-0001',
    updated: '2026-10-20',
    scope: 'project:my-app',
    summary: 'stale copy',
  });
  const freshGlobal = atom({
    id: '2026-10-20-a-0001',
    updated: '2026-10-29',
    summary: 'fresh copy',
  });
  const picked = currentTruthEntries([
    { note: staleProject, source: 'project' },
    { note: freshGlobal, source: 'global' },
  ], 'project:my-app');
  assert.deepEqual(picked.map((entry) => entry.source), ['global']);
});

test('pickBySource: arbitration leaves the losing store budget empty, no duplicate', () => {
  const olderGlobal = atom({ id: '2026-10-20-a-0001', updated: '2026-10-20', subject: 'ui-language' });
  const newerProject = atom({
    id: '2026-10-29-a-0002',
    updated: '2026-10-29',
    subject: 'ui-language',
    scope: 'project:my-app',
  });
  const otherGlobal = atom({ id: '2026-10-21-a-0003', updated: '2026-10-21', subject: 'other' });
  const entries = currentTruthEntries([
    { note: olderGlobal, source: 'global', rank: 0 },
    { note: otherGlobal, source: 'global', rank: 1 },
    { note: newerProject, source: 'project', rank: 0 },
  ], 'project:my-app');
  const picked = pickBySource(entries, { globalLimit: 2, projectLimit: 3 });
  assert.deepEqual(picked.globalPicked.map((note) => note.id), ['2026-10-21-a-0003']);
  assert.deepEqual(picked.projectPicked.map((note) => note.id), ['2026-10-29-a-0002']);
});

test('pickBySource: source budgets are independent', () => {
  const entries = [
    { note: atom({ id: '2026-10-20-a-0001' }), source: 'global', rank: 0 },
    { note: atom({ id: '2026-10-20-a-0002' }), source: 'global', rank: 1 },
    { note: atom({ id: '2026-10-20-a-0003' }), source: 'global', rank: 2 },
    { note: atom({ id: '2026-10-20-a-0004', scope: 'project:my-app' }), source: 'project', rank: 0 },
  ];
  const picked = pickBySource(entries, { globalLimit: 2, projectLimit: 3 });
  assert.equal(picked.globalPicked.length, 2);
  assert.equal(picked.projectPicked.length, 1);
});

test('isInjectable: system scope never enters a global session', () => {
  assert.equal(isInjectable(atom({ scope: 'system' }), 'global'), false);
});

test('isInjectable: work page is never a memory even with a global scope', () => {
  assert.equal(isInjectable(atom({ type: 'work' }), 'global'), false);
});

test('isInjectable: topic page is never a memory even with a global scope', () => {
  assert.equal(isInjectable(atom({ type: 'topic' }), 'global'), false);
});

test('isInjectable: raw session rows are not memories', () => {
  assert.equal(isInjectable({ level: 'raw', status: 'active', type: 'session', scope: '' }, 'global'), false);
});

test('isInjectable: project memory only reaches its own project', () => {
  const note = atom({ scope: 'project:my-app' });
  assert.equal(isInjectable(note, 'project:my-app'), true);
  assert.equal(isInjectable(note, 'global'), false);
  assert.equal(isInjectable(note, 'project:other'), false);
  assert.equal(isInjectable(note, ''), false);
});

test('isInjectable: global memory is visible inside a project session too', () => {
  assert.equal(isInjectable(atom(), 'project:my-app'), true);
});

test('sectionItems: collects up to the limit and stops at the next heading', () => {
  const body = ['## 未决', '', '- 第一条', '- 第二条', '- 第三条', '- 第四条', '', '## 下一步', '- 不该被未决读到'].join('\n');
  assert.deepEqual(sectionItems(body, '未决', 3), ['第一条', '第二条', '第三条']);
  assert.deepEqual(sectionItems(body, '下一步', 3), ['不该被未决读到']);
  assert.deepEqual(sectionItems(body, '不存在', 3), []);
});

test('briefText: includes multiple open items instead of only the first', () => {
  const body = ['## 未决', '', '- 第一件', '- 第二件', '- 第三件', '', '## 下一步', '- 下一步甲', '- 下一步乙'].join('\n');
  const text = briefText({ scope: 'global', summary: '当前阶段摘要' }, body);
  for (const piece of ['第一件', '第二件', '第三件', '下一步甲', '下一步乙', '全局']) {
    assert.ok(text.includes(piece), `brief missing: ${piece}`);
  }
  assert.ok(!text.includes('第一件；第二件；第三件；第四件'));
});

test('briefText: caps each item and labels a project without the raw prefix', () => {
  const long = '很长的条目'.repeat(30);
  const body = ['## 未决', '', `- ${long}`].join('\n');
  const text = briefText({ scope: 'project:my-app', summary: '阶段' }, body);
  assert.ok(text.includes('项目简报 · my-app'));
  assert.ok(!text.includes('project:my-app'));
  assert.ok([...text].length < 300, `brief too long: ${[...text].length}`);
});

test('briefText: empty sections are omitted', () => {
  const text = briefText({ scope: 'global', summary: '只有摘要' }, '');
  assert.equal(text, '【项目简报 · 全局】只有摘要');
});

test('briefText: whole brief is hard-capped so a work page cannot flood the prompt', () => {
  const long = '很长的步骤'.repeat(20);
  const body = ['## 下一步', ...Array.from({ length: 6 }, () => `- ${long}`), '## 未决', ...Array.from({ length: 6 }, () => `- ${long}`)].join('\n');
  const text = briefText({ scope: 'global', summary: '摘要' }, body);
  assert.ok([...text].length <= 420, `brief length ${[...text].length} > 420`);
});

test('scopeLabel: known scopes are Chinese, project keeps its slug', () => {
  assert.equal(scopeLabel('global'), '全局');
  assert.equal(scopeLabel('system'), '系统');
  assert.equal(scopeLabel('project:my-app'), 'my-app');
  assert.equal(scopeLabel(''), '全局');
});

test('clampText: collapses whitespace and counts characters, not bytes', () => {
  assert.equal(clampText('  a\n\tb  ', 40), 'a b');
  assert.equal(clampText('中文中文中文', 2), '中文');
});

test('pickBySourceControls: muted notes never consume a slot', () => {
  const entries = [
    { note: { id: 'g1' }, source: 'global', rank: 0 },
    { note: { id: 'g2' }, source: 'global', rank: 1 },
    { note: { id: 'p1' }, source: 'project', rank: 0 },
    { note: { id: 'p2' }, source: 'project', rank: 1 },
    { note: { id: 'p3' }, source: 'project', rank: 2 },
  ];
  const out = pickBySourceControls(entries, {
    globalLimit: 2,
    projectLimit: 2,
    isMuted: (id) => id === 'g1' || id === 'p1',
  });
  assert.deepEqual(out.globalPicked.map((note) => note.id), ['g2']);
  assert.deepEqual(out.projectPicked.map((note) => note.id), ['p2', 'p3']);
});

test('pickBySourceControls: pinned first, budget still bounds the result', () => {
  const entries = [
    { note: { id: 'p1' }, source: 'project', rank: 0 },
    { note: { id: 'p2' }, source: 'project', rank: 1 },
    { note: { id: 'p3' }, source: 'project', rank: 2 },
    { note: { id: 'p4' }, source: 'project', rank: 3 },
  ];
  const out = pickBySourceControls(entries, {
    projectLimit: 2,
    isPinned: (id) => id === 'p4',
  });
  assert.deepEqual(out.projectPicked.map((note) => note.id), ['p4', 'p1']);
});

test('pickBySourceControls: no controls matches pickBySource, mute wins over pin', () => {
  const entries = [
    { note: { id: 'a' }, source: 'global', rank: 0 },
    { note: { id: 'b' }, source: 'global', rank: 1 },
    { note: { id: 'c' }, source: 'project', rank: 0 },
  ];
  const plain = pickBySource(entries, { globalLimit: 1, projectLimit: 1 });
  const controlled = pickBySourceControls(entries, { globalLimit: 1, projectLimit: 1 });
  assert.deepEqual(controlled, plain);
  const conflicting = pickBySourceControls(entries, {
    globalLimit: 2,
    isPinned: (id) => id === 'a',
    isMuted: (id) => id === 'a',
  });
  assert.deepEqual(conflicting.globalPicked.map((note) => note.id), ['b']);
});

test('rankMemories: inject exposure is down-weighted against explicit reads', () => {
  const notes = [
    atom({ id: '2026-11-01-a-0001', updated: '2026-11-01' }),
    atom({ id: '2026-11-02-a-0002', updated: '2026-11-02' }),
  ];
  const rows = [
    ...Array.from({ length: 10 }, () => ({ id: '2026-11-02-a-0002', t: '2026-11-02T00:00:00+08:00', how: 'inject' })),
    { id: '2026-11-01-a-0001', t: '2026-11-02T00:00:00+08:00', how: 'read' },
  ];
  const ranked = rankMemories(notes, rows, 'global', { now: Date.parse('2026-11-03T00:00:00+08:00') });
  assert.equal(ranked[0].id, '2026-11-01-a-0001', 'one explicit read is not dominated by 10 exposures');
});

test('rankMemories: exploration slot surfaces the newest never-exposed note', () => {
  const notes = [
    atom({ id: '2026-11-01-a-0001', updated: '2026-11-01' }),
    atom({ id: '2026-11-02-a-0002', updated: '2026-11-02' }),
    atom({ id: '2026-11-03-a-0003', updated: '2026-11-03' }),
  ];
  const rows = [
    { id: '2026-11-01-a-0001', t: '2026-11-02T00:00:00+08:00', how: 'read' },
    { id: '2026-11-02-a-0002', t: '2026-11-02T00:00:00+08:00', how: 'read' },
  ];
  const plain = rankMemories(notes, rows, 'global', { now: Date.parse('2026-11-03T00:00:00+08:00') });
  assert.equal(plain[0].id, '2026-11-02-a-0002', 'tie broken by updated');
  const explored = rankMemories(notes, rows, 'global', {
    now: Date.parse('2026-11-03T00:00:00+08:00'),
    exploration: 1,
  });
  assert.equal(explored[1].id, '2026-11-03-a-0003');
  assert.equal(explored[0].id, '2026-11-02-a-0002');
});

test('explainInjection: statuses and page layers explain the fail-closed path', () => {
  const notes = [
    atom({ id: 'a-inbox', status: 'inbox' }),
    atom({ id: 'a-canon', level: 'canon' }),
    atom({ id: 'a-topic', type: 'topic' }),
    atom({ id: 'a-noscope', scope: '' }),
    atom({ id: 'a-ok' }),
  ];
  const reasons = explainInjection({ notes, entries: [], scope: 'global', viewKind: 'global' });
  assert.equal(reasons['a-inbox'].label, '待确认');
  assert.equal(reasons['a-canon'].label, '结论层');
  assert.equal(reasons['a-topic'].label, '页面不是记忆');
  assert.equal(reasons['a-noscope'].state, 'no-scope');
  assert.equal(reasons['a-ok'].state, 'not-selected');
});

test('explainInjection: injected, muted, other-store and project isolation win by priority', () => {
  const notes = [
    atom({ id: 'a-in', status: 'inbox' }),
    atom({ id: 'a-muted' }),
    atom({ id: 'a-global', scope: 'global' }),
    atom({ id: 'a-other', scope: 'project:other' }),
  ];
  const reasons = explainInjection({
    notes,
    entries: [{ id: 'a-in' }],
    mutedIds: ['a-muted'],
    scope: 'project:demo',
    viewKind: 'project',
    inSessionStore: true,
  });
  assert.equal(reasons['a-in'].state, 'injected');
  assert.equal(reasons['a-muted'].state, 'muted');
  // Global memories are intentionally visible inside project sessions; only a
  // memory scoped to a different project is excluded.
  assert.equal(reasons['a-global'].state, 'not-selected');
  assert.equal(reasons['a-other'].state, 'scope');
  const other = explainInjection({ notes: [atom({ id: 'x' })], entries: [], inSessionStore: false });
  assert.equal(other.x.state, 'other-store');
});

test('explainInjection: subject replacement and full budget are distinguished', () => {
  const notes = [
    atom({ id: 'a-old', subject: 'deploy', updated: '2026-11-01' }),
    atom({ id: 'a-new', subject: 'deploy', updated: '2026-11-02' }),
    atom({ id: 'a-cold' }),
  ];
  const replaced = explainInjection({ notes, entries: [], scope: 'global' });
  assert.equal(replaced['a-old'].label, '同主题有更新');
  assert.equal(replaced['a-new'].state, 'not-selected');
  const full = explainInjection({
    notes: [atom({ id: 'a-cold' })],
    entries: ['1', '2', '3', '4', '5'].map((id) => ({ id })),
    scope: 'global',
  });
  assert.equal(full['a-cold'].state, 'budget');
});

test('explainInjection: cross-store subject winner explains a stale copy in one view', () => {
  // Session sees a legacy/global old claim and a newer project claim. Selection
  // arbitrates across both stores and injects only the newer one; the old copy
  // shown in the global view must say "replaced by <new id>", not "not selected".
  const oldGlobal = atom({ id: 'a-global-old', subject: 'deploy', updated: '2026-11-01' });
  const newProject = atom({
    id: 'a-project-new',
    subject: 'deploy',
    updated: '2026-11-02',
    scope: 'project:demo',
  });
  const reasons = explainInjection({
    notes: [oldGlobal],
    candidates: [newProject],
    entries: [{ id: 'a-project-new' }],
    scope: 'project:demo',
    viewKind: 'global',
  });
  assert.equal(reasons['a-global-old'].state, 'replaced');
  assert.match(reasons['a-global-old'].detail, /a-project-new/);
});

test('explainInjection: labels follow the selection snapshot, not a stale edit', () => {
  // Selection read `_meta/catalog.jsonl` (still active) while the note file was
  // manually archived without `rebuild`. The prompt injected the catalog copy,
  // so the label must say injected rather than claiming it was archived.
  const disk = atom({ id: 'a-stale', status: 'archived', subject: 'deploy' });
  const catalog = atom({ id: 'a-stale', status: 'active', subject: 'deploy' });
  const reasons = explainInjection({
    notes: [disk],
    candidates: [catalog],
    entries: [{ id: 'a-stale' }],
    scope: 'global',
    viewKind: 'global',
  });
  assert.equal(reasons['a-stale'].state, 'injected');
});
