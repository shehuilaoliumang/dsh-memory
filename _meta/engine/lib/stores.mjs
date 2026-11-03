/**
 * Store discovery for the multi-project memory layout.
 *
 * Layout (schema §17):
 *   ~/.dsh-memory/global/           global preferences, always available
 *   ~/.dsh-memory/projects.json     user-level attach registry (never in a repo)
 *   <project>/.dsh-memory/          project store, identified by project.json
 *
 * Trust boundary: a store's `project.json` only says *what* it is. A project
 * store is loaded only when its canonical path is listed in the user-level
 * registry. A cloned repository therefore cannot opt itself into the model's
 * context; the user has to attach it explicitly.
 *
 * Pure fs/path helpers, no Host APIs: testable with temp directories.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PROJECT_DIR_NAME = '.dsh-memory';
export const DEFAULT_GLOBAL_ROOT = path.join(os.homedir(), '.dsh-memory', 'global');
export const DEFAULT_REGISTRY_FILE = path.join(os.homedir(), '.dsh-memory', 'projects.json');

export function isWithin(parent, child) {
  if (!parent || !child) return false;
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function isStoreRoot(dir) {
  if (!dir) return false;
  return fs.existsSync(path.join(dir, '_meta', 'config.json')) || fs.existsSync(path.join(dir, '30_Canon', 'core.md'));
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

/** Read `<store>/project.json`. Returns null when the store is not a project. */
export function readProjectMeta(storeRoot) {
  const meta = readJson(path.join(storeRoot, 'project.json'));
  if (!meta || typeof meta !== 'object') return null;
  const slug = String(meta.slug || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug)) return null;
  return { slug, title: String(meta.title || slug) };
}

/**
 * Registry shape: {"version":1,"projects":[{"slug":"x","path":"C:/..."}]}.
 * Unknown shapes are ignored rather than crashing the Host.
 */
export function readProjectRegistry(registryFile = DEFAULT_REGISTRY_FILE) {
  const raw = readJson(registryFile, null);
  if (!raw) return new Map();
  const list = Array.isArray(raw) ? raw : Array.isArray(raw.projects) ? raw.projects : [];
  const out = new Map();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const target = entry.path || entry.root;
    if (!target) continue;
    const resolved = path.resolve(path.dirname(registryFile), String(target));
    out.set(resolved, {
      slug: String(entry.slug || '').trim().toLowerCase(),
      path: resolved,
      attachedAt: String(entry.attachedAt || entry.attached_at || ''),
      // A stable per-library identity, so a renamed folder can be recognised as
      // the same store instead of a new one (c-1001).
      storeId: String(entry.storeId || '').trim().toLowerCase(),
      // Trust provenance: did the plugin itself grant write access when it
      // created this store (autoWritable), or did a human attach it?
      autoGranted: entry.autoGranted === true,
      // Workspace-folder creation time (ms) captured at attach. A rename keeps
      // it; a copy gets a new one, which lets relocation tell the two apart.
      folderBirthtimeMs: Number(entry.folderBirthtimeMs) > 0 ? Number(entry.folderBirthtimeMs) : 0,
      // Write access is a user-level grant, never a project-controlled flag:
      // a cloned repository cannot make itself writable by editing project.json.
      writable: entry.writable === true,
    });
  }
  return out;
}

/**
 * Find the nearest project store from `cwd` upward. The legacy configured root
 * (this vault) is always trusted because it is explicit plugin config.
 *
 * @returns {{root:string, meta:{slug:string,title:string}, legacy:boolean}|null}
 */
export function findProjectStore(cwd, options = {}) {
  if (!cwd) return null;
  const legacyRoot = options.legacyRoot ? path.resolve(options.legacyRoot) : '';
  const registry = readProjectRegistry(options.registryFile || DEFAULT_REGISTRY_FILE);
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, PROJECT_DIR_NAME);
    if (isStoreRoot(candidate)) {
      const meta = readProjectMeta(candidate);
      const canonical = path.resolve(candidate);
      // Keep looking upward when this store is unmarked or not attached: a
      // nested repository must not shadow an attached parent store.
      if (meta && registry.has(canonical)) {
        return { root: canonical, meta, legacy: false, entry: registry.get(canonical) };
      }
    }
    if (legacyRoot && isWithin(legacyRoot, dir)) {
      const meta = readProjectMeta(legacyRoot) || {
        slug: path.basename(legacyRoot).toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'vault',
        title: path.basename(legacyRoot),
      };
      return { root: legacyRoot, meta, legacy: true, entry: null };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the two stores a session may read. Global is optional; project is
 * optional. No store means no injection, exactly like a fresh install.
 */
export function resolveStores(cwd, options = {}) {
  const globalRoot = options.globalRoot ? path.resolve(options.globalRoot) : DEFAULT_GLOBAL_ROOT;
  const global = isStoreRoot(globalRoot) ? globalRoot : null;
  const project = findProjectStore(cwd, options);
  return { globalRoot: global, projectRoot: project ? project.root : null, project: project || null };
}

/** Files/dirs that mark a directory as a project workspace worth a store. */
export const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'AGENTS.md',
  'pom.xml',
  'composer.json',
  'Gemfile',
];

/** Paths under the user profile that are scratch space, never a project. */
function isScratchPath(target, options = {}) {
  const resolved = path.resolve(target);
  if (resolved === path.parse(resolved).root) return true;
  const home = options.homeDir ? path.resolve(options.homeDir) : path.resolve(os.homedir());
  if (resolved === home) return true;
  const tmp = options.tmpDir ? path.resolve(options.tmpDir) : path.resolve(os.tmpdir());
  if (isWithin(tmp, resolved)) return true;
  const scratch = ['.dsh', '.dsh-memory', 'AppData', 'Downloads', 'Desktop'].map((name) =>
    path.join(home, name),
  );
  return scratch.some((dir) => isWithin(dir, resolved));
}

/**
 * Does this directory look like a real project workspace? The legacy vault is
 * handled by its own root, so this only decides whether an external session cwd
 * deserves an automatic store. A container of projects (a folder whose
 * immediate children are git repositories or Node packages) also qualifies.
 */
export function looksLikeProjectWorkspace(cwd) {
  if (!cwd) return false;
  let base;
  try {
    base = path.resolve(cwd);
    if (!fs.statSync(base).isDirectory()) return false;
  } catch {
    return false;
  }
  for (const marker of PROJECT_MARKERS) {
    try {
      if (fs.existsSync(path.join(base, marker))) return true;
    } catch {
      /* keep checking the rest */
    }
  }
  let entries;
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return false;
  }
  let scanned = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (++scanned > 64) break;
    const child = path.join(base, entry.name);
    try {
      if (fs.existsSync(path.join(child, '.git')) || fs.existsSync(path.join(child, 'package.json'))) {
        return true;
      }
    } catch {
      /* keep checking the rest */
    }
  }
  return false;
}

/** Filesystem-safe, stable slug; non-Latin directory names get a short hash. */
export function workspaceSlug(cwd) {
  const base = path
    .basename(path.resolve(cwd))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base && /^[a-z0-9][a-z0-9-]{1,63}$/.test(base)) return base.slice(0, 64);
  const digest = crypto.createHash('sha1').update(path.resolve(cwd).toLowerCase()).digest('hex').slice(0, 8);
  return `p-${digest}`;
}

/** Slug that does not collide with reserved view ids or an attached store. */
export function uniqueWorkspaceSlug(cwd, registryFile = DEFAULT_REGISTRY_FILE) {
  const raw = workspaceSlug(cwd);
  const base = ['global', 'legacy', 'session'].includes(raw) ? `workspace-${raw}` : raw;
  const used = new Set([...readProjectRegistry(registryFile).values()].map((entry) => entry.slug));
  let slug = base;
  let suffix = 2;
  while (used.has(slug)) {
    slug = `${base.slice(0, 54)}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

/**
 * Plan the automatic store a live session cwd may get. Returns null when the
 * directory must not be provisioned: inside the legacy vault or the global
 * store, scratch/system locations, an existing `.dsh-memory` (a repo-shipped
 * store is never auto-trusted), or when no project marker is present.
 *
 * @returns {{cwd:string, storeRoot:string, slug:string, title:string, registryFile:string}|null}
 */
export function provisionTarget(cwd, options = {}) {
  if (!cwd) return null;
  let resolved;
  try {
    resolved = path.resolve(cwd);
  } catch {
    return null;
  }
  const legacyRoot = options.legacyRoot ? path.resolve(options.legacyRoot) : '';
  const globalRoot = options.globalRoot ? path.resolve(options.globalRoot) : DEFAULT_GLOBAL_ROOT;
  if (legacyRoot && isWithin(legacyRoot, resolved)) return null;
  if (isWithin(globalRoot, resolved)) return null;
  if (isScratchPath(resolved, options)) return null;
  const registryFile = options.registryFile || DEFAULT_REGISTRY_FILE;
  const storeRoot = path.join(resolved, PROJECT_DIR_NAME);
  // Never overwrite or auto-attach an existing store: a cloned repository could
  // otherwise ship its own memory. Existing stores go through the explicit card.
  if (fs.existsSync(storeRoot)) return null;
  // A session inside an already-attached project keeps using that project.
  try {
    if (findProjectStore(resolved, { legacyRoot, registryFile })) return null;
  } catch {
    return null;
  }
  if (!looksLikeProjectWorkspace(resolved)) return null;
  const slug = uniqueWorkspaceSlug(resolved, registryFile);
  const title = (path.basename(resolved) || slug).slice(0, 120);
  return { cwd: resolved, storeRoot, slug, title, registryFile };
}

export function registryEntryFor(storeRoot, registryFile = DEFAULT_REGISTRY_FILE) {
  return readProjectRegistry(registryFile).get(path.resolve(storeRoot)) || null;
}

const STORE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{8,63}$/;

/** Relocation tolerance: two birthtimes within 5s count as the same folder. */
export const RELOCATE_BIRTHTIME_TOLERANCE_MS = 5000;

/** Workspace-folder creation time in ms (0 when the filesystem cannot tell). */
export function folderBirthtimeMs(dir) {
  try {
    const value = fs.statSync(dir).birthtimeMs;
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  } catch {
    return 0;
  }
}

/** Read the stable library id from `project.json` ('' when absent/invalid). */
export function readStoreId(storeRoot) {
  const meta = readJson(path.join(storeRoot, 'project.json'), null);
  const id = meta && typeof meta.store_id === 'string' ? meta.store_id.trim().toLowerCase() : '';
  return STORE_ID_PATTERN.test(id) ? id : '';
}

/**
 * Idempotently add a stable `store_id` to `project.json`. Identity must not be
 * the absolute path: a user renaming the workspace folder moves the store, and
 * the registry has to be able to recognise it again (c-0021).
 */
export function ensureStoreId(storeRoot) {
  const root = path.resolve(storeRoot);
  const file = path.join(root, 'project.json');
  const meta = readJson(file, null);
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return '';
  const existing = readStoreId(root);
  if (existing) return existing;
  const id = `store-${crypto.randomBytes(6).toString('hex')}`;
  const next = { ...meta, store_id: id };
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
  return id;
}

/** Update the display name in `project.json`; slug and scope are untouched. */
export function updateProjectTitle(storeRoot, title) {
  const root = path.resolve(storeRoot);
  const file = path.join(root, 'project.json');
  const meta = readJson(file, null);
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('缺少有效 project.json');
  const clean = String(title || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60);
  if (!clean) throw new Error('名称不能为空');
  const next = { ...meta, title: clean };
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
  return clean;
}

/**
 * After a folder rename the store is still auto-derived from its folder name if
 * the title was never customised; keep that behaviour. A manually chosen title
 * survives the migration.
 */
export function followWorkspaceTitle(oldPath, newStoreRoot) {
  const oldTitle = path.basename(path.dirname(path.resolve(oldPath)));
  const newTitle = path.basename(path.dirname(path.resolve(newStoreRoot)));
  const meta = readProjectMeta(path.resolve(newStoreRoot));
  if (!meta || !newTitle || meta.title !== oldTitle) return '';
  if (newTitle === oldTitle) return '';
  try {
    return updateProjectTitle(path.resolve(newStoreRoot), newTitle);
  } catch {
    return '';
  }
}

function writeRegistryFile(registryFile, projects) {
  fs.mkdirSync(path.dirname(registryFile), { recursive: true });
  const tmp = `${registryFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, projects }, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, registryFile);
}

/**
 * Serialize registry "read → mutate → write" across processes (panel routes,
 * CLI attach, startup sync). writeRegistryFile is atomic per write, but two
 * concurrent readers can still lose each other's update; a lock file with a
 * short stale-takeover deadline closes that window without a dependency.
 */
function acquireRegistryLock(registryFile, timeoutMs = 5000) {
  const lockFile = `${registryFile}.lock`;
  fs.mkdirSync(path.dirname(registryFile), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fd = fs.openSync(lockFile, 'wx');
      return () => {
        try {
          fs.closeSync(fd);
        } catch {
          /* already closed */
        }
        try {
          fs.unlinkSync(lockFile);
        } catch {
          /* lock already removed */
        }
      };
    } catch (error) {
      if (error && error.code !== 'EEXIST') throw error;
      if (Date.now() > deadline) {
        // A crashed writer may leave the lock behind; take it over once.
        try {
          fs.unlinkSync(lockFile);
        } catch {
          /* another waiter already removed it */
        }
        if (Date.now() > deadline + 2000) throw new Error(`registry lock timeout: ${lockFile}`);
      } else {
        // Synchronous API: block briefly instead of introducing async churn.
        const until = Date.now() + 10;
        while (Date.now() < until) {
          /* spin */
        }
      }
    }
  }
}

/** Run one registry read-modify-write under the cross-process lock. */
export function withRegistryLock(registryFile, fn) {
  const release = acquireRegistryLock(registryFile);
  try {
    return fn();
  } finally {
    release();
  }
}

/**
 * Backfill the stable id and the workspace-folder birthtime into project.json
 * and the user-level registry for every attached store that still exists.
 * Idempotent; safe to run at plugin start.
 */
export function syncRegistryStoreIds(registryFile = DEFAULT_REGISTRY_FILE) {
  const release = acquireRegistryLock(registryFile);
  try {
    const registry = readJson(registryFile, null);
  const projects = registry && Array.isArray(registry.projects) ? registry.projects : null;
  if (!projects || !projects.length) return 0;
  let changed = 0;
  for (const entry of projects) {
    if (!entry || typeof entry !== 'object') continue;
    const target = entry.path || entry.root;
    if (!target) continue;
    const storeRoot = path.resolve(path.dirname(registryFile), String(target));
    if (!isStoreRoot(storeRoot)) continue;
    let id = '';
    try {
      id = ensureStoreId(storeRoot);
    } catch {
      id = '';
    }
    if (!id) continue;
    if (String(entry.storeId || '') !== id) {
      entry.storeId = id;
      changed += 1;
    }
    // Needed by the two-signal relocation rule: an entry attached before v1.19
    // has no birthtime yet, so its first rename requires a confirmation.
    if (!(Number(entry.folderBirthtimeMs) > 0)) {
      const birthtime = folderBirthtimeMs(path.dirname(storeRoot));
      if (birthtime > 0) {
        entry.folderBirthtimeMs = birthtime;
        changed += 1;
      }
    }
  }
  if (changed) writeRegistryFile(registryFile, projects);
  return changed;
  } finally {
    release();
  }
}

/**
 * Find the registry entry that represents the same store at a different path.
 * Three signals are returned for the caller's policy:
 *   - `oldPathAlive`: copy/clone vs. a moved folder;
 *   - `sameOrigin`: the current workspace folder keeps the creation time that
 *     was recorded at attach time (a rename keeps it, a copy gets a new one);
 *   - the registry entry itself (write grant, slug, autoGranted flag).
 * Automatic relocation is only justified when the old path is gone AND the
 * folder birthtime still matches; anything else needs a human confirmation.
 */
export function relocationCandidate(storeRoot, registryFile = DEFAULT_REGISTRY_FILE) {
  const resolved = path.resolve(storeRoot);
  let id = '';
  try {
    id = ensureStoreId(resolved);
  } catch {
    return null;
  }
  if (!id) return null;
  const entries = [...readProjectRegistry(registryFile).entries()];
  const hit = entries.find(([entryPath, entry]) => entry.storeId === id && entryPath !== resolved);
  if (!hit) return null;
  const [oldPath, entry] = hit;
  const currentBirthtime = folderBirthtimeMs(path.dirname(resolved));
  const sameOrigin = Boolean(
    entry.folderBirthtimeMs > 0
      && currentBirthtime > 0
      && Math.abs(currentBirthtime - entry.folderBirthtimeMs) <= RELOCATE_BIRTHTIME_TOLERANCE_MS,
  );
  return {
    storeId: id,
    oldPath,
    entry,
    oldPathAlive: isStoreRoot(oldPath),
    sameOrigin,
    folderBirthtimeMs: currentBirthtime,
  };
}

/**
 * Move one registry entry to the store's current path, preserving the write
 * grant and slug. The stale old-path entry is dropped in the same write.
 * `options.auto` marks a relocation the plugin performed from the two-signal
 * rule; only then the autoGranted provenance survives the move.
 */
export function relocateProject(storeRoot, oldPath, registryFile = DEFAULT_REGISTRY_FILE, options = {}) {
  const release = acquireRegistryLock(registryFile);
  try {
    const resolved = path.resolve(storeRoot);
  const meta = readProjectMeta(resolved);
  if (!meta) throw new Error(`不是项目库（缺少有效 project.json）：${resolved}`);
  const id = ensureStoreId(resolved);
  const registry = readJson(registryFile, null);
  const projects = registry && Array.isArray(registry.projects) ? registry.projects : [];
  const oldResolved = path.resolve(oldPath);
  const previous = projects.find((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const target = entry.path || entry.root;
    return target ? path.resolve(path.dirname(registryFile), String(target)) === oldResolved : false;
  });
  const kept = projects.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const target = entry.path || entry.root;
    if (!target) return true;
    const entryPath = path.resolve(path.dirname(registryFile), String(target));
    if (entryPath === oldResolved || entryPath === resolved) return false;
    // Also drop any other row that claims the same stable id (duplicate copies).
    return !(id && String(entry.storeId || '') === id);
  });
  const birthtime = folderBirthtimeMs(path.dirname(resolved));
  const row = {
    slug: meta.slug,
    path: resolved,
    attachedAt: new Date().toISOString(),
    storeId: id,
    writable: previous ? previous.writable === true : false,
  };
  if (birthtime > 0) row.folderBirthtimeMs = birthtime;
  if (options.auto === true && previous && previous.autoGranted === true) row.autoGranted = true;
  kept.push(row);
  writeRegistryFile(registryFile, kept);
  return { root: resolved, slug: meta.slug, storeId: id, oldPath: oldResolved, writable: row.writable };
  } finally {
    release();
  }
}

/** Idempotently attach a project store in the user-level registry. */
export function attachProject(storeRoot, registryFile = DEFAULT_REGISTRY_FILE, options = {}) {
  const release = acquireRegistryLock(registryFile);
  try {
    const root = path.resolve(storeRoot);
  const meta = readProjectMeta(root);
  if (!meta) throw new Error(`不是项目库（缺少有效 project.json）：${root}`);
  const registry = readJson(registryFile, null);
  const base = registry && !Array.isArray(registry) ? registry : { version: 1, projects: [] };
  const projects = Array.isArray(base.projects) ? base.projects : [];
  const previous = projects.find((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const target = entry.path || entry.root;
    return target ? path.resolve(path.dirname(registryFile), String(target)) === root : false;
  });
  const kept = projects.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const target = entry.path || entry.root;
    return target ? path.resolve(path.dirname(registryFile), String(target)) !== root : true;
  });
  const writable = options.writable === undefined ? previous && previous.writable === true : options.writable === true;
  let storeId = previous && previous.storeId ? String(previous.storeId) : '';
  try {
    storeId = ensureStoreId(root) || storeId;
  } catch {
    storeId = storeId || '';
  }
  const row = { slug: meta.slug, path: root, attachedAt: new Date().toISOString(), writable };
  if (storeId) row.storeId = storeId;
  const birthtime = folderBirthtimeMs(path.dirname(root));
  if (birthtime > 0) row.folderBirthtimeMs = birthtime;
  // Only the plugin's auto-provision path passes this; an explicit user attach
  // drops the marker so the provenance stays truthful.
  if (options.autoGranted === true) row.autoGranted = true;
  kept.push(row);
  writeRegistryFile(registryFile, kept);
  return { root, slug: meta.slug, registryFile, writable, storeId };
  } finally {
    release();
  }
}

/**
 * The store a turn should be written into. Only an attached project entry with
 * an explicit `writable: true` grant qualifies; otherwise this returns null so
 * the caller can fall back to the legacy predicate (or skip writing entirely).
 */
export function writableProjectStore(cwd, options = {}) {
  const project = findProjectStore(cwd, options);
  if (!project || project.legacy || !project.entry || project.entry.writable !== true) return null;
  return project;
}

/**
 * Resolve one view target for the management UI. `id` is a trust-gated name,
 * never a filesystem path: `global`, `legacy`, or a slug from the user-level
 * registry. This is deliberately read-only about discovery; write permission is
 * reported on the result and enforced by the caller.
 *
 * @returns {{id:string, root:string, kind:'global'|'legacy'|'project', meta:{slug:string,title:string}, writable:boolean}}
 */
export function resolveWorkspaceStore(id, options = {}) {
  const legacyRoot = options.legacyRoot ? path.resolve(options.legacyRoot) : '';
  const globalRoot = options.globalRoot ? path.resolve(options.globalRoot) : DEFAULT_GLOBAL_ROOT;
  const key = String(id || '').trim().toLowerCase();
  const legacyMeta = () =>
    readProjectMeta(legacyRoot) || {
      slug: path.basename(legacyRoot).toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'vault',
      title: path.basename(legacyRoot),
    };

  if (key === 'global') {
    if (!isStoreRoot(globalRoot)) throw new Error('全局记忆库不存在');
    return { id: 'global', root: globalRoot, kind: 'global', meta: { slug: 'global', title: '全局记忆' }, writable: true };
  }

  if (!legacyRoot) throw new Error('当前没有可用的工作区记忆库');
  if (key === '' || key === 'legacy') {
    return { id: 'legacy', root: legacyRoot, kind: 'legacy', meta: { ...legacyMeta(), slug: 'legacy' }, writable: true };
  }

  const entry = [...readProjectRegistry(options.registryFile || DEFAULT_REGISTRY_FILE).values()].find((candidate) => candidate.slug === key);
  if (!entry) throw new Error(`未知的工作区：${key}`);
  if (!isStoreRoot(entry.path)) throw new Error(`工作区记忆库不可读：${key}`);
  if (path.resolve(entry.path) === legacyRoot) {
    return { id: 'legacy', root: legacyRoot, kind: 'legacy', meta: { ...legacyMeta(), slug: 'legacy' }, writable: true };
  }
  const meta = readProjectMeta(entry.path);
  if (!meta) throw new Error(`工作区缺少有效 project.json：${key}`);
  return { id: meta.slug, root: entry.path, kind: 'project', meta, writable: entry.writable === true };
}
