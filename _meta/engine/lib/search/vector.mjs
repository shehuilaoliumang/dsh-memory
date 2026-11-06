/**
 * Zero-dependency hashed character n-gram "vector" fallback for search.
 *
 * This is deliberately **not** an embedding model: the KB engine stays
 * zero-dependency, offline and deterministic. Text is normalized (NFKC +
 * lowercase) and split into ASCII words plus Han character bigrams/trigrams;
 * every feature is hashed with FNV-1a into a fixed 2048-bucket vector with
 * sublinear tf weighting, and candidates are ranked by cosine similarity.
 *
 * Hashed features are only a ranking signal: two different features can land in
 * the same bucket. `vectorRank` therefore also requires genuine (exact) feature
 * overlap before a row may be returned, so a hash collision alone can never
 * manufacture a hit — an unknown ASCII query such as `zzqqxx` stays empty.
 * The stage is meant to fill a funnel that literal BM25 and the pinyin/synonym
 * fallbacks left short, never to replace the lexical ranker.
 *
 * Pure: no I/O, no randomness, no locale-dependent ordering.
 */

/** Feature-bucket count for the hashed vector. */
export const VECTOR_DIM = 2048;
/** Below this cosine similarity a candidate is not worth showing. */
export const VECTOR_MIN_SCORE = 0.12;
/** Human label attached to vector-fallback rows. */
export const VECTOR_MATCH_LABEL = '近似匹配';
/** Minimum share of distinct query features a row must share verbatim. */
const VECTOR_MIN_OVERLAP_RATIO = 0.25;

const ASCII_WORD = /[a-z0-9][a-z0-9._-]*/g;
const HAN_RUN = /[\u3400-\u9fff]+/g;

function normalizeText(text) {
  return String(text || '').normalize('NFKC').toLowerCase();
}

/** 32-bit FNV-1a hash of one feature string. */
export function fnv1a(text) {
  let hash = 0x811c9dc5;
  const value = String(text || '');
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Feature tokens for one text, in deterministic order.
 * ASCII words keep 2+ characters; each contiguous Han run contributes its
 * character bigrams and (when long enough) trigrams.
 */
export function vectorTokens(text) {
  const normalized = normalizeText(text);
  const tokens = [];
  for (const hit of normalized.matchAll(ASCII_WORD)) {
    if (hit[0].length >= 2) tokens.push(`w:${hit[0]}`);
  }
  for (const hit of normalized.matchAll(HAN_RUN)) {
    const chars = [...hit[0]];
    for (let i = 0; i + 1 < chars.length; i += 1) tokens.push(`b:${chars[i]}${chars[i + 1]}`);
    for (let i = 0; i + 2 < chars.length; i += 1) tokens.push(`t:${chars[i]}${chars[i + 1]}${chars[i + 2]}`);
  }
  return tokens;
}

function vectorFromTokens(tokens) {
  const vector = new Float64Array(VECTOR_DIM);
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  for (const [token, count] of counts) {
    vector[fnv1a(token) % VECTOR_DIM] += 1 + Math.log(count);
  }
  return vector;
}

/** Hashed tf vector for one text: a `Float64Array(VECTOR_DIM)` of weights. */
export function vectorize(text) {
  return vectorFromTokens(vectorTokens(text));
}

/** Cosine similarity of two hashed vectors; 0 for empty or mismatched input. */
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (!normA || !normB) return 0;
  return dot / Math.sqrt(normA * normB);
}

/**
 * Rank docs by hashed cosine similarity against `query`.
 *
 * `docs` uses the same shape as `bm25Rank` (an `id` plus a `text` field). Rows
 * come back as `{...doc, score, matchedBy: 'vector', matchLabel: '近似匹配',
 * matchTerms: []}`. A row is returned only when it shares at least a quarter of
 * the query's distinct features verbatim (capped at a minimum of one) and its
 * cosine reaches `minScore`, so collision noise is filtered twice.
 */
export function vectorRank(docs, query, limit = 5, options = {}) {
  const minScore = Number.isFinite(Number(options.minScore)) ? Number(options.minScore) : VECTOR_MIN_SCORE;
  const queryFeatures = [...new Set(vectorTokens(query))];
  // One hashed feature cannot be told apart from a hash collision, and a
  // single-token query is already covered by literal BM25. Requiring two also
  // keeps nonsense strings such as `zzqqxx` at zero results.
  if (queryFeatures.length < 2 || !Array.isArray(docs) || !docs.length) return [];
  const querySet = new Set(queryFeatures);
  const queryVector = vectorFromTokens(queryFeatures);
  const requiredOverlap = Math.max(1, Math.ceil(queryFeatures.length * VECTOR_MIN_OVERLAP_RATIO));
  const scored = [];
  for (const doc of docs) {
    if (!doc || !doc.id) continue;
    const tokens = vectorTokens(doc.text);
    const shared = new Set();
    for (const token of tokens) {
      if (querySet.has(token)) shared.add(token);
    }
    if (shared.size < requiredOverlap) continue;
    const score = cosine(queryVector, vectorFromTokens(tokens));
    if (score < minScore) continue;
    scored.push({ ...doc, score, matchedBy: 'vector', matchLabel: VECTOR_MATCH_LABEL, matchTerms: [] });
  }
  scored.sort((a, b) => b.score - a.score
    || String(b.updated || '').localeCompare(String(a.updated || ''))
    || a.id.localeCompare(b.id));
  const size = Number.isFinite(Number(limit)) ? Math.max(1, Math.trunc(Number(limit))) : 5;
  return scored.slice(0, size);
}
