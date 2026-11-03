import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  attachProject,
  ensureStoreId,
  findProjectStore,
  followWorkspaceTitle,
  isStoreRoot,
  looksLikeProjectWorkspace,
  provisionTarget,
  readProjectMeta,
  readProjectRegistry,
  readStoreId,
  relocationCandidate,
  relocateProject,
  resolveStores,
  resolveWorkspaceStore,
  syncRegistryStoreIds,
  uniqueWorkspaceSlug,
  updateProjectTitle,
  withRegistryLock,
  workspaceSlug,
  writableProjectStore,
} from '../../../engine/lib/stores.mjs';

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

test('registry read-modify-write runs under a lock file and cleans it up', () => {
  const root = tempDir();
  const registry = path.join(root, 'projects.json');
  const lockFile = `${registry}.lock`;
  try {
    const value = withRegistryLock(registry, () => {
      assert.equal(fs.existsSync(lockFile), true, 'lock file exists inside the critical section');
      return 'ok';
    });
    assert.equal(value, 'ok');
    assert.equal(fs.existsSync(lockFile), false, 'lock file removed after the section');
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

test('looksLikeProjectWorkspace accepts markers and project containers', () => {
  const root = tempDir();
  try {
    const bare = path.join(root, 'bare');
    fs.mkdirSync(bare);
    assert.equal(looksLikeProjectWorkspace(bare), false);
    const gitRepo = path.join(root, 'repo');
    fs.mkdirSync(path.join(gitRepo, '.git'), { recursive: true });
    assert.equal(looksLikeProjectWorkspace(gitRepo), true);
    const nodePackage = path.join(root, 'npm');
    fs.mkdirSync(nodePackage);
    fs.writeFileSync(path.join(nodePackage, 'package.json'), '{}\n', 'utf8');
    assert.equal(looksLikeProjectWorkspace(nodePackage), true);
    // A container directory whose children are projects qualifies as well.
    const container = path.join(root, 'container');
    fs.mkdirSync(path.join(container, 'child', '.git'), { recursive: true });
    assert.equal(looksLikeProjectWorkspace(container), true);
    assert.equal(looksLikeProjectWorkspace(path.join(root, 'missing')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('workspace slugs are filesystem-safe and stable for non-Latin names', () => {
  const root = tempDir();
  try {
    assert.equal(workspaceSlug(path.join(root, 'My App')), 'my-app');
    const chinese = path.join(root, '竞对商品筛取及数据匹配');
    const slug = workspaceSlug(chinese);
    assert.match(slug, /^p-[0-9a-f]{8}$/);
    assert.equal(workspaceSlug(chinese), slug);
    const registry = path.join(root, 'projects.json');
    const store = path.join(root, 'existing', '.dsh-memory');
    writeStore(store, { slug: 'my-app' });
    attachProject(store, registry);
    assert.equal(uniqueWorkspaceSlug(path.join(root, 'My App'), registry), 'my-app-2');
    assert.equal(uniqueWorkspaceSlug(path.join(root, 'global'), registry), 'workspace-global');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('provisionTarget plans an auto store only for external project workspaces', () => {
  const root = tempDir();
  const legacy = path.join(root, 'vault');
  const globalRoot = path.join(root, 'global');
  const home = path.join(root, 'home');
  const scratch = path.join(root, 'tmp');
  const project = path.join(root, 'app');
  const registry = path.join(root, 'projects.json');
  const options = {
    legacyRoot: legacy,
    globalRoot,
    registryFile: registry,
    homeDir: home,
    tmpDir: scratch,
  };
  try {
    writeStore(legacy, { slug: 'vault' });
    writeStore(globalRoot, { project: false });
    fs.mkdirSync(project, { recursive: true });
    // No project marker: a random directory does not deserve a store.
    assert.equal(provisionTarget(project, options), null);
    fs.writeFileSync(path.join(project, 'package.json'), '{}\n', 'utf8');
    const plan = provisionTarget(project, options);
    assert.ok(plan);
    assert.equal(plan.storeRoot, path.join(path.resolve(project), '.dsh-memory'));
    assert.equal(plan.slug, 'app');
    assert.equal(plan.title, 'app');
    // The legacy vault, the global store, HOME itself and scratch paths never
    // receive an automatic store.
    assert.equal(provisionTarget(legacy, options), null);
    assert.equal(provisionTarget(globalRoot, options), null);
    assert.equal(provisionTarget(home, options), null);
    assert.equal(provisionTarget(path.join(scratch, 'session'), options), null);
    // A repo-shipped store is never auto-trusted or overwritten.
    writeStore(plan.storeRoot, { slug: 'app-shipped' });
    assert.equal(provisionTarget(project, options), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('provisionTarget does not nest a store under an attached project', () => {
  const root = tempDir();
  const project = path.join(root, 'parent');
  const parentStore = path.join(project, '.dsh-memory');
  const nested = path.join(project, 'packages', 'child');
  const registry = path.join(root, 'projects.json');
  const options = {
    registryFile: registry,
    homeDir: path.join(root, 'home'),
    tmpDir: path.join(root, 'tmp'),
  };
  try {
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'package.json'), '{}\n', 'utf8');
    writeStore(parentStore, { slug: 'parent-app' });
    attachProject(parentStore, registry, { writable: true });
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'package.json'), '{}\n', 'utf8');
    assert.equal(provisionTarget(nested, options), null);
    // ...while a sibling project outside the attached tree is still eligible.
    const sibling = path.join(root, 'sibling');
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(sibling, 'package.json'), '{}\n', 'utf8');
    assert.ok(provisionTarget(sibling, options));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('store ids are stable and recorded in the user-level registry', () => {
  const root = tempDir();
  const store = path.join(root, 'app', '.dsh-memory');
  const registry = path.join(root, 'projects.json');
  try {
    writeStore(store, { slug: 'identity-demo' });
    assert.equal(readStoreId(store), '');
    const first = ensureStoreId(store);
    assert.match(first, /^store-[0-9a-f]{12}$/);
    assert.equal(ensureStoreId(store), first);
    attachProject(store, registry, { writable: true, autoGranted: true });
    const row = readProjectRegistry(registry).get(path.resolve(store));
    assert.equal(row.storeId, first);
    assert.equal(row.writable, true);
    assert.equal(row.autoGranted, true);
    assert.ok(row.folderBirthtimeMs > 0, 'attach must record the workspace folder birthtime');
    // An explicit (human) attach drops the auto-provision provenance.
    attachProject(store, registry);
    const explicit = readProjectRegistry(registry).get(path.resolve(store));
    assert.equal(explicit.storeId, first);
    assert.equal(explicit.autoGranted, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('updateProjectTitle changes only the display name', () => {
  const root = tempDir();
  const store = path.join(root, 'app', '.dsh-memory');
  try {
    writeStore(store, { slug: 'title-demo' });
    const id = ensureStoreId(store);
    assert.equal(updateProjectTitle(store, '  新 名字  '), '新 名字');
    const meta = readProjectMeta(store);
    assert.equal(meta.title, '新 名字');
    assert.equal(meta.slug, 'title-demo');
    assert.equal(readStoreId(store), id);
    assert.throws(() => updateProjectTitle(store, '   '));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('syncRegistryStoreIds backfills identity for stores attached before v1.18', () => {
  const root = tempDir();
  const store = path.join(root, 'app', '.dsh-memory');
  const registry = path.join(root, 'projects.json');
  try {
    writeStore(store, { slug: 'legacy-attach' });
    const id = ensureStoreId(store);
    // Simulate an old registry row without storeId.
    fs.writeFileSync(
      registry,
      `${JSON.stringify({ version: 1, projects: [{ slug: 'legacy-attach', path: store, writable: false }] }, null, 2)}\n`,
      'utf8',
    );
    assert.ok(syncRegistryStoreIds(registry) >= 1);
    const backfilled = readProjectRegistry(registry).get(path.resolve(store));
    assert.equal(backfilled.storeId, id);
    assert.ok(backfilled.folderBirthtimeMs > 0, 'sync must backfill the folder birthtime');
    assert.equal(syncRegistryStoreIds(registry), 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a renamed workspace is relocated through its store id', () => {
  const root = tempDir();
  const oldDir = path.join(root, 'old-name');
  const oldStore = path.join(oldDir, '.dsh-memory');
  const newDir = path.join(root, 'new-name');
  const newStore = path.join(newDir, '.dsh-memory');
  const registry = path.join(root, 'projects.json');
  try {
    writeStore(oldStore, { slug: 'renamed-demo' });
    ensureStoreId(oldStore);
    attachProject(oldStore, registry, { writable: true });
    // The title is still the folder-derived name of the old folder.
    fs.writeFileSync(
      path.join(oldStore, 'project.json'),
      `${JSON.stringify({ slug: 'renamed-demo', title: 'old-name', store_id: readStoreId(oldStore) }, null, 2)}\n`,
      'utf8',
    );
    fs.renameSync(oldDir, newDir);

    const candidate = relocationCandidate(newStore, registry);
    assert.ok(candidate);
    assert.equal(candidate.oldPath, path.resolve(oldStore));
    assert.equal(candidate.oldPathAlive, false);
    // A rename keeps the workspace-folder creation time.
    assert.equal(candidate.sameOrigin, true);

    const moved = relocateProject(newStore, candidate.oldPath, registry);
    assert.equal(moved.writable, true);
    const rows = [...readProjectRegistry(registry).values()];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].path, path.resolve(newStore));
    assert.equal(rows[0].writable, true);
    assert.equal(rows[0].slug, 'renamed-demo');

    assert.equal(followWorkspaceTitle(candidate.oldPath, newStore), 'new-name');
    assert.equal(readProjectMeta(newStore).title, 'new-name');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a copy whose origin path is gone still requires confirmation', () => {
  const root = tempDir();
  const original = path.join(root, 'original');
  const originalStore = path.join(original, '.dsh-memory');
  const copy = path.join(root, 'copy');
  const copyStore = path.join(copy, '.dsh-memory');
  const registry = path.join(root, 'projects.json');
  try {
    writeStore(originalStore, { slug: 'copy-lost-origin' });
    ensureStoreId(originalStore);
    attachProject(originalStore, registry, { writable: true, autoGranted: true });
    // Simulate an attach from an hour ago; the copy gets a fresh folder
    // creation time, so the two-signal rule must not auto-rebind it.
    const raw = JSON.parse(fs.readFileSync(registry, 'utf8'));
    raw.projects[0].folderBirthtimeMs = Date.now() - 60 * 60 * 1000;
    fs.writeFileSync(registry, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
    fs.cpSync(originalStore, copyStore, { recursive: true });
    fs.rmSync(original, { recursive: true, force: true });

    const candidate = relocationCandidate(copyStore, registry);
    assert.ok(candidate);
    assert.equal(candidate.oldPathAlive, false);
    assert.equal(candidate.sameOrigin, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a copied store is not silently relocated and a custom title survives', () => {
  const root = tempDir();
  const original = path.join(root, 'original');
  const originalStore = path.join(original, '.dsh-memory');
  const copy = path.join(root, 'copy');
  const copyStore = path.join(copy, '.dsh-memory');
  const registry = path.join(root, 'projects.json');
  try {
    writeStore(originalStore, { slug: 'copy-demo' });
    ensureStoreId(originalStore);
    attachProject(originalStore, registry, { writable: false });
    fs.cpSync(originalStore, copyStore, { recursive: true });

    const candidate = relocationCandidate(copyStore, registry);
    assert.ok(candidate);
    assert.equal(candidate.oldPath, path.resolve(originalStore));
    assert.equal(candidate.oldPathAlive, true);

    // A custom display name is not overwritten by the folder-derived rule.
    fs.writeFileSync(
      path.join(copyStore, 'project.json'),
      `${JSON.stringify({ slug: 'copy-demo', title: '自定义名称', store_id: readStoreId(copyStore) }, null, 2)}\n`,
      'utf8',
    );
    assert.equal(followWorkspaceTitle(candidate.oldPath, copyStore), '');
    assert.equal(readProjectMeta(copyStore).title, '自定义名称');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
