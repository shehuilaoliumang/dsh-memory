#!/usr/bin/env node
/**
 * Capture a normalized read-surface baseline from a running kb-panel host.
 *
 * Why: the 3.0 structural cycle moves injection selection, per-note reasons,
 * search and panel composition into the engine read model. Before touching the
 * runtime we freeze what 2.4.1 actually returns for a fixed session/queries, so
 * the migrated surface can be diffed against it (see README.md next to the
 * baseline).
 *
 * Usage (host must be running and the session id must be live):
 *   node _meta/engine/test/capture-parity.mjs \
 *     --base http://127.0.0.1:1518 \
 *     --session session-<id> \
 *     --out _meta/engine/test/parity/baseline-2.4.1.json
 *
 * The output deliberately drops volatile data (paths, timestamps, heat scores,
 * full note bodies). Compare IDs/order/state/labels/strategy only.
 */
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = { base: 'http://127.0.0.1:1518', session: '', out: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') out.base = argv[++i] || out.base;
    else if (arg === '--session') out.session = argv[++i] || '';
    else if (arg === '--out') out.out = argv[++i] || '';
  }
  if (!out.session) throw new Error('missing --session (must be a live session id)');
  if (!out.out) throw new Error('missing --out');
  return out;
}

async function getJson(base, pathname) {
  const url = `${base.replace(/\/+$/, '')}${pathname}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${pathname} -> ${res.status}`);
  return res.json();
}

function panelUrl(session, workspace) {
  const q = new URLSearchParams({ session });
  if (workspace) q.set('workspace', workspace);
  return `/kb/panel.json?${q.toString()}`;
}

function normalizePanel(panel) {
  return {
    view: panel.view
      ? { id: panel.view.id, kind: panel.view.kind, writable: panel.view.writable === true }
      : null,
    notes: (panel.notes || []).map((note) => ({
      id: note.id,
      status: note.status || '',
      level: note.level || '',
      type: note.type || '',
      scope: note.scope || '',
      subject: note.subject || '',
      updated: note.updated || '',
      injection: note.injection
        ? { state: note.injection.state, label: note.injection.label }
        : null,
    })),
    injection: {
      total: panel.injection ? panel.injection.total : 0,
      global: panel.injection ? panel.injection.global : 0,
      project: panel.injection ? panel.injection.project : 0,
      entries: ((panel.injection && panel.injection.entries) || []).map((entry) => ({
        id: entry.id,
        store: entry.store || '',
        pinned: entry.pinned === true,
      })),
    },
  };
}

function normalizeSearch(payload) {
  return {
    total: payload.total || 0,
    strategy: payload.strategy || { pinyin: false, semantic: false },
    results: (payload.results || []).map((row) => ({
      id: row.id,
      workspace: row.workspace || '',
      matchedBy: row.matchedBy || '',
      matchLabel: row.matchLabel || '',
      matchTerms: row.matchTerms || [],
    })),
  };
}

const QUERIES = ['jiyi', '发布', 'zzqqxx'];

const args = parseArgs(process.argv.slice(2));
const session = args.session;

const basePanel = await getJson(args.base, panelUrl(session));
const workspaces = (basePanel.workspaces || []).map((w) => ({
  id: w.id,
  label: w.label,
  kind: w.kind,
  writable: w.writable === true,
}));
const defaultPanel = normalizePanel(basePanel);

const panels = {};
for (const workspace of workspaces) {
  const panel = await getJson(args.base, panelUrl(session, workspace.id));
  panels[workspace.id] = normalizePanel(panel);
}

const searches = {};
const targets = ['all', ...workspaces.map((w) => w.id)];
for (const target of targets) {
  searches[target] = [];
  for (const query of QUERIES) {
    const qs = new URLSearchParams({ workspace: target, q: query, limit: '10' });
    const payload = await getJson(args.base, `/kb/search.json?${qs.toString()}`);
    searches[target].push({ query, ...normalizeSearch(payload) });
  }
}

const fixture = {
  schema: 1,
  capturedAt: new Date().toISOString(),
  upstreamVersion: '2.4.1',
  host: args.base,
  session,
  defaultView: defaultPanel.view,
  workspaces,
  panels,
  searches,
  notes: {
    totalPanels: Object.keys(panels).length,
    queries: QUERIES,
    searchTargets: targets,
  },
};

fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
console.log(`parity baseline written: ${args.out}`);
console.log(`workspaces=${workspaces.length} panels=${Object.keys(panels).length} searches=${targets.length * QUERIES.length}`);
