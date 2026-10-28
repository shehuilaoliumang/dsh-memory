/**
 * Trigger tests for `ingest.js` (schema §5 steps 1–2, step-3 queue interface).
 *
 *   node _meta/plugin/kb-panel/test/ingest.test.mjs
 *
 * (`node --test` also works outside the DSH file sandbox; inside it the test
 * runner's piped child processes are denied, so run the file directly.)
 *
 * Everything runs against a throwaway root under `_meta/state/test-tmp/`, with a
 * fake session, a fake `kb.mjs` executor and fake timers, so no vault note and
 * no real child process is touched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createIngestor,
  transcriptChunks,
  messageText,
  sessionSlug,
  sessionTitle,
  resolveNode,
  parseNoteBlocks,
  countUserBlocks,
} from '../ingest.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.dirname(HERE);
const VAULT = path.resolve(PLUGIN, '..', '..', '..');
// Scratch lives in the OS temp dir, never inside the vault's runtime-state dir
// (`_meta/state/`), so tests cannot pollute plugin cursors/queues/windows.
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-ingest-test-'));
process.on('exit', () => {
  try {
    fs.rmSync(SCRATCH, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

let serial = 0;

function freshRoot(config) {
  const root = path.join(SCRATCH, `case-${++serial}-${Date.now()}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, '_meta', 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '_meta', 'config.json'),
    JSON.stringify(
      {
        version: 1,
        paths: { catalog: '_meta/catalog.jsonl', sessions: '10_Raw/sessions' },
        extract: { idle_seconds: 300, max_delay_seconds: 1200, every_turns: 20, trigger_words: ['决定'] },
        judge: { provider: 'test-provider', model: 'test-model' },
        ...(config || {}),
      },
      null,
      2,
    ),
  );
  return root;
}

function msg(id, role, text) {
  const source = role === 'user' ? { kind: 'user' } : { kind: 'model', provider: 'test', model: 'test' };
  return { id, role, source, content: [{ type: 'text', text }] };
}

function event(type, seq, data, time = Date.now()) {
  return { type, seq, time, data };
}

/** A session whose snapshot exposes everything from `fromSeq` on. */
function makeSession(events, header = {}) {
  return {
    id: header.id || 'session-test',
    header: { id: header.id || 'session-test', ...header },
    firstLiveSeq: 0,
    get seq() {
      return events.length ? events[events.length - 1].seq + 1 : 0;
    },
    snapshotEvents(fromSeq = 0) {
      return events.filter((candidate) => candidate.seq >= fromSeq);
    },
    events,
  };
}

function turnEndEvent(turn) {
  return { type: 'turn/end', seq: 0, time: Date.now(), data: { turn, reason: { kind: 'completed' } } };
}

function agentFor(session) {
  // The trigger now receives a Session (session/event), not an Agent.
  return session;
}

/** Fake kb.mjs: parses the subcommand and returns plausible stdout. */
function makeExec(root) {
  const calls = [];
  const counts = { candidates: 0 };
  const exec = async (spec) => {
    if (exec.delayMs) await new Promise((resolve) => setTimeout(resolve, exec.delayMs));
    const args = spec.args || [];
    const command = args[1];
    calls.push({ command, args, env: spec.env });
    if (command === 'append-session') {
      const role = args[args.indexOf('--role') + 1];
      const textFile = args[args.indexOf('--text-file') + 1];
      const text = fs.readFileSync(textFile, 'utf8');
      const slug = args[args.indexOf('--slug') + 1];
      const title = args[args.indexOf('--title') + 1];
      const rel = `10_Raw/sessions/2026/10/2026-10-20-0130-${slug}.md`;
      if (exec.failAppendRole === role && exec.failAppendTimes > 0) {
        exec.failAppendTimes -= 1;
        return { code: 3, stdout: '', stderr: 'append failed (injected)' };
      }
      if (exec.dropAppendRole === role) {
        // Pretend success without writing: simulates a silent external failure.
        return { code: 0, stdout: `已追加到 ${rel}（${role}）\n`, stderr: '' };
      }
      // Mirror kb.mjs: the note is found by session_id first, then created.
      let file = null;
      const walk = (dir) => {
        if (file) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (file) return;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile() && entry.name.endsWith('.md')) {
            const body = fs.readFileSync(full, 'utf8');
            if (new RegExp(`^session_id:\\s*${spec.env.DSH_SESSION_ID}\\s*$`, 'm').test(body)) file = full;
          }
        }
      };
      try {
        walk(path.join(root, '10_Raw'));
      } catch {
        /* no raw notes yet */
      }
      let created = false;
      if (!file) {
        file = path.join(root, rel.split('/').join(path.sep));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `---\nid: 2026-10-20-0130\ntitle: ${title}\nlevel: raw\ntype: session\nstatus: active\nsummary: 测试会话\nsession_id: ${spec.env.DSH_SESSION_ID}\nupdated: 2026-10-20\n---\n`, 'utf8');
        created = true;
      }
      fs.appendFileSync(file, `\n## ${role === 'user' ? '用户' : '助手结论'}\n\n${text}\n`, 'utf8');
      const reported = path.relative(root, file).split(path.sep).join('/');
      return {
        code: 0,
        stdout: `${created ? '已新建并写入' : '已追加到'} ${reported}（${role}）\n`,
        stderr: '',
      };
    }
    if (command === 'rebuild') {
      const rows = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name.endsWith('.md')) {
            const rel = path.relative(root, full).split(path.sep).join('/');
            rows.push({ id: entry.name.slice(0, 16), path: rel, level: 'raw', updated: '2026-10-20' });
          }
        }
      };
      try {
        walk(path.join(root, '10_Raw'));
      } catch {
        /* empty */
      }
      fs.writeFileSync(path.join(root, '_meta', 'catalog.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
      return { code: 0, stdout: `已重建：主索引 ${rows.length} 行\n`, stderr: '' };
    }
    if (command === 'candidates') {
      counts.candidates += 1;
      if (exec.failCandidates > 0 && counts.candidates <= exec.failCandidates) {
        return { code: 3, stdout: '', stderr: 'candidates failed (injected)' };
      }
      if (exec.emptyCandidates) return { code: 0, stdout: JSON.stringify({ gate: { skip: false, triggers: ['决定'] }, sentences: 1, candidates: [] }), stderr: '' };
      const file = args[args.indexOf('--file') + 1];
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes('纯寒暄')) return { code: 0, stdout: JSON.stringify({ gate: { skip: true, reason: '寒暄' }, candidates: [] }), stderr: '' };
      return {
        code: 0,
        stdout: JSON.stringify({
          gate: { skip: false, triggers: ['决定'] },
          sentences: 1,
          candidates: [{ text: text.split(/\r?\n/).find((line) => line.includes('决定')) || text.slice(0, 40), triggers: ['决定'] }],
        }),
        stderr: '',
      };
    }
    if (command === 'log') return { code: 0, stdout: 'logged\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  exec.calls = calls;
  exec.counts = counts;
  exec.delayMs = 0;
  exec.failCandidates = 0;
  exec.emptyCandidates = false;
  exec.failAppendRole = '';
  exec.failAppendTimes = 0;
  exec.dropAppendRole = '';
  return exec;
}

function makeTimers() {
  const pending = new Map();
  let next = 0;
  return {
    setTimer(fn, ms) {
      const id = ++next;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimer(id) {
      pending.delete(id);
    },
    pending,
    fireAll() {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, timer] of due) timer.fn();
      return due.length;
    },
    delays() {
      return [...pending.values()].map((timer) => timer.ms);
    },
  };
}

function build(root, options = {}) {
  const exec = options.exec || makeExec(root);
  const timers = options.timers || makeTimers();
  // Default clock sits far before the real `Date.now()` values that `event()`
  // stamps, so a test that never sets `startAt` behaves like "state present".
  let clock = options.startAt || Date.parse('2020-01-01T00:00:00Z');
  const logs = [];
  const ingestor = createIngestor({
    root,
    config: options.pluginConfig || {},
    isKbSession: options.isKbSession || (() => true),
    now: () => new Date(clock),
    exec,
    log: (line) => logs.push(line),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    judge: options.judge,
  });
  ingestor.start();
  return {
    ingestor,
    exec,
    timers,
    logs,
    advance(ms) {
      clock += ms;
    },
    now: () => clock,
  };
}

function turnEvents(turn, userText, assistantText, seqStart, time = Date.now()) {
  const at = (offset) => time + offset;
  const events = [event('turn/start', seqStart, { turn }, at(0))];
  if (userText) events.push(event('user/message', seqStart + 1, msg(`u${turn}`, 'user', userText), at(1)));
  if (assistantText) events.push(event('assistant/message', seqStart + 2, { turn, step: 1, message: msg(`a${turn}`, 'assistant', assistantText), stream: [] }, at(2)));
  events.push(event('turn/end', seqStart + 3, { turn, reason: { kind: 'completed' } }, at(3)));
  return events;
}

const STATE_REL = path.join('_meta', 'state', 'ingest-state.json');
const QUEUE_REL = path.join('_meta', 'state', 'judge-queue.jsonl');

// ---------------------------------------------------------------- pure bits

test('transcriptChunks keeps users and the last textual assistant per turn', () => {
  const events = [
    event('turn/start', 1, { turn: 1 }),
    event('user/message', 2, msg('u1', 'user', '第一问')),
    event('assistant/message', 3, { turn: 1, step: 1, message: msg('a1', 'assistant', '先调工具'), stream: [] }),
    event('assistant/message', 5, { turn: 1, step: 2, message: msg('a2', 'assistant', '最终结论'), stream: [] }),
    event('turn/end', 6, { turn: 1, reason: { kind: 'completed' } }),
    event('turn/start', 7, { turn: 2 }),
    event('user/message', 8, msg('u2', 'user', '第二问')),
    // A tool-call-only assistant message contributes no transcript text.
    event('assistant/message', 9, { turn: 2, step: 1, message: { id: 'a3', role: 'assistant', content: [{ type: 'tool-call', id: 't', name: 'read', arguments: '{}' }] }, stream: [] }),
  ];
  const chunks = transcriptChunks(events);
  assert.deepEqual(
    chunks.map((chunk) => [chunk.role, chunk.text]),
    [
      ['user', '第一问'],
      ['assistant', '最终结论'],
      ['user', '第二问'],
    ],
  );
  assert.equal(chunks[1].seq, 5);
});

test('messageText only extracts text blocks', () => {
  assert.equal(messageText(msg('m', 'assistant', '甲')), '甲');
  assert.equal(messageText({ content: [{ type: 'tool-call' }, { type: 'text', text: '乙' }] }), '乙');
  assert.equal(messageText(undefined), '');
});

test('session slug/title are stable ASCII-friendly values', () => {
  assert.equal(sessionSlug('session-9560413c-746c'), 'session-9560413c746c');
  assert.equal(sessionTitle('决定：路径用英文\n第二行', new Date('2026-10-20T01:30:00+08:00')), '决定：路径用英文');
  assert.match(sessionTitle('', new Date('2026-10-20T01:30:00+08:00')), /^会话 2026-10-20/);
});

test('resolveNode prefers an explicit path, then a managed runtime', () => {
  assert.equal(resolveNode({ nodePath: process.execPath }).command, process.execPath);
  const managed = resolveNode({}, { ...process.env, DSH_HOME: path.join(VAULT, '_meta', 'state', 'no-runtimes') });
  assert.ok(managed.command);
});

// ---------------------------------------------------------------- step one

test('step 1 appends the turn through kb.mjs and persists the cursor', async () => {
  const root = freshRoot();
  const events = turnEvents(1, '决定用英文路径', '好的，记下这个决定。', 1);
  const session = makeSession(events);
  const h = build(root);
  const agent = agentFor(session);

  await h.ingestor.handleTurnEnd(agent, turnEndEvent(1));

  const appendCalls = h.exec.calls.filter((call) => call.command === 'append-session');
  assert.equal(appendCalls.length, 2);
  assert.equal(appendCalls[0].args[appendCalls[0].args.indexOf('--role') + 1], 'user');
  assert.equal(appendCalls[1].args[appendCalls[1].args.indexOf('--role') + 1], 'assistant');
  for (const call of appendCalls) assert.equal(call.env.DSH_SESSION_ID, 'session-test');

  const state = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8'));
  const entry = state.sessions['session-test'];
  assert.equal(entry.cursor, session.seq);
  assert.equal(entry.turns, 1);
  assert.equal(entry.turnsSince, 1);
  assert.ok(entry.sessionFile.endsWith('.md'));

  // The index is rebuilt once, then the fresh row stops further rebuilds.
  const rebuilds = h.exec.calls.filter((call) => call.command === 'rebuild');
  assert.equal(rebuilds.length, 1);
  const catalog = fs.readFileSync(path.join(root, '_meta', 'catalog.jsonl'), 'utf8');
  assert.ok(catalog.includes(entry.sessionFile.split(path.sep).join('/').replace(/^.*?10_Raw/, '10_Raw')));
});

test('step 1 is idempotent for duplicate turn/end: no append and no rebuild', async () => {
  const root = freshRoot();
  const session = makeSession(turnEvents(1, '决定 A', '收到', 1));
  const h = build(root);
  const agent = agentFor(session);

  await h.ingestor.handleTurnEnd(agent, turnEndEvent(1));
  const before = h.exec.calls.length;
  await h.ingestor.handleTurnEnd(agent, turnEndEvent(1));
  assert.equal(h.exec.calls.length, before);
});

test('a re-stopped turn does not double-count the scheduling window', async () => {
  const root = freshRoot();
  const session = makeSession(turnEvents(1, '决定 A', '收到', 1));
  const h = build(root);
  const agent = agentFor(session);

  await h.ingestor.handleTurnEnd(agent, turnEndEvent(1));
  await h.ingestor.handleTurnEnd(agent, turnEndEvent(1));

  const state = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8'));
  assert.equal(state.sessions['session-test'].turns, 1);
  assert.equal(state.sessions['session-test'].turnsSince, 1);
});

test('a quoted user message in a previous conclusion no longer suppresses the real block', async () => {
  const root = freshRoot();
  const quoted = '收到。这条只是为了让本次会话产生第二轮。';
  const rawFile = path.join(root, '10_Raw', 'sessions', '2026', '10', '2026-10-20-0100-quote.md');
  fs.mkdirSync(path.dirname(rawFile), { recursive: true });
  fs.writeFileSync(
    rawFile,
    `---\nid: 2026-10-20-0100\ntype: session\nsession_id: session-test\n---\n\n## 用户\n\n第一轮问题\n\n## 助手结论\n\n你说的下一句是 \`${quoted}\`，它会成为第二个用户块。\n`,
    'utf8',
  );
  // State is present and trustworthy: after turn 1 the cursor is 4. The legacy
  // entry shape (no trackFromSeq) also exercises the on-load migration.
  writeState(root, { v: 1, sessions: { 'session-test': { cursor: 4, turns: 1, lastTurn: 1, sessionFile: rawFile }, keeper: { cursor: 0 } } });
  const events = [...turnEvents(1, '第一轮问题', '第一轮回复', 1), ...turnEvents(2, quoted, '第二轮回复', 5)];
  const session = makeSession(events);
  const h = build(root);

  await h.ingestor.handleTurnEnd(session, turnEndEvent(2));

  const appends = h.exec.calls.filter((call) => call.command === 'append-session');
  assert.deepEqual(appends.map((call) => call.args[call.args.indexOf('--role') + 1]), ['user', 'assistant']);
  const note = fs.readFileSync(rawFile, 'utf8');
  assert.equal(countUserBlocks(note), 2, 'the real user block must be written despite the quote');
  const state = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8')).sessions['session-test'];
  assert.equal(state.lastError, null);
  assert.equal(state.check.ok, true);
});

test('a partial append failure retries only the missing chunk by identity', async () => {
  const root = freshRoot();
  const exec = makeExec(root);
  exec.failAppendRole = 'assistant';
  exec.failAppendTimes = 1;
  const session = makeSession(turnEvents(1, '决定 A', '收到', 1));
  const h = build(root, { exec });
  const agent = agentFor(session);

  await h.ingestor.handleTurnEnd(agent, turnEndEvent(1));
  let state = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8')).sessions['session-test'];
  assert.ok(String(state.lastError).includes('append-session exited 3'));
  assert.equal(state.written.length, 1, 'successful user chunk is remembered by identity');

  await h.ingestor.handleTurnEnd(agent, turnEndEvent(1));
  state = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8')).sessions['session-test'];
  const roles = h.exec.calls
    .filter((call) => call.command === 'append-session')
    .map((call) => call.args[call.args.indexOf('--role') + 1]);
  assert.equal(roles.filter((role) => role === 'user').length, 1, 'the user chunk must not be appended twice');
  assert.equal(roles[roles.length - 1], 'assistant');
  const note = fs.readFileSync(state.sessionFile, 'utf8');
  assert.equal(countUserBlocks(note), 1);
  assert.equal(parseNoteBlocks(note).filter((block) => block.role === 'assistant').length, 1);
  assert.equal(state.lastError, null);
  assert.equal(state.check.ok, true);
});

test('unknown user/message kinds are audited and never written', async () => {
  const root = freshRoot();
  const events = [
    event('turn/start', 1, { turn: 1 }),
    event('user/message', 2, msg('u1', 'user', '决定 A')),
    event('user/message', 3, { id: 'mystery', role: 'user', source: { kind: 'mystery-delivery' }, content: [{ type: 'text', text: '未知注入块' }] }),
    event('assistant/message', 4, { turn: 1, step: 1, message: msg('a1', 'assistant', '收到'), stream: [] }),
    event('turn/end', 5, { turn: 1, reason: { kind: 'completed' } }),
  ];
  const session = makeSession(events);
  const h = build(root);
  await h.ingestor.handleTurnEnd(session, turnEndEvent(1));

  const state = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8')).sessions['session-test'];
  const note = fs.readFileSync(state.sessionFile, 'utf8');
  assert.ok(!note.includes('未知注入块'));
  assert.ok(String(state.lastWarning).includes('mystery-delivery'));
  assert.ok(String(h.ingestor.snapshot().sessions['session-test'].lastWarning).includes('mystery-delivery'));
});

test('title truncation backs off to a punctuation boundary and trims whitespace', () => {
  const when = new Date('2026-10-20T02:01:00+08:00');
  const long = '记录一下：我在验证知识库入库触发器，这条消息应该被原样写入 10_Raw，并且标题不该是系统注入块。';
  const title = sessionTitle(long, when);
  assert.ok([...title].length <= 30);
  assert.ok(!/\s$/.test(title));
  assert.ok(!/[，,。；;：:！!？?]$/.test(title));
  assert.equal(sessionTitle('短标题', when), '短标题');
  assert.equal([...sessionTitle('x'.repeat(40), when)].length, 30);
});

test('assistant line-start ## headings are demoted; user text stays verbatim', async () => {
  const root = freshRoot();
  const events = [
    event('turn/start', 1, { turn: 1 }),
    event('user/message', 2, msg('u1', 'user', '决定 A\n## 用户自己的小标题')),
    event('assistant/message', 3, { turn: 1, step: 1, message: msg('a1', 'assistant', '结论\n## 子标题\n正文'), stream: [] }),
    event('turn/end', 4, { turn: 1, reason: { kind: 'completed' } }),
  ];
  const session = makeSession(events);
  const h = build(root);
  await h.ingestor.handleTurnEnd(session, turnEndEvent(1));

  const state = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8')).sessions['session-test'];
  const note = fs.readFileSync(state.sessionFile, 'utf8');
  assert.ok(note.includes('### 子标题'));
  assert.ok(!note.includes('\n## 子标题'));
  assert.ok(note.includes('## 用户自己的小标题'), 'user text is written verbatim');
  assert.equal(countUserBlocks(note), 1);
});

test('structural parser skips fenced code when counting user blocks', () => {
  const text = '---\nx: 1\n---\n\n## 用户\n\n甲\n\n## 助手结论\n\n示例：\n\n```\n## 用户\n\n假块\n```\n\n## 用户\n\n乙\n';
  const blocks = parseNoteBlocks(text);
  assert.deepEqual(blocks.map((block) => block.role), ['user', 'assistant', 'user']);
  assert.equal(countUserBlocks(text), 2);
  assert.ok(blocks[1].text.includes('## 用户'));
});

test('post-write self-check warns once, then escalates to an error', async () => {
  // First observation: a single mismatch can be a transient read/append
  // interleaving, so it must warn without setting lastError.
  const root = freshRoot();
  const exec = makeExec(root);
  exec.dropAppendRole = 'user';
  const h = build(root, { exec });
  await h.ingestor.handleTurnEnd(makeSession(turnEvents(1, '决定 A', '收到', 1)), turnEndEvent(1));

  const first = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8')).sessions['session-test'];
  assert.equal(first.check && first.check.ok, false);
  assert.equal(first.lastError, null);
  assert.ok(String(first.lastWarning).includes('疑似缺失'));

  // A shortfall that survives into the next verification escalates to an error.
  const root2 = freshRoot();
  writeState(root2, { v: 1, sessions: { 'session-test': { checkShortfall: 1 } } });
  const exec2 = makeExec(root2);
  exec2.dropAppendRole = 'user';
  const h2 = build(root2, { exec: exec2 });
  await h2.ingestor.handleTurnEnd(makeSession(turnEvents(1, '决定 A', '收到', 1)), turnEndEvent(1));

  const second = JSON.parse(fs.readFileSync(path.join(root2, STATE_REL), 'utf8')).sessions['session-test'];
  assert.ok(String(second.lastError).startsWith('用户块缺失'));
  assert.ok(String(h2.ingestor.snapshot().sessions['session-test'].lastError).startsWith('用户块缺失'));
});

function writeState(root, value) {
  const file = path.join(root, STATE_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
}

test('state present but session untracked resumes after the existing note', async () => {
  const root = freshRoot();
  // A valid state file for another session: cursors are trustworthy, this one
  // session was simply never tracked (e.g. a manual append ran first).
  writeState(root, { v: 1, sessions: { keeper: { cursor: 0 } } });
  const rawFile = path.join(root, '10_Raw', 'sessions', '2026', '10', '2026-10-20-0100-exists.md');
  fs.mkdirSync(path.dirname(rawFile), { recursive: true });
  fs.writeFileSync(
    rawFile,
    '---\nid: 2026-10-20-0100\ntype: session\nsession_id: session-test\n---\n\n## 用户\n\n历史一\n\n## 助手结论\n\n回复一\n\n## 用户\n\n历史二\n\n## 助手结论\n\n回复二\n',
    'utf8',
  );
  const events = [
    ...turnEvents(1, '历史一', '回复一', 1),
    ...turnEvents(2, '历史二', '回复二', 5),
    ...turnEvents(3, '决定现在', '回复三', 9),
  ];
  const session = makeSession(events);
  const h = build(root);

  await h.ingestor.handleTurnEnd(session, turnEndEvent(3));

  const appendCalls = h.exec.calls.filter((call) => call.command === 'append-session');
  assert.equal(appendCalls.length, 2);
  const text = fs.readFileSync(rawFile, 'utf8');
  assert.equal(text.split('历史一').length - 1, 1, 'older turn must not be duplicated');
  assert.ok(text.includes('决定现在'));
  const state = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8'));
  assert.equal(state.sessions['session-test'].cursor, session.seq);
});

test('lost cursor state never replays history: only turns after boot are written', async () => {
  const root = freshRoot();
  const boot = Date.parse('2026-10-20T01:00:00+08:00');
  const oldTurn = turnEvents(1, '远古一轮', '远古回复', 1, boot - 60000);
  const newTurn = turnEvents(2, '开机后决定', '开机后回复', 5, boot + 5000);
  const session = makeSession([...oldTurn, ...newTurn]);
  // No state file at all: the gitignored runtime dir was cleaned/reverted.
  const h = build(root, { startAt: boot });

  await h.ingestor.handleTurnEnd(session, turnEndEvent(2));

  const appendCalls = h.exec.calls.filter((call) => call.command === 'append-session');
  assert.equal(appendCalls.length, 2, 'only the post-boot turn is appended');
  const state = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8'));
  const raw = fs.readFileSync(state.sessions['session-test'].sessionFile, 'utf8');
  assert.ok(raw.includes('开机后决定'));
  assert.ok(!raw.includes('远古一轮'), 'pre-boot history must never be replayed');
});

test('lost cursor state plus an existing note writes nothing from history', async () => {
  const root = freshRoot();
  const rawFile = path.join(root, '10_Raw', 'sessions', '2026', '10', '2026-10-20-0100-manual.md');
  fs.mkdirSync(path.dirname(rawFile), { recursive: true });
  fs.writeFileSync(rawFile, '---\nid: 2026-10-20-0100\ntype: session\nsession_id: session-test\n---\n\n## 用户\n\n手工一轮\n', 'utf8');
  const boot = Date.parse('2026-10-20T01:00:00+08:00');
  const session = makeSession(turnEvents(1, '手工一轮', '手工回复', 1, boot - 60000));
  const h = build(root, { startAt: boot });

  await h.ingestor.handleTurnEnd(session, turnEndEvent(1));

  assert.equal(h.exec.calls.filter((call) => call.command === 'append-session').length, 0);
  const state = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8'));
  assert.equal(state.sessions['session-test'].cursor, session.seq);
  assert.equal(fs.readFileSync(rawFile, 'utf8').split('手工一轮').length - 1, 1);
});

test('step 1 skips subagent sessions and non-vault sessions', async () => {
  const root = freshRoot();
  const session = makeSession(turnEvents(1, '决定 X', '好', 1), { origin: 'subagent' });
  const h = build(root);
  await h.ingestor.handleTurnEnd(session, turnEndEvent(1));
  assert.equal(h.exec.calls.filter((call) => call.command === 'append-session').length, 0);

  const outside = makeSession(turnEvents(1, '决定 Y', '好', 1));
  const h2 = build(root, { isKbSession: () => false });
  await h2.ingestor.handleTurnEnd(outside, turnEndEvent(1));
  assert.equal(h2.exec.calls.length, 0);
});

// ---------------------------------------------------------------- step two

test('step 2 fires on every-turns and queues a step-3 judge job', async () => {
  const root = freshRoot({ extract: { idle_seconds: 300, max_delay_seconds: 1200, every_turns: 2, trigger_words: ['决定'] } });
  const events = [...turnEvents(1, '决定一', '好一', 1), ...turnEvents(2, '决定二', '好二', 5)];
  const session = makeSession(events);
  const h = build(root);
  const agent = agentFor(session);

  await h.ingestor.handleTurnEnd(agent, turnEndEvent(1));
  assert.equal(h.exec.calls.filter((call) => call.command === 'candidates').length, 0);
  await h.ingestor.handleTurnEnd(agent, turnEndEvent(2));
  // Extraction is deliberately not awaited on the turn boundary.
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(h.exec.calls.filter((call) => call.command === 'candidates').length, 1);
  const queue = fs.readFileSync(path.join(root, QUEUE_REL), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].kind, 'extract-judge');
  assert.equal(queue[0].v, 1);
  assert.equal(queue[0].status, 'pending');
  assert.equal(queue[0].sessionId, 'session-test');
  assert.equal(queue[0].cause, 'every-turns');
  assert.ok(Array.isArray(queue[0].candidates) && queue[0].candidates.length >= 1);
  assert.deepEqual(queue[0].judge, { provider: 'test-provider', model: 'test-model' });

  const state = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8'));
  assert.equal(state.sessions['session-test'].turnsSince, 0);
  assert.equal(state.sessions['session-test'].lastJobId, queue[0].id);
});

test('step 2 schedules idle and max-delay timers from config', async () => {
  const root = freshRoot({ extract: { idle_seconds: 300, max_delay_seconds: 1200, every_turns: 20, trigger_words: ['决定'] } });
  const session = makeSession(turnEvents(1, '决定 A', '好', 1));
  const h = build(root);
  await h.ingestor.handleTurnEnd(session, turnEndEvent(1));
  assert.deepEqual(h.timers.delays().sort((a, b) => a - b), [300000, 1200000]);

  // A second turn re-arms the idle timer from the newest activity.
  h.advance(100000);
  session.events.push(...turnEvents(2, '决定 B', '好', 5));
  await h.ingestor.handleTurnEnd(session, turnEndEvent(2));
  const delays = h.timers.delays().sort((a, b) => a - b);
  assert.equal(delays[0], 300000);
  assert.ok(delays[1] < 1200000);
});

test('step 2 idle timer runs the gate; a skip enqueues nothing', async () => {
  const root = freshRoot({ extract: { idle_seconds: 300, max_delay_seconds: 1200, every_turns: 20, trigger_words: ['决定'] } });
  const session = makeSession(turnEvents(1, '纯寒暄', '嗯', 1));
  const h = build(root);
  await h.ingestor.handleTurnEnd(session, turnEndEvent(1));
  h.timers.fireAll();
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(h.exec.calls.filter((call) => call.command === 'candidates').length, 1);
  assert.equal(fs.existsSync(path.join(root, QUEUE_REL)), false);
  const state = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8'));
  assert.equal(state.sessions['session-test'].lastGate.skip, true);
  assert.equal(state.sessions['session-test'].turnsSince, 0);
});

test('step 2 catch-up after a reload (overdue window) extracts without a turn', async () => {
  const root = freshRoot({ extract: { idle_seconds: 1, max_delay_seconds: 2, every_turns: 20, trigger_words: ['决定'] } });
  const first = build(root);
  await first.ingestor.handleTurnEnd(makeSession(turnEvents(1, '决定 A', '好', 1)), turnEndEvent(1));
  first.ingestor.dispose();

  // Simulate time passing across a hot reload, then start a fresh ingestor.
  const second = build(root, { exec: makeExec(root), startAt: first.now() + 5000 });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(second.exec.calls.filter((call) => call.command === 'candidates').length, 1);
});

test('step 3 seam: an injected judge receives the job instead of the queue file', async () => {
  const root = freshRoot({ extract: { idle_seconds: 300, max_delay_seconds: 1200, every_turns: 2, trigger_words: ['决定'] } });
  const jobs = [];
  const h = build(root, {
    judge: async (job) => {
      jobs.push(job);
    },
  });
  const events = [...turnEvents(1, '决定一', '好一', 1), ...turnEvents(2, '决定二', '好二', 5)];
  const session = makeSession(events);
  await h.ingestor.handleTurnEnd(session, turnEndEvent(1));
  await h.ingestor.handleTurnEnd(session, turnEndEvent(2));
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].kind, 'extract-judge');
  assert.equal(fs.existsSync(path.join(root, QUEUE_REL)), false);
});

// ------------------------------------------------- system-injection guard

test('step 1 ignores non-human user/message injections', async () => {
  const root = freshRoot();
  const events = [
    event('turn/start', 1, { turn: 1 }),
    event('user/message', 2, {
      id: 'ctx',
      role: 'user',
      source: { kind: 'runtime-context' },
      content: [{ type: 'text', text: '<system-reminder>工作区指令不该入库</system-reminder>' }],
    }),
    event('user/message', 3, { id: 'skills', role: 'user', source: { kind: 'skill-catalog' }, content: [{ type: 'text', text: '可用技能目录不该入库' }] }),
    event('user/message', 4, msg('human', 'user', '我的偏好是路径英文')),
    event('assistant/message', 5, { turn: 1, step: 1, message: msg('a', 'assistant', '记下了'), stream: [] }),
    event('turn/end', 6, { turn: 1, reason: { kind: 'completed' } }),
  ];
  const session = makeSession(events);
  const h = build(root);
  await h.ingestor.handleTurnEnd(session, turnEndEvent(1));

  const state = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8'));
  const raw = fs.readFileSync(state.sessions['session-test'].sessionFile, 'utf8');
  assert.ok(raw.includes('我的偏好是路径英文'));
  assert.ok(!raw.includes('system-reminder'));
  assert.ok(!raw.includes('可用技能目录'));
  assert.equal(h.exec.calls.filter((call) => call.command === 'append-session').length, 2);
});

test('step 1 skips automated rounds that carry no human message', async () => {
  const root = freshRoot();
  // A goal continuation round: only assistant output, human input is the
  // runtime context injection (filtered out).
  const events = [
    event('turn/start', 1, { turn: 1 }),
    event('user/message', 2, { id: 'goal', role: 'user', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: '【目标】继续做 A' }] }),
    event('assistant/message', 3, { turn: 1, step: 1, message: msg('a1', 'assistant', '自动续跑输出，不该入库'), stream: [] }),
    event('turn/end', 4, { turn: 1, reason: { kind: 'completed' } }),
  ];
  const session = makeSession(events);
  const h = build(root);
  await h.ingestor.handleTurnEnd(session, turnEndEvent(1));

  assert.equal(h.exec.calls.filter((call) => call.command === 'append-session').length, 0);
  const state = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8'));
  assert.equal(state.sessions['session-test'].cursor, session.seq);
  assert.equal(state.sessions['session-test'].pendingChars, 0);
});

test('steering conclusions inside one turn use the last assistant text', async () => {
  const root = freshRoot();
  const events = [
    event('turn/start', 1, { turn: 1 }),
    event('user/message', 2, msg('u1', 'user', '决定 A')),
    event('assistant/message', 3, { turn: 1, step: 1, message: msg('a1', 'assistant', '第一段结论'), stream: [] }),
    // Steering runs another step in the SAME turn; turn/end is emitted once.
    event('assistant/message', 4, { turn: 1, step: 2, message: msg('a2', 'assistant', '补一段最终结论'), stream: [] }),
    event('turn/end', 5, { turn: 1, reason: { kind: 'completed' } }),
  ];
  const session = makeSession(events);
  const h = build(root);

  await h.ingestor.handleTurnEnd(session, turnEndEvent(1));

  const appends = h.exec.calls.filter((call) => call.command === 'append-session');
  assert.equal(appends.length, 2);
  const state = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8'));
  const raw = fs.readFileSync(state.sessions['session-test'].sessionFile, 'utf8');
  assert.ok(raw.includes('补一段最终结论'));
  assert.ok(!raw.includes('第一段结论'));
  const pending = fs.readFileSync(path.join(root, '_meta', 'state', 'pending', 'session-test.md'), 'utf8');
  assert.ok(pending.includes('补一段最终结论'));
  assert.equal(state.sessions['session-test'].turns, 1);
});

// ------------------------------------------------------- robustness paths

test('concurrent turn/end deliveries for one session are serialized', async () => {
  const root = freshRoot();
  const exec = makeExec(root);
  exec.delayMs = 25;
  const session = makeSession(turnEvents(1, '决定 A', '收到', 1));
  const h = build(root, { exec });
  const agent = agentFor(session);

  await Promise.all([
    h.ingestor.handleTurnEnd(agent, turnEndEvent(1)),
    h.ingestor.handleTurnEnd(agent, turnEndEvent(1)),
  ]);

  const appends = h.exec.calls.filter((call) => call.command === 'append-session');
  assert.equal(appends.length, 2);
  const state = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8'));
  const raw = fs.readFileSync(state.sessions['session-test'].sessionFile, 'utf8');
  assert.equal((raw.match(/## 用户/g) || []).length, 1, 'user chunk must be appended exactly once');
  assert.equal((raw.match(/## 助手结论/g) || []).length, 1);
});

test('a failed extraction restores the window and retries after the floor', async () => {
  const root = freshRoot({ extract: { idle_seconds: 300, max_delay_seconds: 1200, every_turns: 1, trigger_words: ['决定'] } });
  const exec = makeExec(root);
  exec.failCandidates = 1;
  const session = makeSession(turnEvents(1, '决定 A', '收到', 1));
  const h = build(root, { exec });

  await h.ingestor.handleTurnEnd(session, turnEndEvent(1));
  await new Promise((resolve) => setTimeout(resolve, 40));

  const pending = path.join(root, '_meta', 'state', 'pending', 'session-test.md');
  const failed = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8')).sessions['session-test'];
  assert.equal(fs.existsSync(path.join(root, QUEUE_REL)), false);
  assert.ok(fs.readFileSync(pending, 'utf8').includes('决定 A'), 'window must be restored');
  assert.equal(failed.turnsSince, 1);
  assert.ok(failed.retryAfter > 0);
  assert.ok(failed.lastError.includes('candidates'));

  h.advance(61000);
  h.timers.fireAll();
  await new Promise((resolve) => setTimeout(resolve, 40));

  const queue = fs.readFileSync(path.join(root, QUEUE_REL), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(queue.length, 1);
  assert.equal(fs.existsSync(pending), false);
  const after = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8')).sessions['session-test'];
  assert.equal(after.turnsSince, 0);
  assert.equal(after.lastError, null);
});

test('a gate pass with no candidate lines enqueues nothing', async () => {
  const root = freshRoot({ extract: { idle_seconds: 300, max_delay_seconds: 1200, every_turns: 1, trigger_words: ['决定'] } });
  const exec = makeExec(root);
  exec.emptyCandidates = true;
  const session = makeSession(turnEvents(1, '决定 A', '收到', 1));
  const h = build(root, { exec });

  await h.ingestor.handleTurnEnd(session, turnEndEvent(1));
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(fs.existsSync(path.join(root, QUEUE_REL)), false);
  const state = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8')).sessions['session-test'];
  assert.equal(state.turnsSince, 0);
  assert.equal(state.lastGate.skip, false);
});

test('ingest.enabled=false disables every write', async () => {
  const root = freshRoot({ ingest: { enabled: false } });
  const session = makeSession(turnEvents(1, '决定 A', '收到', 1));
  const h = build(root);
  await h.ingestor.handleTurnEnd(session, turnEndEvent(1));
  assert.equal(h.exec.calls.length, 0);
  assert.equal(fs.existsSync(path.join(root, STATE_REL)), false);
  assert.equal(h.ingestor.snapshot().enabled, false);
});

test('steering: a second human message inside one turn is appended in order', async () => {
  const root = freshRoot();
  const exec = makeExec(root);
  const events = [
    event('turn/start', 1, { turn: 1 }),
    event('user/message', 2, msg('u1', 'user', '先做 A')),
    event('assistant/message', 3, { turn: 1, step: 1, message: msg('a1', 'assistant', 'A 做到一半'), stream: [] }),
    event('user/message', 4, msg('u2', 'user', '改做 B')),
    event('assistant/message', 5, { turn: 1, step: 2, message: msg('a2', 'assistant', '改为 B 的结论'), stream: [] }),
    event('turn/end', 6, { turn: 1, reason: { kind: 'completed' } }),
  ];
  const session = makeSession(events);
  const h = build(root, { exec });
  await h.ingestor.handleTurnEnd(session, turnEndEvent(1));

  const state = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8')).sessions['session-test'];
  const note = fs.readFileSync(state.sessionFile, 'utf8');
  assert.equal(countUserBlocks(note), 2, 'both steering and original message are recorded');
  const first = note.indexOf('先做 A');
  const second = note.indexOf('改做 B');
  assert.ok(first >= 0 && second > first, 'steering message follows the original one');
  assert.ok(note.includes('改为 B 的结论'), 'only the final assistant text is kept');
  assert.equal(state.check.ok, true, 'self-check counts both human messages');
});
