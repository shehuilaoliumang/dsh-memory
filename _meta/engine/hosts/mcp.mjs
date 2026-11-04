#!/usr/bin/env node
/**
 * MCP stdio host for the memory engine (3.0 P3, second-host proof).
 *
 * This adapter is deliberately thin: it speaks JSON-RPC 2.0 over newline-
 * delimited stdin/stdout and forwards to `_meta/engine/lib/host.mjs`. It has no
 * DSH, SDK or npm dependency, so the same rules can be driven by any MCP client.
 *
 * Usage:
 *   node _meta/engine/hosts/mcp.mjs --root <legacy-vault>
 *
 * Environment fallbacks: KB_ROOT, KB_GLOBAL_ROOT, KB_REGISTRY_FILE.
 * Logs go to stderr; stdout is protocol only.
 */
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

import { createHost } from '../lib/host.mjs';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'dsh-memory-kb';

export const TOOL_DEFINITIONS = [
  {
    name: 'kb_context',
    description: 'Read the memory context (core docs, injected memories, resume brief) for a working directory. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Working directory of the session.' },
        query: { type: 'string', description: 'Optional current task text used for relevance ordering.' },
        pinned_ids: { type: 'array', items: { type: 'string' }, description: 'Optional ids pinned for this session.' },
        muted_ids: { type: 'array', items: { type: 'string' }, description: 'Optional ids silenced for this session.' },
      },
      required: ['cwd'],
    },
  },
  {
    name: 'kb_search',
    description: 'Read-only full-text search across one store or every store. Returns BM25 hits with pinyin/synonym fallback.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Working directory of the session.' },
        query: { type: 'string', description: 'Search text.' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum result count (default 5).' },
        workspace: { type: 'string', description: "Store id, 'session' (default) or 'all'." },
      },
      required: ['cwd', 'query'],
    },
  },
  {
    name: 'kb_remember',
    description: 'Write one inbox memory in the session writable store. Inbox memories never inject until a human confirms them.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Working directory of the session.' },
        text: { type: 'string', description: 'Memory text (multi-line allowed, up to 4000 chars).' },
        title: { type: 'string', description: 'Optional title.' },
        summary: { type: 'string', description: 'Optional one-line summary.' },
        type: { type: 'string', description: 'Atom type (default fact).' },
      },
      required: ['cwd', 'text'],
    },
  },
  {
    name: 'kb_status',
    description: 'Report engine version, known stores and note counts. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { cwd: { type: 'string', description: 'Working directory of the session.' } },
      required: ['cwd'],
    },
  },
  {
    name: 'kb_validate',
    description: 'Validate a known store: frontmatter, scopes, subjects and indexes. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { cwd: { type: 'string', description: 'A known store root (defaults to the host root).' } },
    },
  },
];

const TOOL_HANDLERS = {
  kb_context: (host, args) => host.context(args),
  kb_search: (host, args) => host.search(args),
  kb_remember: (host, args) => host.remember(args),
  kb_status: (host, args) => host.status(args),
  kb_validate: (host, args) => host.validate(args),
};

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } };
}

/**
 * One protocol exchange. Pure apart from the host actions; returns null for a
 * notification (no response must be written).
 */
export function handleRpc(host, message, options = {}) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
    return rpcError(message && message.id, -32600, 'invalid request');
  }
  const id = message.id;
  const isNotification = id === undefined || id === null;
  const method = String(message.method || '');
  const params = message.params && typeof message.params === 'object' ? message.params : {};
  const respond = (result) => (isNotification ? null : { jsonrpc: '2.0', id, result });

  try {
    switch (method) {
      case 'initialize':
        return respond({
          protocolVersion: String(params.protocolVersion || PROTOCOL_VERSION),
          capabilities: { tools: { listChanged: false }, resources: {} },
          serverInfo: { name: SERVER_NAME, version: options.version || 'unknown' },
        });
      case 'notifications/initialized':
      case 'initialized':
      case 'shutdown':
      case 'exit':
        return null;
      case 'ping':
        return respond({});
      case 'resources/list':
        return respond({ resources: [] });
      case 'tools/list': {
        const tools = options.tools || TOOL_DEFINITIONS;
        return respond({ tools });
      }
      case 'tools/call': {
        const name = String(params.name || '');
        const handler = TOOL_HANDLERS[name];
        if (!handler) return rpcError(id, -32601, `unknown tool: ${name}`);
        const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
        const toolOptions = options.tools || TOOL_DEFINITIONS;
        const tool = toolOptions.find((candidate) => candidate.name === name);
        const required = (tool && tool.inputSchema && tool.inputSchema.required) || [];
        const missing = required.filter((key) => args[key] === undefined || args[key] === null || args[key] === '');
        if (missing.length) return rpcError(id, -32602, `missing argument: ${missing.join(', ')}`);
        try {
          const payload = handler(host, args);
          return respond({
            content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
            isError: false,
          });
        } catch (error) {
          return respond({
            content: [{ type: 'text', text: String(error && error.message ? error.message : error) }],
            isError: true,
          });
        }
      }
      default:
        return rpcError(id, -32601, `method not found: ${method}`);
    }
  } catch (error) {
    return rpcError(id, -32603, String(error && error.message ? error.message : error));
  }
}

/** Newline-delimited JSON transport over stdin/stdout. */
export function runStdio(host, options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const write = (message) => {
    if (!message) return;
    output.write(`${JSON.stringify(message)}\n`);
  };
  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      write(rpcError(null, -32700, 'parse error'));
      return;
    }
    write(handleRpc(host, message, options));
  });
  return rl;
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') result.root = argv[++i];
    else if (arg.startsWith('--root=')) result.root = arg.slice('--root='.length);
    else if (arg === '--global-root') result.globalRoot = argv[++i];
    else if (arg === '--registry') result.registryFile = argv[++i];
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const legacyRoot = path.resolve(args.root || process.env.KB_ROOT || process.cwd());
  const host = createHost({
    legacyRoot,
    globalRoot: args.globalRoot || process.env.KB_GLOBAL_ROOT,
    registryFile: args.registryFile || process.env.KB_REGISTRY_FILE,
  });
  process.stderr.write(`[kb-mcp] root=${legacyRoot}\n`);
  runStdio(host, { version: host.status({ cwd: legacyRoot }).version });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[kb-mcp] ${String(error && error.message ? error.message : error)}\n`);
    process.exit(2);
  }
}
