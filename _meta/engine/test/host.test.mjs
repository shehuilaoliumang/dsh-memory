/**
 * Host-layer tests (3.0 P3).
 *
 * The fixture stores are real directories so the same code path (catalog
 * candidates, CLI write, search) runs as in a live host. Everything stays under
 * `.tmp-test-run` because this machine's sandbox denies child writes elsewhere.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createHost } from '../lib/host.mjs';
import { handleRpc, TOOL_DEFINITIONS } from '../hosts/mcp.mjs';

const BASE = path.join(process.cwd(), '.tmp-test-run');
fs.mkdirSync(BASE, { recursive: true });

function makeStore(TMP, name, { slug = name, core = 'fixture core' } = {}) {
  const root = path.join(TMP, name);
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
      catalog_max_rows: 3000,
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
    '---',
    'title: fixture core',
    'updated: 2026-11-04',
    '---',
    '',
    `# ${core}`,
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(root, 'VERSION'), '9.9.9\n', 'utf8');
  fs.writeFileSync(path.join(root, '_meta', 'templates', 'work.md'), [
    '---', 'id: 2026-01-01-w-0000', 'title: t', 'level: digest', 'type: work', 'scope: global', 'status: active', 'summary: s', 'updated: 2026-01-01', '---', '',
    '## 当前阶段', '', '## 在办', '', '## 未决', '', '## 下一步', '', '## 关联', '', '',
  ].join('\n'), 'utf8');
  return root;
}

function writeAtom(store, { id = '2026-11-04-a-0001', title = 'fixture atom', summary = 'fixture summary', scope = 'global', status = 'active' } = {}) {
  const file = path.join(store, '20_Digest', 'atoms', `${id}.md`);
  fs.writeFileSync(file, [
    '---',
    `id: ${id}`,
    `title: ${title}`,
    'level: digest',
    'type: fact',
    `status: ${status}`,
    `scope: ${scope}`,
    `summary: ${summary}`,
    'updated: 2026-11-04',
    '---', '',
    '## 要点', '', `- ${summary}`, '',
  ].join('\n'), 'utf8');
  const row = {
    id, path: `20_Digest/atoms/${id}.md`, level: 'digest', type: 'fact', status, tags: [],
    summary, updated: '2026-11-04', title, scope, subject: '',
  };
  fs.appendFileSync(path.join(store, '_meta', 'catalog.jsonl'), `${JSON.stringify(row)}\n`, 'utf8');
}

function buildHost() {
  const TMP = fs.mkdtempSync(path.join(BASE, 'host-'));
  const REGISTRY = path.join(TMP, 'registry.json');
  const legacy = makeStore(TMP, 'legacy', { slug: 'legacy-fixture', core: '项目核心' });
  const global = makeStore(TMP, 'global', { slug: 'global-fixture', core: '全局核心' });
  writeAtom(global, { id: '2026-11-04-a-0100', title: '全局偏好', summary: '全局偏好内容' });
  writeAtom(legacy, { id: '2026-11-04-a-0200', title: 'fixture search', summary: 'fixture search summary' });
  const host = createHost({ legacyRoot: legacy, globalRoot: global, registryFile: REGISTRY });
  return { host, legacy, global, TMP };
}

test('context renders core, injection and brief without a host', () => {
  const { host } = buildHost();
  const context = host.context({ cwd: host.legacyRoot });
  assert.equal(context.scope, 'global');
  assert.equal(context.injection.total, 2);
  assert.ok(context.text.includes('【全局核心记忆'));
  assert.ok(context.text.includes('【核心记忆'));
  assert.ok(context.text.includes('<untrusted-memory>'));
  assert.equal(context.view.kind, 'legacy');
});

test('search is read-only and tagged per store', () => {
  const { host } = buildHost();
  const result = host.search({ cwd: host.legacyRoot, query: 'fixture', limit: 5 });
  assert.equal(result.ok, true);
  assert.ok(result.results.length >= 1);
  assert.equal(result.results[0].workspace, 'legacy');
  assert.equal(result.strategy.semantic, false);

  const empty = host.search({ cwd: host.legacyRoot, query: 'zzqqxx', limit: 5 });
  assert.equal(empty.total, 0);
});

test('remember writes an inbox atom in the writable store', () => {
  const { host, legacy } = buildHost();
  const first = host.remember({ cwd: host.legacyRoot, text: 'MCP 宿主写入测试\n第二行要点' });
  assert.equal(first.ok, true);
  assert.equal(first.status, 'inbox');
  assert.ok(first.id);
  const file = path.join(legacy, '20_Digest', 'atoms', `${first.id}.md`);
  assert.ok(fs.existsSync(file));
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /status: inbox/);
  assert.match(text, /scope: global/);
  assert.match(text, /MCP 宿主写入测试/);

  const again = host.remember({ cwd: host.legacyRoot, text: 'MCP 宿主写入测试\n第二行要点' });
  assert.equal(again.duplicate, true);
  assert.equal(again.id, first.id);
});

test('remember is fail closed outside a writable store', () => {
  const { host, TMP } = buildHost();
  const outside = path.join(TMP, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  assert.throws(() => host.remember({ cwd: outside, text: '不应写入' }), /没有可写记忆库/);
  assert.throws(() => host.remember({ cwd: host.legacyRoot, text: '   ' }), /不能为空/);
});

test('status and validate report a healthy known store', () => {
  const { host, TMP } = buildHost();
  const status = host.status({ cwd: host.legacyRoot });
  assert.equal(status.version, '9.9.9');
  assert.equal(status.ok, true);
  assert.ok(status.workspaces.some((workspace) => workspace.id === 'legacy'));
  const validation = host.validate({ cwd: host.legacyRoot });
  assert.equal(validation.ok, true);
  assert.equal(validation.notes, 2);
  assert.throws(() => host.validate({ cwd: path.join(TMP, 'outside') }), /只能校验/);
});

test('MCP handler exposes the five tools and forwards calls', () => {
  const { host } = buildHost();
  const init = handleRpc(host, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  assert.equal(init.result.serverInfo.name, 'dsh-memory-kb');
  assert.equal(init.result.protocolVersion, '2024-11-05');

  const list = handleRpc(host, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.deepEqual(list.result.tools.map((tool) => tool.name), TOOL_DEFINITIONS.map((tool) => tool.name));
  assert.equal(list.result.tools.length, 5);

  const call = handleRpc(host, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'kb_status', arguments: { cwd: host.legacyRoot } },
  });
  assert.equal(call.result.isError, false);
  assert.equal(JSON.parse(call.result.content[0].text).version, '9.9.9');

  const missing = handleRpc(host, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'kb_context', arguments: {} } });
  assert.equal(missing.error.code, -32602);

  const unknown = handleRpc(host, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope', arguments: {} } });
  assert.equal(unknown.error.code, -32601);

  assert.equal(handleRpc(host, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }), null);
  assert.equal(handleRpc(host, { jsonrpc: '1.0', id: 6, method: 'ping' }).error.code, -32600);
});
