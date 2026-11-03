#!/usr/bin/env node
/**
 * Pure rules for the sanitized public export (`_meta/scripts/export-public.mjs`).
 *
 * This module owns two decisions and nothing else:
 *   1. which paths may never appear in a public snapshot (`isForbiddenPublicPath`);
 *   2. how exported text is rewritten and then verified
 *      (`stripRawSources`, `stripRuntimeIds`, `sanitizePublicText`,
 *      `assertPublicText`).
 *
 * Everything here is a pure function of its arguments: no fs, no process, no
 * clock, no environment. The table-driven tests in
 * `_meta/scripts/test/export-rules.test.mjs` exploit that to exhaust the edge
 * cases (access* suffixes, session id lengths, absolute paths, tokens) without
 * building a real snapshot.
 *
 * These rules are security-critical and used to be inline in export-public.mjs
 * (v1.19.x: access* family, session id hex floor {6}, raw transcript paths,
 * absolute vault path -> `<vault>`, plugin patch workspaceRoot placeholder).
 * Keep the behavior exact: the export is a one-way door, and CI re-checks the
 * built snapshot independently (forbidden file names, session ids, paths).
 *
 * WARNING: this file is itself exported to the public snapshot, so the literals
 * here must not look like the leaks they redact, or the export aborts on its
 * own rules. The same applies to the test file next to it.
 */

/** Absolute-path placeholder for the local vault root and its parent dir. */
export const VAULT_PLACEHOLDER = '<vault>';

/** Relative path of the plugin bundle patch whose workspaceRoot is placeheld. */
export const PLUGIN_PATCH_REL = '_meta/plugin/kb-panel/cordis.patch.yml';

/** Relative path prefixes that may never be exported (POSIX form). */
export const FORBIDDEN_PATH_PREFIXES = Object.freeze(['10_Raw/', '00_Inbox/', '_meta/state/']);

/**
 * Telemetry family: `access.jsonl` rotates to `access-<stamp>.jsonl` and manual
 * backups add arbitrary suffixes (`access.jsonl.bak`), so match the base-name
 * family, not one file name (same source of truth as `.gitignore`).
 */
export const ACCESS_FILE_PATTERN = /^_meta\/access[^/]*$/i;

/** Raw-transcript provenance: frontmatter `source:` lines and raw wiki links. */
export const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;
export const SOURCE_LINE_PATTERN = /^source\s*:/;
export const WIKI_RAW_LINK_PATTERN = /\[\[10_Raw\/[^\]]*\]\]/g;

/**
 * Runtime identifiers are not document content: session ids (full UUIDs and
 * truncated fragments), bare UUIDs and raw session file names appear in
 * `_meta/log.md` and must not travel with the public repo.
 *
 * The hex floor is 6 (v1.19.4: 6-7 digit truncated ids slipped past an earlier
 * 8-digit floor). The exact replacement semantics are pinned by the tests: the
 * regex redacts the leading hex group and leaves any tail it cannot consume,
 * which is the shipped v1.19.x behavior this refactor must not change.
 */
export const SESSION_ID_PATTERN = /session-[0-9a-f]{6}(?:-[0-9a-f]{4}){0,3}(?:-[0-9a-f]{1,12})?/gi;
export const BARE_UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
export const RAW_SESSION_PATH_PATTERN = /10_Raw\/sessions\/[0-9A-Za-z_./-]+\.md/g;

/**
 * C0 control characters except tab, LF and CR (CR is kept so CRLF files keep
 * their line endings). A stray backspace once reached `_meta/log.md` through a
 * shell escape, hence the scrub.
 */
export const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/**
 * Same classes as above but non-global, for the final post-sanitize assertion.
 * Non-global matters: `.test()` on a /g regex is stateful via `lastIndex`.
 */
export const SESSION_ID_FORBIDDEN = /session-[0-9a-f]{6}/i;
export const BARE_UUID_FORBIDDEN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
export const RAW_SESSION_PATH_FORBIDDEN = /10_Raw\/sessions\/[0-9A-Za-z_./-]+\.md/;

/**
 * Access-token shapes that must never reach the public tree. Kept as escaped
 * regex literals so this file does not itself trip the scan it defines.
 */
export const TOKEN_PATTERNS = Object.freeze([
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
]);

/** Drive-letter user directory: `<drive>:\\Users\\` and `<drive>:/Users/`. */
export const LOCAL_USER_PATH_PATTERN = /[A-Za-z]:[\\/]Users[\\/]/;

/** Plugin patch: replace the absolute workspaceRoot value with a placeholder. */
export const WORKSPACE_ROOT_LINE_PATTERN = /^(\s*workspaceRoot:\s*)['"].*['"]/m;

/**
 * True when `rel` (a POSIX-style path relative to the vault root, as produced
 * by the export walker) must never be written to a public snapshot.
 *
 * The export uses this in its allow-list and again over the selected files as
 * belt-and-braces; CI repeats the file-level check on the built snapshot.
 */
export function isForbiddenPublicPath(rel) {
  if (typeof rel !== 'string' || rel === '') return false;
  // Walker paths are POSIX/relative; normalize anyway so CI scripts can reuse
  // this predicate with Windows-style relative paths.
  const normalized = rel.replaceAll('\\', '/');
  for (const prefix of FORBIDDEN_PATH_PREFIXES) {
    if (normalized.startsWith(prefix)) return true;
  }
  if (normalized === 'PROJECT_PLAN.md') return true;
  if (ACCESS_FILE_PATTERN.test(normalized)) return true;
  // The walker already skips a top-level `.git/` dir; keep the predicate
  // fail-closed for nested ones (e.g. a checked-out fixture) and direct callers.
  if (normalized === '.git' || normalized.startsWith('.git/') || normalized.includes('/.git/')) return true;
  return false;
}

/**
 * Strip raw-transcript provenance from markdown: frontmatter `source:` lines
 * and `[[10_Raw/...]]` wiki links (both currently shipped behaviors).
 */
export function stripRawSources(text) {
  let result = text;
  const frontmatter = FRONTMATTER_PATTERN.exec(result);
  if (frontmatter) {
    const body = frontmatter[1]
      .split(/\r?\n/)
      .filter((line) => !SOURCE_LINE_PATTERN.test(line))
      .join('\n');
    result = result.replace(FRONTMATTER_PATTERN, `---\n${body}\n---`);
  }
  return result.replace(WIKI_RAW_LINK_PATTERN, '');
}

/**
 * Redact runtime identifiers in any text file, then drop control characters.
 * Control scrubbing lives here so every exported text file gets it through
 * `sanitizePublicText`; nothing about it is markdown-specific.
 */
export function stripRuntimeIds(text) {
  return text
    .replace(SESSION_ID_PATTERN, 'session-<redacted>')
    .replace(BARE_UUID_PATTERN, '<uuid>')
    .replace(RAW_SESSION_PATH_PATTERN, '10_Raw/sessions/<redacted>.md')
    .replace(CONTROL_CHAR_PATTERN, '');
}

/**
 * Full sanitization for one exported text file.
 *
 * Order matters and matches the pre-refactor inline implementation:
 * markdown provenance -> runtime ids -> control chars -> absolute paths ->
 * plugin patch workspaceRoot. `root` and `parent` are literal strings (no regex
 * escaping needed) and may be empty to skip path replacement in pure tests.
 */
export function sanitizePublicText(rel, text, options = {}) {
  const { root = '', parent = '' } = options || {};
  let result = text;
  if (rel.endsWith('.md')) result = stripRawSources(result);
  result = stripRuntimeIds(result);
  for (const prefix of [root, parent]) {
    if (!prefix) continue;
    result = result.split(prefix).join(VAULT_PLACEHOLDER);
    result = result.split(prefix.replaceAll('\\', '/')).join(VAULT_PLACEHOLDER);
  }
  if (rel === PLUGIN_PATCH_REL) {
    result = result.replace(WORKSPACE_ROOT_LINE_PATTERN, "$1'<path-to-vault>'");
  }
  return result;
}

/**
 * Fail-closed gate for text about to be written to the public snapshot.
 * Throws on access tokens, local user directory paths, or any residual runtime
 * identifier (session id fragment, bare UUID, raw session file name).
 *
 * Check order and messages match the pre-refactor separate assertions.
 */
export function assertPublicText(rel, text) {
  for (const pattern of TOKEN_PATTERNS) {
    if (pattern.test(text)) throw new Error(`导出中止：${rel} 疑似包含访问令牌`);
  }
  if (LOCAL_USER_PATH_PATTERN.test(text)) {
    throw new Error(`导出中止：${rel} 仍含本地用户目录路径`);
  }
  if (SESSION_ID_FORBIDDEN.test(text) || BARE_UUID_FORBIDDEN.test(text) || RAW_SESSION_PATH_FORBIDDEN.test(text)) {
    throw new Error(`导出中止：${rel} 仍含 session UUID / 原文文件标识`);
  }
}
