import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assignmentSummary,
  normalizeModes,
  recordAssignment,
  resolveRankExperiment,
  resolveRankMode,
  stableHash,
  variantForSession,
} from '../rank-experiment.mjs';

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `kb-rank-${name}-`));
}

test('disabled experiment always reports heat', () => {
  const experiment = resolveRankExperiment({ enabled: false, modes: ['relevance', 'heat'] });
  assert.equal(variantForSession('session-a', experiment), 'heat');
  assert.equal(resolveRankMode({ sessionId: 'session-a', rankMode: 'relevance' }), 'relevance');
});

test('enabled experiment is deterministic and session-stable', () => {
  const experiment = resolveRankExperiment({ enabled: true, modes: ['heat', 'relevance'] });
  const first = variantForSession('session-abc', experiment);
  for (let i = 0; i < 20; i += 1) {
    assert.equal(variantForSession('session-abc', experiment), first);
  }
  assert.ok(['heat', 'relevance'].includes(first));
  assert.equal(resolveRankMode({ sessionId: 'session-abc', experiment }), first);
});

test('salt changes the assignment of at least one session', () => {
  const a = resolveRankExperiment({ enabled: true, modes: ['heat', 'relevance'], salt: 'salt-a' });
  const b = resolveRankExperiment({ enabled: true, modes: ['heat', 'relevance'], salt: 'salt-b' });
  const sessions = Array.from({ length: 40 }, (_, i) => `session-${i}`);
  const differs = sessions.some((id) => variantForSession(id, a) !== variantForSession(id, b));
  assert.equal(differs, true);
});

test('unknown modes fall back and hash is stable', () => {
  assert.deepEqual(normalizeModes(['relevance', 'nonsense', 'relevance']), ['heat', 'relevance']);
  assert.deepEqual(normalizeModes(['relevance']), ['heat', 'relevance']);
  assert.equal(stableHash('abc'), stableHash('abc'));
  assert.notEqual(stableHash('abc'), stableHash('abd'));
});

test('assignment rows are deduplicated per session and summarised', () => {
  const root = tempRoot('record');
  try {
    const first = recordAssignment(root, { sessionId: 's1', variant: 'heat' });
    assert.equal(first.variant, 'heat');
    assert.equal(recordAssignment(root, { sessionId: 's1', variant: 'heat' }), null);
    recordAssignment(root, { sessionId: 's2', variant: 'relevance' });
    const summary = assignmentSummary(root);
    assert.deepEqual(summary, { total: 2, counts: { heat: 1, relevance: 1 } });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('corrupt assignment rows are skipped without breaking the panel', () => {
  const root = tempRoot('corrupt');
  try {
    recordAssignment(root, { sessionId: 's1', variant: 'heat' });
    fs.appendFileSync(path.join(root, '_meta', 'state', 'rank-experiment.jsonl'), 'not-json\n');
    const summary = assignmentSummary(root);
    assert.equal(summary.total, 1);
    assert.deepEqual(summary.counts, { heat: 1, relevance: 0 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
