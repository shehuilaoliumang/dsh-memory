// Public module surface of @local/kb-engine.
//
// The CLI (bin/kb.mjs) is the ingestion interface used by hosts and scripts;
// these exports are the reusable pure modules a host can import directly.
export * from './context.mjs';
export * from './stores.mjs';
export * from './work-brief.mjs';
export * from './promote.mjs';
export * from './redact.mjs';
export { parseFrontmatter, parseFrontmatterData, stripFrontmatter } from './shared/frontmatter.mjs';
export { WORK_SECTIONS } from './shared/work-sections.mjs';
