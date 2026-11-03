#!/usr/bin/env node
// @local/kb-engine CLI entry. The implementation lives in ../lib/cli.mjs;
// `runCli` returns captured output so the same engine can also be used
// in-process by other hosts (see lib/index.mjs).
import { runCli } from '../lib/cli.mjs';

const result = runCli(process.argv.slice(2));
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.code;
