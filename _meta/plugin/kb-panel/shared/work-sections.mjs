/**
 * The five section names of a work page (`type: work`).
 *
 * `kb.mjs` writes them, `work-brief.js` reads them, and the template duplicates
 * them as literal Markdown. `validate` compares the template headings against
 * this list so a renamed section cannot silently stop the brief from rendering.
 */
export const WORK_SECTIONS = Object.freeze(['当前阶段', '在办', '未决', '下一步', '关联']);
