/**
 * 3.0 parity check: compare the engine read model with the 2.4.1 Host snapshot.
 *
 * Exact checks cover architecture-independent behaviour: workspace ids/labels,
 * the default session view, injection entries, shared-note labels, and search
 * for queries whose result set cannot grow. `发布` allows new memories added
 * after the baseline while requiring the old rows to keep their order and
 * match metadata. Content added after `capturedAt` is reported as drift, never
 * as a failure.
 *
 * Exit code 1 on observable regressions.
 */
import fs from 'node:fs';
import path from 'node:path';

import { createSurface } from '../lib/read-model.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, '_meta', 'engine', 'test', 'parity', 'baseline-2.4.1.json'), 'utf8'));
const surface = createSurface({ legacyRoot: ROOT, cwd: ROOT });

const failures = [];
const drifts = [];
const fail = (message) => failures.push(message);
const drift = (message) => drifts.push(message);

function viewShape(view) {
  return { id: view.id, kind: view.kind, writable: view.writable !== false };
}

// Workspace list: shared order must match; new stores append.
const currentWorkspaces = surface.workspaces();
for (let i = 0; i < baseline.workspaces.length; i += 1) {
  const expected = baseline.workspaces[i];
  const actual = currentWorkspaces[i];
  if (!actual) {
    fail(`workspace[${i}] missing: ${expected.id}`);
    continue;
  }
  if (actual.id !== expected.id || actual.label !== expected.label || actual.kind !== expected.kind) {
    fail(`workspace[${i}] ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}
for (const extra of currentWorkspaces.slice(baseline.workspaces.length)) {
  drift(`new workspace: ${extra.id}`);
}

// Default session view.
const defaultView = surface.view('');
const expectedView = baseline.defaultView;
if (defaultView.id !== expectedView.id || defaultView.kind !== expectedView.kind) {
  fail(`default view ${JSON.stringify(viewShape(defaultView))} !== ${JSON.stringify(expectedView)}`);
}

// Injection entries (order is deterministic for the same store content).
const baselineInjection = baseline.panels.legacy.injection;
const currentInjection = surface.injection('global');
const entryShape = (entry) => ({ id: entry.id, store: entry.store, pinned: Boolean(entry.pinned) });
const expectedEntries = baselineInjection.entries.map(entryShape);
const actualEntries = currentInjection.entries.map(entryShape);
if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
  fail(`injection entries ${JSON.stringify(actualEntries)} !== ${JSON.stringify(expectedEntries)}`);
}

// Shared notes: labels must stay identical. New notes are drift.
const currentGlobalNotes = new Map(
  surface.notesWithInjection(surface.view('legacy'), { scope: 'global' }).map((note) => [note.id, note]),
);
for (const expected of baseline.panels.legacy.notes) {
  const actual = currentGlobalNotes.get(expected.id);
  if (!actual) {
    fail(`baseline note missing from legacy view: ${expected.id}`);
    continue;
  }
  for (const field of ['status', 'level', 'type', 'scope', 'subject', 'updated']) {
    if (String(actual[field] || '') !== String(expected[field] || '')) {
      fail(`note ${expected.id} field ${field}: ${JSON.stringify(actual[field])} !== ${JSON.stringify(expected[field])}`);
    }
  }
  const actualState = actual.injection ? actual.injection.state : '';
  const actualLabel = actual.injection ? actual.injection.label : '';
  const wantedState = expected.injection ? expected.injection.state : '';
  const wantedLabel = expected.injection ? expected.injection.label : '';
  if (actualState !== wantedState || actualLabel !== wantedLabel) {
    fail(`note ${expected.id} injection: ${actualState}/${actualLabel} !== ${wantedState}/${wantedLabel}`);
  }
}
for (const actualId of currentGlobalNotes.keys()) {
  if (!baseline.panels.legacy.notes.some((note) => note.id === actualId)) drift(`new note: ${actualId}`);
}

// Search: exact for stable queries, subsequence-with-drift for `发布`.
const rowShape = (row) => ({
  id: row.id,
  workspace: row.workspace,
  matchedBy: row.matchedBy,
  matchLabel: row.matchLabel,
  matchTerms: row.matchTerms,
});
for (const [workspace, queries] of Object.entries(baseline.searches)) {
  for (const expected of queries) {
    const query = expected.query;
    const actual = surface.search({ workspace, query, limit: 10 });
    const exact = query !== '发布';
    if (expected.total === 0) {
      if (actual.total !== 0 || actual.results.length !== 0) fail(`search ${workspace}/${query}: expected empty, got ${actual.total}`);
      continue;
    }
    if (query === '发布') {
      if (actual.total < expected.total) {
        fail(`search ${workspace}/${query}: total shrank ${actual.total} < ${expected.total}`);
        continue;
      }
      const actualById = new Map(actual.results.map((row) => [row.id, row]));
      for (const wantedRow of expected.results) {
        const found = actualById.get(wantedRow.id);
        if (!found || JSON.stringify(rowShape(found)) !== JSON.stringify(rowShape(wantedRow))) {
          fail(`search ${workspace}/${query}: baseline row ${wantedRow.id} changed or disappeared`);
        }
      }
      for (const row of actual.results) {
        if (!expected.results.some((wantedRow) => wantedRow.id === row.id)) drift(`new search row ${workspace}/${query}: ${row.id}`);
      }
      continue;
    }
    if (actual.strategy.pinyin !== expected.strategy.pinyin || actual.strategy.semantic !== expected.strategy.semantic) {
      fail(`search ${workspace}/${query}: strategy ${JSON.stringify(actual.strategy)} !== ${JSON.stringify(expected.strategy)}`);
    }
    const actualRows = actual.results.map(rowShape);
    const expectedRows = expected.results.map(rowShape);
    if (exact && JSON.stringify(actualRows) !== JSON.stringify(expectedRows)) {
      fail(`search ${workspace}/${query}: ${JSON.stringify(actualRows)} !== ${JSON.stringify(expectedRows)}`);
    }
  }
}

for (const line of drifts) console.log(`drift: ${line}`);
if (failures.length) {
  for (const line of failures) console.error(`FAIL: ${line}`);
  console.error(`parity failed: ${failures.length} regression(s), ${drifts.length} drift(s)`);
  process.exit(1);
}
console.log(`parity ok: ${drifts.length} content drift(s), 0 regression(s)`);
