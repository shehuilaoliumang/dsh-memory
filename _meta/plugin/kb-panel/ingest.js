/**
 * Ingest trigger for the knowledge-base write pipeline (`_meta/schema.md` §5).
 *
 * Why this module exists: until now step 1 (append the turn's transcript to
 * `10_Raw/sessions/...`) only happened when the model remembered to call
 * `kb.mjs append-session`. This module moves the trigger into the Host plugin:
 * every turn boundary. The trigger listens on the documented data model instead
 * of an agent lifecycle hook: `session/event`, filtering `event.type ===
 * 'turn/end'` (post-commit, fire-and-forget, observer failures contained). That
 * keeps the write pipeline off the turn-closing critical path.
 *
 *   step 1  turn/end → read the committed session events since the cursor
 *           → `node _meta/scripts/kb.mjs append-session` (env DSH_SESSION_ID)
 *           → advance and persist the cursor → rebuild the index if needed.
 *   step 2  count turns / track silence → after `idle_seconds` of silence,
 *           `max_delay_seconds` since the window opened, or `every_turns`
 *           turns, run `kb.mjs candidates` (gate + candidates).
 *   step 3  NOT implemented here. When the gate passes, the trigger writes one
 *           contract-complete job line to `_meta/state/judge-queue.jsonl` and
 *           hands it to the optional `judge` seam. The semantic judge (a light
 *           subagent call) is a later consumer of that queue.
 *
 * Invariants:
 *   - The vault is written only through `kb.mjs`; this module never edits notes
 *     and never edits `_meta/*.jsonl` indexes (`rebuild` is the only writer).
 *   - Every side effect is best-effort and contained: a failure is recorded in
 *     state/log and never throws into the session append path.
 *   - Cursors and counters live in `_meta/state/` (git-ignored runtime state),
 *     so a plugin hot-reload resumes instead of re-appending the log.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

export const STATE_VERSION = 1;

export const DEFAULT_INGEST = {
  enabled: true,
  nodePath: '',
  stateDir: '_meta/state',
  pendingMaxChars: 12000,
  appendTimeoutMs: 8000,
  candidatesTimeoutMs: 20000,
  rebuildTimeoutMs: 30000,
  skipSubagentSessions: true,
  judgeQueueMaxPending: 200,
  appendIndex: true,
};

/** Step-3 seam contract. Documented in `_meta/schema.md` §5. */
export const JUDGE_JOB_VERSION = 1;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const MESSAGE_TEXT_LIMIT = 200000;

// ------------------------------------------------------------------ helpers

function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try {
    return JSON.parse(readText(file));
  } catch {
    return undefined;
  }
}

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTime(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoStamp(d = new Date()) {
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * Text of one session message. Sessions store content as blocks; only text
 * blocks belong in the Markdown transcript (reasoning and tool calls do not),
 * and older/derived shapes may still use a plain string.
 */
export function messageText(message) {
  if (!message) return '';
  const content = message.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      parts.push(block.text);
    }
  }
  return parts.join('\n').trim().slice(0, MESSAGE_TEXT_LIMIT);
}

/**
 * Fold the session events of one or more turns into transcript chunks:
 * every user message in order, then the last assistant message carrying text
 * per turn. That last one is the turn's conclusion — the same thing
 * `kb.mjs append-session --role assistant` writes under `## 助手结论`.
 *
 * `chunks[i].seq` is the sequence of the source event, so a partial failure
 * can advance the cursor only past what was actually appended.
 */
export function transcriptChunks(events) {
  const groups = new Map();
  let order = 0;
  let currentTurn = 0;
  const groupOf = (turn) => {
    let group = groups.get(turn);
    if (!group) {
      group = { turn: Number(turn) || 0, order: order++, users: [], assistant: null, hasUser: false };
      groups.set(turn, group);
    }
    return group;
  };

  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event.type !== 'string') continue;
    const data = event.data || {};
    if (event.type === 'turn/start') {
      if (typeof data.turn === 'number') currentTurn = data.turn;
      groupOf(currentTurn);
      continue;
    }
    if (event.type === 'user/message') {
      // Only genuine human input is "conversation raw text". DSH also records
      // runtime-context, time-context, agent-instructions, skill-catalog, goal,
      // model-selection and agent-message injections as `user/message`; writing
      // those into the append-only 10_Raw layer would be permanent pollution.
      //
      // A message with NO `source` is accepted and counted as human, because the
      // alternative — dropping it — could silently lose a real user message from
      // a legacy or third-party path. It is not silent though: `auditUserMessageKinds`
      // reports it as a warning, and `verifyUserBlocks` turns the resulting block
      // mismatch into a `lastWarning` as well.
      if (data.source && data.source.kind !== 'user') continue;
      const text = messageText(data);
      if (!text) continue;
      const group = groupOf(currentTurn);
      group.users.push({ text, seq: event.seq });
      group.hasUser = true;
      continue;
    }
    if (event.type === 'assistant/message') {
      const text = messageText(data.message);
      if (!text) continue;
      const turn = typeof data.turn === 'number' ? data.turn : currentTurn;
      groupOf(turn).assistant = { text, seq: event.seq };
    }
  }

  const ordered = [...groups.values()].sort((a, b) => a.order - b.order);
  const chunks = [];
  for (const group of ordered) {
    for (const user of group.users) chunks.push({ role: 'user', text: user.text, seq: user.seq, turn: group.turn, hasUser: true });
    if (group.assistant) {
      chunks.push({ role: 'assistant', text: group.assistant.text, seq: group.assistant.seq, turn: group.turn, hasUser: group.hasUser });
    }
  }
  return chunks;
}

/** A short, stable ASCII slug for a new session note (kb.mjs slugifies it too). */
export function sessionSlug(sessionId) {
  const clean = String(sessionId || '')
    .replace(/^session-/, '')
    .replace(/[^a-zA-Z0-9]+/g, '');
  return `session-${(clean || 'unknown').slice(0, 12)}`.toLowerCase();
}

/**
 * Title for a new session note: first non-empty line, at most 30 characters and
 * never cut inside a token when a punctuation/space boundary exists near the
 * limit. The cap stays at 30 because kb.mjs derives `summary` from the title and
 * a catalog row must stay inside the 300-byte budget (schema §7).
 */
export function sessionTitle(firstUserText, when = new Date()) {
  const line = String(firstUserText || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean);
  if (!line) return `会话 ${localDate(when)} ${localTime(when)}`;
  const chars = [...line];
  let title = chars.slice(0, 30).join('').trimEnd();
  if (chars.length > 30) {
    const boundary = Math.max(
      ...['：', ':', '，', ',', '。', '；', ';', '！', '!', '？', '?', ' ', '\t']
        .map((mark) => title.lastIndexOf(mark)),
    );
    if (boundary >= 8) title = title.slice(0, boundary);
  }
  title = title.replace(/[\s：:，,。；;！!？?]+$/u, '').trim();
  return title || `会话 ${localDate(when)} ${localTime(when)}`;
}

/**
 * `user/message` source kinds the Host is known to write. Only `user` is human
 * text; the rest are injections (or team traffic) and must stay out of the
 * append-only raw layer. Any kind outside this set is *audited* (reported as a
 * warning, never written) so a new Host delivery kind cannot pass silently —
 * the whitelist default is "drop", the recoverable error direction.
 */
export const KNOWN_USER_MESSAGE_KINDS = new Set([
  'user',
  'agent-instructions',
  'runtime-context',
  'skill-catalog',
  'time-context',
  'goal',
  'model-selection',
  'agent-message',
  'subagent-settled',
  'tool-registry',
  'system-prompt',
]);

/**
 * Structural block parser for a raw session note. Only exact `## 用户` /
 * `## 助手结论` heading lines delimit blocks; fenced code is skipped so a
 * quoted example cannot be mistaken for a real block. Everything else stays
 * inside the current block (assistant conclusions legitimately contain
 * sub-headings).
 */
export function parseNoteBlocks(text) {
  const blocks = [];
  let fence = null;
  let current = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
      if (current) current.lines.push(line);
      continue;
    }
    if (!fence) {
      const heading = /^## (用户|助手结论)\s*$/.exec(line);
      if (heading) {
        current = { role: heading[1] === '用户' ? 'user' : 'assistant', lines: [] };
        blocks.push(current);
        continue;
      }
    }
    if (current) current.lines.push(line);
  }
  return blocks.map((block) => ({ role: block.role, text: block.lines.join('\n').trim() }));
}

export function countUserBlocks(text) {
  return parseNoteBlocks(text).filter((block) => block.role === 'user').length;
}

/**
 * Assistant conclusions may contain line-start `##` sub-headings of their own.
 * Demote them to `###` at write time so the raw note keeps exactly two block
 * levels and structural parsing/counting stays reliable. User text is written
 * verbatim — never rewritten.
 */
export function demoteAssistantHeadings(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => (/^##(?=\s)/.test(line) ? `###${line.slice(2)}` : line))
    .join('\n');
}

/** Locate a Node runtime. Never shell out for this: the Host may be Electron. */
export function resolveNode(config = {}, env = process.env, platform = process.platform) {
  const explicit = [config.nodePath, env.DSH_NODE_PATH].find((value) => typeof value === 'string' && value.trim());
  if (explicit) return { command: explicit.trim(), env: {} };

  // The Host process does not necessarily inherit DSH_* variables (they are
  // rebuilt for model shells), so an explicit `home` from the caller wins.
  const home =
    (typeof config.home === 'string' && config.home.trim()) ||
    env.DSH_HOME ||
    path.join(env.USERPROFILE || env.HOME || os.homedir(), '.dsh');
  const runtimes = path.join(home, 'dsh-runtimes');
  try {
    for (const name of fs.readdirSync(runtimes)) {
      const exe = path.join(runtimes, name, 'dependencies', 'node', 'bin', platform === 'win32' ? 'node.exe' : 'node');
      if (fs.existsSync(exe)) return { command: exe, env: { DSH_HOME: home } };
    }
  } catch {
    /* no managed runtimes — fall through to the process itself */
  }

  const base = path.basename(process.execPath || '').toLowerCase();
  if (base === 'node' || base === 'node.exe') return { command: process.execPath, env: {} };
  // Desktop Host is Electron; this makes its binary behave as plain Node.
  return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
}

/** Spawn a process, collect capped stdio, enforce a timeout, never throw. */
export function runProcess(command, args, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15000;
  const limit = Number(options.outputLimit) > 0 ? Number(options.outputLimit) : 200000;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: String(error && error.message ? error.message : error), timedOut: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      finish({ code: -1, stdout, stderr: `${stderr}\ntimed out after ${timeoutMs}ms`, timedOut: true });
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on('data', (chunk) => {
      if (stdout.length < limit) stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < limit) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => finish({ code: -1, stdout, stderr: String(error && error.message ? error.message : error), timedOut: false }));
    child.on('close', (code) => finish({ code: code === null ? -1 : code, stdout, stderr, timedOut: false }));
  });
}

// --------------------------------------------------------------- ingestor

/**
 * Build the trigger. `deps` is explicit so the module can be driven from a
 * test with a fake agent/session and a fake executor:
 *
 *   root        vault root (absolute)
 *   isKbSession (session) => boolean — MUST be the panel's own modeOf predicate
 *   now         () => Date
 *   exec        ({ command, args, env, cwd, timeoutMs }) => Promise<{code,stdout,stderr,timedOut}>
 *   log         (line) => void
 *   setTimer / clearTimer, optional timer injection
 *   judge       optional step-3 seam: async (job) => unknown
 */
export function createIngestor(deps) {
  const root = path.resolve(deps.root);
  const exec = deps.exec || ((spec) => runProcess(spec.command, spec.args, spec));
  // Project stores do not ship their own copy of the engine. `kbScript` plus
  // `globalArgs` let one engine serve both the legacy vault and external
  // project roots (`kb.mjs --root <store> ...`). Legacy callers leave both
  // unset, so their command lines stay byte-for-byte unchanged.
  const kbScript = deps.kbScript || path.join(root, '_meta', 'scripts', 'kb.mjs');
  const globalArgs = Array.isArray(deps.globalArgs) ? deps.globalArgs : [];
  const kbArgs = (args) => [kbScript, ...globalArgs, ...args];
  const now = deps.now || (() => new Date());
  const log = typeof deps.log === 'function' ? deps.log : () => {};
  const setTimer = deps.setTimer || ((fn, ms) => setTimeout(fn, Math.max(0, ms)));
  const clearTimer = deps.clearTimer || ((handle) => clearTimeout(handle));

  const pluginConfig = deps.config || {};
  const configCache = { mtimeMs: -1, value: {} };
  const rawSessionCache = new Map();
  const timers = new Map(); // sessionId → { idle, max }
  const inflight = new Set(); // sessionIds with a running extraction
  const tmpSerial = { n: 0 };

  let state = emptyState();
  let disposed = false;
  let node = resolveNode(pluginConfig, process.env, process.platform);
  let lastError = null;
  /**
   * Epoch ms of this host boot, set only when the cursor state was missing or
   * unusable (the whole `_meta/state/` dir is gitignored runtime state, so a
   * revert/clean/machine switch can remove it). Losing cursors must never
   * replay history: when this is set, a session starts at the first event
   * committed after boot and older turns are deliberately dropped — 宁漏不重.
   */
  let bootBaselineAt = 0;

  function emptyState() {
    return { v: STATE_VERSION, sessions: {} };
  }

  const stateDir = () => path.join(root, config().ingest.stateDir || DEFAULT_INGEST.stateDir);
  const stateFile = () => path.join(stateDir(), 'ingest-state.json');
  const pendingDir = () => path.join(stateDir(), 'pending');
  const tmpDir = () => path.join(stateDir(), 'tmp');
  const queueFile = () => path.join(stateDir(), 'judge-queue.jsonl');
  const sessionStateFile = (sessionId) => path.join(pendingDir(), `${safeId(sessionId)}.md`);

  function safeId(value) {
    return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'session';
  }

  /** Live parameters: `_meta/config.json` wins, plugin config fills the gaps. */
  function config() {
    let mtimeMs = -1;
    try {
      mtimeMs = fs.statSync(path.join(root, '_meta', 'config.json')).mtimeMs;
    } catch {
      mtimeMs = -1;
    }
    if (mtimeMs !== configCache.mtimeMs) {
      configCache.mtimeMs = mtimeMs;
      configCache.value = readJson(path.join(root, '_meta', 'config.json')) || {};
    }
    const file = configCache.value || {};
    const ingest = { ...DEFAULT_INGEST, ...(pluginConfig.ingest || {}), ...(file.ingest || {}) };
    const extract = { ...(file.extract || {}) };
    return {
      raw: file,
      ingest,
      extract: {
        idleSeconds: numberOr(extract.idle_seconds, 300),
        maxDelaySeconds: numberOr(extract.max_delay_seconds, 1200),
        everyTurns: numberOr(extract.every_turns, 20),
        triggerWords: Array.isArray(extract.trigger_words) ? extract.trigger_words : [],
        metaKeywords: Array.isArray(extract.meta_keywords) ? extract.meta_keywords : [],
        metaThreshold: numberOr(extract.meta_threshold, 2),
      },
      judge: file.judge || {},
      paths: {
        sessions: (file.paths && file.paths.sessions) || '10_Raw/sessions',
        catalog: (file.paths && file.paths.catalog) || '_meta/catalog.jsonl',
      },
    };
  }

  function numberOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  /** Count distinct KB-construction keywords in one pending window. */
  function metaKeywordHits(text, words) {
    if (!text || !Array.isArray(words)) return 0;
    const hits = new Set();
    for (const word of words) {
      if (typeof word === 'string' && word && text.includes(word)) hits.add(word);
    }
    return hits.size;
  }

  // ------------------------------------------------------ persisted state

  function loadState() {
    const stored = readJson(stateFile());
    if (!stored || stored.v !== STATE_VERSION || typeof stored.sessions !== 'object' || !stored.sessions) {
      state = emptyState();
      // No trustworthy cursors: default to "from now", never replay.
      bootBaselineAt = now().getTime();
      return;
    }
    state = stored;
    bootBaselineAt = 0;
    // Upgrade entries written by the pre-self-check version: without this
    // migration the first verification would compare against the whole session
    // history and report a false "missing user block" for old sessions.
    for (const entry of Object.values(state.sessions)) {
      if (!entry || typeof entry !== 'object') continue;
      if (entry.trackFromSeq === undefined || entry.trackFromSeq === null) {
        entry.trackFromSeq = Number.isFinite(Number(entry.cursor)) ? Number(entry.cursor) : 0;
        entry.takeoverUserBlocks = 0;
        if (entry.sessionFile) {
          try {
            entry.takeoverUserBlocks = countUserBlocks(readText(entry.sessionFile));
          } catch {
            entry.takeoverUserBlocks = 0;
          }
        }
      }
      if (!Array.isArray(entry.written)) entry.written = [];
      if (entry.check === undefined) entry.check = null;
      if (entry.lastWarning === undefined) entry.lastWarning = null;
    }
  }

  function saveState() {
    try {
      writeJsonAtomic(stateFile(), state);
    } catch (error) {
      log(`[kb-ingest] state write failed: ${errorText(error)}`);
    }
  }

  function sessionState(sessionId) {
    let entry = state.sessions[sessionId];
    if (!entry) {
      entry = {
        cursor: null,
        turns: 0,
        lastTurn: 0,
        lastTurnAt: 0,
        turnsSince: 0,
        firstPendingAt: 0,
        pendingChars: 0,
        sessionFile: null,
        resumeTurn: 0,
        trackFromSeq: null,
        takeoverUserBlocks: 0,
        written: [],
        check: null,
        lastWarning: null,
        lastAppendAt: null,
        lastExtractAt: null,
        lastJobId: null,
        lastGate: null,
        lastError: null,
        retryAfter: 0,
        skipped: null,
      };
      state.sessions[sessionId] = entry;
    }
    return entry;
  }

  // ------------------------------------------------------------ step one

  /** Existing raw note for a session, if the model (or an older run) wrote one. */
  function findRawSession(sessionId) {
    if (rawSessionCache.has(sessionId)) return rawSessionCache.get(sessionId);
    const bare = String(sessionId).replace(/^session-/, '');
    const base = path.join(root, config().paths.sessions);
    let hit = null;
    const walk = (dir) => {
      if (hit) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (hit) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
          let text;
          try {
            text = readText(full);
          } catch {
            continue;
          }
          const match = text.match(FRONTMATTER);
          if (!match) continue;
          const idLine = match[1].match(/^session_id:\s*(.+)$/m);
          if (!idLine) continue;
          const stored = idLine[1].trim().replace(/^["']|["']$/g, '');
          if (stored === sessionId || stored === bare) hit = full;
        }
      }
    };
    walk(base);
    rawSessionCache.set(sessionId, hit);
    return hit;
  }

  /**
   * One-time takeover of an existing (hand-written or legacy) note: match the
   * note's last structural block against a folded chunk by role + exact text,
   * then continue right after it. No substring matching — a quote inside an
   * assistant conclusion must not look like already-written content. If no
   * block matches, start from the current seq (宁漏不重).
   */
  function cursorFromExistingNote(file, session, liveStart) {
    let note = '';
    try {
      note = readText(file);
    } catch {
      return { cursor: liveStart, turn: 0, blocks: 0, matched: false };
    }
    const blocks = parseNoteBlocks(note);
    if (!blocks.length) return { cursor: liveStart, turn: 0, blocks: 0, matched: false };
    const chunks = transcriptChunks(session.snapshotEvents(liveStart));
    for (let b = blocks.length - 1; b >= 0; b -= 1) {
      for (let i = chunks.length - 1; i >= 0; i -= 1) {
        if (chunks[i].role !== blocks[b].role) continue;
        if (chunks[i].text.trim() !== blocks[b].text) continue;
        const seq = Number(chunks[i].seq);
        return {
          cursor: Number.isFinite(seq) ? seq + 1 : liveStart,
          // The note stopped mid-turn: the rest of this turn (including its
          // conclusion) still belongs in the file.
          turn: Number(chunks[i].turn) || 0,
          blocks: blocks.length,
          matched: true,
        };
      }
    }
    return { cursor: liveStart, turn: 0, blocks: blocks.length, matched: false };
  }

  /**
   * First seq whose event was committed at/after the boot baseline. Returning
   * `session.seq` when every event predates the boot deliberately skips this
   * turn — the "宁漏不重" side of the tradeoff.
   */
  function baselineCursor(session, baselineAt) {
    let events = [];
    try {
      events = session.snapshotEvents(0);
    } catch {
      return Number(session.seq) || 0;
    }
    for (const event of events) {
      if (Number(event && event.time) >= baselineAt) return Number(event.seq);
    }
    return Number(session.seq) || 0;
  }

  function writeTmpText(sessionId, text) {
    ensureDir(tmpDir());
    const file = path.join(tmpDir(), `${safeId(sessionId)}-${process.pid}-${++tmpSerial.n}.md`);
    fs.writeFileSync(file, text, 'utf8');
    return file;
  }

  async function appendChunk(sessionId, entry, chunk, context) {
    const cfg = config();
    // User text is verbatim; assistant conclusions get their line-start `##`
    // demoted so the note keeps exactly two structural heading levels.
    const text = chunk.role === 'assistant' ? demoteAssistantHeadings(chunk.text) : chunk.text;
    const textFile = writeTmpText(sessionId, text);
    try {
      const result = await exec({
        command: node.command,
        args: kbArgs([
          'append-session',
          '--slug',
          context.slug,
          '--title',
          context.title,
          '--role',
          chunk.role,
          '--text-file',
          textFile,
          '--json',
        ]),
        cwd: root,
        env: { ...process.env, ...node.env, DSH_SESSION_ID: sessionId },
        timeoutMs: cfg.ingest.appendTimeoutMs,
      });
      if (result.code !== 0) {
        throw new Error(`append-session exited ${result.code}: ${(result.stderr || result.stdout || '').trim().slice(0, 400)}`);
      }
      const line = `${result.stdout || ''}`.trim();
      let reported = null;
      try {
        const payload = JSON.parse(line);
        if (payload && typeof payload.file === 'string' && payload.file.endsWith('.md')) reported = payload.file;
      } catch {
        /* Older kb.mjs / a wrapper may still print the human line. */
      }
      if (!reported) {
        const match = line.match(/(?:已新建并写入|已追加到)\s+(\S+?\.md)/);
        if (match) reported = match[1];
      }
      if (reported) {
        entry.sessionFile = path.join(root, reported.split('/').join(path.sep));
        rawSessionCache.set(sessionId, entry.sessionFile);
      } else {
        // The note was written but its path could not be parsed; drop the
        // negative cache so the next lookup can still find it.
        rawSessionCache.delete(sessionId);
      }
      entry.lastAppendAt = isoStamp(now());
      return { file: entry.sessionFile };
    } finally {
      try {
        fs.rmSync(textFile, { force: true });
      } catch {
        /* best effort */
      }
    }
  }

  function isWritten(entry, chunk) {
    return (
      Array.isArray(entry.written) &&
      entry.written.some((item) => item && item.role === chunk.role && Number(item.seq) === Number(chunk.seq))
    );
  }

  /** Audit unknown `user/message` kinds: never write them, never stay silent. */
  function auditUserMessageKinds(events, entry) {
    const unknown = new Map();
    let unsourced = 0;
    for (const event of events) {
      if (!event || event.type !== 'user/message') continue;
      const kind = event.data && event.data.source && event.data.source.kind;
      if (!kind) {
        // No source at all is treated as human text (see transcriptChunks), but
        // it must never be silent: report it so a real policy question surfaces.
        unsourced += 1;
        continue;
      }
      if (KNOWN_USER_MESSAGE_KINDS.has(kind)) continue;
      unknown.set(kind, (unknown.get(kind) || 0) + 1);
    }
    if (unknown.size) {
      entry.lastWarning = `未知 user/message kind：${[...unknown.keys()].join(', ')}（未写入，需人工确认是否真人投递）`;
      log(`[kb-ingest] ${entry.lastWarning}`);
    }
    if (unsourced) {
      const note = `user/message 缺 source 共 ${unsourced} 条，已按真人文本写入（需确认来源）`;
      entry.lastWarning = entry.lastWarning ? `${entry.lastWarning}；${note}` : note;
      log(`[kb-ingest] ${note}`);
    }
    return unknown.size + unsourced;
  }

  /**
   * Post-write invariant: user blocks written since takeover must equal the
   * number of human `user/message` events since the tracked start. Counting is
   * structural (fenced code skipped); a shortfall becomes `lastError` instead
   * of a silent gap. Extra blocks (manual appends) are reported as a warning
   * only, because they cannot be distinguished from legitimate hand edits.
   */
  function verifyUserBlocks(session, entry, sessionId) {
    try {
      let actual = 0;
      if (entry.sessionFile) {
        try {
          actual = Math.max(0, countUserBlocks(readText(entry.sessionFile)) - (Number(entry.takeoverUserBlocks) || 0));
        } catch {
          actual = 0;
        }
      }
      const from = Number(entry.trackFromSeq) || 0;
      const events = session.snapshotEvents(0);
      const humanEvents = events.filter(
        (event) =>
          event &&
          event.type === 'user/message' &&
          event.data &&
          event.data.source &&
          event.data.source.kind === 'user' &&
          Number(event.seq) >= from,
      );
      const expected = humanEvents.length;
      const previous = entry.check;
      entry.check = { expected, actual, ok: actual === expected, at: isoStamp(now()) };
      if (actual < expected) {
        // Name the suspect instead of only reporting a count: a bare "9 / 10"
        // cannot distinguish real loss from a baseline off-by-one.
        let detail = '';
        try {
          const squash = (value) => String(value || '').replace(/\s+/g, '');
          const noteText = entry.sessionFile ? squash(readText(entry.sessionFile)) : '';
          const missing = humanEvents
            .map((event) => messageText(event.data))
            .filter(Boolean)
            .filter((text) => !noteText.includes(squash(text).slice(0, 24)))
            .slice(0, 2);
          detail = missing.length
            ? `；疑似缺失：${missing.map((text) => `「${text.replace(/\s+/g, ' ').slice(0, 30)}」`).join('、')}`
            : '；文件里找不到任何缺失文本，可能是计数基线偏差';
        } catch {
          /* keep the plain count */
        }
        const message = `用户块缺失：raw ${actual} / 会话真人消息 ${expected}（${sessionId}）${detail}`;
        // One observation can be a transient read/append interleaving, so escalate
        // only when the shortfall survives a second turn boundary.
        const streak = (Number(entry.checkShortfall) || 0) + 1;
        entry.checkShortfall = streak;
        if (streak < 2) {
          entry.lastError = null;
          entry.lastWarning = `用户块疑似缺失（首次观测，下一次落盘复核）：raw ${actual} / ${expected}${detail}`;
          log(`[kb-ingest] ${entry.lastWarning}`);
        } else {
          entry.lastError = message;
          log(`[kb-ingest] ${entry.lastError}`);
        }
      } else if (actual > expected) {
        entry.checkShortfall = 0;
        entry.lastWarning = `用户块多于会话真人消息：raw ${actual} / ${expected}（可能含手工块，已记录）`;
      } else {
        entry.checkShortfall = 0;
        if (entry.lastError && String(entry.lastError).startsWith('用户块缺失')) entry.lastError = null;
      }
      return { previous, current: entry.check };
    } catch (error) {
      entry.lastWarning = `用户块自检失败：${errorText(error)}`;
      return { previous: entry.check, current: entry.check };
    }
  }

  /**
   * Step 1: append every not-yet-recorded message of this session's live log.
   * The cursor is the single authority for what was already written; the only
   * text comparison is the one-time takeover of an existing note
   * (`cursorFromExistingNote`, structural and role-aware). A partial failure is
   * retried by identity (`written` = role+seq), never by substring matching.
   */
  async function appendNewEvents(sessionId, session, entry) {
    const cfg = config();
    const liveStart = numberOr(session.firstLiveSeq, 0) || 0;
    if (entry.cursor === null || entry.cursor === undefined || typeof entry.cursor !== 'number') {
      const existing = findRawSession(sessionId);
      if (existing) entry.sessionFile = existing;
      if (bootBaselineAt > 0) {
        // Cursor state was lost: start at the first event committed after this
        // host boot. Never content-resume here — a note restored by a revert
        // must not be appended to from history we can no longer vouch for.
        entry.cursor = baselineCursor(session, bootBaselineAt);
        if (existing) {
          try {
            entry.takeoverUserBlocks = countUserBlocks(readText(existing));
          } catch {
            entry.takeoverUserBlocks = 0;
          }
        }
        entry.recoveredAt = isoStamp(now());
      } else if (existing) {
        // State is intact but this session was not tracked yet (e.g. a manual
        // `append-session` ran before the trigger saw it). One-time takeover of
        // the note; after this the cursor is trusted and no text is matched.
        const resumed = cursorFromExistingNote(existing, session, liveStart);
        entry.takeoverUserBlocks = resumed.blocks;
        if (resumed.matched) {
          entry.cursor = resumed.cursor;
          entry.resumeTurn = resumed.turn;
        } else {
          // Unrecognised existing note: never replay history (宁漏不重).
          entry.cursor = Number(session.seq) || liveStart;
          entry.recoveredAt = isoStamp(now());
        }
      } else {
        entry.cursor = liveStart;
        entry.takeoverUserBlocks = 0;
      }
      entry.trackFromSeq = Number(entry.cursor) || 0;
      saveState();
    }
    if (!Array.isArray(entry.written)) entry.written = [];

    const fromSeq = Number(entry.cursor) || 0;
    const toSeq = Number(session.seq) || fromSeq;
    if (toSeq <= fromSeq) return { appended: 0, skipped: 0, chunks: [] };

    const events = session.snapshotEvents(fromSeq);
    auditUserMessageKinds(events, entry);
    const allChunks = transcriptChunks(events);
    // Turn-groups without a human message are automated rounds (goal
    // continuation, injected reminders). They are not conversation raw text —
    // except when they continue the turn we already captured (a steered turn
    // can add one more conclusion).
    const lastTurn = Number(entry.lastTurn) || 0;
    const resumeTurn = Number(entry.resumeTurn) || 0;
    const chunks = allChunks.filter(
      (chunk) => chunk.hasUser || chunk.turn === lastTurn || chunk.turn === resumeTurn,
    );
    if (!allChunks.length) {
      entry.cursor = toSeq;
      saveState();
      return { appended: 0, skipped: 0, chunks: [] };
    }
    if (!chunks.length) {
      // Only automated rounds in this slice: nothing for the raw layer, but the
      // cursor still moves so they are not rescanned.
      entry.cursor = toSeq;
      saveState();
      return { appended: 0, skipped: 0, chunks: [] };
    }

    const pendingChunks = chunks.filter((chunk) => !isWritten(entry, chunk));
    const skipped = chunks.length - pendingChunks.length;
    if (!pendingChunks.length) {
      entry.cursor = toSeq;
      entry.resumeTurn = 0;
      entry.written = [];
      entry.lastError = null;
      saveState();
      verifyUserBlocks(session, entry, sessionId);
      saveState();
      return { appended: 0, skipped, chunks };
    }

    const firstUser = chunks.find((chunk) => chunk.role === 'user');
    const context = {
      slug: entry.slug || (entry.slug = sessionSlug(sessionId)),
      title: entry.title || (entry.title = sessionTitle(firstUser ? firstUser.text : '', now())),
    };

    let appended = 0;
    let reached = fromSeq;
    for (const chunk of pendingChunks) {
      if (disposed) break;
      // On throw the cursor does not move; `written` keeps the successful
      // chunks so the retry appends only what is still missing.
      await appendChunk(sessionId, entry, chunk, context);
      entry.written.push({ role: chunk.role, seq: Number(chunk.seq) });
      appended += 1;
      if (Number.isFinite(Number(chunk.seq))) reached = Math.max(reached, Number(chunk.seq) + 1);
      saveState();
    }
    if (disposed) {
      // Keep `written` for the next process; only move the cursor past what was
      // actually appended.
      entry.cursor = Math.max(fromSeq, reached);
      saveState();
      return { appended, skipped, chunks };
    }
    entry.cursor = toSeq;
    entry.resumeTurn = 0;
    entry.written = [];
    entry.lastError = null;
    saveState();
    if (appended && cfg.ingest.appendIndex !== false) await rebuildIfStale(entry);
    verifyUserBlocks(session, entry, sessionId);
    saveState();
    return { appended, skipped, chunks };
  }

  /** Keep the derived index consistent with the raw note (schema §7, §11). */
  async function rebuildIfStale(entry) {
    if (!entry.sessionFile) return false;
    const cfg = config();
    const rel = path.relative(root, entry.sessionFile).split(path.sep).join('/');
    const today = localDate(now());
    const rows = readJsonl(path.join(root, cfg.paths.catalog));
    const row = rows.find((candidate) => candidate && candidate.path === rel);
    if (row && row.updated === today) return false;
    const result = await exec({
      command: node.command,
      args: kbArgs(['rebuild']),
      cwd: root,
      env: { ...process.env, ...node.env },
      timeoutMs: cfg.ingest.rebuildTimeoutMs,
    });
    if (result.code !== 0) throw new Error(`rebuild exited ${result.code}: ${(result.stderr || '').trim().slice(0, 300)}`);
    return true;
  }

  // ------------------------------------------------------------ step two

  function readJsonl(file) {
    try {
      return readText(file)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /** Append this turn's text to the window that a later extraction reads. */
  function accumulatePending(sessionId, entry, chunks) {
    const cfg = config();
    const max = cfg.ingest.pendingMaxChars;
    if (!chunks.length) return;
    const file = sessionStateFile(sessionId);
    ensureDir(pendingDir());
    let current = '';
    try {
      current = readText(file);
    } catch {
      current = '';
    }
    const added = chunks
      .map((chunk) => `${chunk.role === 'user' ? '## 用户' : '## 助手结论'}\n\n${chunk.text}`)
      .join('\n\n');
    let next = `${current}${current ? '\n\n' : ''}${added}`;
    if (next.length > max) {
      const dropped = next.length - max;
      next = next.slice(next.length - max);
      entry.lastWarning = `pending 窗口超限，丢弃最旧 ${dropped} 字符（保留最近 ${max}）`;
      log(`[kb-ingest] ${sessionId} ${entry.lastWarning}`);
    }
    fs.writeFileSync(file, next, 'utf8');
    entry.pendingChars = next.length;
  }

  function clearPending(sessionId, entry) {
    try {
      fs.rmSync(sessionStateFile(sessionId), { force: true });
    } catch {
      /* best effort */
    }
    entry.pendingChars = 0;
  }

  function cancelTimers(sessionId) {
    const held = timers.get(sessionId);
    if (!held) return;
    if (held.idle) clearTimer(held.idle);
    if (held.max) clearTimer(held.max);
    timers.delete(sessionId);
  }

  function armTimers(sessionId, entry) {
    const cfg = config();
    cancelTimers(sessionId);
    if (entry.turnsSince <= 0) return;
    const current = now().getTime();
    // After a failed extraction the window is restored; wait out the retry
    // floor instead of spinning at 0ms.
    const retryFloor = Math.max(current, Number(entry.retryAfter) || 0);
    const idleAt = Math.max((Number(entry.lastTurnAt) || current) + cfg.extract.idleSeconds * 1000, retryFloor);
    const maxAt = Math.max((Number(entry.firstPendingAt) || current) + cfg.extract.maxDelaySeconds * 1000, retryFloor);
    const held = {};
    held.idle = setTimer(() => {
      // Clear both timers of this window: whichever fires first owns the window.
      cancelTimers(sessionId);
      runExtraction(sessionId, 'idle');
    }, Math.max(0, idleAt - current));
    held.max = setTimer(() => {
      cancelTimers(sessionId);
      runExtraction(sessionId, 'max-delay');
    }, Math.max(0, maxAt - current));
    timers.set(sessionId, held);
  }

  /** Step 2 trigger point: schedule from the config file, never from a prompt. */
  function schedule(sessionId, entry) {
    const cfg = config();
    if (entry.retryAfter && now().getTime() < Number(entry.retryAfter)) {
      armTimers(sessionId, entry);
      return;
    }
    if (entry.turnsSince >= cfg.extract.everyTurns) {
      cancelTimers(sessionId);
      runExtraction(sessionId, 'every-turns');
      return;
    }
    armTimers(sessionId, entry);
  }

  async function runExtraction(sessionId, cause) {
    if (disposed || inflight.has(sessionId) || config().ingest.enabled === false) return;
    const entry = state.sessions[sessionId];
    if (!entry || entry.turnsSince <= 0) return;
    inflight.add(sessionId);
    cancelTimers(sessionId);
    let claim = null;
    let rescheduled = false;
    try {
      ensureDir(tmpDir());
      claim = path.join(tmpDir(), `claim-${safeId(sessionId)}-${++tmpSerial.n}.md`);
      // Claim the pending window atomically: turns that land during the
      // extraction append to a fresh pending file and are not lost.
      const pending = sessionStateFile(sessionId);
      let text = '';
      try {
        fs.renameSync(pending, claim);
        text = readText(claim);
      } catch {
        text = '';
      }
      const claimedTurns = Number(entry.turnsSince) || 0;
      const result = await extractWindow(sessionId, entry, text, cause);
      if (disposed) return;
      entry.lastExtractAt = isoStamp(now());
      entry.lastGate = result.gate || null;
      entry.lastJobId = result.jobId || entry.lastJobId;
      entry.lastError = null;
      entry.retryAfter = 0;
      // Turns that arrived while the judge window was being claimed belong to
      // the next window: keep their counter, or they would never be extracted.
      if ((Number(entry.turnsSince) || 0) === claimedTurns) {
        entry.turnsSince = 0;
        entry.firstPendingAt = 0;
        entry.pendingChars = 0;
      } else {
        rescheduled = true;
        entry.pendingChars = textLengthOf(sessionStateFile(sessionId));
      }
      saveState();
    } catch (error) {
      // Never drop a claimed window: put it back so the next schedule retries
      // it. Anything written by newer turns is appended after the restored text.
      restoreWindow(sessionId, claim, entry);
      entry.lastError = errorText(error);
      entry.retryAfter = now().getTime() + 60000;
      saveState();
      log(`[kb-ingest] extract failed for ${sessionId}: ${entry.lastError}`);
    } finally {
      try {
        if (claim) {
          // A hot reload while the window is claimed: hand the text back rather
          // than deleting it, so the replacement instance can still extract it.
          if (disposed) restoreWindow(sessionId, claim, entry);
          fs.rmSync(claim, { force: true });
        }
      } catch {
        /* best effort */
      }
      inflight.delete(sessionId);
      if (!disposed) {
        if (rescheduled) schedule(sessionId, entry);
        else if (Number(entry.retryAfter) > now().getTime()) armTimers(sessionId, entry);
      }
    }
  }

  /** Merge a claimed window back into the pending file (newest text wins). */
  function restoreWindow(sessionId, claim, entry) {
    if (!claim) return;
    try {
      const claimed = readText(claim);
      let fresh = '';
      try {
        fresh = readText(sessionStateFile(sessionId));
      } catch {
        fresh = '';
      }
      const merged = `${claimed}${claimed && fresh ? '\n\n' : ''}${fresh}`;
      const max = config().ingest.pendingMaxChars;
      ensureDir(pendingDir());
      fs.writeFileSync(sessionStateFile(sessionId), merged.slice(-max), 'utf8');
      entry.pendingChars = Math.min(merged.length, max);
    } catch {
      /* restore is best effort */
    }
  }

  function textLengthOf(file) {
    try {
      return readText(file).length;
    } catch {
      return 0;
    }
  }

  async function extractWindow(sessionId, entry, text, cause) {
    const cfg = config();
    if (!text.trim()) return { gate: { skip: true, reason: '窗口内没有文本' } };

    // Phase 0 guard: building this knowledge base is itself a construction log,
    // not a memory to keep. Freeze extraction before any candidate/judge work;
    // the raw transcript is still appended by step 1.
    const metaHits = metaKeywordHits(text, cfg.extract.metaKeywords);
    if (metaHits >= cfg.extract.metaThreshold) {
      return {
        gate: {
          skip: true,
          reason: `知识库建设窗口（命中 ${metaHits} 个元关键词，阈值 ${cfg.extract.metaThreshold}），Phase 0 冻结抽取`,
        },
      };
    }

    // Step 2 rule layer: the gate and candidate extraction already live in
    // kb.mjs. The file form keeps the payload off the Windows command line.
    const inputFile = path.join(tmpDir(), `candidates-${safeId(sessionId)}-${++tmpSerial.n}.md`);
    ensureDir(tmpDir());
    fs.writeFileSync(inputFile, text, 'utf8');
    let stdout;
    try {
      const result = await exec({
        command: node.command,
        args: kbArgs(['candidates', '--file', inputFile, '--json']),
        cwd: root,
        env: { ...process.env, ...node.env },
        timeoutMs: cfg.ingest.candidatesTimeoutMs,
      });
      if (result.code !== 0) throw new Error(`candidates exited ${result.code}: ${(result.stderr || '').trim().slice(0, 300)}`);
      stdout = result.stdout || '';
    } finally {
      try {
        fs.rmSync(inputFile, { force: true });
      } catch {
        /* best effort */
      }
    }

    let payload;
    try {
      payload = JSON.parse(stdout);
    } catch {
      throw new Error(`candidates output was not JSON: ${stdout.trim().slice(0, 200)}`);
    }
    if (!payload || !payload.gate || payload.gate.skip) {
      return { gate: (payload && payload.gate) || { skip: true, reason: '门控未通过' } };
    }
    // Gate passed but no candidate line carried a trigger word: nothing for a
    // semantic judge to decide, so do not enqueue an empty job.
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    if (!candidates.length) return { gate: payload.gate, candidates: 0 };

    // ---- step 3 interface -------------------------------------------------
    // The trigger does not call a model. It emits a contract-complete job and
    // stops here; a step-3 worker consumes judge-queue.jsonl (or the optional
    // `judge` seam does the call in-process).
    const job = {
      v: JUDGE_JOB_VERSION,
      kind: 'extract-judge',
      id: `job-${Date.now().toString(36)}-${safeId(sessionId).slice(-8)}`,
      createdAt: isoStamp(now()),
      cause,
      sessionId,
      raw: entry.sessionFile ? path.relative(root, entry.sessionFile).split(path.sep).join('/') : null,
      gate: payload.gate,
      candidates,
      neighbors: [], // step 2 rule layer: neighbor lookup is not wired yet
      judge: cfg.judge,
      status: 'pending',
    };
    await enqueueJudgeJob(job);
    return { gate: payload.gate, jobId: job.id };
  }

  async function enqueueJudgeJob(job) {
    const cfg = config();
    ensureDir(stateDir());
    const pending = readJsonl(queueFile()).filter((line) => line && line.status === 'pending').length;
    if (pending >= cfg.ingest.judgeQueueMaxPending) {
      // Dropping the newest job is the recoverable direction: raw already has
      // the text, and the next window can be re-extracted. Throwing here would
      // requeue the same claimed window forever and block all later windows.
      const message = `judge 队列已有 ${pending} 条待判，丢弃新 job ${job.id}（原文仍在 raw）`;
      log(`[kb-ingest] WARN ${message}`);
      return { ...job, dropped: true, droppedReason: message };
    }
    if (typeof deps.judge === 'function') {
      // In-process seam: a later step-3 implementation can pass a real judge.
      try {
        await deps.judge(job);
        return job;
      } catch (error) {
        job.status = 'judge-error';
        job.judgeError = errorText(error);
      }
    }
    fs.appendFileSync(queueFile(), `${JSON.stringify(job)}\n`, 'utf8');
    const result = await exec({
      command: node.command,
      args: kbArgs([
        'log',
        '--action',
        'extract',
        '--note',
        `${job.sessionId} 候选 ${job.candidates.length} 条 → judge 队列（${job.cause}）`,
      ]),
      cwd: root,
      env: { ...process.env, ...node.env },
      timeoutMs: cfg.ingest.appendTimeoutMs,
    });
    if (result.code !== 0) log(`[kb-ingest] log append failed: ${(result.stderr || '').trim().slice(0, 200)}`);
    return job;
  }

  // ------------------------------------------------------------- surface

  /** sessionId → tail promise, so one session's step-1 work never interleaves. */
  const chains = new Map();

  /**
   * Entry point for `session/event` (the post-commit append feed): only
   * `turn/end` matters. The feed is fire-and-forget and the emitter contains
   * observer failures, but this handler still does O(1) work on the callback
   * path and then runs cursor/append work serially per session.
   */
  async function handleTurnEnd(session, event) {
    if (disposed) return;
    if (!session || !event || event.type !== 'turn/end') return;
    const sessionId = String(session.id || (session.header && session.header.id) || '');
    if (!sessionId) return;
    const previous = chains.get(sessionId) || Promise.resolve();
    const run = previous.then(
      () => handleTurnEndNow(session, event),
      () => handleTurnEndNow(session, event),
    );
    chains.set(sessionId, run);
    try {
      await run;
    } finally {
      if (chains.get(sessionId) === run) chains.delete(sessionId);
    }
  }

  async function handleTurnEndNow(session, event) {
    if (disposed) return;
    if (config().ingest.enabled === false) return;
    try {
      if (typeof deps.isKbSession === 'function' && !deps.isKbSession(session)) return;
      const header = safeHeader(session);
      const sessionId = String(session.id || (session.header && session.header.id) || '');
      if (!sessionId) return;
      if (header && shouldSkipSession(header)) {
        sessionState(sessionId).skipped = header.origin === 'subagent' ? 'subagent' : 'nested';
        return;
      }
      const entry = sessionState(sessionId);
      if (entry.skipped) entry.skipped = null;

      const turn = Number(event.data && event.data.turn);
      const lastTurn = Number(entry.lastTurn) || 0;
      // Turn/end is emitted once per turn, but a duplicate delivery must not
      // append the same turn twice.
      if (Number.isFinite(turn) && turn <= lastTurn) return;

      const appended = await appendNewEvents(sessionId, session, entry);

      const at = now().getTime();
      entry.turns += 1;
      entry.lastTurn = Number.isFinite(turn) ? turn : lastTurn + 1;
      entry.lastTurnAt = at;
      if (!entry.firstPendingAt) entry.firstPendingAt = at;
      entry.turnsSince = (Number(entry.turnsSince) || 0) + 1;
      accumulatePending(sessionId, entry, (appended && appended.chunks) || []);
      saveState();

      if (appended && (appended.appended || appended.skipped)) {
        log(`[kb-ingest] turn ${entry.lastTurn}: written ${appended.appended} / already-written ${appended.skipped} chunk(s) for ${sessionId}`);
      }
      schedule(sessionId, entry);
    } catch (error) {
      lastError = { at: isoStamp(now()), message: errorText(error) };
      try {
        const sid = String((session && (session.id || (session.header && session.header.id))) || '');
        if (sid) {
          const entry = sessionState(sid);
          entry.lastError = lastError.message;
          saveState();
        }
      } catch {
        /* state is best effort too */
      }
      log(`[kb-ingest] turn/end handler failed: ${lastError.message}`);
    }
  }

  function shouldSkipSession(header) {
    if (!header) return false;
    if (config().ingest.skipSubagentSessions === false) return false;
    if (header.origin === 'subagent') return true;
    if (Number(header.delegationDepth) > 0) return true;
    if (header.parentSession) return true;
    return false;
  }

  function safeHeader(session) {
    try {
      return session.header || undefined;
    } catch {
      return undefined;
    }
  }

  function snapshot() {
    const cfg = config();
    const queue = readJsonl(queueFile());
    const sessions = {};
    for (const [sessionId, entry] of Object.entries(state.sessions)) {
      sessions[sessionId] = {
        cursor: entry.cursor,
        turns: entry.turns,
        turnsSince: entry.turnsSince,
        lastTurnAt: entry.lastTurnAt ? new Date(entry.lastTurnAt).toISOString() : null,
        lastExtractAt: entry.lastExtractAt,
        lastAppendAt: entry.lastAppendAt,
        pendingChars: entry.pendingChars,
        raw: entry.sessionFile ? path.relative(root, entry.sessionFile).split(path.sep).join('/') : null,
        skipped: entry.skipped || null,
        lastGate: entry.lastGate || null,
        lastJobId: entry.lastJobId || null,
        lastError: entry.lastError || null,
        lastWarning: entry.lastWarning || null,
        retryAfter: entry.retryAfter || 0,
        check: entry.check || null,
        written: Array.isArray(entry.written) ? entry.written.length : 0,
        takeoverUserBlocks: Number(entry.takeoverUserBlocks) || 0,
        trackFromSeq: entry.trackFromSeq === null || entry.trackFromSeq === undefined ? null : entry.trackFromSeq,
      };
    }
    return {
      enabled: cfg.ingest.enabled !== false,
      workspace: root,
      node: node.command,
      stateDir: path.relative(root, stateDir()).split(path.sep).join('/'),
      parameters: {
        idleSeconds: cfg.extract.idleSeconds,
        maxDelaySeconds: cfg.extract.maxDelaySeconds,
        everyTurns: cfg.extract.everyTurns,
      },
      judge: cfg.judge,
      queue: {
        file: path.relative(root, queueFile()).split(path.sep).join('/'),
        total: queue.length,
        pending: queue.filter((line) => line.status === 'pending').length,
      },
      inflight: [...inflight],
      lastError,
      sessions,
    };
  }

  function start() {
    node = resolveNode(pluginConfig, process.env, process.platform);
    loadState();
    // Persist upgraded entries (trackFromSeq/takeoverUserBlocks migration) so a
    // crash before the first new turn cannot roll the self-check baseline back.
    if (Object.keys(state.sessions).length > 0) saveState();
    if (config().ingest.enabled === false) {
      log('[kb-ingest] disabled by config (ingest.enabled=false); no trigger armed');
      return;
    }
    // Catch up after a reload: timers are process-local, state is not.
    const deadlines = [];
    for (const [sessionId, entry] of Object.entries(state.sessions)) {
      if (!entry || entry.turnsSince <= 0) continue;
      if (entry.skipped) continue;
      const idleAt = (Number(entry.lastTurnAt) || 0) + config().extract.idleSeconds * 1000;
      const maxAt = (Number(entry.firstPendingAt) || 0) + config().extract.maxDelaySeconds * 1000;
      const due = Math.min(idleAt, maxAt) - now().getTime();
      if (due <= 0) deadlines.push(sessionId);
      else armTimers(sessionId, entry);
    }
    // Do the catch-up in small waves; anything past the wave limit is still
    // armed so it fires shortly instead of being dropped on the floor.
    for (const sessionId of deadlines.slice(0, 20)) {
      const entry = state.sessions[sessionId];
      if (entry && entry.turnsSince >= config().extract.everyTurns) runExtraction(sessionId, 'every-turns');
      else runExtraction(sessionId, 'catch-up');
    }
    for (const sessionId of deadlines.slice(20)) {
      const entry = state.sessions[sessionId];
      if (entry) armTimers(sessionId, entry);
    }
    log(`[kb-ingest] started (${node.command}) state=${path.relative(root, stateFile()).split(path.sep).join('/')}`);
  }

  function dispose() {
    disposed = true;
    for (const sessionId of [...timers.keys()]) cancelTimers(sessionId);
    saveState();
  }

  /** Test/ops hook: run the step-2 window now, ignoring schedules. */
  async function extractNow(sessionId) {
    await runExtraction(sessionId, 'manual');
  }

  return {
    start,
    dispose,
    handleTurnEnd,
    snapshot,
    extractNow,
    get sessionCount() {
      return Object.keys(state.sessions).length;
    },
    get stateFile() {
      return stateFile();
    },
  };
}

function errorText(error) {
  if (!error) return 'unknown error';
  return String(error && error.message ? error.message : error);
}

/** Exported for the profile-level docs/worker that will consume the queue. */
export const JUDGE_QUEUE_CONTRACT = {
  v: JUDGE_JOB_VERSION,
  kind: 'extract-judge',
  fields: [
    'v',
    'kind',
    'id',
    'createdAt',
    'cause',
    'sessionId',
    'raw',
    'gate',
    'candidates[{text,triggers}]',
    'neighbors',
    'judge{provider,model}',
    'status:pending',
  ],
};
