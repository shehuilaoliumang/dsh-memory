/**
 * Third-host conformance (3.1 P1).
 *
 * Proves that the direct host API, the MCP stdio adapter and the HTTP adapter
 * return the same read results for the same store, and that all three fail
 * closed on a write outside a writable store. The HTTP adapter adds auth and
 * transport checks; it must not add or change engine rules.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createHost } from '../lib/host.mjs';
import { handleRpc } from '../hosts/mcp.mjs';
import { startHttpHost } from '../hosts/http.mjs';

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
    '---', 'title: fixture core', 'updated: 2026-11-04', '---', '', `# ${core}`, '',
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
    '---', `id: ${id}`, `title: ${title}`, 'level: digest', 'type: fact', `status: ${status}`,
    `scope: ${scope}`, `summary: ${summary}`, 'updated: 2026-11-04', '---', '',
    '## 要点', '', `- ${summary}`, '',
  ].join('\n'), 'utf8');
  fs.appendFileSync(path.join(store, '_meta', 'catalog.jsonl'), `${JSON.stringify({
    id, path: `20_Digest/atoms/${id}.md`, level: 'digest', type: 'fact', status, tags: [],
    summary, updated: '2026-11-04', title, scope, subject: '',
  })}\n`, 'utf8');
}

function buildFixture() {
  const TMP = fs.mkdtempSync(path.join(BASE, 'host-conformance-'));
  const REGISTRY = path.join(TMP, 'registry.json');
  const legacy = makeStore(TMP, 'legacy', { slug: 'legacy-fixture', core: '项目核心' });
  const global = makeStore(TMP, 'global', { slug: 'global-fixture', core: '全局核心' });
  writeAtom(global, { id: '2026-11-04-a-0100', title: '全局偏好', summary: '全局偏好内容' });
  writeAtom(legacy, { id: '2026-11-04-a-0200', title: 'fixture search', summary: 'fixture search summary' });
  return { TMP, REGISTRY, legacy, global };
}

function hostFor(fixture) {
  return createHost({ legacyRoot: fixture.legacy, globalRoot: fixture.global, registryFile: fixture.REGISTRY });
}

function rpc(host, method, params = {}) {
  const response = handleRpc(host, { jsonrpc: '2.0', id: 1, method, params }, { version: '9.9.9' });
  assert.ok(response, `MCP ${method} must answer a request`);
  assert.equal(response.error, undefined, `MCP ${method} must not return a protocol error`);
  return response.result;
}

function mcpCall(host, name, args) {
  return rpc(host, 'tools/call', { name, arguments: args });
}

async function post(base, token, action, body) {
  return fetch(`${base}/v1/${action}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

test('direct, MCP and HTTP read the same context, search, status and validation', async (t) => {
  const fixture = buildFixture();
  const direct = hostFor(fixture);
  const mcpHost = hostFor(fixture);
  const httpHost = hostFor(fixture);
  const started = await startHttpHost(httpHost, { port: 0, version: '9.9.9' });
  t.after(async () => {
    await started.close();
    fs.rmSync(fixture.TMP, { recursive: true, force: true });
  });
  assert.match(started.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(started.token.length >= 16);

  const context = direct.context({ cwd: direct.legacyRoot });
  const mcpContext = mcpCall(mcpHost, 'kb_context', { cwd: mcpHost.legacyRoot });
  const httpContext = await post(started.origin, started.token, 'context', { cwd: direct.legacyRoot });
  assert.equal(httpContext.status, 200);
  const httpContextBody = await httpContext.json();
  assert.equal(httpContextBody.ok, true);
  assert.equal(httpContextBody.result.text, context.text);
  assert.deepEqual(
    JSON.parse(mcpContext.content[0].text).text,
    context.text,
  );
  assert.equal(context.scope, 'global');
  assert.equal(context.view.id, 'legacy');

  const search = direct.search({ cwd: direct.legacyRoot, query: 'fixture', limit: 5 });
  const mcpSearch = JSON.parse(mcpCall(mcpHost, 'kb_search', { cwd: mcpHost.legacyRoot, query: 'fixture', limit: 5 }).content[0].text);
  const httpSearchResponse = await post(started.origin, started.token, 'search', { cwd: direct.legacyRoot, query: 'fixture', limit: 5 });
  assert.equal(httpSearchResponse.status, 200);
  const httpSearch = (await httpSearchResponse.json()).result;
  assert.deepEqual(httpSearch, search);
  assert.deepEqual(mcpSearch, search);
  assert.ok(search.total >= 1);

  const status = direct.status({ cwd: direct.legacyRoot });
  const mcpStatus = JSON.parse(mcpCall(mcpHost, 'kb_status', { cwd: mcpHost.legacyRoot }).content[0].text);
  const httpStatusResponse = await post(started.origin, started.token, 'status', { cwd: direct.legacyRoot });
  assert.equal(httpStatusResponse.status, 200);
  const httpStatus = (await httpStatusResponse.json()).result;
  for (const value of [mcpStatus, httpStatus]) {
    assert.equal(value.ok, status.ok);
    assert.equal(value.version, status.version);
    assert.deepEqual(value.workspaces.map((store) => store.id), status.workspaces.map((store) => store.id));
    assert.deepEqual(value.workspaces.map((store) => store.counts), status.workspaces.map((store) => store.counts));
  }

  const validation = direct.validate({});
  const mcpValidation = JSON.parse(mcpCall(mcpHost, 'kb_validate', {}).content[0].text);
  const httpValidationResponse = await post(started.origin, started.token, 'validate', {});
  assert.equal(httpValidationResponse.status, 200);
  const httpValidation = (await httpValidationResponse.json()).result;
  assert.deepEqual(httpValidation, validation);
  assert.deepEqual(mcpValidation, validation);
});

test('all three hosts fail closed when the session has no writable store', async (t) => {
  const fixture = buildFixture();
  const direct = hostFor(fixture);
  const mcpHost = hostFor(fixture);
  const httpHost = hostFor(fixture);
  const started = await startHttpHost(httpHost, { port: 0, version: '9.9.9' });
  const outside = fs.mkdtempSync(path.join(BASE, 'outside-'));
  t.after(async () => {
    await started.close();
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(fixture.TMP, { recursive: true, force: true });
  });

  assert.throws(() => direct.remember({ cwd: outside, text: 'must not write' }), /没有可写记忆库/);
  const mcpResult = mcpCall(mcpHost, 'kb_remember', { cwd: outside, text: 'must not write' });
  assert.equal(mcpResult.isError, true);
  assert.match(mcpResult.content[0].text, /没有可写记忆库/);
  const response = await post(started.origin, started.token, 'remember', { cwd: outside, text: 'must not write' });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /没有可写记忆库/);

  assert.equal(fs.existsSync(path.join(outside, '_meta')), false);
});

test('HTTP adapter enforces token, method, content type and size boundaries', async (t) => {
  const fixture = buildFixture();
  const started = await startHttpHost(hostFor(fixture), { port: 0, version: '9.9.9' });
  t.after(async () => {
    await started.close();
    fs.rmSync(fixture.TMP, { recursive: true, force: true });
  });

  const health = await fetch(`${started.origin}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, name: 'dsh-memory-kb', host: 'http', version: '9.9.9' });

  const anonymous = await fetch(`${started.origin}/v1/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cwd: fixture.legacy }),
  });
  assert.equal(anonymous.status, 401);

  const wrongToken = await post(started.origin, 'not-the-token', 'status', { cwd: fixture.legacy });
  assert.equal(wrongToken.status, 401);

  const wrongMethod = await fetch(`${started.origin}/v1/status`, {
    headers: { authorization: `Bearer ${started.token}` },
  });
  assert.equal(wrongMethod.status, 405);

  const wrongType = await fetch(`${started.origin}/v1/status`, {
    method: 'POST',
    headers: { authorization: `Bearer ${started.token}`, 'content-type': 'text/plain' },
    body: JSON.stringify({ cwd: fixture.legacy }),
  });
  assert.equal(wrongType.status, 415);

  const invalidJson = await fetch(`${started.origin}/v1/status`, {
    method: 'POST',
    headers: { authorization: `Bearer ${started.token}`, 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(invalidJson.status, 400);

  const crossSite = await fetch(`${started.origin}/v1/status`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${started.token}`,
      'content-type': 'application/json',
      'sec-fetch-site': 'cross-site',
    },
    body: JSON.stringify({ cwd: fixture.legacy }),
  });
  assert.equal(crossSite.status, 403);

  const missing = await post(started.origin, started.token, 'search', { cwd: fixture.legacy });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /query/);
});

test('HTTP remember writes exactly one inbox atom that cannot inject', async (t) => {
  const fixture = buildFixture();
  const host = hostFor(fixture);
  const started = await startHttpHost(host, { port: 0, version: '9.9.9' });
  t.after(async () => {
    await started.close();
    fs.rmSync(fixture.TMP, { recursive: true, force: true });
  });

  const response = await post(started.origin, started.token, 'remember', {
    cwd: fixture.legacy,
    text: 'HTTP 宿主写入的候选记忆',
    title: 'HTTP 候选',
    summary: 'HTTP 候选摘要',
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.result.status, 'inbox');
  assert.equal(body.result.scope, 'global');

  const files = fs.readdirSync(path.join(fixture.legacy, '20_Digest', 'atoms'));
  assert.equal(files.length, 2, 'existing fixture atom + the new inbox atom');
  const note = fs.readFileSync(path.join(fixture.legacy, '20_Digest', 'atoms', `${body.result.id}.md`), 'utf8');
  assert.match(note, /status: inbox/);
  assert.match(note, /HTTP 宿主写入的候选记忆/);

  const context = await post(started.origin, started.token, 'context', { cwd: fixture.legacy });
  const contextBody = await context.json();
  assert.equal(contextBody.result.text.includes('HTTP 宿主写入的候选记忆'), false);
  assert.equal(contextBody.result.injection.entries.some((entry) => entry.id === body.result.id), false);
});
