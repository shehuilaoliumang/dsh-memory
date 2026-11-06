/**
 * Ranking experiment for the injection prompt (3.2).
 *
 * The experiment is deliberately a *deterministic, session-stable* assignment:
 * each session is pinned to one ranking mode so a conversation cannot see its
 * ordering change between turns. Assignments are also written to
 * `_meta/state/rank-experiment.jsonl` (runtime state, gitignored) so the panel
 * can show which arm a session is in; no access/read counters are affected.
 *
 * The experiment is off unless `_meta/config.json` enables it:
 *   "inject": { "rankExperiment": { "enabled": true, "modes": ["heat","relevance"] } }
 */
import fs from 'node:fs';
import path from 'node:path';

export const RANK_MODES = ['heat', 'relevance'];
export const DEFAULT_RANK_EXPERIMENT = {
  enabled: false,
  modes: ['heat', 'relevance'],
  salt: 'kb-rank-3.2',
};

const normalizeMode = (value) => (RANK_MODES.includes(value) ? value : null);

/** Keep only known modes, de-duplicated, with a stable heat-first fallback. */
export function normalizeModes(modes) {
  const list = Array.isArray(modes) ? modes.map(normalizeMode).filter(Boolean) : [];
  const unique = [...new Set(list)];
  return unique.length >= 2 ? unique : [...RANK_MODES];
}

export function resolveRankExperiment(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    enabled: input.enabled === true,
    modes: normalizeModes(input.modes),
    salt: typeof input.salt === 'string' && input.salt ? input.salt : DEFAULT_RANK_EXPERIMENT.salt,
  };
}

/** FNV-1a — tiny, deterministic, no dependency (not used for security). */
export function stableHash(text) {
  let hash = 0x811c9dc5;
  const value = String(text || '');
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function variantForSession(sessionId, config) {
  const experiment = resolveRankExperiment(config);
  if (!experiment.enabled) return 'heat';
  const key = String(sessionId || '');
  if (!key) return experiment.modes[0];
  return experiment.modes[stableHash(`${experiment.salt}\u0000${key}`) % experiment.modes.length];
}

/** Experiment wins when enabled; otherwise the static config mode applies. */
export function resolveRankMode({ sessionId, rankMode = 'heat', experiment } = {}) {
  if (experiment && experiment.enabled === true && sessionId) {
    return variantForSession(sessionId, experiment);
  }
  return normalizeMode(rankMode) || 'heat';
}

function assignmentsFile(root) {
  return path.join(root, '_meta', 'state', 'rank-experiment.jsonl');
}

/**
 * Append one assignment row per session (idempotent within the session).
 * Returns the row. Failures are advisory and never break the turn.
 */
export function recordAssignment(root, { sessionId, variant, mode = 'relevance', at = new Date().toISOString() } = {}) {
  const id = String(sessionId || '');
  const assigned = normalizeMode(variant);
  if (!root || !id || !assigned) return null;
  const file = assignmentsFile(root);
  try {
    let exists = false;
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      exists = lines.some((line) => {
        try {
          const row = JSON.parse(line);
          return row && String(row.sessionId) === id && row.variant === assigned;
        } catch {
          return false;
        }
      });
    }
    if (exists) return null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const row = { at, sessionId: id, variant: assigned, mode: assigned === 'relevance' ? mode : 'heat' };
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
    return row;
  } catch {
    return null;
  }
}

/** Grouped counts for the panel (`heat: 3` / `relevance: 2`). */
export function assignmentSummary(root) {
  const file = assignmentsFile(root);
  const rows = [];
  try {
    if (!fs.existsSync(file)) return { total: 0, counts: { heat: 0, relevance: 0 } };
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row && RANK_MODES.includes(row.variant)) rows.push(row);
      } catch {
        /* skip corrupt row */
      }
    }
  } catch {
    return { total: 0, counts: { heat: 0, relevance: 0 } };
  }
  const counts = { heat: 0, relevance: 0 };
  for (const row of rows) counts[row.variant] += 1;
  return { total: rows.length, counts };
}
