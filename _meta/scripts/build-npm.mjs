#!/usr/bin/env node
/**
 * Build the publishable npm package for the memory panel.
 *
 * The source tree keeps the plugin next to its host-independent engine
 * (`_meta/plugin/kb-panel` + `_meta/engine`) and imports across that boundary
 * with relative paths. npm cannot ship a path outside the package root, so the
 * published tarball is assembled here: the plugin files copied verbatim, the
 * engine copied under `vendor/engine`, and the cross-package imports rewritten
 * to point at the vendored copy. The repository package.json stays the single
 * manifest — this script only rewrites the copy it packs.
 *
 * Usage:
 *   node _meta/scripts/build-npm.mjs              # build into _meta/state/npm-build/kb-panel
 *   node _meta/scripts/build-npm.mjs --out DIR    # build into DIR
 *   node _meta/scripts/build-npm.mjs --check      # build into a temp dir, verify, delete
 *
 * Verification is the point: every relative import in the built package must
 * resolve, and the vendored engine must still initialise and validate a store.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const PANEL = path.join(REPO, '_meta', 'plugin', 'kb-panel');
const ENGINE = path.join(REPO, '_meta', 'engine');

const PLUGIN_FILES = ['index.js', 'client.js', 'ingest.js', 'judge.js', 'http-guard.js', 'inject-ranking.mjs', 'rank-experiment.mjs', 'cordis.patch.yml', 'icon.svg'];
const PLUGIN_DIRS = ['locale'];

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else if (entry.isFile()) copyFile(src, dst);
  }
}

/** Point cross-package imports at the vendored engine copy. */
function rewriteImports(file) {
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(/(['"])\.\.\/\.\.\/engine\//g, '$1./vendor/engine/');
  if (after !== before) fs.writeFileSync(file, after);
  return after !== before;
}

/** Every relative specifier in `file` must resolve from `file`. */
function unresolvedImports(file) {
  const text = fs.readFileSync(file, 'utf8');
  const missing = [];
  for (const match of text.matchAll(/(?:from|import)\s*\(?\s*(['"])(\.[^'"]*)\1/g)) {
    const spec = match[2];
    const target = path.resolve(path.dirname(file), spec);
    const candidates = [target, `${target}.mjs`, `${target}.js`, path.join(target, 'index.mjs'), path.join(target, 'index.js')];
    if (!candidates.some((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())) missing.push(spec);
  }
  return missing;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Assemble the package into `outDir` (created fresh) and verify it.
 * Throws on any inconsistency; returns a summary for logging/assertions.
 */
export async function buildPackage(outDir) {
  const version = fs.readFileSync(path.join(REPO, 'VERSION'), 'utf8').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`VERSION is not semver: ${version}`);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // 1. Plugin files.
  for (const name of PLUGIN_FILES) copyFile(path.join(PANEL, name), path.join(outDir, name));
  for (const name of PLUGIN_DIRS) copyDir(path.join(PANEL, name), path.join(outDir, name));
  copyFile(path.join(REPO, 'README.md'), path.join(outDir, 'README.md'));
  copyFile(path.join(REPO, 'LICENSE'), path.join(outDir, 'LICENSE'));

  // 2. Vendored engine (lib + hosts + bin, so the CLI still works from the tarball).
  for (const name of ['lib', 'hosts', 'bin']) copyDir(path.join(ENGINE, name), path.join(outDir, 'vendor', 'engine', name));
  fs.writeFileSync(
    path.join(outDir, 'vendor', 'engine', 'README.md'),
    [
      '# Vendored engine',
      '',
      'Copy of `_meta/engine/` from https://github.com/shehuilaoliumang/dsh-memory,',
      'made by `_meta/scripts/build-npm.mjs` because npm cannot ship a path outside',
      'the package root. Do not edit here: change the engine in the repository.',
      '',
    ].join('\n'),
  );

  // 3. Rewrite the cross-package imports in the copied plugin files.
  const rewritten = PLUGIN_FILES.filter((name) => name.endsWith('.js') || name.endsWith('.mjs'))
    .filter((name) => rewriteImports(path.join(outDir, name)));

  // 4. Manifest: same name/repository/dsh block as the repository, version from VERSION,
  //    and an explicit file list so the tarball is exactly what was built.
  const manifest = JSON.parse(fs.readFileSync(path.join(PANEL, 'package.json'), 'utf8'));
  manifest.version = version;
  manifest.files = [...PLUGIN_FILES, ...PLUGIN_DIRS, 'vendor', 'README.md', 'LICENSE'];
  if (manifest.private === true) delete manifest.private;
  fs.writeFileSync(path.join(outDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // 5. Verification: no dangling relative import, manifest sane, engine runnable.
  const built = walk(outDir);
  const dangling = [];
  for (const file of built.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))) {
    for (const spec of unresolvedImports(file)) dangling.push(`${path.relative(outDir, file)} -> ${spec}`);
  }
  if (dangling.length) throw new Error(`unresolved imports after rewrite:\n  ${dangling.join('\n  ')}`);
  if (!manifest.dsh?.bundle?.patch) throw new Error('manifest lost dsh.bundle.patch');
  if (!manifest.engines?.dsh) throw new Error('manifest lost engines.dsh');
  if (!String(manifest.repository?.url || '').includes('shehuilaoliumang/dsh-memory')) throw new Error('manifest repository does not point at the public repo');

  // The vendored engine is exercised in-process rather than through a child
  // process: the CLI entry is side-effectful on import, but `runCli` is the same
  // function the plugin calls, so importing it proves the vendored copy loads.
  const smokeRoot = path.join(outDir, '.smoke-store');
  const { runCli: vendoredRun } = await import(pathToFileURL(path.join(outDir, 'vendor', 'engine', 'lib', 'cli.mjs')).href);
  try {
    for (const step of ['init', 'validate']) {
      const result = vendoredRun([step], { root: smokeRoot });
      if (result.code !== 0) throw new Error(`vendored engine ${step} failed:\n${result.stderr || result.stdout}`);
    }
  } finally {
    fs.rmSync(smokeRoot, { recursive: true, force: true });
  }

  const bytes = built.reduce((sum, file) => sum + fs.statSync(file).size, 0);
  return {
    outDir,
    name: manifest.name,
    version: manifest.version,
    files: built.length,
    bytes,
    rewrittenImports: rewritten,
    engineFiles: walk(path.join(outDir, 'vendor', 'engine')).length,
  };
}

const invokedDirectly = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const outIndex = args.indexOf('--out');
  const outDir = checkOnly
    ? path.join(os.tmpdir(), `kb-panel-build-${process.pid}`)
    : outIndex !== -1
      ? path.resolve(args[outIndex + 1])
      : path.join(REPO, '_meta', 'state', 'npm-build', 'kb-panel');
  try {
    const summary = await buildPackage(outDir);
    console.log(JSON.stringify({ ...summary, outDir: checkOnly ? '(temp, removed)' : summary.outDir }, null, 2));
  } catch (error) {
    console.error(`[build-npm] ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (checkOnly) fs.rmSync(outDir, { recursive: true, force: true });
  }
}
