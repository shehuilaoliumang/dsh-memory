/**
 * One frontmatter parser for every caller.
 *
 * Before this module existed, `kb.mjs` converted booleans/numbers and split
 * quoted inline arrays while `index.js` kept everything as strings and split on
 * every comma. The two views could disagree about the same note. This module is
 * the single definition; callers either take `{data, body}` or the data object.
 *
 * Kept deliberately small and dependency-free: it is imported by the CLI, the
 * Host plugin and the public snapshot's tests.
 */

export function splitInlineArray(source) {
  const out = [];
  let current = '';
  let quote = null;
  for (const ch of source) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim() !== '') out.push(current);
  return out.map((item) => item.trim()).filter(Boolean);
}

export function parseScalar(raw) {
  const value = String(raw ?? '').trim();
  if (value === '') return '';
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
    (value.startsWith("'") && value.endsWith("'") && value.length > 1)
  ) {
    return value.slice(1, -1);
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitInlineArray(value.slice(1, -1)).map(parseScalar);
  }
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/**
 * Returns `{data, body}`. `data` is `null` when the note has no frontmatter so
 * callers can distinguish "missing" from "empty frontmatter" (validate needs
 * that distinction; the panel does not).
 */
export function parseFrontmatter(text) {
  const match = String(text ?? '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: null, body: String(text ?? '') };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    if (!key || key.startsWith('-')) continue;
    data[key] = parseScalar(line.slice(colon + 1));
  }
  return { data, body: String(text ?? '').slice(match[0].length) };
}

/** The panel's original contract: an object, empty when no frontmatter exists. */
export function parseFrontmatterData(text) {
  const { data } = parseFrontmatter(text);
  return data || {};
}
