import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  attachProject,
  findProjectStore,
  isStoreRoot,
  readProjectMeta,
  readProjectRegistry,
  resolveStores,
  resolveWorkspaceStore,
  writableProjectStore,
} from '../stores.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kb-stores-'));
}

function writeStore(root, { slug = '', project = true } = {}) {
  fs.mkdirSync(path.join(root, '_meta'), { recursive: true });
  fs.mkdirSync(path.join(root, '30_Canon'), { recursive: true });
  fs.writeFileSync(path.join(root, '_meta', 'config.json'), '{}\n', 'utf8');
  fs.writeFileSync(path.join(root, '30_Canon', 'core.md'), '# core\n', 'utf8');
  if (project) {
    fs.writeFileSync(path.join(root, 'project.json'), JSON.stringify({ slug, title: slug }) + '\n', 'utf8');
  }
}

test('isStoreRoot recognises a scaffold and rejects a bare directory', () => {
  const root = tempDir();
  try {
    assert.equal(isStoreRoot(root), false);
    writeStore(root, { slug: 'demo' });
    assert.equal(isStoreRoot(root), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unattached project store is not discovered; attaching makes it visible', () => {
  const root = tempDir();
  const project = path.join(root, 'app');
  const store = path.join(project, '.dsh-memory');
  const registry = path.join(root, 'projects.json');
  try {
    writeStore(store, { slug: 'app-demo' });
    assert.equal(readProjectMeta(store).slug, 'app-demo');
    assert.equal(findProjectStore(path.join(project, 'src'), { registryFile: registry }), null);
    const attached = attachProject(store, registry);
    assert.equal(attached.slug, 'app-demo');
    const found = findProjectStore(path.join(project, 'src'), { registryFile: registry });
    assert.ok(found);
    assert.equal(found.root, path.resolve(store));
    assert.equal(found.meta.slug, 'app-demo');
    assert.equal(found.legacy, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unmarked .dsh-memory does not shadow an attached parent store', () => {
  const root = tempDir();
  const project = path.join(root, 'parent');
  const parentStore = path.join(project, '.dsh-memory');
  const child = path.join(project, 'child');
  const childStore = path.join(child, '.dsh-memory');
  const registry = path.join(root, 'projects.json');
  try {
    writeStore(parentStore, { slug: 'parent-app' });
    attachProject(parentStore, registry);
    fs.mkdirSync(path.join(childStore, '_meta'), { recursive: true });
    fs.mkdirSync(path.join(childStore, '30_Canon'), { recursive: true });
    fs.writeFileSync(path.join(childStore, '_meta', 'config.json'), '{}\n', 'utf8');
    fs.writeFileSync(path.join(childStore, '30_Canon', 'core.md'), '# core\n', 'utf8');
    const found = findProjectStore(path.join(child, 'src'), { registryFile: registry });
    assert.ok(found);
    assert.equal(found.root, path.resolve(parentStore));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the legacy configured root is trusted explicitly and wins inside its own tree', () => {
  const root = tempDir();
  const legacy = path.join(root, 'vault');
  try {
    writeStore(legacy, { slug: 'legacy-vault' });
    const found = findProjectStore(path.join(legacy, '20_Digest'), {
      legacyRoot: legacy,
      registryFile: path.join(root, 'projects.json'),
    });
    assert.ok(found);
    assert.equal(found.legacy, true);
    assert.equal(found.root, path.resolve(legacy));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveStores reports global and project roots independently', () => {
  const root = tempDir();
  const globalRoot = path.join(root, 'global');
  const project = path.join(root, 'repo');
  const store = path.join(project, '.dsh-memory');
  const registry = path.join(root, 'projects.json');
  try {
    writeStore(globalRoot, { project: false });
    writeStore(store, { slug: 'repo-demo' });
    attachProject(store, registry);
    const found = resolveStores(path.join(project, 'src'), {
      globalRoot,
      registryFile: registry,
    });
    assert.equal(found.globalRoot, path.resolve(globalRoot));
    assert.equal(found.projectRoot, path.resolve(store));
    assert.equal(found.project.meta.slug, 'repo-demo');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('only an explicitly writable attached project is a write target', () => {
  const root = tempDir();
  const project = path.join(root, 'app');
  const store = path.join(project, '.dsh-memory');
  const registry = path.join(root, 'projects.json');
  try {
    writeStore(store, { slug: 'write-demo' });
    attachProject(store, registry, { writable: false });
    assert.equal(writableProjectStore(path.join(project, 'src'), { registryFile: registry }), null);
    attachProject(store, registry, { writable: true });
    const found = writableProjectStore(path.join(project, 'src'), { registryFile: registry });
    assert.ok(found);
    assert.equal(found.root, path.resolve(store));
    assert.equal(found.entry.writable, true);
    // Re-attaching without a flag must preserve the explicit grant.
    attachProject(store, registry);
    assert.ok(writableProjectStore(path.join(project, 'src'), { registryFile: registry }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a corrupt registry never grants write access', () => {
  const root = tempDir();
  const project = path.join(root, 'app');
  const store = path.join(project, '.dsh-memory');
  const registry = path.join(root, 'projects.json');
  try {
    writeStore(store, { slug: 'corrupt-demo' });
    fs.writeFileSync(registry, '{"version":1,"projects":[', 'utf8');
    assert.equal(writableProjectStore(path.join(project, 'src'), { registryFile: registry }), null);
    assert.equal(resolveStores(path.join(project, 'src'), { registryFile: registry }).projectRoot, null);
    // A failed re-attach must not overwrite the damaged registry with a
    // half-written grant either; the file stays exactly as it was.
    assert.throws(() => attachProject(store, path.join(registry, 'nested.json')));
    assert.equal(fs.readFileSync(registry, 'utf8'), '{"version":1,"projects":[');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a nested unregistered .dsh-memory cannot hijack a writable parent', () => {
  const root = tempDir();
  const project = path.join(root, 'parent');
  const parentStore = path.join(project, '.dsh-memory');
  const child = path.join(project, 'child');
  const childStore = path.join(child, '.dsh-memory');
  const registry = path.join(root, 'projects.json');
  try {
    writeStore(parentStore, { slug: 'parent-writable' });
    attachProject(parentStore, registry, { writable: true });
    writeStore(childStore, { slug: 'child-unregistered' });
    const found = writableProjectStore(path.join(child, 'src'), { registryFile: registry });
    assert.ok(found);
    assert.equal(found.root, path.resolve(parentStore));
    assert.equal(found.meta.slug, 'parent-writable');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('registry reads tolerate missing/corrupt files and deduplicate by path', () => {
  const root = tempDir();
  const registry = path.join(root, 'projects.json');
  try {
    assert.equal(readProjectRegistry(registry).size, 0);
    fs.writeFileSync(registry, '{ not json', 'utf8');
    assert.equal(readProjectRegistry(registry).size, 0);
    const store = path.join(root, 'app', '.dsh-memory');
    writeStore(store, { slug: 'demo-app' });
    attachProject(store, registry);
    attachProject(store, registry);
    const rows = readProjectRegistry(registry);
    assert.equal(rows.size, 1);
    assert.equal([...rows.values()][0].slug, 'demo-app');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveWorkspaceStore accepts trust-gated ids only', () => {
  const root = tempDir();
  const globalRoot = path.join(root, 'global');
  const legacy = path.join(root, 'vault');
  const projectStore = path.join(root, 'app', '.dsh-memory');
  const registry = path.join(root, 'projects.json');
  try {
    writeStore(globalRoot, { project: false });
    writeStore(legacy, { slug: 'vault-demo' });
    writeStore(projectStore, { slug: 'app-demo' });
    attachProject(projectStore, registry, { writable: false });
    const options = { legacyRoot: legacy, globalRoot, registryFile: registry };

    const globalView = resolveWorkspaceStore('global', options);
    assert.equal(globalView.kind, 'global');
    assert.equal(globalView.id, 'global');
    assert.equal(globalView.writable, true);

    const legacyView = resolveWorkspaceStore('legacy', options);
    assert.equal(legacyView.kind, 'legacy');
    assert.equal(legacyView.root, path.resolve(legacy));

    const projectView = resolveWorkspaceStore('app-demo', options);
    assert.equal(projectView.kind, 'project');
    assert.equal(projectView.root, path.resolve(projectStore));
    assert.equal(projectView.writable, false);

    // A filesystem path is never accepted as a view id.
    assert.throws(() => resolveWorkspaceStore(projectStore, options));
    assert.throws(() => resolveWorkspaceStore('missing-app', options));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
