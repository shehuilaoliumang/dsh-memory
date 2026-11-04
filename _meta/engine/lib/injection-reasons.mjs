/**
 * Per-note explanation of why a memory is (not) in this turn's prompt.
 *
 * Deliberately pure and advisory: it consumes the same manifest entries and the
 * same fail-closed predicate (`isInjectable`) the prompt uses, and never decides
 * injection. The source-aware limits are passed in so the labels cannot drift
 * from the budget. Split out of `work-brief.mjs` so the Host can add the panel
 * explanation without reloading the whole rules module.
 *
 * @returns {Record<string, {state: string, label: string, detail: string}>}
 */
import { isInjectable } from './work-brief.mjs';

export function explainInjection({
  notes = [],
  entries = [],
  scope = 'global',
  viewKind = 'project',
  mutedIds = [],
  inSessionStore = true,
  limits = { global: 2, project: 3, total: 5 },
} = {}) {
  const injectedIds = new Set((entries || []).map((entry) => String(entry && entry.id ? entry.id : '')));
  const muted = new Set((mutedIds || []).map(String));
  const budget = `全局 ${limits.global} / 项目 ${limits.project} / 总计 ${limits.total}`;
  // Newest injectable claim per subject in the viewed store; only used to
  // explain a concrete replacement, never to decide what is injected.
  const newestBySubject = new Map();
  for (const note of notes) {
    if (!note || !note.subject || !isInjectable(note, scope)) continue;
    const previous = newestBySubject.get(note.subject);
    if (!previous
      || String(note.updated || '') > String(previous.updated || '')
      || (String(note.updated || '') === String(previous.updated || '') && String(note.id) > String(previous.id))) {
      newestBySubject.set(note.subject, note);
    }
  }
  const reasons = {};
  for (const note of notes) {
    if (!note || note.id === undefined || note.id === null) continue;
    let reason;
    if (!inSessionStore) {
      reason = { state: 'other-store', label: '不在当前会话', detail: '这是其他记忆库的只读视图；注入只取当前会话自己的全局库与项目库。' };
    } else if (injectedIds.has(String(note.id))) {
      reason = { state: 'injected', label: '已注入', detail: '本轮对话已经注入这条记忆。' };
    } else if (muted.has(String(note.id))) {
      reason = { state: 'muted', label: '本会话已静音', detail: '静音只影响当前会话，不改库内状态。' };
    } else if (note.status === 'inbox') {
      reason = { state: 'inbox', label: '待确认', detail: '候选记忆须确认（active）后才会进入注入。' };
    } else if (note.status === 'review') {
      reason = { state: 'review', label: '待复核', detail: '复核完成前不进入注入。' };
    } else if (note.status === 'archived') {
      reason = { state: 'archived', label: '已归档', detail: '归档条目不再注入，正文保留。' };
    } else if (note.status === 'promoted') {
      reason = { state: 'promoted', label: '已晋升', detail: '由更高层结论代替，本层不再注入。' };
    } else if (note.status === 'superseded') {
      reason = { state: 'superseded', label: '已被取代', detail: '同主题已有新结论，旧条只保留历史。' };
    } else if (note.level !== 'digest') {
      reason = note.level === 'canon'
        ? { state: 'canon', label: '结论层', detail: '决策/方法论不参与每轮记忆注入，按需检索。' }
        : { state: 'raw', label: '原文层', detail: '原文只增不改，不参与注入。' };
    } else if (note.type === 'topic' || note.type === 'work' || note.type === 'session') {
      reason = { state: 'page', label: '页面不是记忆', detail: '主题页、工作页与会话原文都不参与注入。' };
    } else if (!isInjectable(note, scope)) {
      if (note.scope === 'unclassified' || !note.scope) {
        reason = { state: 'no-scope', label: '没有范围', detail: '缺失 scope 按 fail closed 处理，永不注入。' };
      } else if (note.scope === 'global' && viewKind === 'project') {
        reason = { state: 'scope-leak', label: '项目库隔离', detail: '项目库里的 global 条目被隔离，不进入注入。' };
      } else if (note.scope === 'global' && viewKind === 'global') {
        reason = { state: 'scope-leak', label: '范围不符', detail: '全局库只注入 global 范围的记忆。' };
      } else {
        reason = { state: 'scope', label: '范围不符', detail: `本条范围 ${note.scope || '未设置'}，与当前会话 ${scope || 'global'} 不一致。` };
      }
    } else if (note.subject && newestBySubject.has(note.subject)
      && String(newestBySubject.get(note.subject).id) !== String(note.id)) {
      reason = { state: 'replaced', label: '同主题有更新', detail: `同主题已有更新条目 ${newestBySubject.get(note.subject).id}，本条不占注入位。` };
    } else if ((entries || []).length >= (limits.total || 5)) {
      reason = { state: 'budget', label: '预算已满', detail: `记忆注入预算（${budget}）已满，排序靠后的条目本轮不注入。` };
    } else {
      reason = { state: 'not-selected', label: '本轮未入选', detail: `本轮共 ${(entries || []).length} 条入选；本条排序靠后。` };
    }
    reasons[String(note.id)] = reason;
  }
  return reasons;
}
