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
  const next = sectionItems(body, '下一步', itemsPerSection).map((item) => clampText(item, itemChars));
  if (next.length) parts.push(`下一步：${next.join('；')}`);
  const blocked = sectionItems(body, '未决', itemsPerSection).map((item) => clampText(item, itemChars));
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
  if (note.level !== 'digest' || note.status !== 'active') return false;
  if (note.type === 'session' || note.type === 'work' || note.type === 'topic') return false;
  if (note.scope === 'global') return true;
  return Boolean(sessionScope) && sessionScope !== 'global' && note.scope === sessionScope;
}
