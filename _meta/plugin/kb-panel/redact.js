/**
 * Secret redaction for the write pipeline (schema §5 / P3.5).
 *
 * Raw transcripts are append-only, but a pasted API key must not become a
 * permanent artifact. This module is intentionally conservative: it only
 * matches well-known secret shapes and `key = value` assignments. It never
 * guesses from surrounding prose, so ordinary notes are untouched.
 */

const RULES = [
  // Provider tokens with recognizable prefixes.
  [/sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED:api-key]'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, '[REDACTED:github-token]'],
  [/github_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED:github-token]'],
  [/glpat-[A-Za-z0-9_-]{16,}/g, '[REDACTED:gitlab-token]'],
  [/AKIA[0-9A-Z]{16}/g, '[REDACTED:aws-key]'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, '[REDACTED:slack-token]'],
  // Bearer tokens in headers/pasted requests.
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[REDACTED]'],
  // key = value / password: value (only when the value looks like a secret).
  [/(\b(?:api[_-]?key|secret|token|password|passwd|pwd|client[_-]?secret)\b\s*[:=]\s*["']?)[A-Za-z0-9_./+=-]{8,}/gi, '$1[REDACTED]'],
  // PEM private keys: replace the whole block, including its header.
  [/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g, '[REDACTED:private-key]'],
];

export const REDACTED = '[REDACTED]';

/** Return `text` with recognizable secrets replaced; input is never mutated. */
export function redactSecrets(text) {
  let value = String(text == null ? '' : text);
  if (!value) return value;
  for (const [pattern, replacementToken] of RULES) {
    value = value.replace(pattern, replacementToken);
  }
  return value;
}

/** True when `redactSecrets` would change the text. */
export function hasSecret(text) {
  return redactSecrets(text) !== String(text == null ? '' : text);
}
