// Public module surface of @local/kb-engine.
//
// The CLI (bin/kb.mjs) is the ingestion interface used by hosts and scripts;
// these exports are the reusable pure modules a host can import directly.
// `runCli` / `createEngine` are the in-process command surface for hosts that
// would otherwise spawn one process per command.
export * from './context.mjs';
export * from './stores.mjs';
export * from './work-brief.mjs';
export * from './injection.mjs';
export * from './read-model.mjs';
export * from './candidates.mjs';
export * from './health.mjs';
export * from './search/intent.mjs';
export * from './search/vector.mjs';
export * from './search/semantic.mjs';
export * from './promote.mjs';
export * from './redact.mjs';
export { runCli, createEngine } from './cli.mjs';
export { parseFrontmatter, parseFrontmatterData, stripFrontmatter } from './shared/frontmatter.mjs';
export { WORK_SECTIONS } from './shared/work-sections.mjs';
