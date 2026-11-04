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
 */
export function expandQuery(query) {
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
  return { terms: terms.slice(0, 10), via, groups };
}
