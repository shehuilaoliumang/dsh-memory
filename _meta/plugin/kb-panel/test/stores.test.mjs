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
