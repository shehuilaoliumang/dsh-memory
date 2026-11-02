#!/usr/bin/env node
/**
 * Compatibility wrapper (v2.0).
 *
 * The rule layer now lives in the host-agnostic `@local/kb-engine` package
 * (`_meta/engine/`). Every document, plugin, test and smoke script in this
 * repository still calls `_meta/scripts/kb.mjs`, so this file only sets the
 * default store root and delegates to the engine CLI. New integrations should
 * call `_meta/engine/bin/kb.mjs` (or import `_meta/engine/lib/index.mjs`).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.KB_DEFAULT_ROOT = process.env.KB_DEFAULT_ROOT || path.resolve(here, '..', '..');
await import('../engine/lib/cli.mjs');
