/**
 * In-process engine API (`runCli` / `createEngine`): hosts can call commands
 * without spawning a process, and one import can serve several store roots
 * sequentially. These tests pin the capture/exit-code contract and the root
 * switch, because both are easy to break with a module-level constant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createEngine, runCli } from '../../../engine/lib/cli.mjs';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kb-engine-api-'));
}

function initStore(root) {
  const result = runCli(['init', '--root', root, '--slug', 'api-demo', '--json']);
  assert.equal(result.code, 0, result.stderr);
}

test('runCli: init/validate/stats run in-process with captured output', () => {
  const root = tempDir();
  try {
    initStore(root);
    const validate = runCli(['validate'], { root });
    assert.equal(validate.code, 0, validate.stderr);
    assert.match(validate.stdout, /校验通过/);
    const stats = runCli(['stats', '--json'], { root });
    assert.equal(stats.code, 0, stats.stderr);
    assert.equal(JSON.parse(stats.stdout).total, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runCli: exit codes are returned, not leaked into process.exitCode', () => {
  const root = tempDir();
  try {
    const missing = runCli(['validate'], { root });
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /根目录不是知识库/);
    const unknown = runCli(['definitely-not-a-command']);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stdout, /未知命令/);
    assert.equal(process.exitCode ?? 0, 0, 'in-process calls must not set process.exitCode');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('createEngine: one import serves two roots sequentially', () => {
  const first = tempDir();
  const second = tempDir();
  try {
    initStore(first);
    initStore(second);
    const atom = {
      title: 'API 测试原子',
      type: 'fact',
      scope: 'global',
      summary: '引擎进程内 API 可用',
      points: ['runCli 捕获 stdout/stderr 并返回 code'],
    };
    const spec = path.join(first, 'spec.json');
    fs.writeFileSync(spec, `${JSON.stringify(atom, null, 2)}\n`, 'utf8');
    const added = createEngine({ root: first }).run(['add-atom', '--json-file', spec, '--json']);
    assert.equal(added.code, 0, added.stderr);
    const firstStats = JSON.parse(createEngine({ root: first }).run(['stats', '--json']).stdout);
    assert.equal(firstStats.total, 1);
    const secondStats = JSON.parse(createEngine({ root: second }).run(['stats', '--json']).stdout);
    assert.equal(secondStats.total, 0, 'the second root must not see the first root writes');
    fs.unlinkSync(spec);
  } finally {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});
