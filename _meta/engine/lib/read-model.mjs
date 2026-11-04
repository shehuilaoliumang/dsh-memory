/**
 * Unified read model for one or many memory stores.
 *
 * 3.0 goal: every host (the DSH panel, the CLI adapter, the MCP host) reads
 * notes, injection candidates, explanations and search through this module.
 * Writes intentionally do not live here: they stay in the CLI/context layer and
 * are still fail-closed per store.
 *
 * The model is synchronous and caches derived files by mtime+size. It never
 * accepts a filesystem path from a caller: workspace ids are resolved through
 * the user-level registry (`resolveWorkspaceStore`).
 */
import fs from 'node:fs';
import path from 'node:path';

import { runCli } from './cli.mjs';
import { rankInjectionCandidates, isGlobalScopeStore } from './injection.mjs';
import { explainInjection } from './injection-reasons.mjs';
import { currentTruthEntries, currentTruthNotes, pickBySourceControls } from './work-brief.mjs';
import { parseFrontmatter } from './shared/frontmatter.mjs';
import {
  DEFAULT_GLOBAL_ROOT,
  DEFAULT_REGISTRY_FILE,
  isStoreRoot,
  readProjectMeta,
  readProjectRegistry,
  resolveStores,
  resolveWorkspaceStore,
} from './stores.mjs';

export const MEMORY_LAYERS = ['10_Raw', '20_Digest', '30_Canon'];
export const TOTAL_INJECTION_LIMIT = 5;
export const GLOBAL_INJECTION_LIMIT = 2;

// Warn once per store for global-scope leaks in non-legacy project stores.
const scopeLeakWarned = new Set();

function walk(dir, visit) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else if (entry.isFile() && entry.name.endsWith('.md')) visit(full);
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return '';
  }
}

const catalogCache = new Map();
const accessCache = new Map();

/**
 * The derived index gives the prompt its candidate fields without reading every
 * note file. A manual edit without `rebuild` is intentionally not reflected
 * here; the label explanation consumes this same snapshot (audit-15 B2).
 */
export function readCatalogInjectionNotes(storeRoot) {
  const root = path.resolve(storeRoot);
  try {
    const file = path.join(root, '_meta', 'catalog.jsonl');
    const stat = fs.statSync(file);
    const cached = catalogCache.get(root);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.notes;
    const rows = readText(file).split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
    const notes = rows
      .filter((row) => row && row.id && row.level === 'digest' && row.status === 'active'
        && !['topic', 'work', 'session'].includes(String(row.type || '')))
      .map((row) => ({
        id: String(row.id),
        title: String(row.title || ''),
        status: 'active',
        scope: String(row.scope || ''),
        level: 'digest',
        type: String(row.type || ''),
        tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
        summary: String(row.summary || ''),
        updated: String(row.updated || ''),
        subject: String(row.subject || ''),
        file: String(row.path || ''),
      }));
    catalogCache.set(root, { mtimeMs: stat.mtimeMs, size: stat.size, notes });
    return notes;
  } catch {
    return null;
  }
}

/** Every note file in the standard three layers (core.md excluded). */
export function scanStoreNotes(storeRoot) {
  const root = path.resolve(storeRoot);
  const files = [];
  for (const layer of MEMORY_LAYERS) walk(path.join(root, layer), (file) => files.push(file));
  const notes = [];
  for (const file of files) {
    if (path.basename(file) === 'core.md') continue;
    const text = readText(file);
    const parsed = parseFrontmatter(text);
    const data = parsed && parsed.data ? parsed.data : (parsed || {});
    if (!data || !data.id || !/^\d{4}-\d{2}-\d{2}-/.test(String(data.id))) continue;
    notes.push({
      id: String(data.id),
      title: String(data.title || ''),
      status: String(data.status || ''),
      scope: String(data.scope || ''),
      level: String(data.level || ''),
      type: String(data.type || ''),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      summary: String(data.summary || ''),
      subject: String(data.subject || ''),
      updated: String(data.updated || ''),
      file: path.relative(root, file).split(path.sep).join('/'),
    });
  }
  return notes;
}

/** Parsed access rows per store, cached until access.jsonl changes. */
export function readAccessRows(storeRoot) {
  const root = path.resolve(storeRoot);
  try {
    const file = path.join(root, '_meta', 'access.jsonl');
    const stat = fs.statSync(file);
    const cached = accessCache.get(root);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.rows;
    const rows = readText(file).split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const row = JSON.parse(line);
        return row && row.id ? [{ id: String(row.id), t: String(row.t || ''), how: String(row.how || '') }] : [];
      } catch {
        return [];
      }
    });
    accessCache.set(root, { mtimeMs: stat.mtimeMs, size: stat.size, rows });
    return rows;
  } catch {
    return [];
  }
}

function legacyLabel(legacyRoot) {
  try {
    const meta = readProjectMeta(legacyRoot);
    if (meta && meta.title) return meta.title;
  } catch {
    /* fall through to the historical label */
  }
  return '当前工作区（旧版）';
}

/**
 * Store targets the UI may request. Ids are trust-gated names; the legacy vault,
 * the global store and attached projects stay separate entries even when a
 * registry row points at the vault.
 */
export function listWorkspaces(options = {}) {
  const legacyRoot = path.resolve(options.legacyRoot);
  const globalRoot = path.resolve(options.globalRoot || DEFAULT_GLOBAL_ROOT);
  const registryFile = path.resolve(options.registryFile || DEFAULT_REGISTRY_FILE);
  const workspaces = [];
  if (isStoreRoot(globalRoot)) {
    workspaces.push({ id: 'global', label: '全局记忆', kind: 'global', root: globalRoot, writable: true });
  }
  workspaces.push({ id: 'legacy', label: legacyLabel(legacyRoot), kind: 'legacy', root: legacyRoot, writable: true });
  const seen = new Set([legacyRoot, globalRoot]);
  for (const entry of readProjectRegistry(registryFile).values()) {
    if (!entry.slug) continue;
    const target = path.resolve(entry.path);
    if (seen.has(target)) continue;
    try {
      if (!isStoreRoot(target) || !readProjectMeta(target)) continue;
    } catch {
      continue;
    }
    seen.add(target);
    workspaces.push({
      id: entry.slug,
      label: readProjectMeta(target).title || entry.slug,
      kind: 'project',
      root: target,
      writable: entry.writable === true,
    });
  }
  return workspaces;
}

/** Resolve one page-selected view without accepting arbitrary paths. */
export function resolveView(workspace, options = {}, stores = null) {
  const legacyRoot = path.resolve(options.legacyRoot);
  const globalRoot = path.resolve(options.globalRoot || DEFAULT_GLOBAL_ROOT);
  const registryFile = path.resolve(options.registryFile || DEFAULT_REGISTRY_FILE);
  const requested = String(workspace || '').trim();
  if (!requested || requested === 'session') {
    if (stores && stores.projectRoot && !stores.project?.legacy && stores.project?.scopeMode !== 'global') {
      const project = stores.project;
      return {
        id: project.meta.slug,
        root: project.root,
        kind: 'project',
        meta: project.meta,
        writable: project.entry ? project.entry.writable === true : false,
      };
    }
    return resolveWorkspaceStore('legacy', { legacyRoot, globalRoot, registryFile });
  }
  return resolveWorkspaceStore(requested, { legacyRoot, globalRoot, registryFile });
}

/**
 * One read surface bound to a session cwd (or explicit stores). All methods are
 * synchronous and side-effect free apart from in-process caches.
 */
export function createSurface(options = {}) {
  const legacyRoot = path.resolve(options.legacyRoot);
  const globalRoot = path.resolve(options.globalRoot || DEFAULT_GLOBAL_ROOT);
  const registryFile = path.resolve(options.registryFile || DEFAULT_REGISTRY_FILE);
  const cwd = options.cwd ? path.resolve(options.cwd) : legacyRoot;
  const stores = options.stores
    || resolveStores(cwd, { legacyRoot, globalRoot, registryFile });
  const legacyProject = Boolean(stores && isGlobalScopeStore(stores.project));
  const storeOptions = { legacyRoot, globalRoot, registryFile };

  const candidatesForStore = (storeRoot, scope, filterScope = '', query = '', extra = {}) => {
    if (!storeRoot) return [];
    const notes = readCatalogInjectionNotes(storeRoot) || scanStoreNotes(storeRoot);
    // A global-scope memory inside a non-legacy project store is a write-layer
    // leak (the judge must downgrade it). Exclude it, but surface once per store
    // so the owner can repair the data; the unified path must keep the warning
    // that used to live only in the plugin fallback (3.0.1 D1).
    if (filterScope && filterScope.startsWith('project:')) {
      const leaked = notes.filter(
        (note) => note.level === 'digest' && note.status === 'active' && note.scope === 'global',
      );
      if (leaked.length && !scopeLeakWarned.has(storeRoot)) {
        scopeLeakWarned.add(storeRoot);
        console.warn(
          `[kb-read-model] project store ${storeRoot} contains ${leaked.length} global-scope active memory(s): `
          + `${leaked.map((note) => note.id).join(', ')}; excluded from injection.`,
        );
      }
    }
    const filtered = notes.filter((note) => !filterScope
      || (filterScope[0] === '!' ? note.scope !== filterScope.slice(1) : note.scope === filterScope));
    return rankInjectionCandidates(currentTruthNotes(filtered, scope), readAccessRows(storeRoot), {
      limit: 500,
      query,
      exploration: extra.explore ? 1 : 0,
    });
  };

  const selectInjection = (scope = 'global', controls = {}, selectOptions = {}) => {
    const query = selectOptions.query || '';
    const pinned = controls && controls.pinned ? controls.pinned : new Set();
    const muted = controls && controls.muted ? controls.muted : new Set();
    const isPinned = (id) => pinned.has(String(id || ''));
    const isMuted = (id) => muted.has(String(id || ''));
    const globalLimit = stores.globalRoot ? GLOBAL_INJECTION_LIMIT : 0;
    const projectLimit = stores.projectRoot
      ? (legacyProject ? TOTAL_INJECTION_LIMIT : stores.globalRoot ? 3 : TOTAL_INJECTION_LIMIT)
      : 0;
    const entries = [];
    const add = (source, notes) => {
      notes.forEach((note, rank) => entries.push({ note, source, rank }));
    };
    if (globalLimit && stores.globalRoot) {
      add('global', candidatesForStore(stores.globalRoot, 'global', 'global', query));
    }
    if (projectLimit && stores.projectRoot) {
      const filterScope = legacyProject ? '' : scope;
      add('project', candidatesForStore(stores.projectRoot, scope, filterScope, query, { explore: true }));
    }
    const current = currentTruthEntries(entries, scope);
    const picked = pickBySourceControls(current, { globalLimit, projectLimit, isPinned, isMuted });
    const pickedGlobal = picked.globalPicked.slice(0, globalLimit);
    const pickedProject = picked.projectPicked.slice(0, Math.max(0, TOTAL_INJECTION_LIMIT - pickedGlobal.length));
    return {
      globalPicked: pickedGlobal,
      projectPicked: pickedProject,
      candidates: current.map((entry) => entry.note),
    };
  };

  const manifestFor = (selected, controls = {}) => {
    const pinSet = controls && controls.pinned ? controls.pinned : new Set();
    const entries = [
      ...selected.globalPicked.map((note) => ({
        id: String(note.id || ''),
        summary: String(note.summary || note.title || ''),
        scope: String(note.scope || 'global'),
        store: 'global',
        pinned: pinSet.has(String(note.id || '')),
      })),
      ...selected.projectPicked.map((note) => ({
        id: String(note.id || ''),
        summary: String(note.summary || note.title || ''),
        scope: String(note.scope || ''),
        store: legacyProject ? 'legacy' : 'project',
        pinned: pinSet.has(String(note.id || '')),
      })),
    ];
    return { total: entries.length, global: selected.globalPicked.length, project: selected.projectPicked.length, entries };
  };

  const injectionFor = (scope = 'global', controls = {}, selectOptions = {}) => {
    const selected = selectInjection(scope, controls, selectOptions);
    return { ...manifestFor(selected, controls), candidates: selected.candidates };
  };

  const limitsFor = () => ({
    global: stores.globalRoot ? GLOBAL_INJECTION_LIMIT : 0,
    project: stores.projectRoot ? (legacyProject ? TOTAL_INJECTION_LIMIT : stores.globalRoot ? 3 : TOTAL_INJECTION_LIMIT) : 0,
    total: TOTAL_INJECTION_LIMIT,
  });

  /**
   * Notes for one view, sorted like the panel, with the same explanation labels
   * the selection produced. `sessionStores` defaults to this surface's stores.
   */
  const notesWithInjection = (view, context = {}) => {
    const scope = context.scope || 'global';
    const sessionStores = context.sessionStores || stores;
    const controls = context.controls || {};
    const query = context.query || '';
    const notes = scanStoreNotes(view.root).sort(
      (a, b) => (b.updated || '').localeCompare(a.updated || '') || b.id.localeCompare(a.id),
    );
    const manifest = context.manifest || injectionFor(scope, controls, { query });
    const roots = new Set();
    if (sessionStores.globalRoot) roots.add(path.resolve(sessionStores.globalRoot));
    const projectRoot = sessionStores.projectRoot || (sessionStores.project && sessionStores.project.root);
    if (projectRoot) roots.add(path.resolve(projectRoot));
    const muted = controls.muted instanceof Set ? [...controls.muted] : (controls.muted || []);
    const reasons = explainInjection({
      notes,
      candidates: manifest.candidates || [],
      entries: manifest.entries || [],
      scope,
      viewKind: view.kind,
      mutedIds: muted,
      inSessionStore: roots.has(path.resolve(view.root)),
      limits: limitsFor(),
    });
    return notes.map((note) => ({ ...note, injection: reasons[note.id] || null }));
  };

  /**
   * Read-only union of every listed store for the panel's "全部记忆库" view.
   * Selection/explanation still belong to the current session; notes carry
   * `workspaceId`/`workspaceLabel`/`uid` so identical ids in two stores stay
   * distinct. Writes are never routed through this view.
   */
  const snapshotAll = (context = {}) => {
    const scope = context.scope || 'global';
    const controls = context.controls || {};
    const query = context.query || '';
    const sessionStores = context.sessionStores || stores;
    const injection = injectionFor(scope, controls, { query });
    const options = listWorkspaces(storeOptions);
    const notes = [];
    for (const option of options) {
      const view = resolveView(option.id, storeOptions, stores);
      const viewNotes = notesWithInjection(view, {
        scope,
        controls,
        query,
        sessionStores,
        manifest: injection,
      });
      for (const note of viewNotes) {
        notes.push({
          ...note,
          workspaceId: option.id,
          workspaceLabel: option.label,
          uid: `${option.id}::${note.id}`,
        });
      }
    }
    notes.sort((a, b) => (b.updated || '').localeCompare(a.updated || '') || String(a.uid).localeCompare(String(b.uid)));
    return {
      view: { id: 'all', kind: 'all', label: '全部记忆库', writable: false, readOnly: true },
      workspaces: options,
      notes,
      total: notes.length,
      injection,
    };
  };

  /**
   * Aggregated read-only search. `workspace='all'` queries every listed store
   * and tags each row with its source; single-store queries keep the historic
   * per-store shape. No recall rows are written here.
   */
  const search = (request = {}) => {
    const query = String(request.query || '').trim();
    if (!query) throw new Error('search 需要 query');
    const requested = Math.trunc(Number(request.limit || 5));
    const limit = Math.max(1, Math.min(20, Number.isFinite(requested) ? requested : 5));
    const workspace = String(request.workspace || 'session');
    const targets = workspace === 'all' ? listWorkspaces(storeOptions) : [resolveView(workspace, storeOptions, stores)];
    const rows = [];
    let total = 0;
    const strategy = { pinyin: false, semantic: false };
    for (const target of targets) {
      const result = runCli(['--root', target.root, 'search', '--query', query, '--limit', String(limit), '--json']);
      if (result.code !== 0) continue;
      let payload;
      try {
        payload = JSON.parse(result.stdout);
      } catch {
        continue;
      }
      total += Number(payload.total) || 0;
      if (payload.strategy) {
        strategy.pinyin = strategy.pinyin || payload.strategy.pinyin === true;
        strategy.semantic = strategy.semantic || payload.strategy.semantic === true;
      }
      const allowed = new Set(scanStoreNotes(target.root).map((note) => note.id));
      for (const row of payload.results || []) {
        if (!allowed.has(String(row.id))) continue;
        rows.push({
          ...row,
          workspace: target.id,
          workspaceLabel: target.label || (target.meta && target.meta.title) || target.id,
        });
      }
      // `total` in the live handler is the literal-hit count; keep CLI parity
      // for a single store and the same additive rule for the union.
    }
    if (workspace === 'all') rows.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    return { ok: true, query, total, strategy, results: rows.slice(0, limit) };
  };

  return {
    legacyRoot,
    globalRoot,
    registryFile,
    stores,
    workspaces: () => listWorkspaces(storeOptions),
    view: (workspace) => resolveView(workspace, storeOptions, stores),
    notes: scanStoreNotes,
    catalogNotes: readCatalogInjectionNotes,
    accessRows: readAccessRows,
    selectInjection,
    injection: injectionFor,
    manifest: manifestFor,
    notesWithInjection,
    snapshotAll,
    search,
  };
}
