#!/usr/bin/env node
/**
 * Compatibility wrapper (v2.0+).
 *
 * The rule layer lives in the host-agnostic `@local/kb-engine` package
 * (`_meta/engine/`). Every document, plugin, test and smoke script in this
 * repository still calls `_meta/scripts/kb.mjs`, so this file only sets the
 * default store root and delegates to the engine CLI runner.
 * New integrations should call `_meta/engine/bin/kb.mjs` or import
 * `_meta/engine/lib/index.mjs`.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.KB_DEFAULT_ROOT = process.env.KB_DEFAULT_ROOT || path.resolve(here, '..', '..');
const { runCli } = await import('../engine/lib/cli.mjs');
const result = runCli(process.argv.slice(2));
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.code;
