#!/usr/bin/env node
/**
 * kb.mjs — Obsidian 永久知识库的规则层（零依赖，Node ≥ 20）
 *
 * 对应 _meta/schema.md 的五步管线：本脚本负责第 1/2/4/5 步里的"规则部分"，
 * 第 3 步语义裁判由 DSH 子代理完成（见 cmdCandidates 的输出格式）。
 *
 *   node _meta/scripts/kb.mjs validate [--json]        # 校验 schema / id / 链接 / 索引一致性
 *   node _meta/scripts/kb.mjs rebuild [--dry-run]      # 从笔记重建 catalog*.jsonl（禁止手改）
 *   node _meta/scripts/kb.mjs stats [--json]           # 分层与状态统计
 *   node _meta/scripts/kb.mjs id-next --kind a|t|c|w   # 下一个可用 id
 *   node _meta/scripts/kb.mjs work-new --scope S [--title T]   # 新建工作页（type: work）
 *   node _meta/scripts/kb.mjs work-brief --scope S [--json]    # 恢复简报（注入用，非记忆）
 *   node _meta/scripts/kb.mjs append-session --slug S --title T [--role user|assistant] [--text ...|--text-file F]
 *   node _meta/scripts/kb.mjs candidates [--file F|--text ...] [--json]   # 门控 + 候选提取
 *   node _meta/scripts/kb.mjs consolidate [--json]     # 每日整理：stale/review/未归主题/重复
 *   node _meta/scripts/kb.mjs log --action X --note Y  # 追加 _meta/log.md
 *
 * 约定：时间一律取系统时钟；脚本只写它负责的派生文件与原文追加，绝不删除、不移动笔记。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { briefText } from '../plugin/kb-panel/work-brief.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = JSON.parse(readText(path.join(ROOT, '_meta', 'config.json')));
const P = {
  catalog: path.join(ROOT, CONFIG.paths.catalog),
  archive: path.join(ROOT, CONFIG.paths.archive),
  access: path.join(ROOT, CONFIG.paths.access),
  changeLog: path.join(ROOT, CONFIG.paths.changeLog),
  sessions: path.join(ROOT, CONFIG.paths.sessions),
};

const LAYERS = [
  { level: 'raw', dir: '10_Raw' },
  { level: 'digest', dir: '20_Digest' },
  { level: 'canon', dir: '30_Canon' },
];
const TYPES = ['fact', 'preference', 'decision', 'opinion', 'question', 'task', 'definition', 'topic', 'work', 'principle', 'session'];
const STATUSES = ['inbox', 'active', 'review', 'stale', 'promoted', 'archived', 'canon'];
const CANON_NOTE_ID = /^\d{4}-\d{2}-\d{2}-[atcw]-\d{4}$/;
const WORK_SCOPE = /^(global|project:[a-z0-9][a-z0-9-]*)$/;
const WORK_DIR = '20_Digest/work';
const SESSION_ID = /^\d{4}-\d{2}-\d{2}-\d{4}$/;

// ---------------------------------------------------------------- 基础 I/O

function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return readText(file)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function writeJsonl(file, rows) {
  writeText(file, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}

function relPath(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTime(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDate(d);
}

// ------------------------------------------------------- frontmatter 解析

function splitInlineArray(s) {
  const out = [];
  let cur = '';
  let quote = null;
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== '') out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function parseScalar(raw) {
  const v = raw.trim();
  if (v === '') return '';
  if ((v.startsWith('"') && v.endsWith('"') && v.length > 1) || (v.startsWith("'") && v.endsWith("'") && v.length > 1)) {
    return v.slice(1, -1);
  }
  if (v.startsWith('[') && v.endsWith(']')) {
    return splitInlineArray(v.slice(1, -1)).map(parseScalar);
  }
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: null, body: text };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    if (!key || key.startsWith('-')) continue;
    data[key] = parseScalar(line.slice(i + 1));
  }
  return { data, body: text.slice(m[0].length) };
}

function splitLinks(value) {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  const out = [];
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    const re = /\[\[([^\]]+)\]\]/g;
    let hit;
    while ((hit = re.exec(item))) {
      out.push(hit[1].split('|')[0].trim());
    }
  }
  return out;
}

// -------------------------------------------------------------- 笔记扫描

function walk(dir, visit) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, visit);
    else if (ent.isFile() && ent.name.endsWith('.md')) visit(full);
  }
}

function loadNotes() {
  const notes = [];
  for (const layer of LAYERS) {
    walk(path.join(ROOT, layer.dir), (file) => {
      const base = path.basename(file);
      if (base.startsWith('_')) return; // _about.md 之类的说明页不参与
      const text = readText(file);
      const { data } = parseFrontmatter(text);
      notes.push({
        file,
        rel: relPath(file),
        data,
        layer: layer.level,
        fixed: base === 'core.md',
      });
    });
  }
  return notes;
}

function idIndex(notes) {
  const map = new Map();
  for (const n of notes) {
    if (n.data && typeof n.data.id === 'string' && n.data.id) map.set(n.data.id, n);
  }
  return map;
}

function toRow(note) {
  const d = note.data;
  return {
    id: d.id,
    path: note.rel,
    level: d.level,
    type: d.type,
    status: d.status,
    tags: Array.isArray(d.tags) ? d.tags : d.tags ? [d.tags] : [],
    summary: typeof d.summary === 'string' ? d.summary : '',
    updated: d.updated,
  };
}

/**
 * Keep one derived index row inside the byte budget (schema §7). A long title or
 * a deep session path can push a row over the limit even when `summary` obeys
 * its own character cap, so the summary is shortened until the serialized row
 * fits. Only the index is shortened — the note body keeps the full text.
 */
function fitRow(row, maxBytes) {
  const budget = Number(maxBytes) > 0 ? Number(maxBytes) : 300;
  if (Buffer.byteLength(JSON.stringify(row), 'utf8') <= budget) return row;
  const chars = [...String(row.summary || '')];
  while (chars.length > 0) {
    chars.pop();
    const candidate = { ...row, summary: chars.join('') };
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= budget) return candidate;
  }
  return { ...row, summary: '' };
}

// ---------------------------------------------------------------- 校验

function cmdValidate(opts) {
  const notes = loadNotes();
  const catalog = readJsonl(P.catalog);
  const archive = readJsonl(P.archive);
  const errors = [];
  const warnings = [];
  const seen = new Set();
  const byId = idIndex(notes);
  const knownIds = new Set([...byId.keys()]);

  for (const n of notes) {
    const where = n.rel;
    if (n.fixed) {
      if (!n.data) errors.push(`${where}: core.md 缺少 frontmatter`);
      continue;
    }
    if (!n.data) {
      errors.push(`${where}: 缺少 frontmatter（不是合法笔记）`);
      continue;
    }
    const d = n.data;
    for (const key of ['id', 'title', 'level', 'type', 'status', 'summary', 'updated']) {
      if (d[key] === undefined || d[key] === '') errors.push(`${where}: 缺少必填字段 ${key}`);
    }
    if (typeof d.id === 'string') {
      const ok = d.type === 'session' ? SESSION_ID.test(d.id) : CANON_NOTE_ID.test(d.id);
      if (!ok) errors.push(`${where}: id 格式不合法 (${d.id})`);
      if (seen.has(d.id)) errors.push(`${where}: id 重复 (${d.id})`);
      seen.add(d.id);
    }
    if (d.level !== n.layer) {
      errors.push(`${where}: level=${d.level} 与所在层 ${n.layer} 不符`);
    }
    if (d.type && !TYPES.includes(d.type)) errors.push(`${where}: type 不在枚举内 (${d.type})`);
    if (d.status && !STATUSES.includes(d.status)) errors.push(`${where}: status 不在枚举内 (${d.status})`);
    // Kind must match the id: a work page hiding behind an `a-` id would dodge
    // the work-specific checks below.
    if (d.type === 'work' && typeof d.id === 'string' && !/^\d{4}-\d{2}-\d{2}-w-\d{4}$/.test(d.id)) {
      errors.push(`${where}: type=work 的 id 必须是 w 段`);
    }
    if (d.type === 'topic' && typeof d.id === 'string' && !/^\d{4}-\d{2}-\d{2}-t-\d{4}$/.test(d.id)) {
      errors.push(`${where}: type=topic 的 id 必须是 t 段`);
    }
    // Note: `scope` is NOT a hard requirement. A memory without scope is valid
    // but can never be injected (fail closed); the UI's "取消范围" depends on it.
    // 工作页是“状态页”而不是记忆：固定目录、固定 scope、固定生命周期。
    // 注入侧另有 type 白名单兜底，所以它们永远不会占用记忆预算。
    if (d.type === 'work') {
      if (!n.rel.startsWith(`${WORK_DIR}/`)) errors.push(`${where}: type=work 必须放在 ${WORK_DIR}/ 下`);
      if (!WORK_SCOPE.test(String(d.scope || ''))) errors.push(`${where}: work 页 scope 必须是 global 或 project:<slug>`);
      if (!['active', 'archived'].includes(d.status)) errors.push(`${where}: work 页 status 只能是 active / archived`);
    } else if (n.rel.startsWith(`${WORK_DIR}/`)) {
      errors.push(`${where}: ${WORK_DIR}/ 下只放 type=work 的工作页`);
    }
    if (typeof d.summary === 'string' && [...d.summary].length > CONFIG.limits.summary_max_chars) {
      errors.push(`${where}: summary 超 ${CONFIG.limits.summary_max_chars} 字`);
    }
    if (typeof d.updated === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(d.updated)) {
      errors.push(`${where}: updated 不是 YYYY-MM-DD`);
    }
    const base = path.basename(n.file);
    if (d.type === 'session') {
      if (typeof d.id === 'string' && !base.startsWith(`${d.id}-`)) {
        errors.push(`${where}: 会话文件名应为 <id>-<slug>.md`);
      }
    } else if (typeof d.id === 'string' && base !== `${d.id}.md`) {
      errors.push(`${where}: 文件名应为 <id>.md`);
    }
    for (const field of ['source', 'related', 'up', 'supersedes']) {
      for (const target of splitLinks(d[field])) {
        if (!resolveTarget(target, knownIds)) {
          errors.push(`${where}: ${field} 链接无法解析 → [[${target}]]`);
        }
      }
    }
    if (d.review_after && !/^\d{4}-\d{2}-\d{2}$/.test(String(d.review_after))) {
      errors.push(`${where}: review_after 不是 YYYY-MM-DD`);
    }
  }

  // 工作页是「一个 scope 一页」的状态页。work-new 会挡住重复创建，但手工
  // 复制文件仍可能造出两个 active 同 scope 页；简报只取最新一篇，另一篇会
  // 静默失效，所以这里必须报错。
  const activeWorkScopes = new Map();
  for (const n of notes) {
    if (n.fixed || n.data?.type !== 'work' || n.data.status !== 'active') continue;
    const scope = String(n.data.scope || '');
    const previous = activeWorkScopes.get(scope);
    if (previous) errors.push(`${n.rel}: 同一 scope 只能有一个 active 工作页（已有 ${previous}）`);
    else activeWorkScopes.set(scope, n.rel);
  }

  const expected = notes.filter((n) => !n.fixed && n.data).map((n) => fitRow(toRow(n), CONFIG.limits.catalog_max_bytes)).sort(byIdAsc);
  const expectedActive = expected.filter((r) => r.status !== 'archived');
  const expectedArchived = expected.filter((r) => r.status === 'archived');
  compareCatalog(expectedActive, catalog, 'catalog.jsonl', errors, warnings);
  compareCatalog(expectedArchived, archive, 'catalog.archive.jsonl', errors, warnings);

  for (const row of [...catalog, ...archive]) {
    const bytes = Buffer.byteLength(JSON.stringify(row), 'utf8');
    if (bytes > CONFIG.limits.catalog_max_bytes) {
      warnings.push(`索引行过长 ${bytes}B（上限 ${CONFIG.limits.catalog_max_bytes}B）: ${row.id}`);
    }
  }
  if (catalog.length + archive.length > CONFIG.limits.catalog_max_rows) {
    warnings.push(`索引总行数 ${catalog.length + archive.length} 超过 ${CONFIG.limits.catalog_max_rows}，该考虑归档了`);
  }

  const result = { ok: errors.length === 0, notes: notes.length, catalog: catalog.length, archive: archive.length, errors, warnings };
  if (opts.json) {
    out(JSON.stringify(result, null, 2));
  } else {
    out(`笔记 ${notes.length} 篇（含 core.md） | 主索引 ${catalog.length} 行 | 归档索引 ${archive.length} 行`);
    for (const w of warnings) out(`⚠ ${w}`);
    for (const e of errors) out(`✗ ${e}`);
    out(errors.length ? `校验失败：${errors.length} 个错误，${warnings.length} 个警告` : `校验通过（${warnings.length} 个警告）`);
  }
  process.exitCode = errors.length ? 1 : 0;
}

function resolveTarget(target, knownIds) {
  const clean = target.replace(/\.md$/, '');
  if (clean.includes('/')) return fs.existsSync(path.join(ROOT, clean + '.md'));
  return knownIds.has(clean);
}

function byIdAsc(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Append one human-readable line to `_meta/log.md` (the change log). */
function appendChangeLog(action, note) {
  const line = `${localDate()} ${localTime()} | ${action} | ${note}\n`;
  const text = readText(P.changeLog);
  fs.appendFileSync(P.changeLog, (text.endsWith('\n') ? '' : '\n') + line, 'utf8');
}

function compareCatalog(expected, actual, label, errors, warnings) {
  const exp = new Map(expected.map((r) => [r.id, r]));
  const act = new Map(actual.map((r) => [r.id, r]));
  for (const [id, row] of exp) {
    if (!act.has(id)) {
      errors.push(`${label}: 缺少 ${id}（索引是派生物，请运行 rebuild）`);
      continue;
    }
    const a = act.get(id);
    for (const key of ['path', 'level', 'type', 'status', 'summary', 'updated']) {
      if (a[key] !== row[key]) errors.push(`${label}: ${id} 的 ${key} 与笔记不一致（应运行 rebuild）`);
    }
    if (JSON.stringify(a.tags || []) !== JSON.stringify(row.tags || [])) {
      errors.push(`${label}: ${id} 的 tags 与笔记不一致（应运行 rebuild）`);
    }
  }
  for (const id of act.keys()) {
    if (!exp.has(id)) errors.push(`${label}: 多出 ${id}（笔记里不存在）`);
  }
}

// ---------------------------------------------------------------- 重建

/** Write both derived indexes from the current notes; returns the row counts. */
function rebuildIndexes() {
  const notes = loadNotes();
  const rows = notes.filter((n) => !n.fixed && n.data).map((n) => fitRow(toRow(n), CONFIG.limits.catalog_max_bytes)).sort(byIdAsc);
  const active = rows.filter((r) => r.status !== 'archived');
  const archived = rows.filter((r) => r.status === 'archived');
  writeJsonl(P.catalog, active);
  writeJsonl(P.archive, archived);
  return { active: active.length, archived: archived.length };
}

function cmdRebuild(opts) {
  const notes = loadNotes();
  const rows = notes.filter((n) => !n.fixed && n.data).map((n) => fitRow(toRow(n), CONFIG.limits.catalog_max_bytes)).sort(byIdAsc);
  const active = rows.filter((r) => r.status !== 'archived');
  const archived = rows.filter((r) => r.status === 'archived');
  const current = readJsonl(P.catalog);
  const currentArchive = readJsonl(P.archive);
  const sameActive = JSON.stringify(current) === JSON.stringify(active);
  const sameArchive = JSON.stringify(currentArchive) === JSON.stringify(archived);

  if (opts.dryRun) {
    out(`[dry-run] 主索引 ${current.length} → ${active.length} 行；归档索引 ${currentArchive.length} → ${archived.length} 行`);
    if (sameActive && sameArchive) {
      out('索引已是最新，无需重建。');
    } else {
      if (!sameActive) reportDiff(current, active, 'catalog.jsonl');
      if (!sameArchive) reportDiff(currentArchive, archived, 'catalog.archive.jsonl');
    }    return;
  }
  const counts = rebuildIndexes();
  out(`已重建：主索引 ${counts.active} 行，归档索引 ${counts.archived} 行。`);
}

function reportDiff(before, after, label) {
  const b = new Map(before.map((r) => [r.id, r]));
  const a = new Map(after.map((r) => [r.id, r]));
  for (const id of a.keys()) if (!b.has(id)) out(`  [+] ${label} ${id}`);
  for (const id of b.keys()) if (!a.has(id)) out(`  [-] ${label} ${id}`);
  for (const [id, row] of a) {
    if (b.has(id) && JSON.stringify(b.get(id)) !== JSON.stringify(row)) out(`  [~] ${label} ${id}`);
  }
  const beforeOrder = before.map((r) => r.id).join(',');
  const afterOrder = after.map((r) => r.id).join(',');
  if (beforeOrder !== afterOrder) out(`  [order] ${label} 行顺序将按 id 重排`);
}

// ---------------------------------------------------------------- 统计

function cmdStats(opts) {
  const notes = loadNotes().filter((n) => !n.fixed && n.data);
  const byLevel = Object.fromEntries(LAYERS.map((l) => [l.level, 0]));
  const byStatus = {};
  const byType = {};
  for (const n of notes) {
    byLevel[n.data.level] = (byLevel[n.data.level] || 0) + 1;
    byStatus[n.data.status] = (byStatus[n.data.status] || 0) + 1;
    byType[n.data.type] = (byType[n.data.type] || 0) + 1;
  }
  const data = { total: notes.length, byLevel, byStatus, byType, untriaged: byStatus.inbox || 0 };
  if (opts.json) return out(JSON.stringify(data, null, 2));
  out(`笔记总数 ${data.total}`);
  out(`分层：${Object.entries(byLevel).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  out(`状态：${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  out(`类型：${Object.entries(byType).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
}

// -------------------------------------------------------------- id 生成

/** Highest allocated sequence for one (date, kind) pair, plus one. */
function computeNextId(kind, date = localDate()) {
  if (!['a', 't', 'c', 'w'].includes(kind)) throw new Error('--kind 只能是 a / t / c / w');
  const notes = loadNotes();
  const re = new RegExp(`^${date}-${kind}-(\\d{4})$`);
  let max = 0;
  for (const n of notes) {
    const m = typeof n.data?.id === 'string' && n.data.id.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${date}-${kind}-${pad(max + 1, 4)}`;
}

function cmdIdNext(opts) {
  out(computeNextId(opts.kind || 'a', opts.date || localDate()));
}

// ------------------------------------------------------------ 原子写入
//
// The semantic judge (step 3) never writes notes itself: it hands the distilled
// payload here, so schema, id allocation, duplicate detection, index rebuild and
// the change log all stay in one place. Spec shape (JSON file):
//   { title, type, summary, points: string[], source?: string[], tags?: string[],
//     quote?: string, confidence?: number, status?: string, reviewAfter?: string }
const ATOM_STATUSES = ['active', 'inbox', 'review'];
const SCOPE_PATTERN = /^(system|global|project:[a-z0-9][a-z0-9-]*|unclassified)$/;
const STATUS_LIFECYCLE = ['inbox', 'active', 'review', 'stale', 'promoted', 'canon', 'archived'];
const ATOM_TYPES = TYPES.filter((t) => t !== 'session' && t !== 'topic' && t !== 'work');

function oneLine(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return max && [...text].length > max ? [...text].slice(0, max).join('') : text;
}

function inlineList(values, quote) {
  const items = (values || []).map((v) => oneLine(v, 80)).filter(Boolean);
  if (!items.length) return null;
  return `[${items.map((v) => (quote ? `"${v.replace(/"/g, "'")}"` : v)).join(', ')}]`;
}

function buildAtomNote(meta, body) {
  const lines = ['---'];
  for (const [key, value] of meta) if (value !== null && value !== undefined && value !== '') lines.push(`${key}: ${value}`);
  lines.push('---', '');
  return `${lines.join('\n')}\n${body}\n`;
}

function cmdAddAtom(opts) {
  if (!opts.jsonFile) throw new Error('add-atom 需要 --json-file F');
  const spec = JSON.parse(readText(path.resolve(opts.jsonFile)));

  const title = oneLine(spec.title, 80);
  if (!title) throw new Error('add-atom: title 不能为空');
  const type = oneLine(spec.type, 20);
  if (!ATOM_TYPES.includes(type)) throw new Error(`add-atom: type 必须是 ${ATOM_TYPES.join(' / ')}`);
  const summary = oneLine(spec.summary, CONFIG.limits.summary_max_chars);
  if (!summary) throw new Error('add-atom: summary 不能为空');
  const status = oneLine(spec.status, 12) || 'inbox';
  if (!ATOM_STATUSES.includes(status)) throw new Error(`add-atom: status 必须是 ${ATOM_STATUSES.join(' / ')}`);
  // Every atom carries a scope, because injection is scoped: only `global`
  // reaches the model automatically. A judge that forgets to classify lands in
  // `unclassified`, which is never injected — fail closed, review to fix.
  const scope = oneLine(spec.scope, 40) || 'unclassified';
  if (!SCOPE_PATTERN.test(scope)) throw new Error('add-atom: scope 必须是 system / global / project:<slug> / unclassified');
  const points = (Array.isArray(spec.points) ? spec.points : []).map((p) => oneLine(p, 200)).filter(Boolean).slice(0, 8);
  if (!points.length) throw new Error('add-atom: points 至少要有一条');
  const sources = (Array.isArray(spec.source) ? spec.source : spec.source ? [spec.source] : [])
    .map((s) => oneLine(s, 200))
    .filter((s) => /^\[\[[^\]]+\]\]$/.test(s));
  const tags = (Array.isArray(spec.tags) ? spec.tags : []).map((t) => oneLine(t, 20)).filter(Boolean);
  const confidence = Number.isFinite(Number(spec.confidence)) ? Math.min(1, Math.max(0, Number(spec.confidence))) : null;
  const reviewAfter = /^\d{4}-\d{2}-\d{2}$/.test(String(spec.reviewAfter || '')) ? String(spec.reviewAfter) : null;
  const quote = String(spec.quote || '').trim();
  const date = localDate();
  const id = computeNextId('a', date);

  // Duplicate guard: the schema derives identity from summary, so an identical
  // summary within the same type is treated as the same memory.
  const dup = loadNotes().find((n) => !n.fixed && n.data?.type === type && n.data?.summary === summary);
  if (dup) {
    const payload = { ok: true, id: dup.data.id, file: relPath(dup.file), duplicate: true, rebuilt: false };
    if (opts.json) return out(JSON.stringify(payload));
    return out(`已存在同 summary 的笔记：${dup.data.id}（未重复写入）`);
  }

  const meta = [
    ['id', id],
    ['title', title],
    ['level', 'digest'],
    ['type', type],
    ['scope', scope],
    ['status', status],
    ['confidence', confidence],
    ['summary', summary],
    ['source', inlineList(sources, true)],
    ['tags', tags.length ? `[${tags.join(', ')}]` : null],
    ['valid_from', date],
    ['review_after', reviewAfter],
    ['updated', date],
  ];
  const bodyLines = ['## 要点', ''];
  for (const point of points) bodyLines.push(`- ${point}`);
  if (quote) bodyLines.push('', '## 原文', '', ...quote.split(/\r?\n/).map((l) => `> ${l}`));
  bodyLines.push('', '## 备注', '', '（第 3 步裁判抽取，待人工复查）');
  const note = buildAtomNote(meta, bodyLines.join('\n') + '\n');
  const file = path.join(ROOT, '20_Digest', 'atoms', `${id}.md`);

  if (opts.dryRun) {
    return out(opts.json ? JSON.stringify({ ok: true, dryRun: true, id, file: relPath(file), note }) : `${relPath(file)}\n\n${note}`);
  }

  writeText(file, note);
  const counts = rebuildIndexes();
  try {
    appendChangeLog('atom', `${id}（${type}）${title}`);
  } catch {
    /* the change log is advisory; a failure must not lose the atom */
  }
  const payload = { ok: true, id, file: relPath(file), duplicate: false, rebuilt: true, index: counts };
  if (opts.json) return out(JSON.stringify(payload));
  out(`已写入 ${payload.file}\n主索引 ${counts.active} 行，归档 ${counts.archived} 行`);
}

/**
 * Move one note through its lifecycle without moving the file (schema §2):
 * `inbox → active` is the confirmation that lets a memory reach the model, and
 * `scope` decides which surface may inject it at all.
 */
function cmdSetStatus(opts) {
  const id = oneLine(opts.id, 40);
  if (!id) throw new Error('set-status 需要 --id');
  const status = oneLine(opts.status, 12) || 'active';
  if (!STATUS_LIFECYCLE.includes(status)) throw new Error(`set-status: 非法 status（可用 ${STATUS_LIFECYCLE.join(' / ')}）`);
  const scope = opts.scope ? oneLine(opts.scope, 40) : null;
  if (scope && !SCOPE_PATTERN.test(scope)) throw new Error('set-status: 非法 scope');
  const notes = loadNotes();
  const note = notes.find((n) => !n.fixed && n.data?.id === id);
  if (!note) throw new Error(`set-status: 找不到 ${id}`);
  if (note.data.type === 'work') {
    if (!['active', 'archived'].includes(status)) throw new Error('set-status: 工作页 status 只能是 active / archived');
    if (opts.clearScope) throw new Error('set-status: 工作页必须保留 scope（global 或 project:<slug>）');
    if (scope && !WORK_SCOPE.test(scope)) throw new Error('set-status: 工作页 scope 必须是 global 或 project:<slug>');
    // Restoring an archived page must not create a second active page for the
    // same scope: the brief would silently pick one of them.
    const effectiveScope = scope || String(note.data.scope || '');
    if (status === 'active') {
      const clash = activeWorkConflict(notes, id, effectiveScope);
      if (clash) throw new Error(`set-status: ${effectiveScope} 已有 active 工作页 ${clash.data.id}，请先归档它`);
    }
  }

  const before = readText(note.file);
  let text = before.replace(/^(status:)\s*.*$/m, `$1 ${status}`);
  if (opts.clearScope) {
    // Remove the field entirely: "取消全局" must return the note to its
    // un-scoped state, not relabel it.
    text = text.replace(/^scope:[^\n]*\n?/m, '');
  } else if (scope) {
    text = /^scope:/m.test(text)
      ? text.replace(/^(scope:)\s*.*$/m, `$1 ${scope}`)
      : text.replace(/^(type:[^\n]*)$/m, `$1\nscope: ${scope}`);
  }
  text = text.replace(/^(updated:)\s*.*$/m, `$1 ${localDate()}`);
  const changed = text !== before;
  if (changed) {
    writeText(note.file, text);
    rebuildIndexes();
    appendChangeLog('status', `${id} → ${status}${opts.clearScope ? '（清除 scope）' : scope ? ` scope=${scope}` : ''}`);
  }
  const payload = { ok: true, id, status, scope: opts.clearScope ? null : scope, cleared: opts.clearScope === true, changed };
  if (opts.json) return out(JSON.stringify(payload));
  const label = opts.clearScope ? '（已清除 scope）' : scope ? ` scope=${scope}` : '';
  out(changed ? `已更新 ${id} → status=${status}${label}` : `未变更：${id}`);
}

/**
 * Promote a lower-layer note into a canon note: the canon note must already
 * exist, and this only adds `up:` back-reference plus `status: promoted` — the
 * file itself never moves (schema §1「不搬家」).
 */
function cmdPromote(opts) {
  const id = oneLine(opts.id, 40);
  const target = oneLine(opts.to, 40);
  if (!id || !target) throw new Error('promote 需要 --id 与 --to');
  const notes = loadNotes();
  const note = notes.find((n) => !n.fixed && n.data?.id === id);
  if (!note) throw new Error(`promote: 找不到 ${id}`);
  if (note.data?.type === 'work') throw new Error('promote: 工作页是状态页，不能晋升');
  const canon = notes.find((n) => !n.fixed && n.data?.id === target);
  if (!canon) throw new Error(`promote: 找不到高层笔记 ${target}`);
  const canonLevel = String(canon.data.level || '');
  const noteLevel = String(note.data.level || '');
  if (canonLevel === noteLevel) throw new Error('promote: 目标必须位于更高的层（digest→canon 或 raw→digest/canon）');

  const before = readText(note.file);
  let text = before.replace(/^(status:)\s*.*$/m, '$1 promoted');
  const upLine = `up: ["[[${target}]]"]`;
  text = /^up:/m.test(text)
    ? text.replace(/^(up:)\s*.*$/m, upLine)
    : text.replace(/^(status:[^\n]*)$/m, `$1\n${upLine}`);
  text = text.replace(/^(updated:)\s*.*$/m, `$1 ${localDate()}`);
  const changed = text !== before;
  if (changed) {
    writeText(note.file, text);
    rebuildIndexes();
    appendChangeLog('promote', `${id} → ${target}`);
  }
  const payload = { ok: true, id, to: target, changed };
  if (opts.json) return out(JSON.stringify(payload));
  out(changed ? `已晋升 ${id} → ${target}（文件未移动）` : `未变更：${id}`);
}

// ------------------------------------------------------------ 会话追加

function findSessionFile(sessionId) {
  if (!sessionId) return null;
  const notes = loadNotes();
  const hit = notes.find((n) => n.data?.type === 'session' && n.data?.session_id === sessionId);
  return hit ? hit.file : null;
}

function cmdAppendSession(opts) {
  const text = opts.textFile ? readText(path.resolve(opts.textFile)) : opts.text || '';
  const role = opts.role || 'user';
  if (!['user', 'assistant'].includes(role)) throw new Error('--role 只能是 user / assistant');
  const sessionId = opts.sessionId || process.env.DSH_SESSION_ID || '';
  let file = findSessionFile(sessionId);
  let created = false;
  if (!file) {
    const date = localDate();
    const slug = (opts.slug || 'session').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session';
    const id = `${date}-${localTime().replace(':', '')}`;
    const title = opts.title || `会话 ${date}`;
    const summary = (opts.summary || `会话：${title}`).slice(0, CONFIG.limits.summary_max_chars);
    file = path.join(P.sessions, String(new Date().getFullYear()), pad(new Date().getMonth() + 1), `${id}-${slug}.md`);
    if (fs.existsSync(file)) throw new Error(`会话文件已存在：${relPath(file)}`);
    const fm = [
      '---',
      `id: ${id}`,
      `title: ${title}`,
      'level: raw',
      'type: session',
      'status: active',
      `summary: ${summary}`,
      sessionId ? `session_id: ${sessionId}` : null,
      `participants: [用户, DeepSeek Harness]`,
      `model: ${opts.model || 'deepseek-flash'}`,
      `updated: ${date}`,
      '---',
      '',
      `# ${date} ${localTime()} · ${title}`,
      '',
    ].filter((l) => l !== null).join('\n');
    writeText(file, fm);
    created = true;
  }
  const heading = role === 'user' ? '## 用户' : '## 助手结论';
  const chunk = `\n${heading}\n\n${text.trim()}\n`;
  fs.appendFileSync(file, chunk, 'utf8');
  // 刷新 updated 字段（只改日期，不动正文）
  const content = readText(file);
  const refreshed = content.replace(/^(updated: )\d{4}-\d{2}-\d{2}$/m, `$1${localDate()}`);
  if (refreshed !== content) fs.writeFileSync(file, refreshed, 'utf8');
  out(`${created ? '已新建并写入' : '已追加到'} ${relPath(file)}（${role}）`);
}

// ---------------------------------------------------------- 门控与候选

const PLEASANTRY = /^(好|好的|好吧|嗯+|哦|收到|ok|okay|行|可以|对|是的|没错|继续|同意|先做了|明白|了解|谢谢|感谢|thx|thanks)[。！!?？.,，~～\s]*$/i;

function gate(text) {
  const t = text.trim();
  if (!t) return { skip: true, reason: '空文本' };
  if (PLEASANTRY.test(t)) return { skip: true, reason: '寒暄 / 确认，无新信息' };
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  const head = lines.slice(0, 5);
  if (head.length && head.every((l) => /^\s*(>|\$|PS [A-Z]:|npm |pnpm |node )/.test(l))) {
    return { skip: true, reason: '命令输出粘贴' };
  }
  const triggers = (CONFIG.extract.trigger_words || []).filter((w) => t.includes(w));
  if (!triggers.length) return { skip: true, reason: '未命中触发词' };
  return { skip: false, triggers };
}

function cmdCandidates(opts) {
  const text = opts.file ? readText(path.resolve(opts.file)) : opts.text || '';
  if (!text.trim()) throw new Error('需要 --file 或 --text');
  const g = gate(text);
  if (g.skip) {
    const payload = { gate: g, candidates: [] };
    return out(opts.json ? JSON.stringify(payload, null, 2) : `跳过：${g.reason}`);
  }
  const sentences = text
    .split(/(?<=[。！？!?；;])|\r?\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
  const triggers = CONFIG.extract.trigger_words || [];
  const candidates = [];
  for (const s of sentences) {
    const hit = triggers.filter((w) => s.includes(w));
    if (hit.length) candidates.push({ text: s, triggers: hit });
  }
  const payload = { gate: g, sentences: sentences.length, candidates: candidates.slice(0, 20) };
  if (opts.json) return out(JSON.stringify(payload, null, 2));
  out(`门控通过（触发词：${g.triggers.join(' / ')}），候选 ${payload.candidates.length} 条：`);
  candidates.slice(0, 20).forEach((c, i) => out(`${i + 1}. ${c.text}`));
}

// ------------------------------------------------------------ 工作页（工作层）
//
// 工作页 = 项目状态的活页面（type: work），不是记忆：不注入、不计入未归主题、
// 可覆写。它存在的唯一目的，是让新会话用几十个字接上“做到哪、下一步是什么”。
// 工作指令本身不进工作页，它们只留在原文层（schema §6.1 / §13）。

function workPageNotes() {
  return loadNotes().filter((n) => !n.fixed && n.data?.type === 'work');
}

/** Another active work page already covering `scope` (excluding `id`). */
function activeWorkConflict(notes, id, scope) {
  return notes.find(
    (n) =>
      !n.fixed &&
      n.data?.type === 'work' &&
      n.data.status === 'active' &&
      n.data.id !== id &&
      String(n.data.scope || '') === scope,
  );
}

/** One compact brief for prompt injection. Work pages are never "memories". */
function buildWorkBrief(note) {
  if (!note) return '';
  const body = readText(note.file).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  // Shared with the Host plugin so CLI preview and injected text cannot drift.
  return briefText(note.data, body);
}

function cmdWorkBrief(opts) {
  const scope = oneLine(opts.scope, 40) || 'global';
  if (!WORK_SCOPE.test(scope)) throw new Error('work-brief: --scope 必须是 global 或 project:<slug>');
  const pages = workPageNotes()
    .filter((n) => String(n.data.scope) === scope && n.data.status === 'active')
    .sort((a, b) => String(b.data.updated).localeCompare(String(a.data.updated)));
  const page = pages[0];
  const payload = page
    ? { ok: true, scope, id: page.data.id, updated: page.data.updated, text: buildWorkBrief(page) }
    : { ok: true, scope, id: null, updated: null, text: '' };
  if (opts.json) return out(JSON.stringify(payload));
  out(payload.text || `（${scope} 没有工作页）`);
}

/**
 * Scaffold one work page. Deliberately not part of the judge pipeline: work
 * pages are human-owned state, and the pipeline must keep saying "no" to
 * procedural instructions. This command only creates the empty skeleton.
 */
function cmdWorkNew(opts) {
  const scope = oneLine(opts.scope, 40) || 'global';
  if (!WORK_SCOPE.test(scope)) throw new Error('work-new: --scope 必须是 global 或 project:<slug>');
  const existing = workPageNotes().find((n) => String(n.data.scope) === scope && n.data.status === 'active');
  if (existing) {
    const payload = { ok: true, existing: true, id: existing.data.id, file: existing.rel };
    if (opts.json) return out(JSON.stringify(payload));
    return out(`已存在工作页：${existing.data.id}（${scope}），未新建。`);
  }
  const title = oneLine(opts.title, 80) || (scope === 'global' ? '全局焦点' : `${scope.replace(/^project:/, '')} 工作页`);
  const summary = oneLine(opts.summary, CONFIG.limits.summary_max_chars) || (scope === 'global' ? '当前焦点与下一步' : '项目阶段与下一步');
  const id = computeNextId('w');
  const body = [
    '## 当前阶段',
    '',
    '（做到哪一步，一句话）',
    '',
    '## 在办',
    '',
    '- ',
    '',
    '## 未决',
    '',
    '- ',
    '',
    '## 下一步',
    '',
    '- ',
    '',
    '## 关联',
    '',
    '（关键决策 / 原子 / 原文链接）',
    '',
  ].join('\n');
  const meta = [
    ['id', id],
    ['title', title],
    ['level', 'digest'],
    ['type', 'work'],
    ['scope', scope],
    ['status', 'active'],
    ['summary', summary],
    ['updated', localDate()],
  ];
  const file = path.join(ROOT, WORK_DIR, `${id}.md`);
  writeText(file, buildAtomNote(meta, body));
  rebuildIndexes();
  appendChangeLog('work', `${id}（${scope}）新建工作页`);
  const payload = { ok: true, id, scope, file: relPath(file) };
  if (opts.json) return out(JSON.stringify(payload));
  out(`已新建工作页 ${id}（${scope}）：${relPath(file)}`);
}

// ------------------------------------------------------------ 每日整理

function daysBetween(a, b) {
  const ms = new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00');
  return Math.round(ms / 86400000);
}

function cmdConsolidate(opts) {
  const notes = loadNotes().filter((n) => !n.fixed && n.data);
  const today = localDate();
  const access = readJsonl(P.access);
  const accessed = new Set(access.map((r) => r.id));
  // Heat: how often each note was actually recalled, and when it last was.
  const heat = new Map();
  for (const row of access) {
    if (!row || !row.id) continue;
    const entry = heat.get(row.id) || { count: 0, lastAt: '' };
    entry.count += 1;
    const at = String(row.t || '');
    if (at > entry.lastAt) entry.lastAt = at;
    heat.set(row.id, entry);
  }
  const topics = notes.filter((n) => n.data.type === 'topic');
  const topicCovered = new Set();
  for (const t of topics) for (const l of splitLinks(t.data.related)) topicCovered.add(l);
  const stale = [];
  const review = [];
  const uncovered = [];
  const duplicates = [];
  const bySummary = new Map();
  for (const n of notes) {
    const d = n.data;
    const age = daysBetween(String(d.updated), today);
    const recall = heat.get(d.id);
    // A recent recall delays "stale" even when the note itself was not edited.
    const lastTouched = recall && recall.lastAt && recall.lastAt > String(d.updated) ? recall.lastAt.slice(0, 10) : String(d.updated);
    const idle = daysBetween(lastTouched, today);
    if (['active', 'promoted', 'canon'].includes(d.status) && d.type !== 'work' && idle > CONFIG.limits.stale_days && !accessed.has(d.id)) {
      stale.push({ id: d.id, updated: d.updated, age });
    }
    if (d.review_after && String(d.review_after) <= today) review.push({ id: d.id, review_after: d.review_after });
    // Archived notes are out of circulation by decision; promoted ones already
    // ascended. Neither is missing coverage.
    if (d.type !== 'topic' && d.type !== 'work' && d.level === 'digest' && d.status !== 'archived' && d.status !== 'promoted' && !topicCovered.has(d.id)) uncovered.push(d.id);
    const key = String(d.summary || '').trim();
    if (key) {
      bySummary.set(key, [...(bySummary.get(key) || []), d.id]);
    }
  }
  for (const [summary, ids] of bySummary) if (ids.length > 1) duplicates.push({ summary, ids });
  const rows = readJsonl(P.catalog).length + readJsonl(P.archive).length;
  const hot = [...heat.entries()]
    .map(([id, entry]) => ({ id, count: entry.count, lastAt: entry.lastAt }))
    .sort((a, b) => b.count - a.count || String(b.lastAt).localeCompare(String(a.lastAt)))
    .slice(0, 10);
  // Inbox notes that were opened repeatedly are the ones the user actually cares
  // about — propose confirming them instead of guessing from content alone.
  const readCandidates = [];
  for (const n of notes) {
    if (n.data.status !== 'inbox') continue;
    const recall = heat.get(n.data.id);
    if (recall && recall.count >= 2) readCandidates.push({ id: n.data.id, reads: recall.count });
  }
  // 工作页是“项目状态的活页面”，不是记忆。整理时只给提示（过期/缺页），
  // 起草与落盘仍由人确认；脚本绝不自动改写工作页正文。
  const activeWorkPages = notes.filter((n) => n.data.type === 'work' && n.data.status === 'active');
  // Archived work pages still count as "the project has a page": otherwise a
  // finished project would be reported as missing one forever.
  const workScopes = new Set(notes.filter((n) => n.data.type === 'work').map((n) => String(n.data.scope || '')));
  const workStaleDays = Number(CONFIG.limits.work_stale_days) > 0 ? Number(CONFIG.limits.work_stale_days) : 14;
  const work = {
    pages: activeWorkPages.map((n) => ({ id: n.data.id, scope: n.data.scope, updated: n.data.updated })),
    stale: activeWorkPages
      .filter((n) => daysBetween(String(n.data.updated), today) > workStaleDays)
      .map((n) => ({ id: n.data.id, scope: n.data.scope, updated: n.data.updated, age: daysBetween(String(n.data.updated), today) })),
    missing: [...new Set(
      notes
        .filter(
          (n) =>
            n.data.level === 'digest' &&
            !['work', 'topic', 'session'].includes(String(n.data.type)) &&
            /^project:/.test(String(n.data.scope || '')) &&
            // Only confirmed memories imply a live project; an inbox candidate
            // must not demand a work page.
            !['inbox', 'archived', 'promoted'].includes(String(n.data.status)),
        )
        .map((n) => String(n.data.scope)),
    )]
      .filter((scope) => !workScopes.has(scope))
      .sort(),
  };
  const payload = {
    date: today,
    total: notes.length,
    indexRows: rows,
    indexLimit: CONFIG.limits.catalog_max_rows,
    stale,
    review,
    uncoveredAtoms: uncovered,
    duplicateSummaries: duplicates,
    accessRows: access.length,
    hot,
    readCandidates,
    work,
  };
  if (opts.json) return out(JSON.stringify(payload, null, 2));
  out(`# 每日整理 ${today}`);
  out(`笔记 ${notes.length} 篇 · 索引 ${rows}/${CONFIG.limits.catalog_max_rows} 行 · 召回日志 ${access.length} 条`);
  out(`\n## 待复查（review_after 到期）${review.length}`);
  review.forEach((r) => out(`- ${r.id}（${r.review_after}）`));
  out(`\n## 转 stale 候选（>${CONFIG.limits.stale_days} 天未召回）${stale.length}`);
  stale.forEach((s) => out(`- ${s.id}（updated ${s.updated}，${s.age} 天）`));
  out(`\n## 未归主题的原子 ${uncovered.length}`);
  out(uncovered.length ? uncovered.map((id) => `- ${id}`).join('\n') : '- 无');
  out(`\n## 重复 summary ${duplicates.length}`);
  duplicates.forEach((d) => out(`- ${d.summary} → ${d.ids.join(', ')}`));
  out(`\n## 热度 Top ${hot.length}`);
  hot.forEach((h) => out(`- ${h.id} × ${h.count}（最近 ${h.lastAt || '—'}）`));
  out(`\n## 读过的待确认条目（建议确认）${readCandidates.length}`);
  readCandidates.forEach((r) => out(`- ${r.id}（读过 ${r.reads} 次）`));
  out(`\n## 工作页 ${work.pages.length} 篇 · 过期 ${work.stale.length} · 缺页 ${work.missing.length}`);
  work.pages.forEach((p) => out(`- ${p.id}（${p.scope}，updated ${p.updated}）`));
  work.stale.forEach((p) => out(`- 过期：${p.id}（${p.scope}，${p.age} 天未更新）`));
  work.missing.forEach((scope) => out(`- 缺页：${scope} 已有记忆但没有工作页`));
  if (access.length === 0) out('\n> access.jsonl 还是空的：热度只来自真实召回，暂不据此判降权。');
  process.exitCode = 0;
}

/**
 * Apply one lifecycle transition to many notes in a single pass, then rebuild
 * the index once. This is what the knowledge-base page's batch buttons call.
 */
function cmdBatchStatus(opts) {
  const ids = String(opts.ids || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length) throw new Error('batch-status 需要 --ids a,b,c');
  const status = oneLine(opts.status, 12) || 'active';
  if (!STATUS_LIFECYCLE.includes(status)) throw new Error(`batch-status: 非法 status`);
  const scope = opts.scope ? oneLine(opts.scope, 40) : null;
  if (scope && !SCOPE_PATTERN.test(scope)) throw new Error('batch-status: 非法 scope');
  const notes = loadNotes();
  // Phase 1: validate the whole batch and compute the new text, without writing
  // anything. A failure halfway through must never leave half the notes changed
  // while the demo index is stale.
  const plans = [];
  const plannedWorkScopes = new Map();
  for (const id of ids) {
    const note = notes.find((n) => !n.fixed && n.data?.id === id);
    if (!note) continue;
    if (note.data.type === 'work') {
      if (!['active', 'archived'].includes(status)) {
        throw new Error(`batch-status: 工作页 ${id} 的 status 只能是 active / archived`);
      }
      if (opts.clearScope) throw new Error(`batch-status: 工作页 ${id} 必须保留 scope`);
      if (scope && !WORK_SCOPE.test(scope)) throw new Error(`batch-status: 工作页 ${id} 的 scope 必须是 global 或 project:<slug>`);
      const effectiveScope = scope || String(note.data.scope || '');
      if (status === 'active') {
        const clash = activeWorkConflict(notes, id, effectiveScope);
        if (clash) throw new Error(`batch-status: ${effectiveScope} 已有 active 工作页 ${clash.data.id}，请先归档它`);
        if (plannedWorkScopes.has(effectiveScope)) {
          throw new Error(`batch-status: 同一批里有多个工作页要恢复为 ${effectiveScope}（${plannedWorkScopes.get(effectiveScope)}, ${id}）`);
        }
        plannedWorkScopes.set(effectiveScope, id);
      }
    }
    const before = readText(note.file);
    let text = before.replace(/^(status:)\s*.*$/m, `$1 ${status}`);
    if (opts.clearScope) text = text.replace(/^scope:[^\n]*\n?/m, '');
    else if (scope) {
      text = /^scope:/m.test(text)
        ? text.replace(/^(scope:)\s*.*$/m, `$1 ${scope}`)
        : text.replace(/^(type:[^\n]*)$/m, `$1\nscope: ${scope}`);
    }
    text = text.replace(/^(updated:)\s*.*$/m, `$1 ${localDate()}`);
    if (text !== before) plans.push({ note, text, id });
  }
  // Phase 2: apply and rebuild once.
  for (const plan of plans) writeText(plan.note.file, plan.text);
  const changedIds = plans.map((plan) => plan.id);
  if (changedIds.length) {
    rebuildIndexes();
    appendChangeLog('status', `${changedIds.join(', ')} → ${status}${scope ? ` scope=${scope}` : ''}`);
  }
  const payload = { ok: true, requested: ids.length, changed: changedIds.length, ids: changedIds };
  if (opts.json) return out(JSON.stringify(payload));
  out(`批量更新 ${payload.changed}/${payload.requested} 条 → status=${status}${scope ? ` scope=${scope}` : ''}`);
}

// ------------------------------------------------------------ 物理删除闸门
//
// 协议默认「只归档、永不删」，物理删除是唯一例外，因此必须两道闸：
// 1. `delete-request` 生成一次性票据与随机密钥（只在命令行输出一次，不落盘明文）；
// 2. `delete` 要求人把密钥原样输入，校验通过且未过期才执行。
// 密钥哈希与票据只在 `_meta/state/` 里，删除动作追加到 `_meta/log.md`。

const TICKET_REL = path.join('_meta', 'state', 'delete-ticket.json');
const DELETE_LOG_REL = path.join('_meta', 'state', 'delete-log.jsonl');
const TICKET_TTL_MS = 10 * 60 * 1000;

function ticketPath() {
  return path.join(ROOT, TICKET_REL);
}

function hashKey(key) {
  return createHash('sha256').update(String(key).trim().toUpperCase()).digest('hex');
}

function makeKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let raw = '';
  for (const byte of bytes) raw += alphabet[byte % alphabet.length];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function cmdDeleteRequest(opts) {
  const ids = String(opts.ids || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length) throw new Error('delete-request 需要 --ids a,b,c');
  const notes = loadNotes();
  const missing = ids.filter((id) => !notes.some((n) => !n.fixed && n.data?.id === id));
  if (missing.length) throw new Error(`delete-request: 找不到 ${missing.join(', ')}`);

  const key = makeKey();
  const ticket = `del-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const now = Date.now();
  writeText(
    ticketPath(),
    JSON.stringify(
      {
        ticket,
        keyHash: hashKey(key),
        ids,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + TICKET_TTL_MS).toISOString(),
      },
      null,
      2,
    ),
  );
  const payload = { ok: true, ticket, key, ids, expiresAt: new Date(now + TICKET_TTL_MS).toISOString() };
  if (opts.json) return out(JSON.stringify(payload));
  out(`删除票据：${ticket}`);
  out(`一次性密钥：${key}`);
  out(`涉及 ${ids.length} 篇：${ids.join(', ')}`);
  out(`有效期 ${Math.round(TICKET_TTL_MS / 60000)} 分钟。确认后执行：`);
  out(`  node _meta/scripts/kb.mjs delete --ticket ${ticket} --key ${key}`);
}

/**
 * Remove `[[id]]` links (frontmatter arrays and inline body text) from one note.
 * Only the link token is removed: a body line that mixes links with prose keeps
 * its prose. A line whose entire content was the link (optionally a bullet or
 * quote marker) is dropped.
 */
function stripLinks(text, ids) {
  let out = text;
  for (const id of ids) {
    const token = `[[${id}]]`;
    if (!out.includes(token)) continue;
    // Quoted frontmatter array elements, with their delimiters.
    out = out.replace(new RegExp(`"\\[\\[${id}\\]\\]"\\s*,\\s*`, 'g'), '');
    out = out.replace(new RegExp(`,\\s*"\\[\\[${id}\\]\\]"`, 'g'), '');
    out = out.replace(new RegExp(`"\\[\\[${id}\\]\\]"`, 'g'), '');
    // Inline occurrences: strip the token in place; drop only link-only lines.
    const kept = [];
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes(token)) {
        kept.push(line);
        continue;
      }
      const cleaned = line.split(token).join('').replace(/[ \t]+$/, '');
      if (!/^\s*(?:[-*+]|>)?\s*$/.test(cleaned)) kept.push(cleaned);
    }
    out = kept.join('\n');
  }
  return out.replace(/related:\s*\[\s*,/g, 'related: [').replace(/,\s*\]/g, ']');
}

function cmdDelete(opts) {
  const ticketId = oneLine(opts.ticket, 60);
  const key = oneLine(opts.key, 20);
  if (!ticketId || !key) throw new Error('delete 需要 --ticket 与 --key');
  const file = ticketPath();
  if (!fs.existsSync(file)) throw new Error('delete: 没有待执行的删除票据（先运行 delete-request）');
  const ticket = JSON.parse(readText(file));
  if (ticket.ticket !== ticketId) throw new Error('delete: 票据不匹配');
  if (Date.parse(ticket.expiresAt) < Date.now()) throw new Error('delete: 票据已过期，请重新生成');
  if (ticket.keyHash !== hashKey(key)) throw new Error('delete: 密钥不匹配，拒绝执行');

  const notes = loadNotes();
  const deleted = [];
  for (const id of ticket.ids) {
    const note = notes.find((n) => !n.fixed && n.data?.id === id);
    if (!note) continue;
    const rel = relPath(note.file);
    if (!/^(10_Raw|20_Digest|30_Canon)\//.test(rel)) throw new Error(`delete: 拒绝删除笔记目录之外的文件 ${rel}`);
    fs.rmSync(note.file, { force: true });
    deleted.push(id);
  }

  // 清掉剩余笔记里指向已删条目的链接，保证 validate 不红。
  let cleaned = 0;
  const dirs = ['10_Raw', '20_Digest', '30_Canon'];
  const stack = dirs.map((d) => path.join(ROOT, d)).filter((d) => fs.existsSync(d));
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.name.endsWith('.md') || entry.name.startsWith('_')) continue;
      const before = readText(full);
      const after = stripLinks(before, deleted);
      if (after !== before) {
        writeText(full, after);
        cleaned += 1;
      }
    }
  }

  const counts = rebuildIndexes();
  try {
    appendChangeLog('delete', `${deleted.join(', ')}（物理删除，票据 ${ticketId}）`);
  } catch {
    /* advisory */
  }
  fs.appendFileSync(
    path.join(ROOT, DELETE_LOG_REL),
    `${JSON.stringify({ t: new Date().toISOString(), ticket: ticketId, ids: deleted, cleanedNotes: cleaned })}\n`,
    'utf8',
  );
  fs.rmSync(file, { force: true });

  const payload = { ok: true, deleted, cleanedNotes: cleaned, index: counts };
  if (opts.json) return out(JSON.stringify(payload));
  out(`已物理删除 ${deleted.length} 篇：${deleted.join(', ')}`);
  out(`清理了 ${cleaned} 篇笔记中的悬空链接；主索引 ${counts.active} 行`);
  out('注：文件已从工作树移除，但仍在 git 历史中，可 `git checkout <commit> -- <path>` 找回。');
}

// ------------------------------------------------------------ 召回日志

/**
 * Append one recall record. `access.jsonl` is telemetry, not a note: it is the
 * only source of heat, and it is append-only by definition (schema §7).
 */
function cmdAccess(opts) {
  const id = oneLine(opts.id, 40);
  if (!id) throw new Error('access 需要 --id');
  const how = oneLine(opts.how, 20) || 'read';
  if (!['inject', 'read', 'grep', 'manual'].includes(how)) throw new Error('access: --how 只能是 inject / read / grep / manual');
  const row = { t: new Date().toISOString(), id, how };
  if (opts.score !== undefined && Number.isFinite(Number(opts.score))) row.score = Number(opts.score);
  if (opts.provenance) row.provenance = oneLine(opts.provenance, 120);
  fs.mkdirSync(path.dirname(P.access), { recursive: true });
  fs.appendFileSync(P.access, `${JSON.stringify(row)}\n`, 'utf8');
  out(opts.json ? JSON.stringify({ ok: true, ...row }) : `已记录召回：${id}（${how}）`);
}

// ---------------------------------------------------------------- 日志

function cmdLog(opts) {
  if (!opts.action || !opts.note) throw new Error('log 需要 --action 与 --note');
  appendChangeLog(opts.action, opts.note);
  out(`已记录：${localDate()} ${localTime()} | ${opts.action} | ${opts.note}`);
}

// ---------------------------------------------------------------- 入口

function out(s) {
  process.stdout.write(s + '\n');
}

function parseArgs(argv) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (key === 'json' || key === 'dry-run' || key === 'help') {
        opts[key === 'dry-run' ? 'dryRun' : key] = true;
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        opts[camel] = argv[++i];
      } else {
        opts[camel] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { command: positional[0], opts };
}

const HELP = `kb.mjs — 知识库规则层

  validate [--json]                   校验 schema / id / 链接 / 索引一致性
  rebuild [--dry-run]                 从笔记重建 catalog*.jsonl
  stats [--json]                      分层与状态统计
  id-next --kind a|t|c|w [--date D]   下一个可用 id
  work-new --scope global|project:S [--title T] [--json]
                                      新建工作页（type=work，项目状态页，不注入）
  work-brief --scope global|project:S [--json]
                                      恢复简报（新会话接上文用，不占记忆预算）
  add-atom --json-file F [--json] [--dry-run]
                                      按 schema 写入一条原子记忆（分配的 id、去重、重建索引）
  set-status --id ID --status S [--scope SC] [--clear-scope] [--json]
                                      迁移状态/范围（inbox→active 即确认；--clear-scope 删除 scope 字段）
  promote --id ID --to CANON_ID [--json]
                                      晋升：给低层笔记加 up 回指并置 promoted，文件不移动
  batch-status --ids A,B --status S [--scope SC] [--clear-scope] [--json]
                                      批量状态迁移（一次重建索引）
  access --id ID [--how inject|read|grep|manual] [--score N] [--provenance P]
                                      追加一条召回记录（热度的唯一来源）
  delete-request --ids A,B [--json]   生成一次性删除票据与随机密钥（唯一物理删除入口的第一步）
  delete --ticket T --key K [--json]  凭票据+密钥物理删除（校验过期与密钥哈希，清理悬空链接）
  append-session --slug S --title T [--role user|assistant] [--text ...|--text-file F]
                                      追加本轮原文（同 session_id 续写、否则新建）
  candidates [--file F|--text ...] [--json]
                                      门控 + 候选提取（喂给子代理裁判）
  consolidate [--json]                每日整理：stale / review / 未归主题 / 重复
  log --action X --note Y             追加 _meta/log.md`;

function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (!command || opts.help) return out(HELP);
  const table = {
    validate: cmdValidate,
    rebuild: cmdRebuild,
    stats: cmdStats,
    'id-next': cmdIdNext,
    'work-new': cmdWorkNew,
    'work-brief': cmdWorkBrief,
    'add-atom': cmdAddAtom,
    'set-status': cmdSetStatus,
    promote: cmdPromote,
    'batch-status': cmdBatchStatus,
    access: cmdAccess,
    'delete-request': cmdDeleteRequest,
    delete: cmdDelete,
    'append-session': cmdAppendSession,
    candidates: cmdCandidates,
    consolidate: cmdConsolidate,
    log: cmdLog,
  };
  const fn = table[command];
  if (!fn) {
    out(`未知命令：${command}\n\n${HELP}`);
    process.exitCode = 2;
    return;
  }
  fn(opts);
}

main();
