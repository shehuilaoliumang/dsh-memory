/**
 * Memory-health analysis for one knowledge store.
 *
 * Consolidation used to be a CLI-only daily report (`kb.mjs consolidate`); this
 * module turns the same signals into a structured, panel-friendly report. It is
 * deliberately:
 * - pure and synchronous: no `fs`, no imports, no hidden clock — the caller
 *   passes `now` so reports are reproducible;
 * - defensive: malformed notes / catalog rows / access rows degrade to "not
 *   checked" instead of throwing, because the panel feeds it a snapshot that may
 *   lag behind a manual edit;
 * - advisory: it detects conflicts, dangling supersedes edges, staleness and
 *   duplicate summaries; it never rewrites a note or changes injection.
 *
 * Consumers normally pass:
 * - `notes`: `scanStoreNotes(root)` output (frontmatter-shaped);
 * - `accessRows`: `readAccessRows(root)` output (`{id, t, how}`);
 * - `catalogRows`: `_meta/catalog.jsonl` rows (optional).
 * A caller that only has the derived index may omit `notes` and pass
 * `catalogRows`; notes are then derived from the rows (fields the catalog does
 * not carry, e.g. `supersedes`/`reviewAfter`, simply are not checked).
 *
 * Severity contract: `ok` is true only when no `error` and no `warn` issue was
 * found. `info` issues are advisory and never flip `ok`.
 *
 * @module health
 */

/** Stable severity order, most severe first. */
export const HEALTH_SEVERITIES = ['error', 'warn', 'info'];

/**
 * Every issue kind this module can emit. The order is the panel-friendly order
 * used to pre-seed `byKind` (a stable object shape with zero counts).
 */
export const HEALTH_KINDS = [
  'conflict',
  'orphan-supersedes',
  'pending-supersedes',
  'missing-subject',
  'scope-mismatch',
  'stale',
  'review-due',
  'duplicate',
  'unclassified',
  'low-recall',
];

const SEVERITY_RANK = new Map(HEALTH_SEVERITIES.map((severity, index) => [severity, index]));
const DAY_MS = 86400000;
const MAX_DATE_MS = 8640000000000000;
const STALE_DAYS_DEFAULT = 180;
const ACCESS_WINDOW_DAYS_DEFAULT = 90;
const DIGEST_PAGE_TYPES = new Set(['topic', 'work', 'session']);
const LIVE_STATUSES = new Set(['active', 'inbox', 'review']);

// ------------------------------------------------------------------ helpers

/** Coerce a frontmatter scalar to text without ever throwing. */
function toText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return fallback;
}

/** Finite number from a number or numeric string; `null` when malformed. */
function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * UTC midnight of a calendar day, strictly validated (no `2026-02-31` rollover).
 * @returns {number|null} epoch ms, or null when the day does not exist
 */
function utcDayMs(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // setUTCFullYear keeps years < 100 from being reinterpreted as 19xx.
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.getTime();
}

/**
 * Parse a frontmatter/telemetry date (`YYYY-MM-DD` or an ISO timestamp) as epoch
 * ms. Date-only values are anchored at UTC midnight so a report is timezone
 * independent. Invalid calendar days return `null`.
 */
function parseDateMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const text = toText(value).trim();
  if (!text) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s].*)?$/.exec(text);
  if (!match) return null;
  const dayStart = utcDayMs(Number(match[1]), Number(match[2]), Number(match[3]));
  if (dayStart === null) return null;
  if (text.length === 10) return dayStart;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

/** Caller `now` as epoch ms; malformed values fall back to the current clock. */
function normalizeNow(value) {
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_DATE_MS) {
    return value;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isFinite(ms)) return ms;
  }
  const parsed = parseDateMs(value);
  return parsed === null ? Date.now() : parsed;
}

/**
 * Read a day-count limit from `limits`, accepting camelCase and the legacy
 * snake_case config spelling. Invalid/negative values fall back to the default.
 */
function readDaysLimit(limits, keys, fallback) {
  const source = limits && typeof limits === 'object' ? limits : {};
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = toFiniteNumber(source[key]);
    if (value !== null && value >= 0) return value;
  }
  return fallback;
}

/**
 * Normalize a `supersedes` value (array or scalar, bare ids or `[[link]]`) to
 * unique bare note ids. Non-string items are ignored.
 */
function normalizeLinks(value) {
  const items = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const links = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const matches = item.match(/\[\[([^\]]+)\]\]/g) || [];
    const candidates = matches.length ? matches : [item];
    for (const candidate of candidates) {
      const bare = candidate
        .replace(/\[\[|\]\]/g, '')
        .split('|')[0]
        .replace(/\.md$/i, '')
        .split('/')
        .pop()
        .trim();
      if (!bare || seen.has(bare)) continue;
      seen.add(bare);
      links.push(bare);
    }
  }
  return links;
}

/** One raw note/catalog row to the shape the checks consume; null when unusable. */
function normalizeNote(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = toText(raw.id).trim();
  if (!id) return null;
  const reviewAfter = toText(raw.reviewAfter).trim() || toText(raw.review_after).trim();
  return {
    id,
    title: toText(raw.title).trim(),
    type: toText(raw.type).trim(),
    status: toText(raw.status).trim(),
    scope: toText(raw.scope).trim(),
    subject: toText(raw.subject).trim(),
    summary: toText(raw.summary),
    updated: toText(raw.updated).trim(),
    level: toText(raw.level).trim(),
    reviewAfter,
    supersedes: normalizeLinks(raw.supersedes),
  };
}

/** Normalize a row list, dropping malformed rows and duplicate ids (first wins). */
function collectNotes(rows) {
  if (!Array.isArray(rows)) return [];
  const notes = [];
  const seen = new Set();
  for (const row of rows) {
    const note = normalizeNote(row);
    if (!note || seen.has(note.id)) continue;
    seen.add(note.id);
    notes.push(note);
  }
  return notes;
}

/**
 * Memory atoms are digest-level; topic/work/session pages are not memories even
 * though work/topic pages also carry `level: digest`.
 */
function isDigestNote(note) {
  if (DIGEST_PAGE_TYPES.has(note.type)) return false;
  if (note.level) return note.level === 'digest';
  return true;
}

/** Lowercase + NFKC + strip punctuation/symbols + collapse whitespace. */
function normalizeSummary(value) {
  return toText(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Most recent `updated` string in a group (lexicographic works for ISO days). */
function latestUpdated(notes) {
  let latest = '';
  for (const note of notes) if (note.updated > latest) latest = note.updated;
  return latest;
}

function uniqueIds(ids) {
  const list = Array.isArray(ids) ? ids : [ids];
  const out = [];
  for (const raw of list) {
    const id = toText(raw).trim();
    if (!id || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

/** Build one issue with only the optional fields that carry information. */
function makeIssue({ kind, severity, ids, message, detail, updated, ageDays }) {
  const issue = {
    kind,
    severity,
    ids: uniqueIds(ids),
    message: toText(message).trim(),
  };
  const detailText = toText(detail).trim();
  if (detailText) issue.detail = detailText;
  const updatedText = toText(updated).trim();
  if (updatedText) issue.updated = updatedText;
  const age = toFiniteNumber(ageDays);
  if (age !== null) issue.ageDays = Math.max(0, Math.floor(age));
  return issue;
}

function compareText(a, b) {
  const left = toText(a);
  const right = toText(b);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Severity first, then kind, then `updated` ascending, then a stable tiebreak. */
function compareIssues(a, b) {
  const rankA = SEVERITY_RANK.has(a.severity) ? SEVERITY_RANK.get(a.severity) : HEALTH_SEVERITIES.length;
  const rankB = SEVERITY_RANK.has(b.severity) ? SEVERITY_RANK.get(b.severity) : HEALTH_SEVERITIES.length;
  if (rankA !== rankB) return rankA - rankB;
  return compareText(a.kind, b.kind)
    || compareText(a.updated, b.updated)
    || compareText(a.ids[0], b.ids[0])
    || compareText(a.message, b.message);
}

/**
 * Assemble the report: sort, count, pre-seed `byKind` with every known kind.
 * @returns {{ok: boolean, generatedAt: string, counts: {error: number, warn: number, info: number}, issues: object[], byKind: Record<string, number>}}
 */
function buildReport(issues, nowMs) {
  const sorted = issues.slice().sort(compareIssues);
  const counts = { error: 0, warn: 0, info: 0 };
  const byKind = {};
  for (const kind of HEALTH_KINDS) byKind[kind] = 0;
  for (const issue of sorted) {
    if (Object.prototype.hasOwnProperty.call(counts, issue.severity)) counts[issue.severity] += 1;
    if (Object.prototype.hasOwnProperty.call(byKind, issue.kind)) byKind[issue.kind] += 1;
  }
  return {
    ok: counts.error === 0 && counts.warn === 0,
    generatedAt: new Date(nowMs).toISOString(),
    counts,
    issues: sorted,
    byKind,
  };
}

// -------------------------------------------------------------- public API

/**
 * Analyze one store snapshot and return a memory-health report.
 *
 * @param {object} [options]
 * @param {object[]} [options.notes] Note-shaped objects (`id,title,type,status,
 *   scope,subject,summary,updated,file`, optional `reviewAfter`/`supersedes`/
 *   `level`/`tags`). Missing or empty notes are derived from `catalogRows`.
 * @param {object[]} [options.catalogRows] Derived-index rows; used for note
 *   derivation when `notes` is absent and as an id/status authority for
 *   supersedes targets.
 * @param {object[]} [options.accessRows] Recall telemetry rows `{id, at, how}`
 *   (the CLI's `{id, t, how}` spelling is accepted too). When omitted entirely,
 *   `low-recall` is not checked; staleness still assumes "not recalled" because
 *   no row means no recent recall.
 * @param {number|string|Date} [options.now=Date.now()] Analysis clock.
 * @param {string} [options.scope='global'] Reserved for callers that pass their
 *   session scope; the issue set is store-wide, so no check depends on it.
 * @param {object} [options.limits] `{staleDays=180, accessWindowDays=90}`
 *   (`stale_days`/`access_window_days` accepted for config reuse).
 * @param {'project'|'global'|'legacy'} [options.storeKind='legacy'] Store kind;
 *   project stores get `scope-mismatch` checks.
 * @param {string} [options.storeSlug] Project store slug, used to accept
 *   `project:<slug>` and flag other project scopes.
 * @returns {object} `{ok, generatedAt, counts, issues, byKind}`.
 */
export function analyzeMemoryHealth(options = {}) {
  const input = options && typeof options === 'object' ? options : {};
  const nowMs = normalizeNow(input.now);
  const notes = collectNotes(input.notes);
  const catalogNotes = collectNotes(input.catalogRows);
  // The catalog is a fallback snapshot and an id/status authority, not a second
  // note list: analyzing both would double-report the same atom.
  const effectiveNotes = notes.length ? notes : catalogNotes;
  const knownIds = new Set(effectiveNotes.map((note) => note.id));
  for (const note of catalogNotes) knownIds.add(note.id);
  const statusById = new Map();
  for (const note of effectiveNotes) statusById.set(note.id, note.status);
  for (const note of catalogNotes) if (!statusById.has(note.id)) statusById.set(note.id, note.status);

  const staleDays = readDaysLimit(input.limits, ['staleDays', 'stale_days'], STALE_DAYS_DEFAULT);
  const accessWindowDays = readDaysLimit(
    input.limits,
    ['accessWindowDays', 'access_window_days', 'recallWindowDays'],
    ACCESS_WINDOW_DAYS_DEFAULT,
  );
  const storeKind = ['project', 'global', 'legacy'].includes(input.storeKind) ? input.storeKind : 'legacy';
  const storeSlug = toText(input.storeSlug).trim();
  const hasAccessRows = Object.prototype.hasOwnProperty.call(input, 'accessRows')
    && Array.isArray(input.accessRows);

  // Recall telemetry: latest row per id, then "was it seen inside the window".
  const lastAccessById = new Map();
  for (const row of hasAccessRows ? input.accessRows : []) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const id = toText(row.id).trim();
    if (!id) continue;
    const at = parseDateMs(row.at) ?? parseDateMs(row.t) ?? parseDateMs(row.timestamp) ?? parseDateMs(row.time);
    if (at === null) continue;
    const previous = lastAccessById.get(id);
    if (previous === undefined || at > previous) lastAccessById.set(id, at);
  }
  const accessCutoff = nowMs - accessWindowDays * DAY_MS;
  const recentlyAccessed = new Set();
  for (const [id, at] of lastAccessById) if (at >= accessCutoff) recentlyAccessed.add(id);

  const activeDigest = effectiveNotes.filter((note) => note.status === 'active' && isDigestNote(note));
  const issues = [];

  // 1. conflict — two active claims on the same subject.
  const subjectGroups = new Map();
  for (const note of activeDigest) {
    if (!note.subject) continue;
    const group = subjectGroups.get(note.subject) || [];
    group.push(note);
    subjectGroups.set(note.subject, group);
  }
  for (const [subject, group] of subjectGroups) {
    if (group.length < 2) continue;
    const ids = group.map((note) => note.id).sort(compareText);
    issues.push(makeIssue({
      kind: 'conflict',
      severity: 'error',
      ids,
      message: `主题「${subject}」有 ${ids.length} 条 active 记忆同时有效`,
      detail: `subject：${subject}`,
      updated: latestUpdated(group),
    }));
  }

  // 2 + 3. supersedes edges — dangling targets are errors, live targets warn.
  for (const note of activeDigest) {
    if (!note.supersedes.length) continue;
    const missing = note.supersedes.filter((target) => !knownIds.has(target));
    const stillActive = note.supersedes.filter((target) => statusById.get(target) === 'active');
    if (missing.length) {
      issues.push(makeIssue({
        kind: 'orphan-supersedes',
        severity: 'error',
        ids: [note.id],
        message: `取代目标不存在：${note.id} → ${missing.join('、')}`,
        detail: `缺失目标：${missing.join('、')}`,
        updated: note.updated,
      }));
    }
    if (stillActive.length) {
      issues.push(makeIssue({
        kind: 'pending-supersedes',
        severity: 'warn',
        ids: [note.id, ...stillActive],
        message: `取代尚未完成：${note.id} 仍指向 active 的 ${stillActive.join('、')}`,
        detail: `旧结论需改为 superseded/archived：${stillActive.join('、')}`,
        updated: note.updated,
      }));
    }
  }

  // 4. missing-subject — active memory without a stable subject slug.
  for (const note of activeDigest) {
    if (note.subject) continue;
    issues.push(makeIssue({
      kind: 'missing-subject',
      severity: 'warn',
      ids: [note.id],
      message: `active 记忆缺少 subject：${note.id}`,
      detail: note.title ? `title：${note.title}` : '',
      updated: note.updated,
    }));
  }

  // 5. scope-mismatch — a project store may only hold its own project scope.
  if (storeKind === 'project') {
    const expectedScope = storeSlug ? `project:${storeSlug}` : 'project:<slug>';
    for (const note of effectiveNotes) {
      if (!isDigestNote(note) || !LIVE_STATUSES.has(note.status)) continue;
      const scopeValue = note.scope.toLowerCase();
      const globalLeak = scopeValue === 'global';
      const otherProject = Boolean(storeSlug)
        && scopeValue.startsWith('project:')
        && scopeValue !== `project:${storeSlug.toLowerCase()}`;
      if (!globalLeak && !otherProject) continue;
      issues.push(makeIssue({
        kind: 'scope-mismatch',
        severity: 'warn',
        ids: [note.id],
        message: globalLeak
          ? `项目库出现 global 范围：${note.id}`
          : `项目库出现其他项目范围 ${note.scope}：${note.id}`,
        detail: `项目库应为 ${expectedScope}`,
        updated: note.updated,
      }));
    }
  }

  // 6. stale — old note with no recall inside the access window.
  for (const note of activeDigest) {
    const updatedMs = parseDateMs(note.updated);
    if (updatedMs === null) continue;
    const ageDays = Math.floor((nowMs - updatedMs) / DAY_MS);
    if (ageDays <= staleDays) continue;
    if (recentlyAccessed.has(note.id)) continue;
    issues.push(makeIssue({
      kind: 'stale',
      severity: 'warn',
      ids: [note.id],
      message: `超过 ${staleDays} 天未更新且近 ${accessWindowDays} 天无召回：${note.id}`,
      detail: `updated ${note.updated}`,
      updated: note.updated,
      ageDays,
    }));
  }

  // 7. review-due — explicit review date reached (any status, like consolidate).
  for (const note of effectiveNotes) {
    if (!note.reviewAfter) continue;
    const dueMs = parseDateMs(note.reviewAfter);
    if (dueMs === null || dueMs > nowMs) continue;
    issues.push(makeIssue({
      kind: 'review-due',
      severity: 'info',
      ids: [note.id],
      message: `到了复查日期 ${note.reviewAfter}：${note.id}`,
      detail: `reviewAfter：${note.reviewAfter}`,
      updated: note.updated,
    }));
  }

  // 8. duplicate — same normalized summary and type among active memories.
  const duplicateGroups = new Map();
  for (const note of activeDigest) {
    const normalized = normalizeSummary(note.summary);
    if (!normalized) continue;
    const key = `${note.type}\u0000${normalized}`;
    const group = duplicateGroups.get(key) || [];
    group.push(note);
    duplicateGroups.set(key, group);
  }
  for (const group of duplicateGroups.values()) {
    if (group.length < 2) continue;
    const ids = group.map((note) => note.id).sort(compareText);
    const typeLabel = group[0].type || '未设置';
    issues.push(makeIssue({
      kind: 'duplicate',
      severity: 'warn',
      ids,
      message: `类型 ${typeLabel} 有 ${ids.length} 条摘要重复`,
      detail: `摘要：${group[0].summary.trim()}`,
      updated: latestUpdated(group),
    }));
  }

  // 9. unclassified — active memory that can never be injected (fail closed).
  for (const note of activeDigest) {
    const scopeValue = note.scope.toLowerCase();
    if (scopeValue && scopeValue !== 'unclassified') continue;
    issues.push(makeIssue({
      kind: 'unclassified',
      severity: 'info',
      ids: [note.id],
      message: scopeValue === 'unclassified'
        ? `范围是 unclassified，永不注入：${note.id}`
        : `缺少 scope（fail closed，永不注入）：${note.id}`,
      detail: '未分范围的记忆不会进入注入。',
      updated: note.updated,
    }));
  }

  // 10. low-recall — only meaningful when the caller actually supplied access
  // rows; an empty array still means "checked, nothing recalled".
  if (hasAccessRows) {
    for (const note of activeDigest) {
      if (recentlyAccessed.has(note.id)) continue;
      issues.push(makeIssue({
        kind: 'low-recall',
        severity: 'info',
        ids: [note.id],
        message: `近 ${accessWindowDays} 天没有召回记录：${note.id}`,
        updated: note.updated,
      }));
    }
  }

  return buildReport(issues, nowMs);
}

/**
 * One-sentence summary of a report, for panel badges/toasts.
 *
 * @param {object} report `analyzeMemoryHealth(...)` output (malformed input is
 *   treated as an empty healthy report).
 * @returns {{ok: boolean, counts: {error: number, warn: number, info: number}, headline: string}}
 */
export function healthSummary(report) {
  const source = report && typeof report === 'object' ? report : {};
  const sourceCounts = source.counts && typeof source.counts === 'object' ? source.counts : {};
  const counts = {
    error: sanitizeCount(sourceCounts.error),
    warn: sanitizeCount(sourceCounts.warn),
    info: sanitizeCount(sourceCounts.info),
  };
  const parts = [];
  if (counts.error) parts.push(`${counts.error} 个错误`);
  if (counts.warn) parts.push(`${counts.warn} 个提醒`);
  if (counts.info) parts.push(`${counts.info} 条提示`);
  return {
    ok: counts.error === 0 && counts.warn === 0,
    counts,
    headline: parts.length ? parts.join('、') : '未发现问题',
  };
}

function sanitizeCount(value) {
  const parsed = toFiniteNumber(value);
  return parsed !== null && parsed > 0 ? Math.floor(parsed) : 0;
}
