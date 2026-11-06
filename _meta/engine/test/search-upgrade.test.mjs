/**
 * Search intelligence upgrade (3.2.0): intent classification, catalog-seeded
 * synonym expansion and the hashed-vector last-resort fallback.
 *
 * The invariants pinned here:
 *  - `classifyQuery` only labels/boosts, in a fixed narrow-to-broad order;
 *  - `expandQueryWithRows` derives extra terms from the top literal rows but
 *    still obeys the synonym-table caps and never repeats the query;
 *  - `vectorRank` is a last resort: it needs real feature overlap, so an
 *    unknown ASCII query such as `zzqqxx` can never produce a hit;
 *  - `cmdSearch` reports `intent` + `strategy.vector`, and existing literal /
 *    pinyin / semantic behaviour is unchanged.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runCli } from '../lib/cli.mjs';
import { classifyQuery } from '../lib/search/intent.mjs';
import { EXTRA_TERM_LIMIT, expandQuery, expandQueryWithRows } from '../lib/search/semantic.mjs';
import {
  VECTOR_DIM,
  VECTOR_MATCH_LABEL,
  cosine,
  fnv1a,
  vectorRank,
  vectorTokens,
  vectorize,
} from '../lib/search/vector.mjs';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kb-search-upgrade-'));
}

function renderNote({
  id,
  title,
  level,
  type = 'fact',
  status = 'active',
  scope = 'global',
  summary = '',
  tags = [],
  updated = '2026-11-04',
  body = '',
}) {
  return `---
id: ${id}
title: ${title}
level: ${level}
type: ${type}
scope: ${scope}
status: ${status}
summary: ${summary}
tags: [${tags.join(', ')}]
valid_from: ${updated}
updated: ${updated}
---

## 要点

- ${body || summary}
`;
}

/** Build a throwaway store with exactly the given notes (id/dir pairs). */
function makeStore(notes) {
  const root = tempDir();
  const init = runCli(['init', '--root', root, '--slug', 'search-upgrade', '--json']);
  assert.equal(init.code, 0, init.stderr);
  for (const note of notes) {
    const dir = path.join(root, note.dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${note.id}.md`), renderNote(note), 'utf8');
  }
  return root;
}

function search(root, query, extra = []) {
  const result = runCli(['search', '--query', query, '--json', ...extra], { root });
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

// ------------------------------------------------------------- intent.mjs

test('intent: status questions are narrowest and expose the work boost', () => {
  const status = classifyQuery('下一步做什么');
  assert.equal(status.intent, 'status');
  assert.equal(status.label, '项目状态');
  assert.deepEqual(status.boostTypes, ['work']);
  assert.deepEqual(status.boostLevels, []);
  assert.equal(classifyQuery('blocked').intent, 'status');
});

test('intent: decision and preference buckets carry their level boosts', () => {
  const decision = classifyQuery('为什么选这个方案');
  assert.equal(decision.intent, 'decision');
  assert.equal(decision.label, '决策');
  assert.deepEqual(decision.boostTypes, ['decision']);
  assert.deepEqual(decision.boostLevels, ['canon']);
  assert.equal(classifyQuery('architecture').intent, 'decision');

  const preference = classifyQuery('always prefer this');
  assert.equal(preference.intent, 'preference');
  assert.equal(preference.label, '偏好');
  assert.deepEqual(preference.boostTypes, ['preference']);
  assert.deepEqual(preference.boostLevels, ['canon', 'digest']);
});

test('intent: lookup matches whole ASCII words and default is generic lookup', () => {
  const lookup = classifyQuery('如何检索');
  assert.equal(lookup.intent, 'lookup');
  assert.equal(lookup.label, '原理/解释');
  assert.deepEqual(lookup.boostTypes, []);
  assert.deepEqual(lookup.boostLevels, []);
  assert.equal(classifyQuery('what changed').label, '原理/解释');

  assert.equal(classifyQuery('somewhat').label, '通用检索');
  assert.equal(classifyQuery('发布流程').label, '通用检索');
  assert.equal(classifyQuery('').intent, 'lookup');
  assert.equal(classifyQuery('').label, '通用检索');
  // Fresh arrays per call: callers may sort/mutate without cross-talk.
  const first = classifyQuery('决策');
  const second = classifyQuery('决策');
  assert.notEqual(first.boostLevels, second.boostLevels);
});

// ----------------------------------------------------------- semantic.mjs

test('semantic: extraTerms are normalized, de-duped, capped and labelled', () => {
  const expanded = expandQuery('打包', { extraTerms: ['Alpha', 'alpha', '丙丁', '戊己', '庚辛', '壬癸'] });
  assert.deepEqual(expanded.terms, ['alpha', '丙丁', '戊己', '庚辛']);
  assert.equal(expanded.terms.length, EXTRA_TERM_LIMIT);
  assert.deepEqual(expanded.via, ['目录扩展']);
  assert.deepEqual(expanded.groups, []);
});

test('semantic: rows seed terms from tags/title without repeating the query', () => {
  const fromTags = expandQueryWithRows('打包', [{ tags: ['发布流程'] }]);
  assert.deepEqual(fromTags.terms, ['发布', '布流', '流程']);
  assert.deepEqual(fromTags.via, ['目录扩展']);

  const repeated = expandQueryWithRows('发布', [{ title: '发布流程' }]);
  assert.equal(repeated.terms.includes('发布'), false);
  assert.ok(repeated.terms.includes('布流'));
  assert.ok(repeated.terms.includes('流程'));
  assert.ok(repeated.via.includes('目录扩展'));
  assert.deepEqual(expandQueryWithRows('发布', []), expandQuery('发布'));
});

test('semantic: only the first three rows and at most four derived terms are used', () => {
  const expanded = expandQueryWithRows('打包', [
    { title: '甲方标题' },
    { title: '乙方标题' },
    { title: '丙方标题' },
    { title: '丁方标题' },
  ]);
  assert.deepEqual(expanded.terms, ['甲方', '方标', '标题', '乙方']);
  assert.equal(expanded.terms.includes('丙方'), false);
  assert.equal(expanded.terms.includes('丁方'), false);
});

// ------------------------------------------------------------- vector.mjs

test('vector: tokens, FNV-1a and cosine are deterministic and dependency-free', () => {
  assert.ok(vectorTokens('记忆').includes('b:记忆'));
  assert.ok(vectorTokens('星系航行坐标').includes('t:星系航'));
  assert.equal(fnv1a('记忆'), fnv1a('记忆'));
  assert.equal(Number.isInteger(fnv1a('x')), true);
  assert.ok(fnv1a('x') >= 0 && fnv1a('x') <= 0xffffffff);

  const vector = vectorize('记忆写入边界');
  assert.equal(vector.length, VECTOR_DIM);
  assert.equal(vector instanceof Float64Array, true);
  assert.ok(cosine(vector, vectorize('记忆写入边界')) > 0.999);
  assert.equal(cosine(vector, new Float64Array(VECTOR_DIM)), 0);
  assert.equal(cosine(vector, new Float64Array(8)), 0);
});

test('vector: unknown single-feature queries and thin overlaps never hit', () => {
  const docs = [{ id: 'zz', updated: '2026-11-04', text: 'zzqqxx 记忆写入边界' }];
  // `zzqqxx` alone is one hashed feature: indistinguishable from a collision
  // and already covered by literal BM25, so the guarantee is zero candidates.
  assert.deepEqual(vectorRank(docs, 'zzqqxx'), []);
  assert.deepEqual(vectorRank([], '星系航行坐标'), []);

  // Two feature tokens overlap is the floor for a multi-feature query.
  const thin = [{ id: 'one', updated: '2026-11-04', text: '只有星系两个字的笔记' }];
  assert.deepEqual(vectorRank(thin, '星系航行坐标'), []);
});

test('vector: positive hits are labelled, sorted, thresholded and deterministic', () => {
  const docs = [
    {
      id: 'v1',
      updated: '2026-11-04',
      text: '星系航行日志\n深空航行校准记录\n一次远航记录',
    },
  ];
  const hits = vectorRank(docs, '星系航行坐标');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'v1');
  assert.equal(hits[0].matchedBy, 'vector');
  assert.equal(hits[0].matchLabel, VECTOR_MATCH_LABEL);
  assert.deepEqual(hits[0].matchTerms, []);
  assert.ok(hits[0].score > 0.12 && hits[0].score <= 1);
  assert.deepEqual(vectorRank(docs, '星系航行坐标'), hits);
  assert.deepEqual(vectorRank(docs, '星系航行坐标', 5, { minScore: 0.99 }), []);
});

// ---------------------------------------------------------- integration

test('search: decision intent boosts canon decision rows over a newer digest tie', () => {
  const root = makeStore([
    {
      dir: '30_Canon/decisions',
      id: '2026-11-04-c-9401',
      level: 'canon',
      type: 'decision',
      title: '决策检索基线',
      summary: 'alpha beta 检索排序基线',
      tags: ['检索'],
      updated: '2026-11-03',
      body: '决策记录 alpha 排序',
    },
    {
      dir: '20_Digest/atoms',
      id: '2026-11-04-a-9402',
      level: 'digest',
      type: 'principle',
      title: '决策检索基线',
      summary: 'alpha beta 检索排序基线',
      tags: ['检索'],
      updated: '2026-11-04',
      body: '决策记录 alpha 排序',
    },
  ]);
  try {
    const boosted = search(root, '决策 alpha');
    assert.equal(boosted.total, 2);
    assert.equal(boosted.intent.intent, 'decision');
    assert.equal(boosted.intent.label, '决策');
    assert.equal(boosted.results[0].id, '2026-11-04-c-9401');
    assert.equal(boosted.results[0].matchedBy, 'literal');
    assert.ok(boosted.results[0].score > boosted.results[1].score);

    // Control: without the intent keyword the newer tie-break order wins.
    const plain = search(root, 'alpha');
    assert.equal(plain.intent.label, '通用检索');
    assert.equal(plain.results[0].id, '2026-11-04-a-9402');
  } finally {
    cleanup(root);
  }
});

test('search: catalog rows seed synonym terms the table alone would miss', () => {
  const root = makeStore([
    {
      dir: '20_Digest/atoms',
      id: '2026-11-04-a-9301',
      level: 'digest',
      type: 'principle',
      title: '排序基线快照',
      summary: '检索排序基线',
      tags: ['基线'],
      updated: '2026-11-04',
      body: '排序基线用于回归',
    },
    {
      dir: '20_Digest/atoms',
      id: '2026-11-04-a-9302',
      level: 'digest',
      type: 'principle',
      title: '快照发布检查',
      summary: '上线前的打包检查',
      tags: ['发布'],
      updated: '2026-11-04',
      body: '检查清单',
    },
  ]);
  try {
    const payload = search(root, '排序基线');
    assert.equal(payload.total, 2);
    assert.deepEqual(payload.strategy, { pinyin: false, semantic: true, vector: false });
    assert.equal(payload.results[0].id, '2026-11-04-a-9301');
    assert.equal(payload.results[0].matchedBy, 'literal');

    const bridged = payload.results.find((row) => row.id === '2026-11-04-a-9302');
    assert.ok(bridged, 'catalog-seeded expansion should reach the paraphrase');
    assert.equal(bridged.matchedBy, 'semantic');
    assert.match(bridged.matchLabel, /目录扩展/);
    assert.ok(bridged.matchTerms.includes('快照'));
  } finally {
    cleanup(root);
  }
});

test('search: vector fallback fills the last slot and keeps unknown queries at zero', () => {
  // Query 8 Han chars => 7 bigram terms, so literal BM25 requires 5 matches;
  // the note shares only 3 bigrams (plus 2 trigrams the literal ranker never
  // tokenizes), so only the vector stage can bridge it.
  const root = makeStore([
    {
      dir: '20_Digest/atoms',
      id: '2026-11-04-a-9201',
      level: 'digest',
      type: 'principle',
      title: '星系航行日志',
      summary: '深空校准记录',
      tags: ['航行'],
      updated: '2026-11-04',
      body: '一次远航记录',
    },
  ]);
  try {
    const payload = search(root, '星系航行坐标定位');
    assert.equal(payload.total, 1);
    assert.deepEqual(payload.strategy, { pinyin: false, semantic: false, vector: true });
    assert.equal(payload.intent.intent, 'lookup');
    assert.equal(payload.intent.label, '通用检索');
    assert.equal(payload.results.length, 1);
    assert.equal(payload.results[0].id, '2026-11-04-a-9201');
    assert.equal(payload.results[0].matchedBy, 'vector');
    assert.equal(payload.results[0].matchLabel, '近似匹配');
    assert.deepEqual(payload.results[0].matchTerms, []);

    // Text output must expose both the intent label and the vector stage.
    const text = runCli(['search', '--query', '星系航行坐标定位'], { root });
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /意图：通用检索/);
    assert.match(text.stdout, /回退：向量近似/);

    const none = search(root, 'zzqqxx');
    assert.equal(none.total, 0);
    assert.deepEqual(none.strategy, { pinyin: false, semantic: false, vector: false });
  } finally {
    cleanup(root);
  }
});
