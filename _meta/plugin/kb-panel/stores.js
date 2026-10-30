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
      if (meta && registry.has(canonical)) return { root: canonical, meta, legacy: false };
    }
    if (legacyRoot && isWithin(legacyRoot, dir)) {
      const meta = readProjectMeta(legacyRoot) || {
        slug: path.basename(legacyRoot).toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'vault',
        title: path.basename(legacyRoot),
      };
      return { root: legacyRoot, meta, legacy: true };
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

export function registryEntryFor(storeRoot, registryFile = DEFAULT_REGISTRY_FILE) {
  return readProjectRegistry(registryFile).get(path.resolve(storeRoot)) || null;
}

/** Idempotently attach a project store in the user-level registry. */
export function attachProject(storeRoot, registryFile = DEFAULT_REGISTRY_FILE) {
  const root = path.resolve(storeRoot);
  const meta = readProjectMeta(root);
  if (!meta) throw new Error(`不是项目库（缺少有效 project.json）：${root}`);
  const registry = readJson(registryFile, null);
  const base = registry && !Array.isArray(registry) ? registry : { version: 1, projects: [] };
  const projects = Array.isArray(base.projects) ? base.projects : [];
  const kept = projects.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const target = entry.path || entry.root;
    return target ? path.resolve(path.dirname(registryFile), String(target)) !== root : true;
  });
  kept.push({ slug: meta.slug, path: root, attachedAt: new Date().toISOString() });
  const next = { version: 1, projects: kept };
  fs.mkdirSync(path.dirname(registryFile), { recursive: true });
  const tmp = `${registryFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, registryFile);
  return { root, slug: meta.slug, registryFile };
}
