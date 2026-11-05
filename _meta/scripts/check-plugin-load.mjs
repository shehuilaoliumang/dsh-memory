#!/usr/bin/env node
/**
 * Plugin load-shape gate (CI + local).
 *
 * Round-9 audit finding: the 1.14.0 outage was a UTF-8 BOM in
 * `_meta/plugin/kb-panel/package.json` — DSH's profile loader could not parse it
 * and silently marked the plugin unaddressable. CI at the time validated notes,
 * tests and the public snapshot, but never parsed the bundle the way the Host
 * does. This gate closes that class statically and cheaply:
 *
 *   1. every JSON config in the repo parses and carries no UTF-8 BOM;
 *   2. the plugin manifest has the shape the Host expects (name/type/exports/
 *      files/bundle patch/client), its version matches root VERSION, and every
 *      exported / listed file exists;
 *   3. the bundle patch is a plain patch file naming @local/kb-panel;
 *   4. every plugin/engine JavaScript file passes `node --check`.
 *
 * It is a load-shape check, not a real Host boot: CI cannot start DSH, so the
 * next best guarantee is "everything the loader touches exists and parses".
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGIN_DIR = path.join(ROOT, '_meta', 'plugin', 'kb-panel');
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'state', '.obsidian', '90_Archive', '00_Inbox']);
const errors = [];
const notes = [];

function fail(message) {
  errors.push(message);
}

function readBytes(file) {
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

/** Parse one JSON file strictly: no BOM, valid JSON. */
function readJsonStrict(rel) {
  const file = path.join(ROOT, rel);
  const buf = readBytes(file);
  if (!buf) {
    fail(`missing ${rel}`);
    return null;
  }
  if (buf.length >= 3 && buf.subarray(0, 3).equals(BOM)) {
    fail(`${rel}: UTF-8 BOM is not allowed (DSH JSON.parse would fail)`);
    return null;
  }
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch (error) {
    fail(`${rel}: invalid JSON (${error.message})`);
    return null;
  }
}

function walk(dir, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  }
}

function checkSyntax(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    fail(`missing source ${rel}`);
    return;
  }
  // `stdio: 'ignore'`: confined sandboxes forbid piped child stdio, and the
  // status code is all this gate needs.
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'ignore' });
  if (result.status !== 0) fail(`${rel}: node --check failed (exit ${result.status})`);
}

/** Expand one `files` / `exports` entry, supporting simple `dir/*.ext`. */
function expandEntry(rel) {
  if (!rel.includes('*')) return [rel];
  const star = rel.indexOf('*');
  const dir = path.posix.dirname(rel.slice(0, star) + 'placeholder');
  const suffix = rel.slice(star + 1);
  const absDir = path.join(PLUGIN_DIR, dir);
  let names = [];
  try {
    names = fs.readdirSync(absDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(suffix))
    .map((name) => path.posix.join(dir, name));
}

// 1) Every tracked JSON config must parse and must not start with a BOM.
const jsonFiles = [];
walk(ROOT, jsonFiles);
for (const rel of jsonFiles) readJsonStrict(rel);
notes.push(`${jsonFiles.length} JSON config(s) parsed`);

// 2) Plugin manifest shape (the exact surface the DSH profile loader reads).
const pkg = readJsonStrict('_meta/plugin/kb-panel/package.json');
if (pkg) {
  if (pkg.name !== '@local/kb-panel') fail(`plugin name must be @local/kb-panel, got ${pkg.name}`);
  if (pkg.type !== 'module') fail('plugin package.json must declare "type": "module"');
  if (!pkg.dsh || !pkg.dsh.bundle || typeof pkg.dsh.bundle.patch !== 'string') {
    fail('plugin package.json is missing dsh.bundle.patch');
  }
  if (!pkg.dsh || !pkg.dsh.client || pkg.dsh.client.platform !== 'web') {
    fail('plugin package.json is missing dsh.client.platform = "web"');
  }
  const versionBuf = readBytes(path.join(ROOT, 'VERSION'));
  const version = versionBuf ? versionBuf.toString('utf8').trim() : '';
  if (!version) fail('missing or empty VERSION');
  else if (pkg.version !== version) fail(`plugin version ${pkg.version} != VERSION ${version}`);

  const declared = new Set();
  for (const rel of Object.values(pkg.exports || {})) {
    if (typeof rel !== 'string' || !rel.startsWith('./')) continue;
    for (const file of expandEntry(rel.slice(2))) declared.add(file);
  }
  for (const rel of pkg.files || []) {
    for (const file of expandEntry(String(rel))) declared.add(file);
  }
  for (const rel of declared) {
    if (!fs.existsSync(path.join(PLUGIN_DIR, rel))) fail(`plugin manifest points at missing file: ${rel}`);
  }
  notes.push(`${declared.size} manifest file(s) verified`);

  // 2b) Engine package (v2.0): the rule layer is host-agnostic, so it must have
// the same parse/version/existence guarantees as the plugin that depends on it.
const enginePkg = readJsonStrict('_meta/engine/package.json');
if (enginePkg) {
  const engineDir = path.join(ROOT, '_meta', 'engine');
  if (enginePkg.name !== '@local/kb-engine') fail(`engine name must be @local/kb-engine, got ${enginePkg.name}`);
  if (enginePkg.type !== 'module') fail('engine package.json must declare "type": "module"');
  const versionBuf = readBytes(path.join(ROOT, 'VERSION'));
  const version = versionBuf ? versionBuf.toString('utf8').trim() : '';
  if (version && enginePkg.version !== version) {
    fail(`engine version ${enginePkg.version} != VERSION ${version}`);
  }
  if (!enginePkg.exports || typeof enginePkg.exports !== 'object') fail('engine package.json is missing exports');
  const engineDeclared = new Set();
  const expandEngineEntry = (rel) => {
    if (!rel.includes('*')) return [rel];
    const star = rel.indexOf('*');
    const dir = path.posix.dirname(rel.slice(0, star) + 'placeholder');
    const suffix = rel.slice(star + 1);
    let names = [];
    try {
      names = fs.readdirSync(path.join(engineDir, dir));
    } catch {
      return [];
    }
    return names.filter((name) => name.endsWith(suffix)).map((name) => path.posix.join(dir, name));
  };
  for (const rel of Object.values(enginePkg.exports)) {
    if (typeof rel !== 'string' || !rel.startsWith('./')) continue;
    for (const file of expandEngineEntry(rel.slice(2))) engineDeclared.add(file);
  }
  for (const rel of enginePkg.files || []) {
    for (const file of expandEngineEntry(String(rel))) engineDeclared.add(file);
  }
  for (const rel of engineDeclared) {
    if (!fs.existsSync(path.join(engineDir, rel))) fail(`engine manifest points at missing file: ${rel}`);
  }
  notes.push(`${engineDeclared.size} engine file(s) verified`);
}

// 3) Bundle patch: plain YAML, names the package, no BOM.
  const patchRel = String((pkg.dsh.bundle && pkg.dsh.bundle.patch) || 'cordis.patch.yml').replace(/^\.\//, '');
  const patchFile = path.join(PLUGIN_DIR, patchRel);
  const patchBuf = readBytes(patchFile);
  if (!patchBuf) {
    fail(`missing bundle patch ${patchRel}`);
  } else {
    if (patchBuf.length >= 3 && patchBuf.subarray(0, 3).equals(BOM)) fail(`${patchRel}: UTF-8 BOM is not allowed`);
    const text = patchBuf.toString('utf8');
    if (!text.includes('@local/kb-panel')) fail(`${patchRel}: does not insert @local/kb-panel`);
    const firstLine = text.split(/\r?\n/).find((line) => line.trim() && !line.trim().startsWith('#'));
    if (!firstLine || !firstLine.trim().startsWith('- ')) fail(`${patchRel}: does not look like a loader patch list`);
  }
}

// 4) JSON locale resources: strict parse, no BOM.
let localeCount = 0;
for (const file of expandEntry('locale/*.json')) {
  const data = readJsonStrict(`_meta/plugin/kb-panel/${file}`);
  if (data) localeCount += 1;
}
notes.push(`${localeCount} locale file(s) parsed`);

// 5) Syntax-check every plugin/engine JavaScript file (the loader imports these).
const sources = [
  '_meta/scripts/kb.mjs',
  '_meta/scripts/export-public.mjs',
  '_meta/scripts/publish-public.mjs',
  '_meta/scripts/eval-judge.mjs',
  '_meta/scripts/lib/export-rules.mjs',
  '_meta/scripts/test/export-rules.test.mjs',
  '_meta/plugin/kb-panel/index.js',
  '_meta/plugin/kb-panel/client.js',
  '_meta/plugin/kb-panel/ingest.js',
  '_meta/plugin/kb-panel/judge.js',
  '_meta/plugin/kb-panel/http-guard.js',
  '_meta/plugin/kb-panel/inject-ranking.mjs',
  '_meta/engine/bin/kb.mjs',
  '_meta/engine/lib/cli.mjs',
  '_meta/engine/lib/index.mjs',
  '_meta/engine/lib/context.mjs',
  '_meta/engine/lib/stores.mjs',
  '_meta/engine/lib/work-brief.mjs',
  '_meta/engine/lib/injection.mjs',
  '_meta/engine/lib/read-model.mjs',
  '_meta/engine/lib/host.mjs',
  '_meta/engine/hosts/mcp.mjs',
  '_meta/engine/hosts/http.mjs',
  '_meta/engine/lib/injection-reasons.mjs',
  '_meta/engine/lib/promote.mjs',
  '_meta/engine/lib/redact.mjs',
  '_meta/engine/lib/search/pinyin.mjs',
  '_meta/engine/lib/search/semantic.mjs',
  '_meta/engine/lib/shared/frontmatter.mjs',
  '_meta/engine/lib/shared/work-sections.mjs',
  '_meta/engine/test/capture-parity.mjs',
  '_meta/engine/test/compare-parity.mjs',
  '_meta/engine/test/read-model.test.mjs',
  '_meta/engine/test/host.test.mjs',
  '_meta/engine/test/host-conformance.test.mjs',
  '_meta/engine/test/bench-read-model.mjs',
];
for (const rel of sources) checkSyntax(rel);
notes.push(`${sources.length} JS file(s) syntax-checked`);

if (errors.length) {
  console.error(`plugin load-shape check failed (${errors.length}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`plugin load-shape check ok: ${notes.join('; ')}`);
