/**
 * Query-side intent classification for the read-only search surface.
 *
 * Pure and dependency-free: a small keyword table gives the caller one human
 * label per query plus the row types/levels worth a small literal-score boost.
 * Classification never adds or removes candidates, never filters, and never
 * writes: a misclassified query only loses a gentle ranking nudge.
 *
 * Order is deliberate — status → decision → preference → explicit lookup →
 * default. Later buckets are broader, so the narrow ones must win first (e.g.
 * `为什么` is a decision question, while `what/how/why` alone are lookup).
 */

const STATUS_HAN = ['状态', '进度', '做到', '下一步', '在办', '完成'];
const STATUS_ASCII = ['status', 'blocked'];

const DECISION_HAN = ['决定', '决策', '为什么', '方案', '选择'];
const DECISION_ASCII = ['architecture', 'decision', 'adr'];

const PREFERENCE_HAN = ['偏好', '习惯', '不要', '以后'];
const PREFERENCE_ASCII = ['always', 'never', 'prefer'];

const LOOKUP_HAN = ['是什么', '原理', '怎么', '如何'];
const LOOKUP_ASCII = ['what', 'how', 'why'];

function payload(intent, label, boostTypes, boostLevels) {
  return { intent, label, boostTypes, boostLevels };
}

/** Normalize once; ASCII words are matched as whole words, Han as substrings. */
function normalizeQuery(query) {
  return String(query || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function asciiWords(text) {
  return new Set(text.match(/[a-z0-9]+/g) || []);
}

function hasHan(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function hasAscii(words, keywords) {
  return keywords.some((keyword) => words.has(keyword));
}

/**
 * Classify a search query.
 *
 * Returns `{ intent, label, boostTypes, boostLevels }`:
 * - `status` / `项目状态` — wants project progress; boosts `type: work` rows
 *   (work pages are not in the default candidate set, so this stays advisory);
 * - `decision` / `决策` — wants a decision record; boosts `type: decision` and
 *   `level: canon`;
 * - `preference` / `偏好` — wants a preference; boosts `type: preference` and
 *   canon/digest rows;
 * - `lookup` / `原理/解释` — a how/what/why question without a narrower intent;
 * - `lookup` / `通用检索` — the default.
 */
export function classifyQuery(query) {
  const text = normalizeQuery(query);
  if (!text) return payload('lookup', '通用检索', [], []);
  const words = asciiWords(text);

  if (hasHan(text, STATUS_HAN) || hasAscii(words, STATUS_ASCII)) {
    return payload('status', '项目状态', ['work'], []);
  }
  if (hasHan(text, DECISION_HAN) || hasAscii(words, DECISION_ASCII)) {
    return payload('decision', '决策', ['decision'], ['canon']);
  }
  if (hasHan(text, PREFERENCE_HAN) || hasAscii(words, PREFERENCE_ASCII)) {
    return payload('preference', '偏好', ['preference'], ['canon', 'digest']);
  }
  if (hasHan(text, LOOKUP_HAN) || hasAscii(words, LOOKUP_ASCII)) {
    return payload('lookup', '原理/解释', [], []);
  }
  return payload('lookup', '通用检索', [], []);
}
