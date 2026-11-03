#!/usr/bin/env node
/**
 * Build the sanitized public snapshot of this vault.
 *
 * The public snapshot is a one-way export, not a backup:
 *   - never includes 10_Raw/ (conversation transcripts)
 *   - never includes _meta/state/ or any access*.jsonl telemetry file
 *     (`access.jsonl` rotates to `access-<stamp>.jsonl`, and .gitignore hides
 *     the whole family, so the exclusion must be a pattern, not one filename)
 *   - strips source: links to raw transcripts
 *   - rewrites the plugin patch's workspaceRoot to a placeholder
 *   - rebuilds the catalog from the exported notes and validates it
 *
 * Usage:
 *   node _meta/scripts/export-public.mjs --out ../dsh-memory-public
 *   node _meta/scripts/export-public.mjs --out <dir> --root <vault>
 *
 * --out must be outside the vault. The target is replaced when it exists.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertPublicText,
  isForbiddenPublicPath,
  sanitizePublicText,
} from './lib/export-rules.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

const root = path.resolve(arg('root', path.resolve(here, '../..')));
const outArg = arg('out');
if (!outArg) {
  console.error('用法: node _meta/scripts/export-public.mjs --out <vault 外的目录>');
  process.exit(2);
}
const out = path.resolve(outArg);

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
if (isInside(root, out)) {
  console.error(`拒绝导出到 vault 内: ${out}`);
  process.exit(2);
}
if (isInside(out, root)) {
  console.error(`拒绝导出到 vault 的上级目录: ${out}`);
  process.exit(2);
}

const TEXT_EXTENSIONS = new Set([
  '.md', '.json', '.jsonl', '.yml', '.yaml', '.mjs', '.js', '.cjs',
  '.ps1', '.txt', '.css', '.html', '.gitignore',
]);
const PUBLIC_ROOT_FILES = new Set(['README.md', 'AGENTS.md', '.gitignore', 'LICENSE', 'LICENSE-CONTENT', 'VERSION', 'CHANGELOG.md', 'project.json']);

const skipDirs = new Set(['.git', 'node_modules', '_meta/state', 'dist']);
const skipFiles = new Set([
  '_meta/access.jsonl',
  '_meta/catalog.jsonl',
  '_meta/catalog.archive.jsonl',
  'PROJECT_PLAN.md',
  '20_Digest/atoms/2026-10-29-a-0002.md',
]);

function walk(dir, relative = '') {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (skipDirs.has(rel)) continue;
      files.push(...walk(path.join(dir, entry.name), rel));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files;
}

function allowed(rel) {
  if (skipFiles.has(rel)) return false;
  // Security rules live in lib/export-rules.mjs (unit-tested in
  // _meta/scripts/test/export-rules.test.mjs): the access* telemetry family
  // (any suffix), raw transcripts, runtime state, PROJECT_PLAN and .git.
  if (isForbiddenPublicPath(rel)) return false;
  if (PUBLIC_ROOT_FILES.has(rel)) return true;
  if (rel.startsWith('20_Digest/')) return true;
  if (rel.startsWith('30_Canon/')) return true;
  if (rel.startsWith('_meta/')) return true;
  if (rel.startsWith('scripts/')) return true;
  if (rel === '.github/workflows/kb.yml') return true;
  return false;
}

// Sanitization (source links, runtime ids, control chars, absolute paths,
// plugin patch workspaceRoot) and the post-sanitize assertion live in
// lib/export-rules.mjs so they can be unit-tested edge by edge.

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const files = walk(root).filter(allowed);
// Belt-and-braces: if the allow-list changes and a runtime file slips through,
// abort instead of publishing telemetry or transcripts. CI repeats this
// file-level check on the built snapshot independently.
const forbidden = files.filter(isForbiddenPublicPath);
if (forbidden.length) {
  throw new Error(`导出中止：禁止导出的运行时文件: ${forbidden.slice(0, 5).join(', ')}`);
}
for (const rel of files) {
  const source = path.join(root, rel);
  const target = path.join(out, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const buffer = fs.readFileSync(source);
  const ext = path.extname(rel).toLowerCase();
  const isText = TEXT_EXTENSIONS.has(ext) || path.basename(rel) === '.gitignore';
  if (!isText) {
    fs.writeFileSync(target, buffer);
    continue;
  }
  const text = sanitizePublicText(rel, buffer.toString('utf8'), { root, parent: path.dirname(root) });
  assertPublicText(rel, text);
  fs.writeFileSync(target, text, 'utf8');
}

if (!fs.existsSync(path.join(out, '_meta/scripts/kb.mjs'))) {
  throw new Error('导出缺少 _meta/scripts/kb.mjs');
}

const exported = walk(out).length;
console.log(`公开快照已写入 ${out}`);
console.log(`文件 ${exported} 个；已排除 10_Raw/、_meta/state/、access.jsonl、catalog 原始文件、PROJECT_PLAN.md`);
console.log('下一步（在导出目录执行）:');
console.log('  node _meta/scripts/kb.mjs rebuild');
console.log('  node _meta/scripts/kb.mjs validate');
console.log('注意：公开快照是单向导出，不是本地完整 git 历史的远端备份。');
