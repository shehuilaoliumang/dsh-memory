#!/usr/bin/env node
/**
 * HTTP host for the memory engine (3.1 third-host proof).
 *
 * The MCP adapter proves the rules can be driven over a stdio tool protocol.
 * This adapter proves the same host contract works as a long-running local
 * service for a different kind of consumer (editor plugins, local agents,
 * scripts). It is deliberately thin: every action forwards to
 * `_meta/engine/lib/host.mjs`; no injection, ranking, scope or search rule
 * lives here.
 *
 * Endpoints (all JSON):
 *   GET  /health          liveness only (no token, no store data)
 *   POST /v1/context      {cwd, query?, pinnedIds?, mutedIds?}
 *   POST /v1/search       {cwd, query, limit?, workspace?}
 *   POST /v1/remember     {cwd, text, title?, summary?, type?}
 *   POST /v1/status       {cwd}
 *   POST /v1/validate     {cwd?}
 *
 * Trust boundary:
 *   - binds 127.0.0.1 only; non-loopback socket peers are rejected;
 *   - every /v1 request needs `Authorization: Bearer <token>`;
 *   - cross-site browser requests are rejected; there is no CORS;
 *   - body size is capped; errors are JSON and never echo the token.
 * This is a local single-user service, not a multi-user server.
 *
 * Usage:
 *   node _meta/engine/hosts/http.mjs --root <legacy-vault> [--port 0]
 *   # env fallbacks: KB_ROOT, KB_GLOBAL_ROOT, KB_REGISTRY_FILE, KB_HTTP_TOKEN
 *   # startup JSON on stdout: {ok, origin, token, version}; logs -> stderr
 */
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { createHost } from '../lib/host.mjs';

const SERVER_NAME = 'dsh-memory-kb';
const MAX_BODY_BYTES = 1024 * 1024;
const ACTIONS = {
  '/v1/context': 'context',
  '/v1/search': 'search',
  '/v1/remember': 'remember',
  '/v1/status': 'status',
  '/v1/validate': 'validate',
};

// Match the MCP adapter's required-argument check so a caller gets the same
// client error on every host instead of an empty result or a type error.
const REQUIRED_ARGS = {
  context: ['cwd'],
  search: ['cwd', 'query'],
  remember: ['cwd', 'text'],
  status: ['cwd'],
  validate: [],
};

function isLoopback(address) {
  const value = String(address || '');
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

function header(req, name) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(res, status, payload) {
  const text = `${JSON.stringify(payload)}\n`;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sameToken(provided, expected) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(req, token) {
  const value = header(req, 'authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return Boolean(match && sameToken(match[1], token));
}

function originAllowed(req) {
  const site = String(header(req, 'sec-fetch-site') || '').toLowerCase();
  if (site === 'cross-site') return false;
  const origin = header(req, 'origin');
  if (!origin) return true;
  const host = header(req, 'host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Attach the HTTP protocol to an existing host object. Exported separately so
 * tests can exercise routing without binding a port.
 */
export function createHttpHost(host, options = {}) {
  const token = String(options.token || randomBytes(16).toString('hex'));
  const version = String(options.version || 'unknown');

  const server = http.createServer(async (req, res) => {
    try {
      if (!isLoopback(req.socket.remoteAddress)) {
        sendJson(res, 403, { ok: false, error: 'loopback clients only' });
        return;
      }
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/health') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        sendJson(res, 200, { ok: true, name: SERVER_NAME, host: 'http', version });
        return;
      }
      const action = ACTIONS[url.pathname];
      if (!action) {
        sendJson(res, 404, { ok: false, error: 'not found' });
        return;
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      if (!originAllowed(req)) {
        sendJson(res, 403, { ok: false, error: 'cross-site requests are not allowed' });
        return;
      }
      if (!authorized(req, token)) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      const type = String(header(req, 'content-type') || '').toLowerCase();
      if (!type.includes('application/json')) {
        sendJson(res, 415, { ok: false, error: 'content-type must be application/json' });
        return;
      }
      let args;
      try {
        const raw = await readBody(req);
        args = raw.trim() ? JSON.parse(raw) : {};
      } catch (error) {
        sendJson(res, error.status || 400, { ok: false, error: error.status === 413 ? error.message : 'invalid JSON body' });
        return;
      }
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        sendJson(res, 400, { ok: false, error: 'request body must be a JSON object' });
        return;
      }
      const missing = (REQUIRED_ARGS[action] || []).filter(
        (key) => args[key] === undefined || args[key] === null || args[key] === '',
      );
      if (missing.length) {
        sendJson(res, 400, { ok: false, error: `missing argument: ${missing.join(', ')}` });
        return;
      }
      try {
        const result = host[action](args);
        sendJson(res, 200, { ok: true, result });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) });
      }
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) });
    }
  });
  return { server, token, version };
}

/**
 * Start the HTTP host on loopback. Port 0 picks an ephemeral port, which is the
 * default for tests and for callers that do not want a fixed port.
 */
export async function startHttpHost(host, options = {}) {
  const created = createHttpHost(host, options);
  const port = Number.isInteger(options.port) ? options.port : 0;
  const hostname = '127.0.0.1';
  await new Promise((resolve, reject) => {
    created.server.once('error', reject);
    created.server.listen(port, hostname, resolve);
  });
  const address = created.server.address();
  const actualPort = address && typeof address === 'object' ? address.port : port;
  const origin = `http://${hostname}:${actualPort}`;
  return {
    ...created,
    origin,
    port: actualPort,
    close: () => new Promise((resolve) => {
      created.server.close(() => resolve());
      if (typeof created.server.closeAllConnections === 'function') created.server.closeAllConnections();
    }),
  };
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') result.root = argv[++i];
    else if (arg.startsWith('--root=')) result.root = arg.slice('--root='.length);
    else if (arg === '--global-root') result.globalRoot = argv[++i];
    else if (arg === '--registry') result.registryFile = argv[++i];
    else if (arg === '--port') result.port = Number(argv[++i]);
    else if (arg.startsWith('--port=')) result.port = Number(arg.slice('--port='.length));
    else if (arg === '--token') result.token = argv[++i];
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const legacyRoot = path.resolve(args.root || process.env.KB_ROOT || process.cwd());
  const host = createHost({
    legacyRoot,
    globalRoot: args.globalRoot || process.env.KB_GLOBAL_ROOT,
    registryFile: args.registryFile || process.env.KB_REGISTRY_FILE,
  });
  const started = await startHttpHost(host, {
    port: Number.isInteger(args.port) ? args.port : 0,
    token: args.token || process.env.KB_HTTP_TOKEN,
    version: host.status({ cwd: legacyRoot }).version,
  });
  process.stderr.write(`[kb-http] root=${legacyRoot} origin=${started.origin}\n`);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    origin: started.origin,
    token: started.token,
    version: started.version,
  })}\n`);
  const shutdown = () => {
    started.close().then(() => process.exit(0)).catch(() => process.exit(1));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`[kb-http] ${String(error && error.message ? error.message : error)}\n`);
    process.exit(2);
  });
}
