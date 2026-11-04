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
import os from 'node:os';
import path from 'node:path';

import { createSurface } from '../lib/read-model.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

/**
 * The 2.4.1 baseline was captured from this machine's full memory setup
 * (private global/project stores, 10_Raw sessions, access history). That setup
 * does not exist in CI or a fresh public checkout, so this gate runs a
 * self-contained fixture parity check there instead of silently skipping:
 * it exercises the same read-model surface and asserts the architecture-level
 * invariants (workspace labels, legacy scope, injection budget, read-only all
 * snapshot, cross-store search tags).
 */
function runFixtureParity() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-parity-'));
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };

  function makeStore(name, global) {
    const root = path.join(base, name);
    for (const dir of ['_meta', '10_Raw', '20_Digest/atoms', '30_Canon']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    fs.writeFileSync(path.join(root, '_meta', 'config.json'), `${JSON.stringify({
      version: 1,
      paths: {
        catalog: '_meta/catalog.jsonl', archive: '_meta/catalog.archive.jsonl',
        access: '_meta/access.jsonl', changeLog: '_meta/log.md', sessions: '10_Raw/sessions',
      },
    }, null, 2)}\n`);
    fs.writeFileSync(path.join(root, '_meta', 'catalog.jsonl'), '');
    fs.writeFileSync(path.join(root, 'project.json'), JSON.stringify({ slug: name, title: global ? '全局记忆' : 'DSH Fixture' }));
    fs.writeFileSync(path.join(root, '30_Canon', 'core.md'), `# ${global ? '全局' : '项目'}核心\n`);
    return root;
  }

  function writeAtom(store, atom) {
    fs.writeFileSync(path.join(store, '20_Digest', 'atoms', `${atom.id}.md`), [
      '---', `id: ${atom.id}`, `title: ${atom.title}`, 'level: digest', 'type: fact',
      'status: active', `scope: ${atom.scope}`, `summary: ${atom.summary}`,
      `updated: ${atom.updated || '2026-11-04'}`, '---', '', atom.body || atom.summary, '',
    ].join('\n'));
    fs.appendFileSync(path.join(store, '_meta', 'catalog.jsonl'), `${JSON.stringify({
      id: atom.id, path: `20_Digest/atoms/${atom.id}.md`, level: 'digest', type: 'fact',
      status: 'active', tags: [], summary: atom.summary, updated: atom.updated || '2026-11-04',
      title: atom.title, scope: atom.scope, subject: '',
    })}\n`);
  }

  try {
    const global = makeStore('global', true);
    const legacy = makeStore('legacy', false);
    writeAtom(global, { id: '2026-11-04-a-0900', title: '全局偏好', summary: 'fixture global preference', scope: 'global' });
    writeAtom(legacy, { id: '2026-11-04-a-0901', title: 'fixture search', summary: 'fixture local memory', scope: 'global' });
    const surface = createSurface({ legacyRoot: legacy, globalRoot: global, cwd: legacy, registryFile: path.join(base, 'registry.json') });
    const ids = surface.workspaces().map((store) => store.id);
    check(ids.join(',') === 'global,legacy', `workspace ids ${JSON.stringify(ids)}`);
    const injection = surface.injection('global');
    check(injection.total === 2, `injection total ${injection.total} !== 2`);
    check(injection.entries.length === 2 && injection.entries.every((entry) => entry.id), `injection entries ${JSON.stringify(injection.entries)}`);
    const notes = surface.notesWithInjection(surface.view('legacy'), { scope: 'global' });
    check(notes.some((note) => note.id.endsWith('a-0901') && note.injection.state === 'injected'), 'legacy note not injected');
    const all = surface.snapshotAll({ scope: 'global' });
    check(all.view.id === 'all' && all.view.readOnly === true && all.notes.length === 2, 'all snapshot shape');
    check(all.notes.every((note) => note.uid.startsWith('global::') || note.uid.startsWith('legacy::')), 'all snapshot uid');
    const search = surface.search({ workspace: 'all', query: 'fixture', limit: 5 });
    check(search.total >= 1 && search.results.every((row) => ['global', 'legacy'].includes(row.workspace)), 'all search tags');
    console.log(`fixture parity ok: ${all.notes.length} notes, injection ${injection.total}, ${search.total} search hit(s)`);
  } catch (error) {
    failures.push(`fixture parity threw: ${error.message}`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
  if (failures.length) {
    for (const line of failures) console.error(`FAIL: ${line}`);
    console.error(`fixture parity failed: ${failures.length} regression(s)`);
    process.exit(1);
  }
}

const liveGlobalRoot = process.env.KB_GLOBAL_ROOT || path.join(os.homedir(), '.dsh-memory', 'global');
if (!fs.existsSync(liveGlobalRoot) || !fs.existsSync(path.join(ROOT, '10_Raw', 'sessions'))) {
  console.log('live 2.4.1 baseline stores unavailable (CI/fresh checkout); running fixture parity');
  runFixtureParity();
  process.exit(0);
}

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
