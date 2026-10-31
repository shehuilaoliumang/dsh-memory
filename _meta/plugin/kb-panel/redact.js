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
  // Credentials embedded in a URL: keep scheme/user/host, hide the password.
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)([^@\s/]+)@/gi, '$1[REDACTED]@'],
  // key = value / password: value. Chinese labels are common in prose; the
  // lookahead keeps ordinary sentences such as “密码是敏感信息” untouched.
  [/((?:\b(?:api[_-]?key|secret|token|password|passwd|pwd|client[_-]?secret|access[_-]?key)\b|密码|口令|密钥|秘钥|令牌)\s*(?:是|为|[:=：])\s*["']?)(?=[^\s，。；;,"']*[A-Za-z0-9])[^\s，。；;,"']{6,}/gi, '$1[REDACTED]'],
  // Mainland mobile numbers and 18-digit resident IDs (checksum not verified:
  // the goal is to avoid persisting a full identifier, not to validate it).
  [/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[REDACTED:phone]'],
  [/(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g, '[REDACTED:id-card]'],
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
