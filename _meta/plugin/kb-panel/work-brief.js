/**
 * Pure rules shared by the Host plugin and the rule layer (`kb.mjs`).
 *
 * Two code-enforced rules live here because they must not drift:
 *  1. `isInjectable` — what may reach the model as a memory. Pages (topic/work)
 *     and sessions are never memories, `inbox` is never injected, and a
 *     project-scoped memory only reaches its own project's sessions.
 *  2. `briefText` — the one-line resume brief rendered from a work page. It is
 *     state, not memory, so it deliberately does not count against the five
 *     memory slots.
 *
 * No fs, no clock, no Host APIs: testable with plain node:test.
 */
import { WORK_SECTIONS } from './shared/work-sections.mjs';

/** Collapse whitespace and clamp to `max` characters (no ellipsis). */
export function clampText(value, max) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...text];
  if (!max || chars.length <= max) return text;
  return chars.slice(0, max).join('').trim();
}

/** Chinese label for a scope; unknown project slugs are shown without prefix. */
export function scopeLabel(scope) {
  if (!scope || scope === 'global') return '全局';
  if (scope === 'system') return '系统';
  if (scope === 'unclassified') return '未分类';
  return String(scope).replace(/^project:/, '');
}

/**
 * First `limit` non-empty bullet lines under one `## heading`. Stops at the
 * next heading; a plain paragraph line also counts as an item.
 */
export function sectionItems(body, heading, limit = 3) {
  const lines = String(body || '').split(/\r?\n/);
  const pattern = new RegExp(`^##\\s*${heading}\\s*$`);
  const index = lines.findIndex((line) => pattern.test(line.trim()));
  if (index < 0) return [];
  const items = [];
  for (let i = index + 1; i < lines.length && items.length < limit; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('##')) break;
    const item = line.replace(/^[-*]\s*/, '').trim();
    if (item) items.push(item);
  }
  return items;
}

/**
 * One compact resume brief built from a work page. Every section is capped so
 * the brief stays a brief: ≤3 items per section, 60 chars per item, ≤420 chars
 * total (it is injected every turn, so an edited page cannot flood the prompt).
 */
export function briefText(page, body, options = {}) {
  const itemsPerSection = Number(options.itemsPerSection) > 0 ? Number(options.itemsPerSection) : 3;
  const itemChars = Number(options.itemChars) > 0 ? Number(options.itemChars) : 60;
  const summaryChars = Number(options.summaryChars) > 0 ? Number(options.summaryChars) : 80;
  // Hard ceiling for the whole brief: it is injected every turn, so an edited
  // work page must never be able to flood the prompt.
  const maxChars = Number(options.maxChars) > 0 ? Number(options.maxChars) : 420;
  const pageData = page || {};
  const parts = [`【项目简报 · ${scopeLabel(pageData.scope)}】${clampText(pageData.summary, summaryChars)}`];
  const next = sectionItems(body, WORK_SECTIONS[3], itemsPerSection).map((item) => clampText(item, itemChars));
  if (next.length) parts.push(`下一步：${next.join('；')}`);
  const blocked = sectionItems(body, WORK_SECTIONS[2], itemsPerSection).map((item) => clampText(item, itemChars));
  if (blocked.length) parts.push(`未决：${blocked.join('；')}`);
  const text = parts.join('；');
  const chars = [...text];
  if (chars.length <= maxChars) return text;
  const clipped = chars.slice(0, maxChars).join('');
  const boundary = clipped.lastIndexOf('；');
  return boundary >= Math.floor(maxChars * 0.5) ? clipped.slice(0, boundary) : clipped;
}

/**
 * The injection predicate, mirrored from schema §6.1. Kept as one function so
 * the panel's counters and the actual prompt context can never disagree.
 */
export function isInjectable(note, sessionScope) {
  if (!note) return false;
  // `superseded` is a terminal truth state: the old claim may stay on disk for
  // history, but it must never compete with the note that replaced it.
  if (note.level !== 'digest' || note.status !== 'active') return false;
  if (note.type === 'session' || note.type === 'work' || note.type === 'topic') return false;
  if (note.scope === 'global') return true;
  return Boolean(sessionScope) && sessionScope !== 'global' && note.scope === sessionScope;
}

/**
 * Decayed recall heat. A memory read 30 days ago counts half as much as one
 * read today, so an old hot note eventually yields to a fresh, relevant one.
 * `lastAt` is an ISO timestamp; invalid/missing timestamps fall back to zero age
 * rather than inventing recency.
 */
export function heatWeight(count, lastAt, now = Date.now(), halfLifeDays = 30) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const halfLife = Number(halfLifeDays) > 0 ? Number(halfLifeDays) : 30;
  const at = Date.parse(String(lastAt || ''));
  const ageDays = Number.isFinite(at) ? Math.max(0, (now - at) / 86400000) : 0;
  return n * Math.pow(0.5, ageDays / halfLife);
}

function idSequence(id) {
  const match = /^(\d{4}-\d{2}-\d{2})-[atcw]-(\d{4})$/.exec(String(id || ''));
  return match ? { date: match[1], seq: Number(match[2]) } : { date: '', seq: 0 };
}

/** Newest current truth first: `updated`, then id order, then id text. */
function newerTruth(a, b) {
  const updated = String(a.updated || '').localeCompare(String(b.updated || ''));
  if (updated) return updated;
  const left = idSequence(a.id);
  const right = idSequence(b.id);
  const date = left.date.localeCompare(right.date);
  if (date) return date;
  const seq = left.seq - right.seq;
  if (seq) return seq;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

/**
 * One current claim per `subject` across entries from possibly different
 * stores. `validate` rejects two active atoms sharing a subject inside one
 * vault, but the global and project stores are validated independently; the
 * same subject can therefore exist in both. Injection must arbitrate them
 * together or the older claim can win.
 *
 * Entries are `{ note, ...metadata }`; metadata (source, rank) is preserved.
 * Returned order is subject insertion order then subject-less entries, matching
 * `currentTruthNotes`.
 */
export function currentTruthEntries(entries, sessionScope = 'global') {
  const injectable = (entries || []).filter((entry) => entry && isInjectable(entry.note, sessionScope));
  const bySubject = new Map();
  const noSubject = [];
  for (const entry of injectable) {
    const subject = String(entry.note.subject || '').trim();
    if (!subject) {
      noSubject.push(entry);
      continue;
    }
    const previous = bySubject.get(subject);
    if (!previous || newerTruth(entry.note, previous.note) > 0) bySubject.set(subject, entry);
  }
  return [...bySubject.values(), ...noSubject];
}

/**
 * One current claim per `subject`. Kept as the note-only façade used by
 * `rankMemories` and the panel fallback.
 */
export function currentTruthNotes(notes, sessionScope = 'global') {
  return currentTruthEntries((notes || []).map((note) => ({ note })), sessionScope).map((entry) => entry.note);
}

/**
 * Apply source-aware budgets after cross-store arbitration. `entries` must
 * already be deduped (normally by `currentTruthEntries`) and carry a source and
 * a rank; the rank preserves each store's own heat order.
 */
export function pickBySource(entries, options = {}) {
  const limit = (value) => Math.max(0, Number(value) || 0);
  const globalLimit = limit(options.globalLimit);
  const projectLimit = limit(options.projectLimit);
  const pick = (source, cap) => (entries || [])
    .filter((entry) => entry.source === source)
    .sort((a, b) => (Number(a.rank) || 0) - (Number(b.rank) || 0))
    .slice(0, cap)
    .map((entry) => entry.note);
  return {
    globalPicked: pick('global', globalLimit),
    projectPicked: pick('project', projectLimit),
  };
}

/**
 * Rank injectable memories for the shadow comparison in `consolidate`:
 * current truth (one per subject) × decayed heat × recency.
 * This function is pure so the report can be tested without a vault or clock.
 */
export function rankMemories(notes, accessRows = [], sessionScope = 'global', options = {}) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const halfLifeDays = Number(options.halfLifeDays) > 0 ? Number(options.halfLifeDays) : 30;
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 5;
  const heat = new Map();
  for (const row of accessRows) {
    if (!row || !row.id) continue;
    const prev = heat.get(row.id) || { count: 0, lastAt: '' };
    prev.count += 1;
    if (String(row.t || '') > prev.lastAt) prev.lastAt = String(row.t || '');
    heat.set(row.id, prev);
  }
  return currentTruthNotes(notes, sessionScope)
    .map((note) => {
      const recalled = heat.get(note.id);
      return {
        note,
        heat: recalled ? heatWeight(recalled.count, recalled.lastAt, now, halfLifeDays) : 0,
        order: idSequence(note.id),
      };
    })
    .sort(
      (a, b) =>
        b.heat - a.heat ||
        String(b.note.updated || '').localeCompare(String(a.note.updated || '')) ||
        b.order.date.localeCompare(a.order.date) ||
        b.order.seq - a.order.seq ||
        String(b.note.id).localeCompare(String(a.note.id)),
    )
    .slice(0, limit)
    .map((entry) => entry.note);
}
