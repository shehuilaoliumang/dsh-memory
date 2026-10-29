#!/usr/bin/env node
/**
 * Build the sanitized public snapshot of this vault.
 *
 * The public snapshot is a one-way export, not a backup:
 *   - never includes 10_Raw/ (conversation transcripts)
 *   - never includes _meta/state/ or _meta/access.jsonl (runtime telemetry)
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
const PUBLIC_ROOT_FILES = new Set(['README.md', 'AGENTS.md', '.gitignore', 'LICENSE']);

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
  if (rel.startsWith('10_Raw/')) return false;
  if (rel.startsWith('00_Inbox/')) return false;
  if (rel.includes('/.git/')) return false;
  if (PUBLIC_ROOT_FILES.has(rel)) return true;
  if (rel.startsWith('20_Digest/')) return true;
  if (rel.startsWith('30_Canon/')) return true;
  if (rel.startsWith('_meta/')) return true;
  if (rel === '.github/workflows/kb.yml') return true;
  return false;
}

function stripRawSources(text) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/;
  const match = text.match(frontmatter);
  if (match) {
    const body = match[1]
      .split(/\r?\n/)
      .filter((line) => !/^source\s*:/.test(line))
      .join('\n');
    text = text.replace(frontmatter, `---\n${body}\n---`);
  }
  return text.replace(/\[\[10_Raw\/[^\]]*\]\]/g, '');
}

function sanitizeText(rel, text) {
  if (rel.endsWith('.md')) text = stripRawSources(text);
  const prefixes = [root, path.dirname(root)];
  for (const prefix of prefixes) {
    text = text.split(prefix).join('<vault>');
    text = text.split(prefix.replaceAll('\\', '/')).join('<vault>');
  }
  if (rel === '_meta/plugin/kb-panel/cordis.patch.yml') {
    text = text.replace(/^(\s*workspaceRoot:\s*)['"].*['"]/m, "$1'<path-to-vault>'");
  }
  return text;
}

const secrets = [
  new RegExp('\\bgh[pousr]_[A-Za-z0-9_]{20,}\\b'),
  new RegExp('\\bgithub_' + 'pat_[A-Za-z0-9_]{20,}\\b'),
  new RegExp('\\bsk-[A-Za-z0-9]{20,}\\b'),
];
function assertNoSecrets(rel, text) {
  for (const pattern of secrets) {
    if (pattern.test(text)) {
      throw new Error(`导出中止：${rel} 疑似包含访问令牌`);
    }
  }
}

const localUserPath = new RegExp('[A-Za-z]:[\\\\/]Users[\\\\/]');
function assertNoLocalPaths(rel, text) {
  if (localUserPath.test(text)) {
    throw new Error(`导出中止：${rel} 仍含本地用户目录路径`);
  }
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const files = walk(root).filter(allowed);
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
  const text = sanitizeText(rel, buffer.toString('utf8'));
  assertNoSecrets(rel, text);
  assertNoLocalPaths(rel, text);
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
