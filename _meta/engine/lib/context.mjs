/**
 * Context convergence (v2.0/A) — the single decision function for "which stores
 * does this session see, and which one may it write to".
 *
 * Before v2.0 the plugin derived this from paths in several places: `within(root,
 * cwd)` for mode, `storesFor` for injection, `writableProjectStore` + a legacy
 * fallback in the ingestion hook, and workspace-kind checks in the UI handlers.
 * Those copies could drift. Every routing decision now goes through this module,
 * and a store is always described by the same shape whether it is the legacy
 * vault, a project store or the global preference store.
 *
 * Host-agnostic: no DSH or plugin imports.
 */
import path from 'node:path';
import {
  findProjectStore,
  isStoreRoot,
  isWithin,
  resolveStores,
  writableProjectStore,
} from './stores.mjs';

/**
 * Uniform descriptor for every store kind. `kind` is the only discriminator the
 * callers need; `scope` and `writable` are derived once here.
 *
 * @param {{root:string, kind:'global'|'legacy'|'project', entry?:object|null, meta?:object|null}} spec
 */
export function describeStore({ root, kind, entry = null, meta = null }) {
  const resolved = path.resolve(root);
  const slug = String((meta && meta.slug) || (entry && entry.slug) || '').trim().toLowerCase();
  return {
    root: resolved,
    kind,
    entry,
    slug,
    writable: kind === 'global' || kind === 'legacy' ? true : Boolean(entry && entry.writable === true),
    scope: kind === 'project' && slug ? `project:${slug}` : 'global',
    isLegacy: kind === 'legacy',
    isProject: kind === 'project',
    isGlobal: kind === 'global',
  };
}

/** Is `cwd` inside the explicitly configured legacy vault? */
export function isInsideLegacy(cwd, legacyRoot) {
  if (!cwd || !legacyRoot) return false;
  return isWithin(path.resolve(legacyRoot), path.resolve(cwd));
}

/**
 * Resolve the stores a session sees. `global` is omitted when the global store
 * is not a store root; `project` is the nearest attached project store, or the
 * legacy vault when cwd is inside it. `scope` matches the original semantics:
 * project stores get `project:<slug>`, everything else is `global`.
 */
export function resolveContext(cwd, options = {}) {
  const { legacyRoot = '', globalRoot = '', registryFile } = options;
  const stores = resolveStores(cwd, options);
  const global = stores.globalRoot
    ? describeStore({ root: stores.globalRoot, kind: 'global' })
    : null;
  let project = null;
  if (stores.project) {
    const kind = stores.project.legacy ? 'legacy' : 'project';
    project = describeStore({
      root: stores.project.root,
      kind,
      entry: stores.project.entry || null,
      meta: stores.project.meta || null,
    });
  }
  return {
    cwd: cwd ? path.resolve(cwd) : '',
    global,
    project,
    scope: project && project.isProject ? project.scope : 'global',
    legacy: Boolean(project && project.isLegacy),
    writeTarget: resolveWriteTarget(cwd, { legacyRoot, registryFile }),
  };
}

/**
 * The single write-authority decision: a writable attached project store wins;
 * otherwise a session inside the configured legacy vault writes there. Anything
 * else returns null (fail closed — no implicit store creation here).
 *
 * @returns {{root:string, kind:'legacy'|'project', scope:string}|null}
 */
export function resolveWriteTarget(cwd, options = {}) {
  if (!cwd) return null;
  const { legacyRoot = '', registryFile } = options;
  try {
    const writable = writableProjectStore(cwd, { legacyRoot, registryFile });
    if (writable) {
      const descriptor = describeStore({
        root: writable.root,
        kind: 'project',
        entry: writable.entry || null,
        meta: writable.meta || null,
      });
      return { root: descriptor.root, kind: 'project', scope: descriptor.scope };
    }
  } catch {
    /* fall through to the legacy decision */
  }
  if (isInsideLegacy(cwd, legacyRoot)) {
    return { root: path.resolve(legacyRoot), kind: 'legacy', scope: 'global' };
  }
  return null;
}

/**
 * Trust-gated workspace kinds for the management UI. Ids are names, never
 * paths; the actual store resolution still goes through `resolveWorkspaceStore`.
 */
export function workspaceKind(id) {
  const key = String(id || '').trim().toLowerCase();
  if (key === 'global') return 'global';
  if (key === 'legacy') return 'legacy';
  return 'project';
}

/** Re-export the pure helpers callers need alongside the context. */
export { findProjectStore, isStoreRoot, isWithin, resolveStores, writableProjectStore };
