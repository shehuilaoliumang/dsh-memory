/**
 * Query-side semantic expansion for the read-only full-text search fallback.
 *
 * This is deliberately **not** an embedding model: the KB engine stays
 * zero-dependency and offline. It is a small, auditable synonym table over the
 * vocabulary this project actually uses (memory stores, injection, publish,
 * judge, permissions, work pages). Expansion candidates are appended only when
 * literal BM25 found fewer than three hits, at a lower score, and every result
 * says why it matched. Nothing is written.
 *
 * When the table has no group matching the query, `expandQuery` returns an
 * empty list and search behaves exactly like the lexical ranker.
 *
 * Expansion can also be seeded with catalog-derived terms (see
 * `expandQueryWithRows`): the top literal hits already carry tags/subject/title,
 * which often name the exact vocabulary the query paraphrased.
 */
export const SEMANTIC_GROUPS = [
  ['发布', '上线', '部署', 'public 快照', 'release', 'publish', 'deploy'],
  ['删除', '移除', '清理', '物理删除', 'delete', 'remove', 'cleanup'],
  ['记忆', '知识库', '记忆库', 'memory', 'kb', 'knowledge base'],
  ['检索', '搜索', '查找', '全文检索', 'search', 'query', 'lookup'],
  ['注入', '上下文', 'inject', 'injection', 'context'],
  ['权限', '授权', '写入', '只读', 'writable', 'permission', 'attach'],
  ['改名', '重命名', 'rename'],
  ['迁移', '移动', '重定位', 'relocate', 'move'],
  ['测试', '冒烟', '验证', '回归', 'test', 'smoke', 'verify'],
  ['快照', '导出', '脱敏', 'snapshot', 'export', 'redact'],
  ['裁判', '抽取', '判定', '裁决', 'judge', 'extract', 'verdict'],
  ['工作页', '简报', '项目状态', 'work', 'brief'],
  ['范围', '作用域', 'scope'],
  ['状态', '生命周期', 'status', 'lifecycle'],
  ['整理', '归档', 'consolidate', 'archive'],
  ['安装', '接入', 'install', 'attach'],
  ['安全', '风险', '信任', 'security', 'risk', 'trust'],
  ['决策', 'adr', 'decision'],
  ['配置', '设置', 'config', 'setting'],
  ['索引', '目录', 'catalog', 'index'],
  ['检索排序', '相关性', '热度', 'relevance', 'heat', 'rank'],
];

const ASCII_ALIAS = /^[a-z0-9][a-z0-9 ._-]*$/i;
const HAN_ALIAS = /^[\u3400-\u9fff]+$/;

/** Catalog-derived query terms are advisory seeds, capped separately. */
export const EXTRA_TERM_LIMIT = 4;
const EXTRA_TERM_VIA = '目录扩展';
const ROW_SCAN_LIMIT = 3;
const ROW_TERM_LIMIT = 12;

/** Structure words that say nothing about what a note is about. */
const GENERIC_TERMS = new Set(['项目', '记忆', '文件', '规则', '测试', '全局', '笔记', '内容', '说明', '文档', '更新', '系统']);

/** ASCII function words dropped from row-derived candidates. */
const GENERIC_ASCII = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'are', 'was', 'not']);

const ROW_ASCII = /[a-z0-9][a-z0-9._-]*/g;
const ROW_HAN = /[\u3400-\u9fff]+/g;

function asciiWords(text) {
  return new Set(String(text || '').toLowerCase().normalize('NFKC').match(/[a-z0-9][a-z0-9._-]*/g) || []);
}

/**
 * Expand a query through the synonym table.
 * Returns `{ terms, via, groups }`:
 * - `terms`: new terms to append to the query (never repeats a term already in
 *   the query; at most 4 per matching group, 10 total);
 * - `via`: the alias that caused each expansion (for the result label);
 * - `groups`: matched group indexes.
 *
 * `options.extraTerms` seeds extra candidates from another source (the catalog
 * rows); at most `EXTRA_TERM_LIMIT` are used, after normalizing/de-duping, and
 * `via` gains `目录扩展` so the result label stays truthful.
 */
export function expandQuery(query, options = {}) {
  const raw = String(query || '').toLowerCase().normalize('NFKC');
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return { terms: [], via: [], groups: [] };
  const words = asciiWords(text);
  const terms = [];
  const via = [];
  const groups = [];
  const seen = new Set();
  for (const group of SEMANTIC_GROUPS) {
    let hit = '';
    for (const alias of group) {
      const needle = alias.toLowerCase();
      if (ASCII_ALIAS.test(alias)) {
        if (words.has(needle)) {
          hit = alias;
          break;
        }
      } else if (HAN_ALIAS.test(alias) && needle.length >= 2 && text.includes(needle)) {
        hit = alias;
        break;
      }
    }
    if (!hit) continue;
    const additions = [];
    for (const alias of group) {
      const needle = alias.toLowerCase();
      if (needle === hit.toLowerCase()) continue;
      if (text.includes(needle)) continue;
      if (seen.has(needle)) continue;
      seen.add(needle);
      additions.push(needle);
      if (additions.length >= 4) break;
    }
    if (!additions.length) continue;
    groups.push(SEMANTIC_GROUPS.indexOf(group));
    via.push(hit);
    terms.push(...additions);
    if (terms.length >= 10) break;
  }
  const extraTerms = Array.isArray(options.extraTerms) ? options.extraTerms : [];
  let extraUsed = 0;
  for (const value of extraTerms) {
    if (terms.length >= 10 || extraUsed >= EXTRA_TERM_LIMIT) break;
    const candidate = normalizeTerm(value);
    if (candidate.length < 2 || text.includes(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    terms.push(candidate);
    extraUsed += 1;
  }
  if (extraUsed && !via.includes(EXTRA_TERM_VIA)) via.push(EXTRA_TERM_VIA);
  return { terms: terms.slice(0, 10), via, groups };
}

function normalizeTerm(value) {
  return String(value || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/**
 * Propose expansion candidates from one metadata field: ASCII words of 3+
 * characters that contain a letter, plus every bigram of each 4+ character Han
 * run. Generic structure words are dropped so `记忆写入边界` contributes `写入`
 * and `边界` rather than `记忆`.
 */
function deriveRowTerms(value) {
  const text = normalizeTerm(value);
  if (!text) return [];
  const terms = [];
  for (const hit of text.matchAll(ROW_ASCII)) {
    const word = hit[0];
    if (word.length < 3 || !/[a-z]/.test(word) || GENERIC_ASCII.has(word)) continue;
    terms.push(word);
  }
  for (const hit of text.matchAll(ROW_HAN)) {
    const chars = [...hit[0]];
    if (chars.length < 4) continue;
    for (let i = 0; i + 1 < chars.length; i += 1) {
      const bigram = chars[i] + chars[i + 1];
      if (!GENERIC_TERMS.has(bigram)) terms.push(bigram);
    }
  }
  return terms;
}

function rowFields(row) {
  if (!row || typeof row !== 'object') return [];
  const fields = [];
  const tags = row.tags;
  if (Array.isArray(tags)) {
    for (const tag of tags) if (tag) fields.push(String(tag));
  } else if (typeof tags === 'string' && tags) {
    fields.push(tags);
  }
  if (typeof row.subject === 'string' && row.subject) fields.push(row.subject);
  if (typeof row.title === 'string' && row.title) fields.push(row.title);
  return fields;
}

/**
 * Expand a query with terms derived from the catalog metadata of the top rows
 * (the caller passes the literal hits). Reads at most `ROW_SCAN_LIMIT` rows and
 * proposes at most `ROW_TERM_LIMIT` candidates, then defers the cap/de-dupe/
 * not-already-in-query rules to `expandQuery`. With no rows this is exactly
 * `expandQuery(query)`.
 */
export function expandQueryWithRows(query, rows) {
  const base = expandQuery(query);
  if (!Array.isArray(rows) || !rows.length) return base;
  const derived = [];
  const pushed = new Set();
  for (const row of rows.slice(0, ROW_SCAN_LIMIT)) {
    const fields = rowFields(row);
    for (const field of fields) {
      for (const term of deriveRowTerms(field)) {
        if (derived.length >= ROW_TERM_LIMIT) break;
        if (pushed.has(term)) continue;
        pushed.add(term);
        derived.push(term);
      }
      if (derived.length >= ROW_TERM_LIMIT) break;
    }
    if (derived.length >= ROW_TERM_LIMIT) break;
  }
  if (!derived.length) return base;
  return expandQuery(query, { extraTerms: derived });
}
