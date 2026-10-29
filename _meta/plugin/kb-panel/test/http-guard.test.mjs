import test from 'node:test';
import assert from 'node:assert/strict';
import { requestRejected } from '../http-guard.js';

function exchange(headers = {}, method = 'GET') {
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
  const req = { method, headers };
  const rejected = requestRejected(req, res, { write: method === 'POST' });
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
