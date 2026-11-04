/**
 * 3.0 P4 performance gate.
 *
 * Fixtures: 5 stores x 300 digest atoms (legacy + 4 attached projects). The
 * gate measures the two user-facing read paths on one warm `createSurface`:
 *   - all-store search (server-side `workspace=all`, no child process)
 *   - unified panel snapshot (`snapshotAll`, one pass over every store)
 *
 * Budgets: all-search median < 500ms, snapshot median < 300ms, zero spawn.
 * Exit code is non-zero on failure so CI can call this directly.
 */
import fs from 'node:fs';
import path from 'node:path';

import { createSurface } from '../lib/read-model.mjs';

const BASE = path.join(process.cwd(), '.tmp-bench');
const STORES = 5;
const NOTES_PER_STORE = 300;
const QUERY = '记忆 回退 发布';
const SEARCH_BUDGET_MS = 500;
const SNAPSHOT_BUDGET_MS = 300;

function makeStore(root, slug) {
  for (const dir of ['_meta', '10_Raw', '20_Digest/atoms', '20_Digest/work', '30_Canon', '_meta/templates']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(root, '_meta', 'config.json'), `${JSON.stringify({
    version: 1,
    paths: {
      catalog: '_meta/catalog.jsonl',
      archive: '_meta/catalog.archive.jsonl',
      access: '_meta/access.jsonl',
      changeLog: '_meta/log.md',
      sessions: '10_Raw/sessions',
    },
    limits: {
      catalog_max_rows: 5000,
      catalog_max_bytes: 300,
      summary_max_chars: 40,
      stale_days: 180,
      archive_days: 180,
      review_warn_days: 0,
      work_stale_days: 14,
      access_max_lines: 50000,
      access_max_bytes: 5242880,
    },
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(root, '_meta', 'catalog.jsonl'), '', 'utf8');
  fs.writeFileSync(path.join(root, '_meta', 'catalog.archive.jsonl'), '', 'utf8');
  fs.writeFileSync(path.join(root, '_meta', 'log.md'), '# log\n', 'utf8');
  fs.writeFileSync(path.join(root, 'project.json'), JSON.stringify({ slug, title: `库 ${slug}` }), 'utf8');
  fs.writeFileSync(path.join(root, '30_Canon', 'core.md'), [
    '---', 'title: bench core', 'updated: 2026-11-04', '---', '', '# bench core', '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(root, 'VERSION'), '9.9.9\n', 'utf8');
  fs.writeFileSync(path.join(root, '_meta', 'templates', 'work.md'), [
    '---', 'id: 2026-01-01-w-0000', 'title: t', 'level: digest', 'type: work', 'scope: global', 'status: active', 'summary: s', 'updated: 2026-01-01', '---', '',
    '## 当前阶段', '', '## 在办', '', '## 未决', '', '## 下一步', '', '## 关联', '', '',
  ].join('\n'), 'utf8');
}

function writeNotes(root) {
  const catalog = [];
  for (let i = 0; i < NOTES_PER_STORE; i += 1) {
    const id = `2026-11-04-a-${String(i).padStart(4, '0')}`;
    const title = `性能夹具 ${i} 记忆回退发布`;
    const summary = `第 ${i} 条性能夹具摘要：记忆检索、发布流程与注入回退`;
    fs.writeFileSync(path.join(root, '20_Digest', 'atoms', `${id}.md`), [
      '---',
      `id: ${id}`,
      `title: ${title}`,
      'level: digest',
      'type: fact',
      'status: active',
      'scope: global',
      `summary: ${summary}`,
      'updated: 2026-11-04',
      '---', '',
      '## 要点', '', `- ${summary}`, '',
    ].join('\n'), 'utf8');
    catalog.push(JSON.stringify({
      id, path: `20_Digest/atoms/${id}.md`, level: 'digest', type: 'fact', status: 'active',
      tags: [], summary, updated: '2026-11-04', title, scope: 'global', subject: '',
    }));
  }
  fs.writeFileSync(path.join(root, '_meta', 'catalog.jsonl'), `${catalog.join('\n')}\n`, 'utf8');
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function time(fn, runs = 3) {
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const start = process.hrtime.bigint();
    const value = fn();
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
    if (i === runs - 1) return { ms: median(samples), samples, value };
    void value;
  }
  return { ms: median(samples), samples, value: undefined };
}

function main() {
  fs.rmSync(BASE, { recursive: true, force: true });
  fs.mkdirSync(BASE, { recursive: true });
  const legacy = path.join(BASE, 'legacy');
  makeStore(legacy, 'bench-legacy');
  writeNotes(legacy);
  const projects = [];
  for (let i = 0; i < STORES - 1; i += 1) {
    const root = path.join(BASE, `p-${i}`);
    const slug = `bench-${i}`;
    makeStore(root, slug);
    writeNotes(root);
    projects.push({ slug, path: root, attachedAt: new Date().toISOString(), writable: true, storeId: `bench${i}` });
  }
  const registryFile = path.join(BASE, 'registry.json');
  fs.writeFileSync(registryFile, `${JSON.stringify({ version: 1, projects }, null, 2)}\n`, 'utf8');
  const globalRoot = path.join(BASE, 'global');
  makeStore(globalRoot, 'bench-global');

  const surface = createSurface({ legacyRoot: legacy, globalRoot, registryFile, cwd: legacy });
  surface.search({ workspace: 'all', query: QUERY, limit: 20 }); // warm caches + catalog mtime/size
  surface.snapshotAll();

  const search = time(() => surface.search({ workspace: 'all', query: QUERY, limit: 20 }));
  const snapshot = time(() => surface.snapshotAll());
  const engineSource = fs.readFileSync(new URL('../lib/read-model.mjs', import.meta.url), 'utf8')
    + fs.readFileSync(new URL('../lib/cli.mjs', import.meta.url), 'utf8');
  const spawnFree = !/child_process|spawnSync|execFileSync/.test(engineSource);
  const stores = surface.workspaces().length;
  const notes = STORES * NOTES_PER_STORE;

  const result = {
    stores,
    notes,
    searches: search.samples.map((n) => Math.round(n)),
    snapshotMs: Math.round(snapshot.ms),
    searchMs: Math.round(search.ms),
    spawnFree,
    budgets: { searchMs: SEARCH_BUDGET_MS, snapshotMs: SNAPSHOT_BUDGET_MS },
    ok: stores === STORES + 1 && search.ms < SEARCH_BUDGET_MS && snapshot.ms < SNAPSHOT_BUDGET_MS && spawnFree,
  };
  console.log(JSON.stringify(result, null, 2));
  fs.rmSync(BASE, { recursive: true, force: true });
  if (!result.ok) process.exit(1);
}

main();
