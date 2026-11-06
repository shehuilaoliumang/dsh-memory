/**
 * Candidate quality helpers for the third write-pipeline step (judge).
 *
 * Two jobs, deliberately kept out of the judge worker so they can be tested
 * without a model:
 *
 *  1. Enrich a parsed atom with cheap, auditable hints: explicit-memory
 *     detection, a confidence floor, and suggested subject/supersedes links.
 *     Hints are advisory only; they never rewrite the model's scope/subject.
 *  2. Decide whether a candidate may skip the manual confirmation queue.
 *     Auto-activation is opt-in and fail-closed:
 *       - never for `global` atoms,
 *       - only for project-scoped atoms in a project store,
 *       - only when the user asked explicitly to remember something,
 *       - only after the human labels show a reliable acceptance rate.
 *
 * Nothing here reads the filesystem: rows are passed in by the caller.
 */

export const DEFAULT_AUTO_ACTIVATE = {
  enabled: false,
  explicitOnly: true,
  projectOnly: true,
  minConfidence: 0.8,
  minFeedback: 5,
  minAcceptRate: 0.8,
};

const STRONG_EXPLICIT = /(记住|记一下|记下来|帮我记|请记|remember|keep in mind|note that)/i;
const SOFT_EXPLICIT = /(以后|今后|下次|往后|不要|别再|不要再|我习惯|的习惯|我偏好|我的偏好|我喜欢|always|never|from now on|don't|do not)/i;

/** Normalise a string for cheap character-level comparison. */
export function normalizeText(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[`*_>#\[\]()（）"'“”‘’、，。！？；：!?;:,.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(text) {
  const chars = [...normalizeText(text)];
  const set = new Set();
  if (chars.length === 1) set.add(chars[0]);
  for (let i = 0; i < chars.length - 1; i += 1) set.add(chars[i] + chars[i + 1]);
  return set;
}

/** Dice-like similarity over character bigrams (0..1). */
export function textSimilarity(a, b) {
  const left = bigrams(a);
  const right = bigrams(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * Detect that the user explicitly asked to remember something. The judge's
 * prompt already bans task instructions, so this is a hint, not a decision.
 */
export function detectExplicitMemory(text) {
  const value = String(text || '');
  if (STRONG_EXPLICIT.test(value)) {
    return { explicit: true, score: 1, matched: value.match(STRONG_EXPLICIT)?.[0] || '', reason: '明确要求记住' };
  }
  if (SOFT_EXPLICIT.test(value)) {
    return { explicit: true, score: 0.7, matched: value.match(SOFT_EXPLICIT)?.[0] || '', reason: '语境含长期约定' };
  }
  return { explicit: false, score: 0, matched: '', reason: '' };
}

/**
 * Aggregate human labels written by `recordJudgeFeedback`.
 * A row is accepted when its status became `active`, rejected when it moved to
 * `archived`/`promoted`/anything else. Rows without `accepted` are counted by
 * the `from`/`to` transition.
 */
export function summarizeFeedback(rows = []) {
  const valid = (Array.isArray(rows) ? rows : []).filter((row) => row && typeof row === 'object');
  let accepted = 0;
  let rejected = 0;
  let lastAt = '';
  for (const row of valid) {
    const isAccepted =
      row.accepted === true ||
      (row.accepted !== false && row.from !== 'active' && row.to === 'active');
    const isRejected =
      row.accepted === false ||
      (row.accepted !== true && row.from === 'active' && row.to !== 'active');
    if (isAccepted) accepted += 1;
    else if (isRejected) rejected += 1;
    if (row.at && String(row.at) > lastAt) lastAt = String(row.at);
  }
  const samples = accepted + rejected;
  return {
    samples,
    accepted,
    rejected,
    acceptRate: samples ? Number((accepted / samples).toFixed(3)) : 0,
    lastAt,
  };
}

/** Merge a partial `judge.autoActivate` config over the safe defaults. */
export function resolveAutoActivateConfig(config = {}) {
  const source = config && typeof config === 'object' ? config : {};
  return {
    ...DEFAULT_AUTO_ACTIVATE,
    ...source,
    enabled: source.enabled === true,
    explicitOnly: source.explicitOnly !== false,
    projectOnly: source.projectOnly !== false,
  };
}

/**
 * Add advisory hints and an explicit-memory confidence floor to one atom.
 * Never mutates the input. `knownRows` may be catalog rows (id/summary/type/
 * subject/scope/status/level); missing fields are tolerated.
 */
export function enrichCandidate({ atom, text = '', knownRows = [], sessionScope = 'global', storeKind = 'project' }) {
  const explicit = detectExplicitMemory(text);
  const suggestions = [];
  const confidence = Math.max(0, Math.min(1, Number(atom.confidence) || 0));
  let subject = String(atom.subject || '').trim();
  const activeRows = (Array.isArray(knownRows) ? knownRows : []).filter(
    (row) => row && row.id && (!row.status || row.status === 'active') && (!row.level || row.level !== 'raw'),
  );

  if (!subject && activeRows.length) {
    let best = null;
    for (const row of activeRows) {
      if (!row.subject) continue;
      const score = Math.max(
        textSimilarity(atom.title, row.title || ''),
        textSimilarity(atom.summary, row.summary || ''),
      );
      if (score >= 0.55 && (!best || score > best.score)) best = { row, score };
    }
    if (best) {
      suggestions.push({
        kind: 'subject',
        value: String(best.row.subject),
        against: best.row.id,
        score: Number(best.score.toFixed(2)),
        message: `已有同主题条目 ${best.row.id}，可复用 subject=${best.row.subject}`,
      });
    }
  } else if (subject) {
    const seen = new Set((atom.supersedes || []).map(String));
    for (const row of activeRows) {
      if (String(row.subject || '') !== subject || seen.has(String(row.id))) continue;
      suggestions.push({
        kind: 'supersedes',
        id: String(row.id),
        summary: String(row.summary || ''),
        message: `同主题旧条目 ${row.id} 可能被这条结论取代`,
      });
      if (suggestions.filter((item) => item.kind === 'supersedes').length >= 3) break;
    }
  }

  if (explicit.explicit) {
    suggestions.push({
      kind: 'explicit',
      score: explicit.score,
      matched: explicit.matched,
      message: `检测到显式记忆意图（${explicit.reason}）`,
    });
  }

  let nextConfidence = confidence;
  if (explicit.explicit) {
    nextConfidence = Math.max(confidence, explicit.score >= 1 ? 0.8 : 0.7);
  }
  if (storeKind === 'project' && /^project:/.test(String(sessionScope || '')) && atom.scope === 'unclassified') {
    suggestions.push({
      kind: 'scope',
      value: String(sessionScope),
      message: `范围未定，可考虑 ${sessionScope}（仍需人工确认）`,
    });
  }

  return {
    ...atom,
    confidence: Number(nextConfidence.toFixed(2)),
    explicit: explicit.explicit,
    explicitScore: explicit.score,
    explicitReason: explicit.reason,
    suggestions,
  };
}

/**
 * Decide the status for a judge-written atom. Returns `inbox` by default and
 * `active` only when every guard passes. Reasons are stable short strings used
 * in the audit log.
 */
export function autoActivateDecision({ atom, feedback = {}, config = {}, storeKind = 'project', sessionScope = 'global' }) {
  const cfg = resolveAutoActivateConfig(config);
  const explicit = atom && atom.explicit === true;
  const confidence = Number(atom && atom.confidence) || 0;
  const scope = String((atom && atom.scope) || '');
  if (!cfg.enabled) return { status: 'inbox', reason: 'auto-activate disabled' };
  if (!storeKind || storeKind !== 'project') return { status: 'inbox', reason: 'not a project store' };
  if (cfg.projectOnly && !/^project:[a-z0-9][a-z0-9-]*$/.test(String(sessionScope || ''))) {
    return { status: 'inbox', reason: 'session is not project-scoped' };
  }
  if (cfg.explicitOnly && !explicit) return { status: 'inbox', reason: 'not an explicit memory request' };
  if (scope === 'global' || scope === 'system') return { status: 'inbox', reason: 'global/system memories are manual' };
  if (scope !== String(sessionScope || '')) return { status: 'inbox', reason: 'scope differs from session scope' };
  if (Array.isArray(atom.supersedes) && atom.supersedes.length) {
    return { status: 'inbox', reason: 'supersedes needs manual review' };
  }
  if (confidence < Number(cfg.minConfidence)) return { status: 'inbox', reason: 'confidence below threshold' };
  if (Number(feedback.samples) < Number(cfg.minFeedback)) return { status: 'inbox', reason: 'not enough feedback samples' };
  if (Number(feedback.acceptRate) < Number(cfg.minAcceptRate)) return { status: 'inbox', reason: 'acceptance rate below threshold' };
  return { status: 'active', reason: 'explicit project memory + reliable feedback' };
}

/** Human-readable note appended to the atom spec for auditability. */
export function candidateNote(atom) {
  const parts = [];
  if (atom && atom.explicit) parts.push(`显式记忆：${atom.explicitReason || '是'}`);
  for (const item of (atom && atom.suggestions) || []) {
    if (item.kind === 'subject') parts.push(`主题建议：${item.value}（来自 ${item.against}，相似度 ${item.score}）`);
    else if (item.kind === 'supersedes') parts.push(`取代建议：${item.id}`);
    else if (item.kind === 'scope') parts.push(`范围建议：${item.value}`);
  }
  return parts.join('；').slice(0, 300);
}
