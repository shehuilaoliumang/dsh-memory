/**
 * Search fallback rules: pinyin (vendored tiny-pinyin data) and semantic
 * expansion are advisory recall aids, never replacements for literal BM25.
 *
 * The two invariants pinned here:
 *  - a ASCII query such as `jiyi` can reach 记忆 notes without external deps;
 *  - a Chinese query can reach a synonym group while the literal hits still
 *    come first and an unknown query still totals zero (smoke expectation).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runCli } from '../../../engine/lib/cli.mjs';
import { pinyinAvailable, toPinyin } from '../../../engine/lib/search/pinyin.mjs';
import { expandQuery } from '../../../engine/lib/search/semantic.mjs';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kb-search-fallback-'));
}

function note({ id, title, summary, body = '' }) {
  return `---
id: ${id}
title: ${title}
level: digest
type: fact
scope: global
status: active
summary: ${summary}
tags: [测试]
valid_from: 2026-11-04
updated: 2026-11-04
---

## 要点

- ${body || summary}
`;
}

function makeStore() {
  const root = tempDir();
  const init = runCli(['init', '--root', root, '--slug', 'search-demo', '--json']);
  assert.equal(init.code, 0, init.stderr);
  const atoms = path.join(root, '20_Digest', 'atoms');
  fs.mkdirSync(atoms, { recursive: true });
  fs.writeFileSync(
    path.join(atoms, '2026-11-04-a-9001.md'),
    note({
      id: '2026-11-04-a-9001',
      title: '记忆写入边界',
      summary: '写入由 context 统一裁决，raw 只增不改',
      body: '记忆写入路径只由 engine 决定',
    }),
    'utf8',
  );
  fs.writeFileSync(
    path.join(atoms, '2026-11-04-a-9002.md'),
    note({
      id: '2026-11-04-a-9002',
      title: '发布流程',
      summary: '脱敏导出、发布硬闸、CI 全绿才算发布',
      body: '发布前必须通过公开快照检查',
    }),
    'utf8',
  );
  return root;
}

test('pinyin: memory syllables and initials are available without dependencies', () => {
  if (!pinyinAvailable()) return;
  const token = toPinyin('记忆发布');
  assert.match(token.full, /jiyi/);
  assert.match(token.full, /fabu/);
  assert.equal(token.initials, 'jyfb');
  assert.equal(toPinyin('记忆').initials, 'jy');
});

test('semantic: aliases expand a Chinese query without duplicating terms', () => {
  const expanded = expandQuery('发布');
  assert.ok(expanded.terms.includes('上线') || expanded.terms.includes('部署'));
  assert.equal(new Set(expanded.terms).size, expanded.terms.length);
  assert.equal(expanded.terms.includes('发布'), false);
});

test('search: pinyin fallback finds a Han note and reports its strategy', () => {
  const root = makeStore();
  try {
    const result = runCli(['search', '--query', 'jiyi', '--json'], { root });
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.strategy.pinyin, pinyinAvailable());
    if (pinyinAvailable()) {
      assert.ok(payload.total >= 1);
      assert.equal(payload.results[0].matchedBy, 'pinyin');
      assert.match(payload.results[0].matchLabel, /拼音/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('search: semantic fallback is additive, literal stays first, unknown stays zero', () => {
  const root = makeStore();
  try {
    const semantic = runCli(['search', '--query', '上线', '--json'], { root });
    assert.equal(semantic.code, 0, semantic.stderr);
    const payload = JSON.parse(semantic.stdout);
    assert.equal(payload.strategy.semantic, true);
    assert.ok(payload.results.some((row) => row.matchedBy === 'semantic'));

    const literal = runCli(['search', '--query', '发布流程', '--json'], { root });
    assert.equal(literal.code, 0, literal.stderr);
    const first = JSON.parse(literal.stdout).results[0];
    assert.equal(first.id, '2026-11-04-a-9002');
    assert.equal(first.matchedBy, 'literal');

    const none = runCli(['search', '--query', '不存在的词xyz', '--json'], { root });
    assert.equal(none.code, 0, none.stderr);
    const empty = JSON.parse(none.stdout);
    assert.equal(empty.total, 0);
    assert.equal(empty.strategy.pinyin, false);
    assert.equal(empty.strategy.semantic, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
