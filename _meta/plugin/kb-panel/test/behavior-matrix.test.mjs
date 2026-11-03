/**
 * Runtime behavior matrix — the routing contract between context.mjs and
 * stores.mjs after the v2.0/A convergence (one resolver decides stores, scope
 * and write authority).
 *
 * Real implementations only (engine/lib/context.mjs + engine/lib/stores.mjs),
 * temporary directories only, no network, no Host, no mocks.
 *
 * Covered behavior rows (each asserts kind / scope / writable / writeTarget /
 * mode semantics):
 *   a. session inside the explicitly configured legacy vault
 *      → project.kind='legacy', scope='global', write kind='legacy', isInsideLegacy=true;
 *   b. external project + attached writable store
 *      → kind='project', scope='project:<slug>', writeTarget points at that store;
 *   c. external project + attached read-only store
 *      → kind='project', project.writable=false, writeTarget=null;
 *   d. external project that ships its OWN `.dsh-memory` but is not attached
 *      → context.project=null (never auto-trusted), writeTarget=null, even if
 *        project.json claims `writable: true` (trust is user-level only);
 *   e. folder rename (old path gone, folder creation time kept)
 *      → relocationCandidate.oldPathAlive=false && sameOrigin=true (the
 *        two-signal auto-rebind rule holds); after relocation the write route
 *        follows the new path;
 *   f. copied store (old path still present → oldPathAlive=true; or old path
 *      deleted but a fresh folder birthtime → sameOrigin=false)
 *      → never auto-rebound, only an explicit human confirmation relocates it.
 * Plus one turn/end routing sequence — vault → project A → project B → vault —
 * that checks the write root of every leg and that routing mutates no state.
 *
 * Boundaries — Host behavior deliberately NOT simulated here:
 *   - the `session/event` subscription, async ingest/judge runners and their
 *     queueing, retry and backoff;
 *   - the per-session memory toggle override map (`/kb/mode`) and the panel's
 *     stored project scope; `hostMode()` below is only the cwd-derived default;
 *   - automatic provisioning (`ensureWorkspaceStore` / `provisionTarget`) and the
 *     management-page cards for an unconfirmed copy or a migrated workspace;
 *   - prompt assembly / injection budgets, ctx service access, `/kb/*` HTTP
 *     handlers and their CSRF + local-token checks, index rebuilds, and any
 *     other behavior that needs a live DSH Host.
 * `hostSessionScope()` mirrors the plugin's `scopeOfSession` fallback; it is part
 * of the contract this harness pins, so plugin and harness must change together.
 *
 * Isolation: every store, vault and registry lives under
 * os.tmpdir()+mkdtemp and is removed in `finally`. Every engine call receives an
 * explicit `registryFile` / `globalRoot` / `legacyRoot`, so the real user-level
 * `~/.dsh-memory/projects.json` is never read or written. Folder identity uses
 * stat birthtime; RELOCATE_BIRTHTIME_TOLERANCE_MS (5s) absorbs timer granularity.
 */
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
import {
  attachProject,
  ensureStoreId,
  folderBirthtimeMs,
  isStoreRoot,
  readProjectRegistry,
  relocationCandidate,
  relocateProject,
} from '../../../engine/lib/stores.mjs';

const TMP_PREFIX = 'kb-behavior-matrix-';
/** Mirrors RELOCATE_BIRTHTIME_TOLERANCE_MS in stores.mjs. */
const RELOCATE_TOLERANCE_MS = 5000;

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
}

/**
 * Scaffold a directory that satisfies `isStoreRoot` (via `_meta/config.json` /
 * `30_Canon/core.md`) and, unless `project:false`, carries a valid
 * `project.json` slug. `ensureStoreId` backfills the stable id like a real
 * created store would have.
 */
function writeStore(storeRoot, slug, { project = true, meta = {} } = {}) {
  fs.mkdirSync(path.join(storeRoot, '_meta'), { recursive: true });
  fs.mkdirSync(path.join(storeRoot, '30_Canon'), { recursive: true });
  fs.writeFileSync(path.join(storeRoot, '_meta', 'config.json'), '{"version":1}\n', 'utf8');
  fs.writeFileSync(path.join(storeRoot, '30_Canon', 'core.md'), '# core\n', 'utf8');
  if (project) {
    fs.writeFileSync(
      path.join(storeRoot, 'project.json'),
      `${JSON.stringify({ slug, title: slug, created_at: '2026-01-01', ...meta })}\n`,
      'utf8',
    );
    ensureStoreId(storeRoot);
  }
}

/**
 * One isolated fixture: the explicitly configured legacy vault, an optional
 * global store, and a user-level attach registry. Callers must pass
 * `layout.options` to every engine call so nothing escapes the temp root.
 */
function createLayout() {
  const root = makeTempRoot();
  const vault = path.join(root, 'vault');
  const globalRoot = path.join(root, 'global');
  const registryFile = path.join(root, 'projects.json');
  writeStore(vault, 'legacy-vault');
  writeStore(globalRoot, null, { project: false });
  return {
    root,
    vault,
    globalRoot,
    registryFile,
    options: { legacyRoot: vault, globalRoot, registryFile },
  };
}

/** A project workspace directory plus its `.dsh-memory` store; optionally attached. */
function makeProject(layout, dirName, slug, { writable = null } = {}) {
  const dir = path.join(layout.root, dirName);
  fs.mkdirSync(dir, { recursive: true });
  const storeRoot = path.join(dir, '.dsh-memory');
  writeStore(storeRoot, slug);
  if (writable !== null) attachProject(storeRoot, layout.registryFile, { writable });
  return { dir, storeRoot };
}

/** The Host mode default: only the cwd predicate; overrides are not simulated. */
function hostMode(cwd, options) {
  return isInsideLegacy(cwd, options.legacyRoot) ? 'on' : 'off';
}

/**
 * The Host session-scope inference for a session with no stored choice (plugin
 * `scopeOfSession`): an attached project store wins; outside the vault the
 * directory basename is inferred; inside the vault stays `global`.
 */
function hostSessionScope(cwd, context) {
  if (context.project && context.project.isProject && context.project.slug) {
    return context.project.scope;
  }
  if (!context.legacy) {
    const slug = path
      .basename(path.resolve(cwd))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (slug) return `project:${slug}`;
    return 'unclassified';
  }
  return 'global';
}

/**
 * Reference implementation of the Host's turn/end routing decision: one write
 * authority (or none), plus the mode/scope the Host would report for the leg.
 */
function routeTurn(cwd, options) {
  const context = resolveContext(cwd, options);
  return {
    context,
    mode: hostMode(cwd, options),
    scope: hostSessionScope(cwd, context),
    writeTarget: context.writeTarget,
  };
}

/** The documented two-signal relocation policy (plugin `ensureWorkspaceBinding`). */
function autoRebindAllowed(candidate) {
  return Boolean(candidate && candidate.oldPathAlive === false && candidate.sameOrigin === true);
}

/** Plain-data view of one routed leg, for exact expected-value comparisons. */
function summarize(route) {
  return {
    mode: route.mode,
    scope: route.scope,
    projectKind: route.context.project ? route.context.project.kind : null,
    projectSlug: route.context.project ? route.context.project.slug : null,
    projectWritable: route.context.project ? route.context.project.writable : null,
    writeKind: route.writeTarget ? route.writeTarget.kind : null,
    writeRoot: route.writeTarget ? path.resolve(route.writeTarget.root) : null,
    writeScope: route.writeTarget ? route.writeTarget.scope : null,
  };
}

test('describeStore derives kind / scope / write authority for every store kind', () => {
  const global = describeStore({ root: 'C:/tmp/global', kind: 'global' });
  assert.equal(global.kind, 'global');
  assert.equal(global.scope, 'global');
  assert.equal(global.writable, true);
  assert.equal(global.isGlobal, true);

  const legacy = describeStore({ root: 'C:/tmp/vault', kind: 'legacy' });
  assert.equal(legacy.kind, 'legacy');
  assert.equal(legacy.scope, 'global');
  assert.equal(legacy.writable, true);
  assert.equal(legacy.isLegacy, true);

  const writableProject = describeStore({
    root: 'C:/tmp/app/.dsh-memory',
    kind: 'project',
    entry: { writable: true, slug: 'app' },
    meta: { slug: 'app', title: 'App' },
  });
  assert.equal(writableProject.scope, 'project:app');
  assert.equal(writableProject.writable, true);
  assert.equal(writableProject.isProject, true);

  const readOnlyProject = describeStore({
    root: 'C:/tmp/ro/.dsh-memory',
    kind: 'project',
    entry: { writable: false, slug: 'ro' },
    meta: { slug: 'ro', title: 'RO' },
  });
  assert.equal(readOnlyProject.scope, 'project:ro');
  assert.equal(readOnlyProject.writable, false);

  // Workspace ids are trust-gated names, never client paths.
  assert.equal(workspaceKind('global'), 'global');
  assert.equal(workspaceKind('legacy'), 'legacy');
  assert.equal(workspaceKind('some-project'), 'project');
  assert.equal(workspaceKind('C:\\Users\\evil\\path'), 'project');
});

test('a. a session inside the legacy vault reads and writes the legacy store', () => {
  const layout = createLayout();
  try {
    const cwd = path.join(layout.vault, '20_Digest', 'atoms');
    fs.mkdirSync(cwd, { recursive: true });
    assert.equal(isInsideLegacy(cwd, layout.vault), true);
    assert.equal(isInsideLegacy(path.join(layout.root, 'outside'), layout.vault), false);

    const route = routeTurn(cwd, layout.options);
    const { context } = route;

    assert.equal(route.mode, 'on');
    assert.equal(route.scope, 'global');
    assert.equal(context.project.kind, 'legacy');
    assert.equal(context.project.isLegacy, true);
    assert.equal(context.project.writable, true);
    assert.equal(context.legacy, true);
    assert.equal(context.scope, 'global');
    assert.equal(context.global.kind, 'global');

    assert.equal(route.writeTarget.kind, 'legacy');
    assert.equal(route.writeTarget.scope, 'global');
    assert.equal(path.resolve(route.writeTarget.root), path.resolve(layout.vault));
    // The target embedded in the context and the standalone write-authority
    // call must agree (single decision function, no drift).
    assert.deepEqual(context.writeTarget, resolveWriteTarget(cwd, layout.options));
  } finally {
    fs.rmSync(layout.root, { recursive: true, force: true });
  }
});

test('b. an attached writable project store wins write authority with project scope', () => {
  const layout = createLayout();
  try {
    const project = makeProject(layout, 'proj-a', 'proj-a', { writable: true });
    // A nested cwd is enough: the nearest attached store is found upward.
    const cwd = path.join(project.dir, 'src', 'deep');
    fs.mkdirSync(cwd, { recursive: true });

    const route = routeTurn(cwd, layout.options);
    const { context } = route;

    assert.equal(route.mode, 'off');
    assert.equal(route.scope, 'project:proj-a');
    assert.equal(context.project.kind, 'project');
    assert.equal(context.project.slug, 'proj-a');
    assert.equal(context.project.scope, 'project:proj-a');
    assert.equal(context.project.writable, true);
    assert.equal(context.legacy, false);
    // Global memory stays visible to external sessions; only project memory is
    // project-scoped.
    assert.equal(context.global.kind, 'global');

    assert.equal(route.writeTarget.kind, 'project');
    assert.equal(route.writeTarget.scope, 'project:proj-a');
    assert.equal(path.resolve(route.writeTarget.root), path.resolve(project.storeRoot));
    assert.deepEqual(context.writeTarget, resolveWriteTarget(cwd, layout.options));
  } finally {
    fs.rmSync(layout.root, { recursive: true, force: true });
  }
});

test('c. an attached read-only project store is readable but never a write target', () => {
  const layout = createLayout();
  try {
    const project = makeProject(layout, 'proj-ro', 'proj-ro', { writable: false });
    const cwd = path.join(project.dir, 'src');
    fs.mkdirSync(cwd, { recursive: true });

    const route = routeTurn(cwd, layout.options);
    const { context } = route;

    assert.equal(route.mode, 'off');
    assert.equal(route.scope, 'project:proj-ro');
    assert.equal(context.project.kind, 'project');
    assert.equal(context.project.slug, 'proj-ro');
    assert.equal(context.project.writable, false);
    assert.equal(context.legacy, false);

    assert.equal(context.writeTarget, null);
    assert.equal(route.writeTarget, null);
    assert.equal(resolveWriteTarget(cwd, layout.options), null);

    // The attach row really exists and is readable; only the grant is missing.
    const row = readProjectRegistry(layout.registryFile).get(path.resolve(project.storeRoot));
    assert.ok(row, 'read-only store must still be attached');
    assert.equal(row.writable, false);
  } finally {
    fs.rmSync(layout.root, { recursive: true, force: true });
  }
});

test('d. a repo-shipped .dsh-memory is not auto-trusted and grants no write', () => {
  const layout = createLayout();
  try {
    // A cloned repo ships its own store, and even self-declares writable: the
    // project.json flag is never a trust signal.
    const cloneDir = path.join(layout.root, 'clone');
    const cloneStore = path.join(cloneDir, '.dsh-memory');
    writeStore(cloneStore, 'repo-shipped', { meta: { writable: true } });
    const cwd = cloneDir;
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });

    // The directory *looks* like a store and is not in the user-level registry.
    assert.equal(isStoreRoot(cloneStore), true);
    assert.equal(readProjectRegistry(layout.registryFile).has(path.resolve(cloneStore)), false);

    const route = routeTurn(cwd, layout.options);
    const { context } = route;

    assert.equal(route.mode, 'off');
    // No attached store: the context carries no project store at all, even
    // though an unattached `.dsh-memory` sits directly in the cwd.
    assert.equal(context.project, null);
    assert.equal(context.legacy, false);
    assert.equal(context.scope, 'global');
    // The Host still labels the session with an inferred project scope; that is
    // a name, not access — the write authority stays closed.
    assert.equal(route.scope, 'project:clone');

    assert.equal(context.writeTarget, null);
    assert.equal(route.writeTarget, null);
    assert.equal(resolveWriteTarget(cwd, layout.options), null);
  } finally {
    fs.rmSync(layout.root, { recursive: true, force: true });
  }
});

test('e. a renamed workspace is recognised by store id + folder birthtime and auto-rebinds', () => {
  const layout = createLayout();
  try {
    const oldDir = path.join(layout.root, 'old-name');
    fs.mkdirSync(oldDir, { recursive: true });
    const oldStore = path.join(oldDir, '.dsh-memory');
    writeStore(oldStore, 'renamed-app');
    attachProject(oldStore, layout.registryFile, { writable: true });

    const registered = readProjectRegistry(layout.registryFile).get(path.resolve(oldStore));
    assert.ok(registered);
    assert.ok(registered.folderBirthtimeMs > 0, 'attach records the workspace-folder birthtime');

    // Rename keeps the folder's creation time on the same volume.
    const newDir = path.join(layout.root, 'new-name');
    fs.renameSync(oldDir, newDir);
    const newStore = path.join(newDir, '.dsh-memory');
    fs.mkdirSync(path.join(newDir, 'src'), { recursive: true });

    const candidate = relocationCandidate(newStore, layout.registryFile);
    assert.ok(candidate, 'the stable store id must be recognised at the new path');
    assert.equal(candidate.oldPath, path.resolve(oldStore));
    assert.equal(candidate.storeId, ensureStoreId(newStore));
    assert.equal(candidate.oldPathAlive, false);
    assert.equal(candidate.sameOrigin, true);
    assert.equal(candidate.entry.writable, true);
    assert.ok(
      Math.abs(folderBirthtimeMs(newDir) - candidate.folderBirthtimeMs) <= RELOCATE_TOLERANCE_MS,
      'sameOrigin means both birthtimes are inside the relocation tolerance',
    );
    // Two-signal rule: old path gone AND same origin → automatic rebind is safe.
    assert.equal(autoRebindAllowed(candidate), true);

    // Before the Host rebinds, the new path is just an unattached store: no
    // project context, no write authority, only a derived session-scope label.
    const before = routeTurn(newDir, layout.options);
    assert.equal(before.context.project, null);
    assert.equal(before.writeTarget, null);
    assert.equal(before.scope, 'project:new-name');

    // What ensureWorkspaceBinding(auto) does on the two-signal rule.
    const moved = relocateProject(newStore, candidate.oldPath, layout.registryFile, { auto: true });
    assert.equal(moved.slug, 'renamed-app');
    const rows = readProjectRegistry(layout.registryFile);
    assert.equal(rows.size, 1);
    assert.equal(rows.has(path.resolve(newStore)), true);
    assert.equal(rows.has(path.resolve(oldStore)), false);
    assert.equal(rows.get(path.resolve(newStore)).writable, true);

    // After the rebind the same cwd routes writes into the store's new path.
    const after = routeTurn(path.join(newDir, 'src'), layout.options);
    assert.equal(after.mode, 'off');
    assert.equal(after.context.project.kind, 'project');
    assert.equal(after.context.project.slug, 'renamed-app');
    assert.equal(after.context.project.writable, true);
    assert.equal(after.scope, 'project:renamed-app');
    assert.equal(after.writeTarget.kind, 'project');
    assert.equal(after.writeTarget.scope, 'project:renamed-app');
    assert.equal(path.resolve(after.writeTarget.root), path.resolve(newStore));
  } finally {
    fs.rmSync(layout.root, { recursive: true, force: true });
  }
});

test('f1. a copied store whose origin path is alive is never auto-rebound', () => {
  const layout = createLayout();
  try {
    const originalDir = path.join(layout.root, 'copy-source');
    fs.mkdirSync(originalDir, { recursive: true });
    const originalStore = path.join(originalDir, '.dsh-memory');
    writeStore(originalStore, 'copy-live');
    attachProject(originalStore, layout.registryFile, { writable: true });

    const copyDir = path.join(layout.root, 'copy-destination');
    fs.mkdirSync(copyDir, { recursive: true });
    const copyStore = path.join(copyDir, '.dsh-memory');
    fs.cpSync(originalStore, copyStore, { recursive: true });

    const candidate = relocationCandidate(copyStore, layout.registryFile);
    assert.ok(candidate);
    assert.equal(candidate.oldPath, path.resolve(originalStore));
    assert.equal(candidate.oldPathAlive, true, 'the origin still exists: this is a copy, not a rename');
    // The grant belongs to the origin path; the copy has no trust of its own.
    assert.equal(candidate.entry.writable, true);
    // Even if the copy happens to share a birthtime, the living origin blocks
    // the automatic path. A human must confirm "this is the same library".
    assert.equal(autoRebindAllowed(candidate), false);

    const copyRoute = routeTurn(copyDir, layout.options);
    assert.equal(copyRoute.mode, 'off');
    // Only the Host's derived session-scope label exists; the write path stays closed.
    assert.equal(copyRoute.scope, 'project:copy-destination');
    assert.equal(copyRoute.context.project, null);
    assert.equal(copyRoute.writeTarget, null);

    // The origin keeps its write authority untouched.
    const originRoute = routeTurn(originalDir, layout.options);
    assert.equal(originRoute.mode, 'off');
    assert.equal(originRoute.scope, 'project:copy-live');
    assert.equal(originRoute.context.project.kind, 'project');
    assert.equal(originRoute.context.project.writable, true);
    assert.equal(originRoute.writeTarget.kind, 'project');
    assert.equal(originRoute.writeTarget.scope, 'project:copy-live');
    assert.equal(path.resolve(originRoute.writeTarget.root), path.resolve(originalStore));
  } finally {
    fs.rmSync(layout.root, { recursive: true, force: true });
  }
});

test('f2. a copy with a fresh birthtime and no origin needs human confirmation to relocate', () => {
  const layout = createLayout();
  try {
    const originalDir = path.join(layout.root, 'copy-origin');
    fs.mkdirSync(originalDir, { recursive: true });
    const originalStore = path.join(originalDir, '.dsh-memory');
    writeStore(originalStore, 'copy-confirmed');
    attachProject(originalStore, layout.registryFile, { writable: true, autoGranted: true });

    // Simulate an attach from an hour ago: the copy gets a fresh folder
    // creation time, so the two-signal rule must not treat it as same-origin.
    const raw = JSON.parse(fs.readFileSync(layout.registryFile, 'utf8'));
    raw.projects[0].folderBirthtimeMs = Date.now() - 60 * 60 * 1000;
    fs.writeFileSync(layout.registryFile, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');

    const copyDir = path.join(layout.root, 'copy-checkout');
    fs.mkdirSync(copyDir, { recursive: true });
    const copyStore = path.join(copyDir, '.dsh-memory');
    fs.cpSync(originalStore, copyStore, { recursive: true });
    fs.rmSync(originalDir, { recursive: true, force: true });

    const candidate = relocationCandidate(copyStore, layout.registryFile);
    assert.ok(candidate);
    assert.equal(candidate.oldPathAlive, false, 'the origin path is gone');
    assert.equal(candidate.sameOrigin, false, 'the copy has a different folder creation time');
    assert.equal(candidate.entry.autoGranted, true);
    assert.equal(autoRebindAllowed(candidate), false);

    // The copy was not trusted before a human clicked "confirm".
    const before = routeTurn(copyDir, layout.options);
    assert.equal(before.mode, 'off');
    assert.equal(before.scope, 'project:copy-checkout');
    assert.equal(before.context.project, null);
    assert.equal(before.writeTarget, null);

    // The panel's "确认这是同一个库" action: an explicit relocate (no `auto`).
    const moved = relocateProject(copyStore, candidate.oldPath, layout.registryFile);
    assert.equal(moved.writable, true, 'a confirmed relocation preserves the write grant');
    const rows = readProjectRegistry(layout.registryFile);
    assert.equal(rows.size, 1);
    const row = rows.get(path.resolve(copyStore));
    assert.ok(row);
    assert.equal(row.writable, true);
    // A human confirmation is not the plugin's auto-provision path, so the
    // auto-granted provenance marker is dropped.
    assert.equal(row.autoGranted, false);

    const after = routeTurn(path.join(copyDir, 'src'), layout.options);
    assert.equal(after.mode, 'off');
    assert.equal(after.context.project.kind, 'project');
    assert.equal(after.context.project.slug, 'copy-confirmed');
    assert.equal(after.context.project.writable, true);
    assert.equal(after.scope, 'project:copy-confirmed');
    assert.equal(after.writeTarget.kind, 'project');
    assert.equal(after.writeTarget.scope, 'project:copy-confirmed');
    assert.equal(path.resolve(after.writeTarget.root), path.resolve(copyStore));
  } finally {
    fs.rmSync(layout.root, { recursive: true, force: true });
  }
});

test('turn/end routing sequence keeps the write root per leg and mutates no state', () => {
  const layout = createLayout();
  try {
    const projectA = makeProject(layout, 'proj-a', 'proj-a', { writable: true });
    const projectB = makeProject(layout, 'proj-b', 'proj-b', { writable: true });
    const registryBefore = fs.readFileSync(layout.registryFile, 'utf8');

    const legs = [
      {
        cwd: path.join(layout.vault, '20_Digest'),
        expected: {
          mode: 'on',
          scope: 'global',
          projectKind: 'legacy',
          projectSlug: 'legacy-vault',
          projectWritable: true,
          writeKind: 'legacy',
          writeRoot: path.resolve(layout.vault),
          writeScope: 'global',
        },
      },
      {
        cwd: path.join(projectA.dir, 'src'),
        expected: {
          mode: 'off',
          scope: 'project:proj-a',
          projectKind: 'project',
          projectSlug: 'proj-a',
          projectWritable: true,
          writeKind: 'project',
          writeRoot: path.resolve(projectA.storeRoot),
          writeScope: 'project:proj-a',
        },
      },
      {
        cwd: projectB.dir,
        expected: {
          mode: 'off',
          scope: 'project:proj-b',
          projectKind: 'project',
          projectSlug: 'proj-b',
          projectWritable: true,
          writeKind: 'project',
          writeRoot: path.resolve(projectB.storeRoot),
          writeScope: 'project:proj-b',
        },
      },
      {
        // Back to the vault: no cross-leg state may leak from the projects.
        cwd: path.join(layout.vault, '30_Canon'),
        expected: {
          mode: 'on',
          scope: 'global',
          projectKind: 'legacy',
          projectSlug: 'legacy-vault',
          projectWritable: true,
          writeKind: 'legacy',
          writeRoot: path.resolve(layout.vault),
          writeScope: 'global',
        },
      },
    ];

    const summaries = [];
    for (const leg of legs) {
      const route = routeTurn(leg.cwd, layout.options);
      assert.deepEqual(summarize(route), leg.expected);
      // context.writeTarget is the same decision as calling the authority directly.
      assert.deepEqual(route.context.writeTarget, resolveWriteTarget(leg.cwd, layout.options));
      // Routing is a pure read: the user-level registry is byte-identical after
      // every leg, so one leg cannot steer the next.
      assert.equal(fs.readFileSync(layout.registryFile, 'utf8'), registryBefore);
      summaries.push(summarize(route));
    }

    // The last vault leg routes exactly like the first one.
    assert.deepEqual(summaries[3], summaries[0]);
    // And re-running any leg is deterministic (no hidden resolver state).
    assert.deepEqual(summarize(routeTurn(legs[1].cwd, layout.options)), summaries[1]);
    assert.equal(readProjectRegistry(layout.registryFile).size, 2);
  } finally {
    fs.rmSync(layout.root, { recursive: true, force: true });
  }
});
