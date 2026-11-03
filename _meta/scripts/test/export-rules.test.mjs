#!/usr/bin/env node
/**
 * Table-driven tests for `_meta/scripts/lib/export-rules.mjs` — the public
 * export's security rules (which paths may leave the vault, and how text is
 * sanitized / verified before it is written out).
 *
 * Run:
 *   node --test _meta/scripts/test/export-rules.test.mjs
 *   node _meta/scripts/test/export-rules.test.mjs   # node:test also runs directly
 *
 * NOTE: the export sanitizes every text file, including this one. Leak-shaped
 * fixtures are therefore assembled at runtime from harmless fragments: a literal
 * session id / UUID / absolute path / token here would be rewritten by the
 * export (or abort it), and the published copy of these tests would silently
 * stop testing the rule. Build, don't inline.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  PLUGIN_PATCH_REL,
  TOKEN_PATTERNS,
  VAULT_PLACEHOLDER,
  assertPublicText,
  isForbiddenPublicPath,
  sanitizePublicText,
  stripRawSources,
  stripRuntimeIds,
} from '../lib/export-rules.mjs';

// --- leak-shaped fixtures, assembled at runtime (see header note) ------------
const sessionId = (...groups) => ['session', ...groups].join('-');
const bareUuid = (...groups) => groups.join('-');
const rawSessionPath = (stamp) => ['10_Raw', 'sessions', `${stamp}.md`].join('/');
const rawSessionLink = (stamp) => `[[${rawSessionPath(stamp)}]]`;
const token = (prefix, length = 32) => prefix + 'A'.repeat(length);

const UUID_GROUPS = ['12345678', '1234', '5678', '9abc', 'def012345678'];
// Absolute test roots, built through path.join so the source never contains a
// real local path literal (the export would refuse to publish this file).
const WIN_ROOT = path.win32.join('C:', 'Users', 'Lu', 'Vault');
const WIN_PARENT = path.win32.dirname(WIN_ROOT);
const POSIX_ROOT = path.posix.join('/home', 'lu', 'vault');
const POSIX_PARENT = path.posix.dirname(POSIX_ROOT);

// --- constants ---------------------------------------------------------------

test('pinned public placeholders and rule constants', () => {
  assert.equal(VAULT_PLACEHOLDER, '<vault>');
  assert.equal(PLUGIN_PATCH_REL, '_meta/plugin/kb-panel/cordis.patch.yml');
  // github (classic/oauth/app) + fine-grained PAT + sk- style API key.
  assert.equal(TOKEN_PATTERNS.length, 3);
});

// --- isForbiddenPublicPath ---------------------------------------------------

test('isForbiddenPublicPath rejects runtime/telemetry paths', () => {
  const rows = [
    [rawSessionPath('2026/11/2026-11-02-1200'), 'raw transcript'],
    ['10_Raw/tmp.txt', 'raw prefix'],
    ['00_Inbox/clip.md', 'inbox prefix'],
    ['_meta/state/judge-queue.json', 'runtime state dir'],
    ['_meta/access.jsonl', 'active telemetry file'],
    ['_meta/access-20261102-1552.jsonl', 'rotated telemetry'],
    ['_meta/access.jsonl.bak', 'telemetry backup (v1.19.3 suffix seam)'],
    ['_meta/access.jsonl.bak.2', 'longer backup suffix'],
    ['_meta/access', 'bare access family name'],
    ['_meta/ACCESS.JSONL', 'family match is case-insensitive'],
    ['PROJECT_PLAN.md', 'plan file'],
    ['.git/config', 'top-level git dir'],
    ['_meta/plugin/.git/hooks/pre-commit', 'nested git dir'],
    ['10_Raw\\sessions\\2026\\11\\x.md', 'windows-style separators'],
    ['_meta\\access.jsonl.bak', 'windows-style telemetry path'],
  ];
  for (const [rel, why] of rows) {
    assert.equal(isForbiddenPublicPath(rel), true, `${rel} (${why})`);
  }
});

test('isForbiddenPublicPath allows publishable paths', () => {
  const rows = [
    ['20_Digest/atoms/2026-10-30-a-0001.md', 'digest layer'],
    ['30_Canon/core.md', 'canon layer'],
    ['_meta/scripts/kb.mjs', 'compat entry'],
    ['_meta/scripts/lib/export-rules.mjs', 'this rule module is exported'],
    ['_meta/catalog.jsonl', 'catalog (dropped by export skipFiles, not by this rule)'],
    ['README.md', 'root doc'],
    ['.gitignore', 'gitignore'],
    ['_meta/state.md', 'name prefix, not the state dir'],
    ['10_Raw', 'dir name without trailing slash'],
    ['_meta/accessx/file.md', 'access family is single path segment, as shipped'],
  ];
  for (const [rel, why] of rows) {
    assert.equal(isForbiddenPublicPath(rel), false, `${rel} (${why})`);
  }
  assert.equal(isForbiddenPublicPath(''), false, 'empty relative path');
  assert.equal(isForbiddenPublicPath(undefined), false, 'non-string input');
});

// --- stripRawSources ---------------------------------------------------------

test('stripRawSources removes raw provenance from markdown', () => {
  const link = rawSessionLink('2026-11-02-1200');
  const second = rawSessionLink('2026-11-02-1201');
  const rows = [
    [
      ['---', 'id: 2026-11-02-a-0001', 'status: active', `source: ${link}`, '---', '', `见 ${link}`].join('\n'),
      ['---', 'id: 2026-11-02-a-0001', 'status: active', '---', '', '见 '].join('\n'),
      'frontmatter source line + body wiki link',
    ],
    [
      ['---', 'id: x', `source: "[[${rawSessionPath('2026-11-02-1201')}]]"`, '---', 'body'].join('\n'),
      ['---', 'id: x', '---', 'body'].join('\n'),
      'quoted source value',
    ],
    [
      `---\r\nid: x\r\nsource: ${second}\r\nstatus: active\r\n---\r\n\r\nbody`,
      `---\nid: x\nstatus: active\n---\r\n\r\nbody`,
      'CRLF frontmatter',
    ],
    ['no frontmatter, keep text', 'no frontmatter, keep text', 'no frontmatter'],
    ['source: only body lines are untouched', 'source: only body lines are untouched', 'body source line kept'],
    ['---\nid: x\n  source: indented stays\n---', '---\nid: x\n  source: indented stays\n---', 'indented key stays'],
  ];
  for (const [input, expected, why] of rows) {
    assert.equal(stripRawSources(input), expected, why);
  }
});

// --- stripRuntimeIds: session ids -------------------------------------------

test('stripRuntimeIds redacts session ids at every shipped length', () => {
  const rows = [
    [sessionId('abc123'), 'session-<redacted>', 'shortest 6-hex id (v1.19.4 floor)'],
    [sessionId('abc1234'), 'session-<redacted>4', '7-hex id: regex consumes 6, tail stays'],
    [sessionId('8f9b2dfd'), 'session-<redacted>fd', '8-hex idle: shipped regex leaves tail'],
    [sessionId('8f9b2dfd77e6'), 'session-<redacted>fd77e6', '12-hex truncated uuid: tail stays'],
    [`pre ${sessionId('abcdef12', '3456', '7890')} post`, 'pre session-<redacted>12-3456-7890 post', 'dash-grouped fragment'],
    [
      sessionId('abcdef12', '3456', '7890', 'abcd', 'ef0123456789'),
      'session-<redacted>12-3456-7890-abcd-ef0123456789',
      'full uuid form',
    ],
    [sessionId('ABCDEF'), 'session-<redacted>', 'case-insensitive hex'],
  ];
  for (const [input, expected, why] of rows) {
    assert.equal(stripRuntimeIds(input), expected, why);
  }
});

test('stripRuntimeIds leaves no residual six-hex session prefix', () => {
  const inputs = [
    sessionId('abc123'),
    sessionId('abc1234'),
    sessionId('8f9b2dfd'),
    sessionId('8f9b2dfd77e6'),
    sessionId('ABCDEF'),
    sessionId('abcdef12', '3456', '7890', 'abcd', 'ef0123456789'),
    `log: ${sessionId('0123abcd', 'ef01')} done`,
  ];
  // This is exactly the CI snapshot gate: after sanitization no text may still
  // contain a six-hex session prefix.
  const residual = /session-[0-9a-f]{6}/i;
  for (const input of inputs) {
    assert.equal(residual.test(stripRuntimeIds(input)), false, input);
  }
});

// --- stripRuntimeIds: bare UUIDs and raw paths ------------------------------

test('stripRuntimeIds redacts bare UUIDs', () => {
  const uuid = bareUuid(...UUID_GROUPS);
  assert.equal(stripRuntimeIds(uuid), '<uuid>');
  assert.equal(stripRuntimeIds(`id=${uuid}; id2=${uuid}`), 'id=<uuid>; id2=<uuid>');
  assert.equal(stripRuntimeIds('<uuid>'), '<uuid>', 'already redacted stays');
  // A 7-hex first group is not a UUID and must not be swallowed.
  const notUuid = ['1234567', '1234', '5678', '9abc', 'def012345678'].join('-');
  assert.equal(stripRuntimeIds(notUuid), notUuid);
});

test('stripRuntimeIds redacts raw session file paths', () => {
  assert.equal(stripRuntimeIds(rawSessionPath('2026-11-02-1200')), '10_Raw/sessions/<redacted>.md');
  assert.equal(
    stripRuntimeIds(`[原文](${rawSessionPath('2026/11/2026-11-02-1200')})`),
    '[原文](10_Raw/sessions/<redacted>.md)',
    'nested date directories are consumed by the character class',
  );
  assert.equal(stripRuntimeIds(rawSessionPath('2026-11-02-1200')), stripRuntimeIds(stripRuntimeIds(rawSessionPath('2026-11-02-1200'))), 'idempotent');
  // Shipped rule is forward-slash only; keep that documented rather than silent.
  const backslashed = ['10_Raw', 'sessions', 'x.md'].join('\\');
  assert.equal(stripRuntimeIds(backslashed), backslashed, 'windows-style raw path is not rewritten');
});

// --- stripRuntimeIds: control characters ------------------------------------

test('stripRuntimeIds scrubs control characters, keeps tab/LF/CR', () => {
  assert.equal(stripRuntimeIds('a\u0007b\u000Bc\u000Cd\u001Be'), 'abcde', 'BEL/VT/FF/ESC removed');
  assert.equal(stripRuntimeIds('\u0000x'), 'x', 'NUL removed');
  assert.equal(stripRuntimeIds('a\tb\nc\rd'), 'a\tb\nc\rd', 'tab/LF/CR kept (CRLF line endings survive)');
});

// --- sanitizePublicText: absolute paths -------------------------------------

test('sanitizePublicText replaces absolute vault root/parent with <vault>', () => {
  const winOptions = { root: WIN_ROOT, parent: WIN_PARENT };
  const posixOptions = { root: POSIX_ROOT, parent: POSIX_PARENT };
  const winSuffix = ['20_Digest', 'note.md'].join('\\');
  const rows = [
    [
      `body ${WIN_ROOT}\\${winSuffix}`,
      `body ${VAULT_PLACEHOLDER}\\${winSuffix}`,
      winOptions,
      'windows root (backslash form)',
    ],
    [
      `body ${WIN_ROOT.replaceAll('\\', '/')}/20_Digest/note.md`,
      `body ${VAULT_PLACEHOLDER}/20_Digest/note.md`,
      winOptions,
      'windows root (forward-slash form)',
    ],
    [`body ${POSIX_ROOT}/core.md`, `body ${VAULT_PLACEHOLDER}/core.md`, posixOptions, 'posix root'],
    [
      `body ${WIN_PARENT}\\other\\note.md`,
      `body ${VAULT_PLACEHOLDER}\\other\\note.md`,
      winOptions,
      'windows parent dir',
    ],
    [
      `body ${WIN_PARENT.replaceAll('\\', '/')}/other/note.md`,
      `body ${VAULT_PLACEHOLDER}/other/note.md`,
      winOptions,
      'windows parent dir (forward-slash form)',
    ],
    [`body ${POSIX_PARENT}/other/note.md`, `body ${VAULT_PLACEHOLDER}/other/note.md`, posixOptions, 'posix parent dir'],
  ];
  for (const [input, expected, options, why] of rows) {
    assert.equal(sanitizePublicText('20_Digest/note.md', input, options), expected, why);
  }
  // Empty options skip path replacement entirely.
  const untouched = 'path: <vault>/already-placeheld';
  assert.equal(sanitizePublicText('20_Digest/note.md', untouched), untouched);
});

// --- sanitizePublicText: plugin patch --------------------------------------

test('sanitizePublicText placeholds the plugin patch workspaceRoot', () => {
  for (const quote of ["'", '"']) {
    const patch = ['plugins:', '  - id: kb-panel', '    config:', `      workspaceRoot: ${quote}${WIN_ROOT}${quote}`, '      other: 1'].join('\n');
    const sanitized = sanitizePublicText(PLUGIN_PATCH_REL, patch, { root: WIN_ROOT, parent: WIN_PARENT });
    assert.match(sanitized, /^      workspaceRoot: '<path-to-vault>'$/m, `quote ${quote}`);
    assert.equal(sanitized.includes(WIN_ROOT), false, `quote ${quote}: root is gone`);
  }
  // The same text under any other rel keeps the value (only the patch is special).
  const otherRel = sanitizePublicText('_meta/other.yml', ['  workspaceRoot: "' + WIN_ROOT + '"'].join('\n'));
  assert.equal(otherRel.includes(WIN_ROOT), true);
});

// --- sanitizePublicText: markdown-only source stripping ---------------------

test('sanitizePublicText strips raw sources for markdown only', () => {
  const doc = ['---', 'id: x', 'source: raw transcript', '---', 'body'].join('\n');
  assert.equal(
    sanitizePublicText('20_Digest/x.md', doc),
    ['---', 'id: x', '---', 'body'].join('\n'),
    'markdown loses the source line',
  );
  assert.equal(sanitizePublicText('_meta/x.jsonl', doc), doc, 'non-markdown keeps it');
});

// --- sanitizePublicText: combined document ---------------------------------

test('sanitizePublicText cleans a realistic document in one pass', () => {
  const rel = '20_Digest/atoms/2026-10-30-a-0001.md';
  const link = rawSessionLink('2026-10-30-1200');
  const dirty = [
    '---',
    'id: 2026-10-30-a-0001',
    `source: ${link}`,
    'status: active',
    '---',
    '',
    `原文：${link}`,
    `本机路径：${WIN_ROOT}\\20_Digest\\atoms\\2026-10-30-a-0001.md`,
    `会话 ${sessionId('abcdef12', '3456', '7890')}，uuid ${bareUuid(...UUID_GROUPS)}`,
    '控制字符[\u0007]结束',
  ].join('\n');
  const sanitized = sanitizePublicText(rel, dirty, { root: WIN_ROOT, parent: WIN_PARENT });
  assert.equal(sanitized.includes(WIN_ROOT), false, 'absolute root is gone');
  assert.equal(sanitized.includes(rawSessionPath('2026-10-30-1200')), false, 'raw path is gone');
  assert.equal(sanitized.includes(UUID_GROUPS.join('-')), false, 'bare uuid is gone');
  assert.equal(sanitized.includes('\u0007'), false, 'control char is gone');
  assert.match(sanitized, /session-<redacted>/);
  assert.match(sanitized, /<uuid>/);
  // The export invariant: sanitized output always passes the fail-closed gate.
  assert.doesNotThrow(() => assertPublicText(rel, sanitized));
});

// --- assertPublicText -------------------------------------------------------

test('assertPublicText rejects access tokens', () => {
  const rows = [
    [token('gh' + 'p_'), 'classic github token'],
    [token('gh' + 'o_'), 'github oauth token'],
    [token('github_' + 'pat_'), 'fine-grained github token'],
    [token('sk' + '-'), 'sk- style api key'],
  ];
  for (const [secret, why] of rows) {
    assert.throws(() => assertPublicText('20_Digest/x.md', `value: ${secret}`), /访问令牌/, why);
  }
});

test('assertPublicText rejects local user directory paths', () => {
  assert.throws(() => assertPublicText('20_Digest/x.md', `open ${WIN_ROOT}\\x.md`), /本地用户目录/, 'backslash form');
  assert.throws(
    () => assertPublicText('20_Digest/x.md', `open ${WIN_ROOT.replaceAll('\\', '/')}/x.md`),
    /本地用户目录/,
    'forward-slash form',
  );
  assert.doesNotThrow(() => assertPublicText('20_Digest/x.md', `open ${VAULT_PLACEHOLDER}/x.md`), 'placeholder is safe');
});

test('assertPublicText rejects residual runtime identifiers', () => {
  const rows = [
    [`id: ${sessionId('8f9b2dfd77e6')}`, /session UUID/, 'residual session id'],
    [`id: ${bareUuid(...UUID_GROUPS)}`, /session UUID/, 'residual bare uuid'],
    [`file: ${rawSessionPath('2026-11-02-1200')}`, /session UUID/, 'residual raw session path'],
  ];
  for (const [text, pattern, why] of rows) {
    assert.throws(() => assertPublicText('_meta/log.md', text), pattern, why);
  }
});

test('assertPublicText passes benign published prose', () => {
  const rows = [
    '决策 c-1001：10_Raw/ 原文层只增不改，摘要写入 20_Digest/。',
    'AGENTS.md 声明 _meta/state/ 与 10_Raw/ 不进公开快照。',
    '占位符 session-<redacted> 与 <uuid> 不构成泄漏。',
    'c-1001 与 task-17 是普通编号，不是运行时 id。',
    'workspaceRoot 被替换为 <path-to-vault>。',
  ];
  for (const text of rows) {
    assert.doesNotThrow(() => assertPublicText('20_Digest/x.md', text), text);
  }
});
