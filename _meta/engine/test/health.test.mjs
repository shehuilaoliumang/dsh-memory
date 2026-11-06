#!/usr/bin/env node
/**
 * Unit tests for `_meta/engine/lib/health.mjs` — the pure memory-health report.
 *
 * The module has no filesystem dependency, so every fixture lives in memory; no
 * temp directory is created here. Run from the repo root:
 *
 *   node --test --test-isolation=none _meta/engine/test/health.test.mjs
 *
 * (`--test-isolation=none` sidesteps the sandbox EPERM that a forked child
 * `node --test` can hit on this machine.)
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HEALTH_KINDS,
  HEALTH_SEVERITIES,
  analyzeMemoryHealth,
  healthSummary,
} from '../lib/health.mjs';

// Fixed clock (UTC) so `ageDays` and `generatedAt` assertions are exact.
const NOW = Date.UTC(2026, 10, 6); // 2026-11-06T00:00:00.000Z
const DAY = 86400000;

/** `YYYY-MM-DD` for a day offset from NOW (negative = past). */
function day(offsetDays) {
  return new Date(NOW + offsetDays * DAY).toISOString().slice(0, 10);
}

let sequence = 0;

/** A neutral active digest note; every default is unique to avoid accidental groups. */
function note(overrides = {}) {
  const id = overrides.id !== undefined ? overrides.id : `note-${++sequence}`;
  return {
    id,
    title: `fixture ${id}`,
    type: 'fact',
    status: 'active',
    scope: 'global',
    subject: `subject-${id}`,
    summary: `summary ${id}`,
    updated: '2026-11-01',
    ...overrides,
  };
}

function analyze(options = {}) {
  return analyzeMemoryHealth({ now: NOW, ...options });
}

function kinds(report) {
  return report.issues.map((item) => item.kind);
}

function issue(report, kind) {
  return report.issues.find((item) => item.kind === kind);
}

function ofKind(report, kind) {
  return report.issues.filter((item) => item.kind === kind);
}

// ---------------------------------------------------------------- constants

test('exports stable severities and issue kinds', () => {
  assert.deepEqual(HEALTH_SEVERITIES, ['error', 'warn', 'info']);
  assert.deepEqual(HEALTH_KINDS, [
    'conflict',
    'orphan-supersedes',
    'pending-supersedes',
    'missing-subject',
    'scope-mismatch',
    'stale',
    'review-due',
    'duplicate',
    'unclassified',
    'low-recall',
  ]);
});

// --------------------------------------------------------------- empty store

test('empty store is healthy and deterministic', () => {
  const report = analyze();
  assert.equal(report.ok, true);
  assert.equal(report.generatedAt, '2026-11-06T00:00:00.000Z');
  assert.deepEqual(report.counts, { error: 0, warn: 0, info: 0 });
  assert.deepEqual(report.issues, []);
  assert.deepEqual(Object.keys(report.byKind), HEALTH_KINDS);
  assert.ok(HEALTH_KINDS.every((kind) => report.byKind[kind] === 0));
  assert.deepEqual(healthSummary(report), {
    ok: true,
    counts: { error: 0, warn: 0, info: 0 },
    headline: '未发现问题',
  });
});

// ---------------------------------------------------------------- conflicts

test('conflict: two active digest notes sharing a subject', () => {
  const report = analyze({
    notes: [
      note({ id: 'a-1', subject: 'deploy' }),
      note({ id: 'a-2', subject: 'deploy' }),
    ],
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.counts, { error: 1, warn: 0, info: 0 });
  const conflict = issue(report, 'conflict');
  assert.equal(conflict.severity, 'error');
  assert.deepEqual(conflict.ids, ['a-1', 'a-2']);
  assert.match(conflict.message, /deploy/);
  assert.match(conflict.message, /2 条/);
});

test('conflict ignores pages and inactive notes', () => {
  const report = analyze({
    notes: [
      note({ id: 't-1', type: 'topic', subject: 'shared' }),
      note({ id: 'w-1', type: 'work', level: 'digest', subject: 'shared' }),
      note({ id: 'a-1', subject: 'shared' }),
      note({ id: 'a-2', subject: 'shared', status: 'inbox' }),
    ],
  });
  assert.deepEqual(kinds(report), []);
});

// --------------------------------------------------------- supersedes edges

test('orphan-supersedes: missing target is an error', () => {
  const report = analyze({
    notes: [note({ id: 'a-1', supersedes: ['2026-10-01-a-0000'] })],
  });
  const orphan = issue(report, 'orphan-supersedes');
  assert.equal(orphan.severity, 'error');
  assert.deepEqual(orphan.ids, ['a-1']);
  assert.match(orphan.message, /2026-10-01-a-0000/);
  assert.deepEqual(kinds(report), ['orphan-supersedes']);
});

test('orphan-supersedes resolves [[link]] form to an existing note', () => {
  const report = analyze({
    notes: [
      note({ id: 'a-1', supersedes: ['[[2026-10-01-a-0000]]'] }),
      note({ id: '2026-10-01-a-0000', status: 'superseded', updated: '2026-10-01' }),
    ],
  });
  assert.equal(issue(report, 'orphan-supersedes'), undefined);
  assert.equal(issue(report, 'pending-supersedes'), undefined);
});

test('orphan-supersedes accepts a target known only from catalogRows', () => {
  const report = analyze({
    notes: [note({ id: 'a-1', supersedes: ['catalog-target'] })],
    catalogRows: [{
      id: 'catalog-target',
      level: 'digest',
      type: 'fact',
      status: 'superseded',
      scope: 'global',
      subject: 'subject-a-1',
      summary: 'old',
      updated: '2026-01-01',
    }],
  });
  assert.equal(issue(report, 'orphan-supersedes'), undefined);
});

test('pending-supersedes: target is still active', () => {
  const report = analyze({
    notes: [
      note({ id: 'new-1', subject: 's-new', supersedes: ['old-1'] }),
      note({ id: 'old-1', subject: 's-old' }),
    ],
  });
  const pending = issue(report, 'pending-supersedes');
  assert.equal(pending.severity, 'warn');
  assert.deepEqual(pending.ids, ['new-1', 'old-1']);
  assert.deepEqual(report.counts, { error: 0, warn: 1, info: 0 });
});

// ---------------------------------------------------------- missing subject

test('missing-subject only for active digest notes', () => {
  const report = analyze({
    notes: [
      note({ id: 'a-1', subject: '' }),
      note({ id: 'a-2', subject: '', status: 'inbox' }),
      note({ id: 'c-1', subject: '', level: 'canon', status: 'active' }),
    ],
  });
  const missing = issue(report, 'missing-subject');
  assert.deepEqual(missing.ids, ['a-1']);
  assert.equal(missing.severity, 'warn');
  assert.deepEqual(report.counts, { error: 0, warn: 1, info: 0 });
});

// ---------------------------------------------------------- scope mismatch

test('scope-mismatch flags global and other-project scopes in a project store', () => {
  const report = analyze({
    storeKind: 'project',
    storeSlug: 'alpha',
    notes: [
      note({ id: 'own-1', subject: 's1', scope: 'project:alpha' }),
      note({ id: 'leak-1', subject: 's2', scope: 'global' }),
      note({ id: 'other-1', subject: 's3', scope: 'project:beta' }),
      note({ id: 'empty-1', subject: 's4', scope: '' }),
    ],
  });
  const mismatch = ofKind(report, 'scope-mismatch');
  assert.equal(mismatch.length, 2);
  assert.deepEqual(mismatch.map((item) => item.ids[0]), ['leak-1', 'other-1']);
  assert.ok(mismatch.every((item) => item.severity === 'warn'));
  assert.match(mismatch[0].detail, /project:alpha/);
  // `empty-1` is an unclassified info issue, not a scope mismatch.
  assert.deepEqual(ofKind(report, 'unclassified').map((item) => item.ids[0]), ['empty-1']);
});

test('scope-mismatch without storeSlug only flags global leaks', () => {
  const report = analyze({
    storeKind: 'project',
    notes: [
      note({ id: 'g-1', subject: 's1', scope: 'global' }),
      note({ id: 'p-1', subject: 's2', scope: 'project:beta' }),
    ],
  });
  const mismatch = ofKind(report, 'scope-mismatch');
  assert.equal(mismatch.length, 1);
  assert.deepEqual(mismatch[0].ids, ['g-1']);
});

test('scope-mismatch never fires outside project stores', () => {
  for (const storeKind of ['legacy', 'global', undefined]) {
    const report = analyze({ storeKind, notes: [note({ id: 'leak-2', scope: 'global' })] });
    assert.equal(issue(report, 'scope-mismatch'), undefined);
  }
});

// ------------------------------------------------------------------- stale

test('stale: old and unnoted notes only', () => {
  const report = analyze({
    notes: [
      note({ id: 'old-1', subject: 's1', updated: day(-400) }),
      note({ id: 'fresh-1', subject: 's2', updated: day(-10) }),
      note({ id: 'recalled-1', subject: 's3', updated: day(-400) }),
    ],
    accessRows: [
      { id: 'recalled-1', at: new Date(NOW - 5 * DAY).toISOString(), how: 'read' },
    ],
  });
  const stale = issue(report, 'stale');
  assert.equal(stale.severity, 'warn');
  assert.deepEqual(stale.ids, ['old-1']);
  assert.equal(stale.ageDays, 400);
  assert.match(stale.message, /180 天/);
  assert.deepEqual(report.counts, { error: 0, warn: 1, info: 2 });
});

test('stale ignores recall older than the access window', () => {
  const report = analyze({
    notes: [note({ id: 'n-1', updated: day(-400) })],
    accessRows: [{ id: 'n-1', at: day(-120), how: 'read' }],
  });
  assert.ok(issue(report, 'stale'));
});

test('stale honors limits and skips malformed dates', () => {
  const report = analyze({
    limits: { staleDays: 30, accessWindowDays: 7 },
    notes: [
      note({ id: 'n-1', subject: 's1', updated: day(-40) }),
      note({ id: 'bad-1', subject: 's2', updated: 'not-a-date' }),
      note({ id: 'future-1', subject: 's3', updated: day(10) }),
    ],
  });
  const stale = ofKind(report, 'stale');
  assert.equal(stale.length, 1);
  assert.deepEqual(stale[0].ids, ['n-1']);
  assert.equal(stale[0].ageDays, 40);
  assert.match(stale[0].message, /30 天/);
});

// -------------------------------------------------------------- review due

test('review-due: only valid due dates are reported', () => {
  const report = analyze({
    notes: [
      note({ id: 'due-1', reviewAfter: day(-3) }),
      note({ id: 'invalid-1', review_after: '2026-02-31' }),
      note({ id: 'future-1', reviewAfter: day(30) }),
      note({ id: 'none-1' }),
    ],
  });
  const due = ofKind(report, 'review-due');
  assert.equal(due.length, 1);
  assert.deepEqual(due[0].ids, ['due-1']);
  assert.equal(due[0].severity, 'info');
  assert.match(due[0].message, /复查/);
});

// --------------------------------------------------------------- duplicate

test('duplicate: same type + same normalized summary', () => {
  const report = analyze({
    notes: [
      note({ id: 'd-1', type: 'fact', summary: '项目 全景 提升清单。' }),
      note({ id: 'd-2', type: 'fact', summary: '项目 全景 提升清单' }),
      note({ id: 'd-3', type: 'principle', summary: '项目 全景 提升清单' }),
      note({ id: 'd-4', type: 'fact', summary: '完全不同' }),
    ],
  });
  const duplicate = ofKind(report, 'duplicate');
  assert.equal(duplicate.length, 1);
  assert.deepEqual(duplicate[0].ids, ['d-1', 'd-2']);
  assert.equal(duplicate[0].severity, 'warn');
  assert.match(duplicate[0].message, /fact/);
  assert.match(duplicate[0].message, /2 条/);
});

test('duplicate normalization lowercases and collapses whitespace', () => {
  const report = analyze({
    notes: [
      note({ id: 'e-1', summary: '  HELLO   World!,  again  ' }),
      note({ id: 'e-2', summary: 'hello world again' }),
    ],
  });
  const duplicate = ofKind(report, 'duplicate');
  assert.equal(duplicate.length, 1);
  assert.deepEqual(duplicate[0].ids, ['e-1', 'e-2']);
});

// ------------------------------------------------------------- unclassified

test('unclassified: missing or unclassified scope on active memories', () => {
  const report = analyze({
    notes: [
      note({ id: 'u-1', scope: '' }),
      note({ id: 'u-2', scope: 'unclassified' }),
      note({ id: 'ok-1', scope: 'global' }),
    ],
  });
  const found = ofKind(report, 'unclassified');
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((item) => item.ids[0]), ['u-1', 'u-2']);
  assert.equal(report.counts.info, 2);
  assert.equal(report.ok, true, 'info-only reports stay ok');
});

// --------------------------------------------------------------- low recall

test('low-recall is omitted when accessRows are not supplied', () => {
  const report = analyze({ notes: [note({ id: 'n-1' })] });
  assert.equal(issue(report, 'low-recall'), undefined);
  assert.equal(report.byKind['low-recall'], 0);
});

test('low-recall distinguishes "not supplied" from an empty access list', () => {
  const notes = [note({ id: 'n-1' }), note({ id: 'n-2' })];

  const empty = analyze({ notes, accessRows: [] });
  assert.deepEqual(ofKind(empty, 'low-recall').map((item) => item.ids[0]), ['n-1', 'n-2']);

  const partial = analyze({
    notes,
    accessRows: [{ id: 'n-1', at: new Date(NOW - 2 * DAY).toISOString(), how: 'read' }],
  });
  assert.deepEqual(ofKind(partial, 'low-recall').map((item) => item.ids[0]), ['n-2']);

  // The CLI telemetry spelling `t` is accepted as well.
  const legacyShape = analyze({
    notes,
    accessRows: [{ id: 'n-1', t: new Date(NOW - 2 * DAY).toISOString(), how: 'inject' }],
  });
  assert.deepEqual(ofKind(legacyShape, 'low-recall').map((item) => item.ids[0]), ['n-2']);

  // A row older than the window is not recall.
  const oldRows = analyze({ notes, accessRows: [{ id: 'n-1', at: day(-120), how: 'read' }] });
  assert.deepEqual(ofKind(oldRows, 'low-recall').map((item) => item.ids[0]), ['n-1', 'n-2']);
});

test('low-recall ignores inactive notes', () => {
  const report = analyze({
    notes: [note({ id: 'i-1', subject: '', status: 'inbox' })],
    accessRows: [],
  });
  assert.equal(issue(report, 'low-recall'), undefined);
});

// ----------------------------------------------------- sorting and counting

test('sorts errors, then warnings, then info; counts and byKind agree', () => {
  const report = analyze({
    notes: [
      note({ id: 'c-1', subject: 'dup-subject' }),
      note({ id: 'c-2', subject: 'dup-subject' }),
      note({ id: 'o-1', supersedes: ['missing-target'] }),
      note({ id: 'd-1', type: 'fact', summary: '同样的摘要' }),
      note({ id: 'd-2', type: 'fact', summary: '同样的摘要。' }),
      note({ id: 'm-1', subject: '' }),
      note({ id: 'p-1', supersedes: ['p-2'] }),
      note({ id: 'p-2' }),
      note({ id: 'st-1', updated: day(-400) }),
      note({ id: 'r-1', reviewAfter: day(-1) }),
      note({ id: 'u-1', scope: '' }),
    ],
  });

  assert.deepEqual(kinds(report), [
    'conflict',
    'orphan-supersedes',
    'duplicate',
    'missing-subject',
    'pending-supersedes',
    'stale',
    'review-due',
    'unclassified',
  ]);
  assert.deepEqual(report.counts, { error: 2, warn: 4, info: 2 });
  assert.equal(report.ok, false);
  assert.equal(report.byKind.conflict, 1);
  assert.equal(report.byKind.duplicate, 1);
  assert.equal(report.byKind.stale, 1);
  assert.equal(report.byKind['scope-mismatch'], 0);
  assert.equal(report.byKind['low-recall'], 0);

  const rank = new Map(HEALTH_SEVERITIES.map((severity, index) => [severity, index]));
  const ranks = report.issues.map((item) => rank.get(item.severity));
  assert.deepEqual(ranks, ranks.slice().sort((a, b) => a - b));
});

test('sorts same-kind issues by updated ascending', () => {
  const report = analyze({
    notes: [
      note({ id: 'newer', subject: 's1', updated: day(-200) }),
      note({ id: 'older', subject: 's2', updated: day(-400) }),
    ],
  });
  const stale = ofKind(report, 'stale');
  assert.deepEqual(stale.map((item) => item.ids[0]), ['older', 'newer']);
});

// ------------------------------------------------------------- ok contract

test('ok is false with warnings and true with only info', () => {
  const warned = analyze({ notes: [note({ id: 'm-1', subject: '' })] });
  assert.equal(warned.ok, false);
  const infoOnly = analyze({ notes: [note({ id: 'u-1', scope: '' })] });
  assert.equal(infoOnly.ok, true);
});

// --------------------------------------------------- derivation / pages

test('derives notes from catalogRows when notes are absent', () => {
  const report = analyze({
    catalogRows: [
      {
        id: '2026-11-01-a-0001', level: 'digest', type: 'fact', status: 'active',
        scope: 'global', subject: 'same', summary: 'one', updated: '2026-11-01',
      },
      {
        id: '2026-11-01-a-0002', level: 'digest', type: 'fact', status: 'active',
        scope: 'global', subject: 'same', summary: 'two', updated: '2026-11-02',
      },
      {
        id: '2026-11-02-c-1001', level: 'canon', type: 'decision', status: 'canon',
        scope: 'global', subject: '', summary: 'canon', updated: '2026-11-02',
      },
      {
        id: 'raw-1', level: 'raw', type: 'session', status: 'active',
        scope: '', subject: '', summary: '', updated: '2026-11-02',
      },
    ],
  });
  assert.deepEqual(issue(report, 'conflict').ids, ['2026-11-01-a-0001', '2026-11-01-a-0002']);
  // canon/raw catalog rows are not digest memories and must not add noise.
  assert.equal(issue(report, 'missing-subject'), undefined);
  assert.equal(issue(report, 'unclassified'), undefined);
});

test('pages and non-digest levels are ignored by memory checks', () => {
  const report = analyze({
    notes: [
      note({ id: 'w-1', type: 'work', level: 'digest', subject: '', scope: '', status: 'active' }),
      note({ id: 't-1', type: 'topic', level: 'digest', subject: '', scope: '', status: 'active' }),
      note({ id: 'c-1', type: 'decision', level: 'canon', subject: '', scope: '', status: 'active' }),
    ],
  });
  assert.deepEqual(report.issues, []);
});

// ------------------------------------------------------- malformed inputs

test('malformed notes/catalog/access rows never throw', () => {
  const cases = [
    { notes: [null, undefined, 42, 'x', [], { id: {} }, { id: 'ok', supersedes: {} }] },
    {
      notes: [{
        id: 'x',
        status: 'active',
        level: 'digest',
        scope: 42,
        subject: ['a'],
        summary: {},
        updated: NaN,
        reviewAfter: [],
        supersedes: [1, null, '[[ ]]'],
      }],
    },
    { notes: [], catalogRows: [null, 7, { id: 'c-1' }] },
    { notes: 'not-an-array', catalogRows: {}, accessRows: 'nope' },
    {
      notes: [{ id: 'n-1', status: 'active', level: 'digest', updated: '2026-99-99' }],
      accessRows: [null, 1, { id: 'n-1', at: 'garbage' }],
    },
  ];
  for (const options of cases) {
    const report = analyze(options);
    assert.equal(typeof report.ok, 'boolean');
    assert.equal(Array.isArray(report.issues), true);
    assert.equal(typeof report.byKind.conflict, 'number');
    assert.ok(Number.isFinite(report.counts.error));
  }
});

test('malformed now still yields a valid ISO generatedAt', () => {
  for (const now of [undefined, null, 'not-a-date', NaN, Infinity, 1e300]) {
    const report = analyzeMemoryHealth({ now });
    assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  }
});

// ----------------------------------------------------------- healthSummary

test('healthSummary formats a mixed report', () => {
  const report = analyze({
    notes: [
      note({ id: 'c-1', subject: 'dup-subject' }),
      note({ id: 'c-2', subject: 'dup-subject' }),
      note({ id: 'o-1', supersedes: ['missing-target'] }),
      note({ id: 'm-1', subject: '' }),
      note({ id: 's-1', updated: day(-400) }),
    ],
  });
  const summary = healthSummary(report);
  assert.equal(summary.ok, false);
  assert.deepEqual(summary.counts, { error: 2, warn: 2, info: 0 });
  assert.equal(summary.headline, '2 个错误、2 个提醒');
});

test('healthSummary matches the documented headline example', () => {
  assert.equal(
    healthSummary({ counts: { error: 2, warn: 3, info: 0 } }).headline,
    '2 个错误、3 个提醒',
  );
  assert.equal(healthSummary({ counts: { error: 0, warn: 0, info: 5 } }).headline, '5 条提示');
  assert.equal(healthSummary({ counts: { error: 0, warn: 0, info: 0 } }).headline, '未发现问题');
});

test('healthSummary tolerates missing or malformed reports', () => {
  assert.deepEqual(healthSummary(null), {
    ok: true,
    counts: { error: 0, warn: 0, info: 0 },
    headline: '未发现问题',
  });
  const coerced = healthSummary({ counts: { error: '2', warn: 3.9, info: -1 } });
  assert.deepEqual(coerced.counts, { error: 2, warn: 3, info: 0 });
  assert.equal(coerced.headline, '2 个错误、3 个提醒');
  assert.equal(healthSummary(undefined).ok, true);
});

// ------------------------------------------------------------ option shape

test('accepts scope/storeKind options without changing legacy behavior', () => {
  const report = analyze({ scope: 'project:alpha', notes: [note({ id: 'n-1' })] });
  assert.deepEqual(report.issues, []);
});
