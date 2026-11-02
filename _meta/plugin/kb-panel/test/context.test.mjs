import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  describeStore,
  isInsideLegacy,
  resolveContext,
  resolveWriteTarget,
  workspaceKind,
} from '../../../engine/lib/context.mjs';
import { attachProject, ensureStoreId } from '../../../engine/lib/stores.mjs';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kb-context-'));
}

/** Scaffold a store root that satisfies isStoreRoot + readProjectMeta. */
function writeStore(storeRoot, slug = 'ctx-demo') {
  fs.mkdirSync(path.join(storeRoot, '_meta'), { recursive: true });
  fs.mkdirSync(path.join(storeRoot, '30_Canon'), { recursive: true });
  fs.writeFileSync(path.join(storeRoot, '_meta', 'config.json'), '{"version":1}\n', 'utf8');
  fs.writeFileSync(path.join(storeRoot, '30_Canon', 'core.md'), '# core\n', 'utf8');
  fs.writeFileSync(
    path.join(storeRoot, 'project.json'),
    JSON.stringify({ slug, title: slug, created_at: '2026-01-01' }) + '\n',
    'utf8',
  );
  ensureStoreId(storeRoot);
}

test('describeStore derives scope and write authority per store kind', () => {
  const global = describeStore({ root: 'C:/tmp/global', kind: 'global' });
  assert.equal(global.scope, 'global');
  assert.equal(global.writable, true);
  assert.equal(global.isGlobal, true);

  const legacy = describeStore({ root: 'C:/tmp/vault', kind: 'legacy' });
  assert.equal(legacy.scope, 'global');
  assert.equal(legacy.writable, true);
  assert.equal(legacy.isLegacy, true);

  const project = describeStore({
    root: 'C:/tmp/app/.dsh-memory',
    kind: 'project',
    entry: { writable: true, slug: 'app' },
    meta: { slug: 'app', title: 'App' },
  });
  assert.equal(project.scope, 'project:app');
  assert.equal(project.writable, true);
  assert.equal(project.isProject, true);

  const readOnly = describeStore({
    root: 'C:/tmp/ro/.dsh-memory',
    kind: 'project',
    entry: { writable: false, slug: 'ro' },
    meta: { slug: 'ro', title: 'RO' },
  });
  assert.equal(readOnly.writable, false);
});

test('legacy vault session resolves to legacy store and legacy write target', () => {
  const root = tempDir();
  const vault = path.join(root, 'vault');
  const globalRoot = path.join(root, 'global');
  const registry = path.join(root, 'projects.json');
  try {
    fs.mkdirSync(vault, { recursive: true });
    writeStore(vault, 'vault');
    writeStore(globalRoot, 'global');

    assert.equal(isInsideLegacy(path.join(vault, 'nested'), vault), true);
    assert.equal(isInsideLegacy(path.join(root, 'outside'), vault), false);

    const context = resolveContext(path.join(vault, 'nested'), { legacyRoot: vault, globalRoot, registryFile: registry });
    assert.equal(context.global.kind, 'global');
    assert.equal(context.project.kind, 'legacy');
    assert.equal(context.scope, 'global');
    assert.equal(context.legacy, true);

    const target = resolveWriteTarget(path.join(vault, 'nested'), { legacyRoot: vault, registryFile: registry });
    assert.equal(target.kind, 'legacy');
    assert.equal(target.scope, 'global');
    assert.equal(path.resolve(target.root), path.resolve(vault));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an attached writable project wins over the legacy decision', () => {
  const root = tempDir();
  const project = path.join(root, 'project');
  const store = path.join(project, '.dsh-memory');
  const registry = path.join(root, 'projects.json');
  try {
    writeStore(store, 'writable-project');
    attachProject(store, registry, { writable: true });

    const context = resolveContext(project, { legacyRoot: path.join(root, 'vault'), registryFile: registry });
    assert.equal(context.project.kind, 'project');
    assert.equal(context.project.slug, 'writable-project');
    assert.equal(context.scope, 'project:writable-project');
    assert.equal(context.legacy, false);

    const target = resolveWriteTarget(project, { legacyRoot: path.join(root, 'vault'), registryFile: registry });
    assert.equal(target.kind, 'project');
    assert.equal(target.scope, 'project:writable-project');
    assert.equal(path.resolve(target.root), path.resolve(store));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('read-only and unattached stores never become a write target', () => {
  const root = tempDir();
  const readOnlyProject = path.join(root, 'readonly');
  const readOnlyStore = path.join(readOnlyProject, '.dsh-memory');
  const bareProject = path.join(root, 'bare');
  const registry = path.join(root, 'projects.json');
  try {
    writeStore(readOnlyStore, 'readonly-project');
    attachProject(readOnlyStore, registry, { writable: false });
    fs.mkdirSync(path.join(bareProject, '.dsh-memory'), { recursive: true });
    writeStore(path.join(bareProject, '.dsh-memory'), 'bare-project');

    assert.equal(resolveWriteTarget(readOnlyProject, { legacyRoot: path.join(root, 'vault'), registryFile: registry }), null);
    assert.equal(resolveWriteTarget(bareProject, { legacyRoot: path.join(root, 'vault'), registryFile: registry }), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('workspaceKind never trusts client paths', () => {
  assert.equal(workspaceKind('global'), 'global');
  assert.equal(workspaceKind('legacy'), 'legacy');
  assert.equal(workspaceKind('some-slug'), 'project');
  assert.equal(workspaceKind('C:\\Users\\evil\\path'), 'project');
});
