import test from 'node:test';
import assert from 'node:assert/strict';
import { isLoopbackAddress, requestRejected } from '../http-guard.js';

function exchange(headers = {}, method = 'GET', options = {}, socket) {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = body;
    },
  };
  const req = { method, headers, ...(socket ? { socket } : {}) };
  const rejected = requestRejected(req, res, { write: method === 'POST', ...options });
  return { rejected, status: res.statusCode, body: res.body };
}

test('accepts same-origin requests', () => {
  const result = exchange({ host: '127.0.0.1:9223', origin: 'http://127.0.0.1:9223' });
  assert.equal(result.rejected, false);
  assert.equal(result.status, 200);
});

test('rejects a foreign Origin', () => {
  const result = exchange({ host: '127.0.0.1:9223', origin: 'http://evil.example' });
  assert.equal(result.rejected, true);
  assert.equal(result.status, 403);
  assert.match(result.body, /cross-origin/);
});

test('rejects an opaque Origin', () => {
  const result = exchange({ host: '127.0.0.1:9223', origin: 'null' });
  assert.equal(result.rejected, true);
  assert.equal(result.status, 403);
});

test('rejects sec-fetch-site: cross-site even without Origin', () => {
  const result = exchange({ host: '127.0.0.1:9223', 'sec-fetch-site': 'cross-site' });
  assert.equal(result.rejected, true);
  assert.equal(result.status, 403);
  assert.match(result.body, /cross-site/);
});

test('rejects a form-encoded write', () => {
  const result = exchange(
    { host: '127.0.0.1:9223', 'content-type': 'text/plain' },
    'POST',
  );
  assert.equal(result.rejected, true);
  assert.equal(result.status, 415);
  assert.match(result.body, /application\/json/);
});

test('accepts a JSON write from the same origin', () => {
  const result = exchange(
    {
      host: '127.0.0.1:9223',
      origin: 'http://127.0.0.1:9223',
      'content-type': 'application/json; charset=utf-8',
    },
    'POST',
  );
  assert.equal(result.rejected, false);
  assert.equal(result.status, 200);
});

test('requires the CSRF token on writes when configured', () => {
  const headers = {
    host: '127.0.0.1:9223',
    origin: 'http://127.0.0.1:9223',
    'content-type': 'application/json',
  };
  assert.equal(exchange(headers, 'POST', { token: 'abc' }).status, 403);
  const good = exchange({ ...headers, 'x-kb-csrf': 'abc' }, 'POST', { token: 'abc' });
  assert.equal(good.rejected, false);
});

test('reports loopback and non-loopback addresses honestly', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('192.168.1.20'), false);
  assert.equal(isLoopbackAddress(''), false);
});

test('rejects a non-loopback connection before any other check', () => {
  const result = exchange({}, 'GET', {}, { localAddress: '192.168.1.20' });
  assert.equal(result.rejected, true);
  assert.equal(result.status, 403);
  assert.match(result.body, /non-loopback/);
});

test('non-browser writes must present the per-boot local token', () => {
  const headers = {
    host: '127.0.0.1:9223',
    origin: 'http://127.0.0.1:9223',
    'content-type': 'application/json',
    'x-kb-csrf': 'csrf',
  };
  assert.equal(exchange(headers, 'POST', { token: 'csrf', localToken: 'local' }).status, 403);
  const good = exchange(
    { ...headers, 'x-kb-local-token': 'local' },
    'POST',
    { token: 'csrf', localToken: 'local' },
  );
  assert.equal(good.rejected, false);
});

test('a browser same-origin write only needs the CSRF token', () => {
  const result = exchange(
    {
      host: '127.0.0.1:9223',
      origin: 'http://127.0.0.1:9223',
      'content-type': 'application/json',
      'x-kb-csrf': 'csrf',
      'sec-fetch-site': 'same-origin',
    },
    'POST',
    { token: 'csrf', localToken: 'local' },
  );
  assert.equal(result.rejected, false);
});
