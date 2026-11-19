#!/usr/bin/env node
// Fresh-install smoke test.
//
// New users install the npm package, not this repository: there is no
// `_meta/scripts/kb.mjs` next to their store, and their store starts empty.
// The 3.3.3 package broke on exactly those two facts (the CLI lookup pointed at
// the vault layout) and the panel then failed on "create store", "remember one"
// and "consolidate". This script reproduces the installed shape end to end:
//
//   build the package → init an empty store with the *vendored* CLI
//   → record one atom → consolidate → validate
//
// It runs on the build output, so a regression in build-npm.mjs, in the engine
// copy, or in the CLI resolution fails here before anything is published.

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildPackage } from './build-npm.mjs';

const HERE = import.meta.dirname;
const REPO = path.resolve(HERE, '..', '..');
const WORK = path.join(REPO, '_meta', 'state', 'smoke-install');
const keep = process.argv.includes('--keep');

function fail(message) {
  console.error(`smoke-install: ${message}`);
  process.exit(1);
}

function expectOk(label, result) {
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().split('\n').slice(-3).join(' | ');
    fail(`${label} exited ${result.code}: ${detail}`);
  }
  return result;
}

async function main() {
  await rm(WORK, { recursive: true, force: true });
  await mkdir(WORK, { recursive: true });

  const pkgDir = path.join(WORK, 'package');
  const pkg = await buildPackage(pkgDir);

  const cliPath = path.join(pkgDir, 'vendor', 'engine', 'lib', 'cli.mjs');
  if (!existsSync(cliPath)) fail('the build did not copy the engine CLI into vendor/engine');

  // The installed package must be able to find that CLI from where it lives.
  // index.js imports it, so a broken candidate list would throw here.
  const panel = await import(pathToFileURL(path.join(pkgDir, 'index.js')).href);
  if (typeof panel.apply !== 'function') fail('index.js did not export apply()');
  if (typeof panel.DEFAULT_STORE_ROOT !== 'string' || !panel.DEFAULT_STORE_ROOT) {
    fail('index.js did not export DEFAULT_STORE_ROOT');
  }

  const { runCli } = await import(pathToFileURL(cliPath).href);

  // 1. An empty directory becomes a store. This is what the panel does on the
  //    first run of a marketplace install (default root ~/.dsh-memory).
  const store = path.join(WORK, 'store');
  expectOk('init', runCli(['init'], { root: store }));
  if (!existsSync(path.join(store, '_meta', 'config.json'))) fail('init did not write _meta/config.json');

  // 2. "Remember one": the single write path every remember/confirm goes through.
  const specPath = path.join(WORK, 'atom.json');
  await writeFile(specPath, JSON.stringify({
    title: 'Fresh install smoke',
    type: 'fact',
    summary: 'An empty store accepts its first atom after the package is built.',
    status: 'inbox',
    scope: 'project:smoke',
    points: ['Empty store accepts one atom.'],
  }, null, 2));
  expectOk('add-atom', runCli(['add-atom', '--json-file', specPath], { root: store }));
  const atoms = await readdir(path.join(store, '20_Digest', 'atoms')).catch(() => []);
  if (atoms.length !== 1) fail(`expected 1 atom after add-atom, found ${atoms.length}`);

  // 3. "Consolidate": reads the index and the note set, so it also proves the
  //    index was written for a store that started empty.
  expectOk('consolidate', runCli(['consolidate', '--json'], { root: store }));

  // 4. A store that started empty must still be structurally valid.
  expectOk('validate', runCli(['validate'], { root: store }));

  if (!keep) await rm(WORK, { recursive: true, force: true });

  console.log(`smoke-install ok: ${pkg.name}@${pkg.version}, ${pkg.files} files, ` +
    `empty store → init → add-atom → consolidate → validate`);
}

await main();
