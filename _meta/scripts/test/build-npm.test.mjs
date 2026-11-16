import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPackage } from '../build-npm.mjs';

const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const VERSION = fs.readFileSync(path.join(REPO, 'VERSION'), 'utf8').trim();

test('npm package builds, rewrites cross-package imports, and stays publishable', async () => {
  const outDir = path.join(os.tmpdir(), `kb-panel-test-${process.pid}-${Date.now()}`);
  try {
    const summary = await buildPackage(outDir);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'package.json'), 'utf8'));

    // Identity and publication gates the market index relies on.
    assert.equal(manifest.name, 'dsh-kb-panel');
    assert.equal(manifest.version, VERSION);
    assert.equal(manifest.private, undefined, 'a publishable package must not set private');
    assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
    assert.match(manifest.engines.dsh, />=0\.2\.0/);
    assert.match(manifest.repository.url, /shehuilaoliumang\/dsh-memory/);
    assert.equal(manifest.repository.directory, '_meta/plugin/kb-panel');

    // The vendored engine replaces the cross-package imports.
    assert.equal(fs.existsSync(path.join(outDir, 'vendor', 'engine', 'lib', 'cli.mjs')), true);
    const index = fs.readFileSync(path.join(outDir, 'index.js'), 'utf8');
    assert.doesNotMatch(index, /\.\.\/\.\.\/engine\//);
    assert.match(index, /from '\.\/vendor\/engine\/lib\/index\.mjs'/);
    assert.deepEqual(summary.rewrittenImports.sort(), ['index.js', 'judge.js']);

    // Every declared file exists, and nothing the manifest promises is missing.
    for (const entry of manifest.files) {
      assert.equal(fs.existsSync(path.join(outDir, entry)), true, `files[] entry missing from the build: ${entry}`);
    }
    assert.equal(fs.existsSync(path.join(outDir, 'README.md')), true);
    assert.equal(fs.existsSync(path.join(outDir, 'LICENSE')), true);

    // The patch template must not bake in the author's machine.
    const patch = fs.readFileSync(path.join(outDir, 'cordis.patch.yml'), 'utf8');
    assert.doesNotMatch(patch, /C:\/Users\//);
    assert.match(patch, /^ {6}name: 'dsh-kb-panel'$/m);

    // No leftover verification store inside the tarball contents.
    assert.equal(fs.existsSync(path.join(outDir, '.smoke-store')), false);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
