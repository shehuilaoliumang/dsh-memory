/**
 * Injection ranking and store-policy helpers shared by every host.
 *
 * This is the engine-side reference for the rules the DSH panel used to keep in
 * `_meta/plugin/kb-panel/inject-ranking.mjs`: exposure-weighted heat, one
 * bounded exploration slot, optional relevance ordering, and the nested store
 * policy shape used after the v2.2 surface merge.
 *
 * 3.0: hosts read injection through `read-model.mjs`; this module stays pure so
 * the CLI, tests, the DSH plugin and the MCP host cannot drift apart.
 */

const DEFAULT_INJECT_WEIGHT = 0.1;
const HALF_LIFE_DAYS = 30;

const CJK = /[\u3400-\u9fff]/;

/**
 * Behaviour policy of a resolved store: the legacy vault arrives from
 * `resolveStores()` as `{legacy:false, entry:{policy:{scopeMode:'global'}}}`,
 * so checking only top-level fields silently drops its five-slot global policy.
 */
export function isGlobalScopeStore(store) {
  if (!store) return false;
  if (store.legacy === true || store.scopeMode === 'global') return true;
  const policy = store.policy && typeof store.policy === 'object'
    ? store.policy
    : store.entry && store.entry.policy && typeof store.entry.policy === 'object'
      ? store.entry.policy
      : null;
  return Boolean(policy && policy.scopeMode === 'global');
}

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFKC');
}

/** Match tokens: ASCII words (>1 char) and CJK bigrams (lone char kept). */
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

/** Query coverage in [0,1] over title/summary/tags/scope/type. */
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

/** Relevance-first ordering over an already heat-ranked list. */
export function reorderByRelevance(notes, query) {
  const list = Array.isArray(notes) ? notes : [];
  const wanted = matchTokens(query);
  if (!wanted.size) return list;
  const scored = list.map((note, index) => ({ note, index, score: relevanceScore(query, note) }));
  const relevant = scored.filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  const rest = scored.filter((entry) => entry.score <= 0);
  return [...relevant, ...rest].map((entry) => entry.note);
}

/** Decayed recall heat with exposure weighting (counts already weighted). */
export function heatWeight(count, lastAt, now = Date.now(), halfLifeDays = HALF_LIFE_DAYS) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const halfLife = Number(halfLifeDays) > 0 ? Number(halfLifeDays) : HALF_LIFE_DAYS;
  const at = Date.parse(String(lastAt || ''));
  const ageDays = Number.isFinite(at) ? Math.max(0, (now - at) / 86400000) : 0;
  return n * Math.pow(0.5, ageDays / halfLife);
}

function idSequence(id) {
  const match = /^(\d{4}-\d{2}-\d{2})-[atcw]-(\d{4})$/.exec(String(id || ''));
  return match ? { date: match[1], seq: Number(match[2]) } : { date: '', seq: 0 };
}

/**
 * Rank already-deduped (current-truth) notes: weighted heat × recency, with an
 * optional reserved exploration slot for the newest never-exposed note and an
 * optional relevance-first pass.
 */
export function rankInjectionCandidates(notes, accessRows = [], options = {}) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const halfLifeDays = Number(options.halfLifeDays) > 0 ? Number(options.halfLifeDays) : HALF_LIFE_DAYS;
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 500;
  const injectWeight = Number.isFinite(Number(options.injectWeight)) && Number(options.injectWeight) >= 0
    ? Number(options.injectWeight)
    : DEFAULT_INJECT_WEIGHT;
  const exploration = Math.max(0, Number(options.exploration) || 0);
  const query = String(options.query || '');

  const heat = new Map();
  const exposed = new Set();
  for (const row of accessRows) {
    if (!row || !row.id) continue;
    const id = String(row.id);
    exposed.add(id);
    const weight = String(row.how || '') === 'inject' ? injectWeight : 1;
    const prev = heat.get(id) || { count: 0, lastAt: '' };
    prev.count += weight;
    if (String(row.t || '') > prev.lastAt) prev.lastAt = String(row.t || '');
    heat.set(id, prev);
  }

  const ordered = (Array.isArray(notes) ? notes : []).map((note) => {
    const recalled = heat.get(String(note.id));
    return {
      note,
      heat: recalled ? heatWeight(recalled.count, recalled.lastAt, now, halfLifeDays) : 0,
      order: idSequence(note.id),
    };
  }).sort(
    (a, b) =>
      b.heat - a.heat ||
      String(b.note.updated || '').localeCompare(String(a.note.updated || '')) ||
      b.order.date.localeCompare(a.order.date) ||
      b.order.seq - a.order.seq ||
      String(b.note.id).localeCompare(String(a.note.id)),
  );

  if (exploration > 0 && ordered.length > exploration) {
    const cold = ordered
      .filter((entry) => !exposed.has(String(entry.note.id || '')))
      .sort(
        (a, b) =>
          String(b.note.updated || '').localeCompare(String(a.note.updated || '')) ||
          String(b.note.id).localeCompare(String(a.note.id)),
      );
    const pick = cold[0];
    if (pick) {
      const index = ordered.indexOf(pick);
      if (index > exploration) {
        ordered.splice(index, 1);
        ordered.splice(exploration, 0, pick);
      }
    }
  }

  const ranked = ordered.map((entry) => entry.note);
  const limited = ranked.slice(0, limit);
  return query ? reorderByRelevance(limited, query) : limited;
}

export { CJK };
