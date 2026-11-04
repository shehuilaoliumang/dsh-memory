# Host contract (3.0)

Every host — the DSH panel, the CLI, the MCP server — must read memory through
`_meta/engine/lib/read-model.mjs` and act through `_meta/engine/lib/host.mjs`.
A host adapter is only allowed to translate its own protocol to these calls; it
must not re-implement injection, ranking, scoping or search rules.

## Required actions

| Action | Signature | Rules |
| --- | --- | --- |
| context | `context({cwd, query?, pinnedIds?, mutedIds?})` | Reads core docs, the selected memories and the resume brief. Never writes. |
| search | `search({cwd, query, limit?, workspace?})` | Read-only. `workspace='all'` unions registered stores and tags each row. Never writes recall rows. |
| remember | `remember({cwd, text, title?, summary?, type?})` | Writes exactly one `inbox` atom in the session's writable store; the atom cannot inject until a human confirms it. Fail-closed when no store is writable. |
| status | `status({cwd})` | Version, known stores and note counts. Read-only. |
| validate | `validate({cwd?})` | Schema/index validation; only known store roots are accepted. Read-only. |

## Invariants

1. **No paths for reads.** `cwd` is a working directory; store targets resolve
   through the user registry or the configured legacy root. A host must not
   accept a store path from a model/client.
2. **Writes are fail-closed.** Only `remember` writes, only to
   `resolveWriteTarget(cwd)`, and only as `inbox`. The global store is never
   written from a project session.
3. **One rule source.** Context selection, explanation labels and search all come
   from the same `surface` instance / same candidate universe.
4. **Zero dependencies.** Hosts may depend on the engine; the engine never
   depends on a host (no DSH imports, no SDK).
5. **stdout is protocol only.** Logs and diagnostics go to stderr.

## MCP adapter

`_meta/engine/hosts/mcp.mjs` is the reference second host. It speaks JSON-RPC
2.0 over newline-delimited stdin/stdout and exposes the five actions as
`kb_context`, `kb_search`, `kb_remember`, `kb_status`, `kb_validate`.

```bash
node _meta/engine/hosts/mcp.mjs --root <legacy-vault>
# env fallbacks: KB_ROOT, KB_GLOBAL_ROOT, KB_REGISTRY_FILE
```

A client calls `initialize`, then `tools/list` / `tools/call`. Tool failures are
returned as MCP tool results with `isError: true`; transport and unknown-method
failures use JSON-RPC errors.

## Adding a host

1. Build `createHost({legacyRoot, globalRoot?, registryFile?})`.
2. Map its protocol onto the five actions; no engine rule belongs in the adapter.
3. Prove parity against `_meta/engine/test/parity/` and add adapter tests that do
   not require a live model.
4. Record the adapter and its trust boundary in the ADR / engine README.
