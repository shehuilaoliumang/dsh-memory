/**
 * Explicit promotion of one workspace memory into the shared global store.
 *
 * The cross-project library only grows through a human action (the memory page
 * "提升为全局" button), never from a project judge: project stores must not emit
 * `scope: global` on their own, or project A's conversation could quietly leak
 * into every other workspace (c-0019 + c-0020).
 *
 * Pure helpers, no fs / Host APIs: the payload is built here and handed to
 * `kb.mjs add-atom` by the Host, so these functions are unit-testable.
 */

/** Atom types that are memory (work / topic / session pages are not). */
export const MEMORY_TYPES = new Set([
  'fact',
  'preference',
  'decision',
  'opinion',
  'question',
  'task',
  'definition',
  'principle',
]);

/**
 * Only a confirmed digest atom is promotable: an inbox candidate has not been
 * accepted yet, a raw/session row is a transcript, and canon/topic/work pages
 * are structures rather than memories.
 */
export function isGlobalPromotable(note) {
  if (!note || typeof note !== 'object') return false;
  if (!MEMORY_TYPES.has(String(note.type || ''))) return false;
  if (String(note.level || '') !== 'digest') return false;
  return String(note.status || '') === 'active';
}

/** Read the bullet list under `## 要点`; other sections are not memory text. */
export function extractPoints(body) {
  const points = [];
  let inPoints = false;
  for (const line of String(body || '').split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      inPoints = heading[1] === '要点';
      continue;
    }
    if (!inPoints) continue;
    const item = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
    if (!item) continue;
    const point = item[1].replace(/\s+/g, ' ').trim();
    if (point) points.push(point);
    if (points.length >= 8) break;
  }
  return points;
}

/** Local YYYY-MM-DD stamp for the provenance note. */
export function localDateStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Build the `kb.mjs add-atom` spec for the global copy. Every cross-store link
 * (`source`, `related`, `up`, `supersedes`) is dropped deliberately: those ids
 * live in the source store and would be dangling in the global catalog. The
 * provenance line records where the memory came from instead.
 */
export function globalAtomSpec(note, body, options = {}) {
  const summary = String(note.summary || '').trim() || String(note.title || '').trim();
  const points = extractPoints(body);
  if (!points.length && summary) points.push(summary);
  const spec = {
    title: String(note.title || summary).slice(0, 80),
    type: String(note.type || 'fact'),
    scope: 'global',
    status: 'active',
    summary,
    points,
    tags: Array.isArray(note.tags) ? note.tags.map((tag) => String(tag)).slice(0, 8) : [],
    note: `由 ${String(note.id || '')}（${String(options.sourceLabel || '项目库')}）提升为全局记忆（${String(options.date || '')}）`,
  };
  const subject = String(note.subject || '').trim().toLowerCase();
  if (/^[a-z0-9][a-z0-9-]{1,63}$/.test(subject)) spec.subject = subject;
  return spec;
}
