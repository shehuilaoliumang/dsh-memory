/**
 * Local (plugin-side) relevance helpers for the optional `inject.rankMode:
 * "relevance"` ordering. They are intentionally dependency-free and pure so the
 * ranking rule is unit-tested like the engine rules.
 *
 * Why not in `_meta/engine/lib/work-brief.mjs` (the architectural home)? The
 * live DSH Host caches ESM modules by URL: a plugin hot-reload does not see a
 * newly added engine export. Keeping the pure rule here lets the feature ship
 * with a hot reload; the engine remains the host-agnostic home for the next
 * structural refactor.
 */

const CJK = /[\u3400-\u9fff]/;

/** Normalize once; query and note text must be tokenized the same way. */
function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFKC');
}

/**
 * Match tokens: ASCII words (length > 1) and CJK bigrams (a lone CJK char is
 * kept as its own token). This mirrors the tokenizer used by `kb.mjs search`,
 * without importing it (the CLI module is not a library).
 */
export function matchTokens(text) {
  const tokens = new Set();
  const normalized = normalize(text);
  for (const hit of normalized.matchAll(/[a-z0-9][a-z0-9._-]*/g)) {
    if (hit[0].length > 1) tokens.add(hit[0]);
  }
  for (const hit of normalized.matchAll(/[\u3400-\u9fff]+/g)) {
    const chars = [...hit[0]];
    if (chars.length === 1) tokens.add(chars[0]);
    for (let i = 0; i + 1 < chars.length; i += 1) tokens.add(chars[i] + chars[i + 1]);
  }
  return tokens;
}

function noteText(note) {
  const tags = Array.isArray(note && note.tags) ? note.tags.join(' ') : (note && note.tags) || '';
  return [note && note.title, note && note.summary, tags, note && note.scope, note && note.type]
    .filter(Boolean)
    .join(' ');
}

/**
 * Query coverage in [0,1]: the share of distinct query tokens that also occur
 * in the note's title/summary/tags/scope/type. Byte length is irrelevant, so
 * one-character CJK queries do not dominate.
 */
export function relevanceScore(query, note) {
  if (!note) return 0;
  const wanted = matchTokens(query);
  if (!wanted.size) return 0;
  const have = matchTokens(noteText(note));
  if (!have.size) return 0;
  let hits = 0;
  for (const token of wanted) {
    if (have.has(token)) hits += 1;
  }
  return hits / wanted.size;
}

/**
 * Relevance-first ordering over an already heat-ranked list. Notes with no
 * overlap keep their heat order and follow the relevant ones; equal scores keep
 * the incoming order. An empty query returns the input unchanged.
 */
export function reorderByRelevance(notes, query) {
  const list = Array.isArray(notes) ? notes : [];
  const wanted = matchTokens(query);
  if (!wanted.size) return list;
  const scored = list.map((note, index) => ({ note, index, score: relevanceScore(query, note) }));
  const relevant = scored.filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  const rest = scored.filter((entry) => entry.score <= 0);
  return [...relevant, ...rest].map((entry) => entry.note);
}

export { CJK };
