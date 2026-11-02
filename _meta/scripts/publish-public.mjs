#!/usr/bin/env node
/**
 * Publish a sanitized public snapshot to GitHub through the REST API.
 *
 * Why not `git push`: on this machine git's HTTPS path cannot acquire TLS
 * credentials inside the agent sandbox (`schannel: SEC_E_NO_CREDENTIALS`), while
 * `gh`/HTTPS API calls work. This script therefore builds one commit from the
 * exported directory and moves the branch ref:
 *
 *   1. read the current branch head (commit + tree);
 *   2. upload every file as a base64 blob;
 *   3. create one full tree and one commit whose parent is the current head;
 *   4. fast-forward the branch ref (no force).
 *
 * The exported directory is still produced by export-public.mjs, which owns all
 * sanitization rules; this script never reads the live vault.
 *
 * Usage:
 *   node _meta/scripts/publish-public.mjs --dir D:\dsh-memory-public
 *   GH_TOKEN=$(gh auth token) node _meta/scripts/publish-public.mjs --dir <out>
 *
 * Token: GH_TOKEN or GITHUB_TOKEN, or `gh auth token` output passed via env.
 * Safety: refuses to run if the directory lacks `_meta/scripts/kb.mjs` or still
 * contains a local user path.
 */
import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

const dir = path.resolve(arg('dir'));
const repo = arg('repo', 'shehuilaoliumang/dsh-memory');
const branch = arg('branch', 'main');
const today = new Date().toISOString().slice(0, 10);
const message = arg('message', `release: public snapshot ${today}`);
const token = String(process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
// `--orphan` starts a fresh history from the clean tree (used to purge an
// accidentally published telemetry file from reachable history); it implies
// `--force` because it replaces the current branch head.
const orphan = process.argv.includes('--orphan');
const force = orphan || process.argv.includes('--force');

function fail(text) {
  console.error(text);
  process.exit(1);
}

if (!token) fail('缺少 GH_TOKEN / GITHUB_TOKEN（可用 gh auth token 获取）');
if (!/^[^/]+\/[^/]+$/.test(repo)) fail(`--repo 格式应为 owner/name：${repo}`);
if (!fs.existsSync(path.join(dir, '_meta', 'scripts', 'kb.mjs'))) {
  fail(`--dir 不像公开快照（缺少 _meta/scripts/kb.mjs）：${dir}`);
}

const localUserPath = new RegExp('[A-Za-z]:[\\\\/]Users[\\\\/]');

function walk(current, relative = '') {
  const out = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(current, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

async function api(method, pathname, body) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dsh-memory-publish',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${pathname} -> HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const files = walk(dir).sort();
if (!files.length) fail(`公开快照为空：${dir}`);
// Forbidden runtime artifacts must never reach a public tree. This repeats the
// export's exclusion list on purpose: the export owns sanitization, the publish
// gate owns "what is allowed on GitHub", and both must fail closed.
const forbidden = files.filter(
  (rel) =>
    /(^|\/)access[^/]*\.jsonl$/.test(rel)
    || rel.startsWith('_meta/state/')
    || rel.startsWith('10_Raw/')
    || rel === 'PROJECT_PLAN.md',
);
if (forbidden.length) fail(`公开快照含禁止发布的文件：${forbidden.slice(0, 5).join(', ')}`);
// The export already sanitizes; this is the last belt-and-braces gate before a
// public push, so a manual edit to the export directory cannot leak a path.
for (const rel of files) {
  if (!/\.(md|json|jsonl|yml|yaml|mjs|js|cjs|ps1|txt|css|html|svg|gitignore)$/i.test(rel)) continue;
  const text = fs.readFileSync(path.join(dir, rel), 'utf8');
  if (localUserPath.test(text)) fail(`公开快照仍含本地用户目录路径：${rel}`);
}

let parentSha = '';
let parent = null;
if (!orphan) {
  const ref = await api('GET', `/repos/${repo}/git/ref/heads/${branch}`);
  parentSha = ref.object.sha;
  parent = await api('GET', `/repos/${repo}/git/commits/${parentSha}`);
}
const treeEntries = [];
for (const rel of files) {
  const content = fs.readFileSync(path.join(dir, rel)).toString('base64');
  const blob = await api('POST', `/repos/${repo}/git/blobs`, { content, encoding: 'base64' });
  treeEntries.push({ path: rel, mode: '100644', type: 'blob', sha: blob.sha });
}
const tree = await api('POST', `/repos/${repo}/git/trees`, { tree: treeEntries });
const commit = await api('POST', `/repos/${repo}/git/commits`, {
  message,
  tree: tree.sha,
  parents: orphan ? [] : [parentSha],
});
await api('PATCH', `/repos/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force });
console.log(
  JSON.stringify(
    {
      ok: true,
      repo,
      branch,
      files: files.length,
      commit: commit.sha,
      tree: tree.sha,
      orphan,
      forced: force,
      parent: parentSha,
      previousTree: parent && parent.tree ? parent.tree.sha : '',
      url: `https://github.com/${repo}/commit/${commit.sha}`,
    },
    null,
    2,
  ),
);
