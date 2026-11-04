/**
 * Read-model unit tests (3.0 P1).
 *
 * Fixtures are real stores on disk so the same code path (catalog candidates,
 * current-truth arbitration, search CLI) runs as in the Host. TEMP stays inside
 * the workspace because this machine's sandbox denies writes to the OS temp
 * directory from child processes.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createSurface, readCatalogInjectionNotes, scanStoreNotes } from '../lib/read-model.mjs';

const BASE = path.join(process.cwd(), '.tmp-test-run');
fs.mkdirSync(BASE, { recursive: true });

function makeStore(name, { slug = name, global = false } = {}) {
  const root = fs.mkdtempSync(path.join(BASE, `rm-${name}-`));
  for (const dir of ['_meta', '10_Raw', '20_Digest/atoms', '30_Canon']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(root, '_meta', 'config.json'), `${JSON.stringify({
    version: 1,
    paths: {
      catalog: '_meta/catalog.jsonl',
      archive: '_meta/catalog.archive.jsonl',
      access: '_meta/access.jsonl',
      changeLog: '_meta/log.md',
      sessions: '10_Raw/sessions',
    },
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(root, '_meta', 'catalog.jsonl'), '', 'utf8');
  fs.writeFileSync(path.join(root, 'project.json'), JSON.stringify({ slug, title: `库 ${slug}` }), 'utf8');
  fs.writeFileSync(path.join(root, '30_Canon', 'core.md'), `${global ? '全局核心' : '项目核心'}\n`, 'utf8');
  return root;
}

function writeAtom(store, atom) {
  const file = path.join(store, '20_Digest', 'atoms', `${atom.id}.md`);
  const tags = atom.tags || [];
  fs.writeFileSync(file, [
    '---',
    `id: ${atom.id}`,
    `title: ${atom.title || atom.id}`,
    'level: digest',
    `type: ${atom.type || 'fact'}`,
    `status: ${atom.status || 'active'}`,
    `scope: ${atom.scope}`,
    `summary: ${atom.summary || atom.title || atom.id}`,
    `updated: ${atom.updated || '2026-11-04'}`,
    ...(atom.subject ? [`subject: ${atom.subject}`] : []),
    ...(tags.length ? [`tags: [${tags.join(', ')}]`] : []),
    '---',
    '',
    atom.body || '',
    '',
  ].join('\n'), 'utf8');
  const row = {
    id: atom.id,
    path: `20_Digest/atoms/${atom.id}.md`,
    level: 'digest',
    type: atom.type || 'fact',
    status: atom.status || 'active',
    tags,
    summary: atom.summary || atom.title || atom.id,
    updated: atom.updated || '2026-11-04',
    title: atom.title || atom.id,
    scope: atom.scope,
    subject: atom.subject || '',
  };
  fs.appendFileSync(path.join(store, '_meta', 'catalog.jsonl'), `${JSON.stringify(row)}\n`, 'utf8');
  return row;
}

function surfaceFor({ globalRoot, projectRoot }) {
  return createSurface({
    legacyRoot: projectRoot,
    globalRoot,
    cwd: projectRoot,
    registryFile: path.join(path.dirname(globalRoot), 'registry.json'),
    stores: {
      globalRoot,
      projectRoot,
      project: {
        root: projectRoot,
        meta: { slug: path.basename(projectRoot), title: path.basename(projectRoot) },
        entry: { writable: true },
        legacy: false,
      },
    },
  });
}

test('catalog candidates are active digest memories only', () => {
  const store = makeStore('catalog');
  writeAtom(store, { id: '2026-11-04-a-0001', scope: 'global' });
  writeAtom(store, { id: '2026-11-04-a-0002', scope: 'global', status: 'inbox' });
  writeAtom(store, { id: '2026-11-04-t-0001', scope: 'global', type: 'topic' });
  const notes = readCatalogInjectionNotes(store);
  assert.deepEqual(notes.map((n) => n.id), ['2026-11-04-a-0001']);
  assert.equal(scanStoreNotes(store).length, 3);
});

test('project session injects its own scope and the global store', () => {
  const globalStore = makeStore('global', { slug: 'global', global: true });
  writeAtom(globalStore, { id: '2026-11-04-a-0100', scope: 'global', summary: '全局偏好' });
  const project = makeStore('demo', { slug: 'demo' });
  writeAtom(project, { id: '2026-11-04-a-0200', scope: 'project:demo', summary: '项目记忆' });
  // A global-scope leak inside a project store must never be injected.
  writeAtom(project, { id: '2026-11-04-a-0201', scope: 'global', summary: '泄漏的全局记忆' });
  const surface = surfaceFor({ globalRoot: globalStore, projectRoot: project });
  const selected = surface.selectInjection('project:demo');
  assert.deepEqual(selected.globalPicked.map((n) => n.id), ['2026-11-04-a-0100']);
  assert.deepEqual(selected.projectPicked.map((n) => n.id), ['2026-11-04-a-0200']);
  assert.equal(selected.candidates.length, 2);
});

test('cross-store subject arbitration keeps the newer claim', () => {
  const globalStore = makeStore('global', { slug: 'global', global: true });
  writeAtom(globalStore, {
    id: '2026-11-03-a-0300',
    scope: 'global',
    subject: 'deploy',
    updated: '2026-11-03',
    summary: '旧的部署约定',
  });
  const project = makeStore('demo2', { slug: 'demo2' });
  writeAtom(project, {
    id: '2026-11-04-a-0301',
    scope: 'project:demo2',
    subject: 'deploy',
    updated: '2026-11-04',
    summary: '新的部署约定',
  });
  const surface = surfaceFor({ globalRoot: globalStore, projectRoot: project });
  const selected = surface.selectInjection('project:demo2');
  assert.deepEqual(selected.globalPicked, []);
  assert.deepEqual(selected.projectPicked.map((n) => n.id), ['2026-11-04-a-0301']);
  // The old copy is visible in the global view but labelled as replaced by the
  // selection snapshot, not as an unexplained "not selected" entry.
  const notes = surface.notesWithInjection(surface.view('global'), { scope: 'project:demo2' });
  const old = notes.find((n) => n.id === '2026-11-03-a-0300');
  assert.equal(old.injection.state, 'replaced');
  assert.match(old.injection.detail, /2026-11-04-a-0301/);
});

test('search aggregates stores and tags each row with its workspace', () => {
  const globalStore = makeStore('global', { slug: 'global', global: true });
  writeAtom(globalStore, { id: '2026-11-04-a-0400', scope: 'global', title: '发布流程', summary: '发布流程' });
  const project = makeStore('demo3', { slug: 'demo3' });
  writeAtom(project, { id: '2026-11-04-a-0401', scope: 'project:demo3', title: '发布检查', summary: '发布检查' });
  const surface = surfaceFor({ globalRoot: globalStore, projectRoot: project });
  const all = surface.search({ workspace: 'all', query: '发布', limit: 10 });
  const workspaces = new Set(all.results.map((row) => row.workspace));
  assert.ok(workspaces.has('global'));
  assert.ok(workspaces.has('legacy'));
  assert.ok(all.results.some((row) => row.id === '2026-11-04-a-0400'));
  // A single-view search keeps the historic top-level shape.
  const single = surface.search({ workspace: 'global', query: '发布', limit: 10 });
  assert.equal(single.results.length, 1);
  assert.equal(single.results[0].workspace, 'global');
});

test('unknown query does not fall back to unrelated memories', () => {
  const globalStore = makeStore('global', { slug: 'global', global: true });
  writeAtom(globalStore, { id: '2026-11-04-a-0500', scope: 'global' });
  const project = makeStore('demo4', { slug: 'demo4' });
  const surface = surfaceFor({ globalRoot: globalStore, projectRoot: project });
  const result = surface.search({ workspace: 'all', query: 'zzqqxx', limit: 10 });
  assert.equal(result.total, 0);
  assert.deepEqual(result.strategy, { pinyin: false, semantic: false });
});

test('snapshotAll unions stores read-only with workspace-tagged uids', () => {
  const globalStore = makeStore('global', { slug: 'global', global: true });
  writeAtom(globalStore, { id: '2026-11-04-a-0600', scope: 'global', summary: '全局约定' });
  const project = makeStore('demo5', { slug: 'demo5' });
  writeAtom(project, { id: '2026-11-04-a-0601', scope: 'project:demo5', summary: '项目约定' });
  const surface = surfaceFor({ globalRoot: globalStore, projectRoot: project });
  const all = surface.snapshotAll({ scope: 'project:demo5' });
  assert.equal(all.view.kind, 'all');
  assert.equal(all.view.writable, false);
  assert.equal(all.view.readOnly, true);
  assert.equal(all.total, 2);
  const globalNote = all.notes.find((note) => note.id === '2026-11-04-a-0600');
  const projectNote = all.notes.find((note) => note.id === '2026-11-04-a-0601');
  assert.equal(globalNote.uid, 'global::2026-11-04-a-0600');
  assert.equal(globalNote.workspaceId, 'global');
  assert.equal(projectNote.uid, 'legacy::2026-11-04-a-0601');
  assert.equal(projectNote.injection.state, 'injected');
  assert.equal(all.injection.total, 2);
});
