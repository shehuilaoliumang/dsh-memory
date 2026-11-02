/**
 * Regression tests for `transcriptChunks()` in `../ingest.js` (schema §5 step 1).
 *
 *   node --test _meta/plugin/kb-panel/test/transcript-chunks.test.mjs
 *
 * Pure-function tests only: no vault write, no child process, no plugin reload.
 * The historical bug this guards against: the writer used to drop a chunk when
 * the tail of the already-written note "contained" its text (`tailHas`), so an
 * assistant reply that quoted the user verbatim made the user message look
 * already-written and it was silently lost. `tailHas` is gone; the cursor is the
 * single authority. These cases pin that behaviour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { transcriptChunks, messageText, KNOWN_USER_MESSAGE_KINDS } from '../ingest.js';

/** A session event exactly as the ingest trigger reads it: { type, seq, time, data }. */
function event(type, seq, data) {
  return { type, seq, time: Date.UTC(2026, 9, 20, 14, 4, 0) + seq, data };
}

/**
 * `user/message` carries the message fields on `event.data` itself
 * (`transcriptChunks` calls `messageText(data)`, so `content` lives on `data`).
 */
function userMessage(text, kind = 'user', id = 'u') {
  return { id, role: 'user', source: { kind }, content: [{ type: 'text', text }] };
}

/** `assistant/message` carries the message under `event.data.message`. */
function assistantMessage(text, id = 'a') {
  return {
    id,
    role: 'assistant',
    source: { kind: 'model', provider: 'test', model: 'test' },
    content: [{ type: 'text', text }],
  };
}

const pairs = (chunks) => chunks.map((chunk) => [chunk.role, chunk.text]);

// --------------------------------------------------------------- (a) plain turn

test('普通一轮：一条 user/message + 一条 assistant/message 产出两个 chunk', () => {
  const events = [
    event('turn/start', 1, { turn: 1 }),
    event('user/message', 2, userMessage('帮我把这段话记下来')),
    event('assistant/message', 3, { turn: 1, step: 1, message: assistantMessage('记下了。'), stream: [] }),
  ];

  const chunks = transcriptChunks(events);

  assert.deepEqual(pairs(chunks), [
    ['user', '帮我把这段话记下来'],
    ['assistant', '记下了。'],
  ]);
  // seq points at the source event, so a partial failure can advance the cursor
  // only past what was actually appended.
  assert.deepEqual(chunks.map((chunk) => chunk.seq), [2, 3]);
  assert.deepEqual(chunks.map((chunk) => chunk.turn), [1, 1]);
  assert.ok(chunks.every((chunk) => chunk.hasUser === true));
});

// ------------------------------------------------------- (b) the regression case

test('回归：assistant 逐字引用用户原话时，user chunk 必须仍然存在', () => {
  const human = '写入前用尾部子串包含去重会把用户消息静默丢掉';
  const events = [
    event('turn/start', 1, { turn: 1 }),
    event('user/message', 2, userMessage(human)),
    event('assistant/message', 3, {
      turn: 1,
      step: 1,
      message: assistantMessage(`你刚才说的是：“${human}”。我会记住。`),
      stream: [],
    }),
  ];

  const chunks = transcriptChunks(events);

  // Scenario premise: the assistant text does contain the user text verbatim,
  // which is exactly what the old `tailHas` substring check misread.
  assert.equal(chunks.length, 2, 'user + assistant, nothing swallowed');
  assert.ok(chunks[1].text.includes(human), 'assistant must quote the user verbatim');
  assert.deepEqual(pairs(chunks), [
    ['user', human],
    ['assistant', `你刚才说的是：“${human}”。我会记住。`],
  ]);
  assert.deepEqual(
    chunks.filter((chunk) => chunk.role === 'user').map((chunk) => [chunk.text, chunk.seq]),
    [[human, 2]],
  );
});

test('回归：上一轮 assistant 结尾逐字等于本轮 user 文本时，本轮 user chunk 仍然存在', () => {
  // The classic tail case: the note already ends with this exact text because the
  // previous conclusion quoted the upcoming message. A tail-substring dedupe
  // would treat the new user message as "already written".
  const quoted = '这条用户消息在上一轮助手回复的尾部已经出现过';
  const events = [
    event('turn/start', 1, { turn: 1 }),
    event('user/message', 2, userMessage('第一问')),
    event('assistant/message', 3, {
      turn: 1,
      step: 1,
      message: assistantMessage(`回答第一问。接下来你会说：${quoted}`),
      stream: [],
    }),
    event('turn/start', 4, { turn: 2 }),
    event('user/message', 5, userMessage(quoted)),
    event('assistant/message', 6, { turn: 2, step: 1, message: assistantMessage('第二轮答复'), stream: [] }),
  ];

  const chunks = transcriptChunks(events);

  assert.deepEqual(pairs(chunks), [
    ['user', '第一问'],
    ['assistant', `回答第一问。接下来你会说：${quoted}`],
    ['user', quoted],
    ['assistant', '第二轮答复'],
  ]);
  assert.deepEqual(chunks.map((chunk) => chunk.seq), [2, 3, 5, 6]);
});

// ------------------------------------------------------- (c) injected blocks

test('注入块过滤：source.kind 不是 user 的 user/message 不产出 chunk', () => {
  const events = [
    event('turn/start', 1, { turn: 1 }),
    event('user/message', 2, userMessage('【指令】你是知识库助手，只读元层', 'agent-instructions', 'inj-1')),
    event('user/message', 3, userMessage('<system-reminder>运行时上下文</system-reminder>', 'runtime-context', 'inj-2')),
    event('user/message', 4, userMessage('可用技能目录：…', 'skill-catalog', 'inj-3')),
    event('user/message', 5, userMessage('真正的人话')),
    event('assistant/message', 6, { turn: 1, step: 1, message: assistantMessage('收到'), stream: [] }),
  ];

  const chunks = transcriptChunks(events);

  assert.deepEqual(pairs(chunks), [
    ['user', '真正的人话'],
    ['assistant', '收到'],
  ]);
  const joined = chunks.map((chunk) => chunk.text).join('\n');
  for (const injected of ['【指令】你是知识库助手，只读元层', '<system-reminder>', '可用技能目录']) {
    assert.ok(!joined.includes(injected), `injected block must not reach the raw layer: ${injected}`);
  }
  // These are known Host delivery kinds: the whitelist default is "drop".
  for (const kind of ['agent-instructions', 'runtime-context', 'skill-catalog']) {
    assert.ok(KNOWN_USER_MESSAGE_KINDS.has(kind), `${kind} must be a known kind`);
  }
});

// -------------------------------------------------------- (d) steering in one turn

test('steering：同一 turn 内两条真人 user/message 都保留且顺序正确', () => {
  const events = [
    event('turn/start', 1, { turn: 1 }),
    event('user/message', 2, userMessage('先做 A')),
    event('assistant/message', 3, { turn: 1, step: 1, message: assistantMessage('A 做到一半'), stream: [] }),
    event('user/message', 4, userMessage('改做 B')),
    event('assistant/message', 5, { turn: 1, step: 2, message: assistantMessage('改为 B 的结论'), stream: [] }),
  ];

  const chunks = transcriptChunks(events);

  assert.deepEqual(pairs(chunks), [
    ['user', '先做 A'],
    ['user', '改做 B'],
    ['assistant', '改为 B 的结论'],
  ]);
  assert.deepEqual(chunks.map((chunk) => chunk.seq), [2, 4, 5]);
  assert.equal(chunks.filter((chunk) => chunk.role === 'user').length, 2, 'both human messages survive');
});

// ---------------------------------------------------------------- shape guards

test('内容块形状：只取 text block，忽略 tool-call / reasoning', () => {
  assert.equal(messageText(assistantMessage('甲')), '甲');
  assert.equal(messageText({ content: [{ type: 'reasoning', text: '思考' }, { type: 'text', text: '乙' }] }), '乙');
  assert.equal(messageText({ content: [{ type: 'tool-call', id: 't', name: 'read', arguments: '{}' }] }), '');
  assert.equal(messageText(undefined), '');

  const events = [
    event('turn/start', 1, { turn: 1 }),
    event('user/message', 2, userMessage('决定 A')),
    event('assistant/message', 3, {
      turn: 1,
      step: 1,
      message: {
        id: 'a1',
        role: 'assistant',
        content: [
          { type: 'tool-call', id: 't', name: 'read', arguments: '{}' },
          { type: 'text', text: '最终结论' },
        ],
      },
      stream: [],
    }),
  ];
  assert.deepEqual(pairs(transcriptChunks(events)), [
    ['user', '决定 A'],
    ['assistant', '最终结论'],
  ]);
});
