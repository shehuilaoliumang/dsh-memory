/**
 * Client half of the knowledge-base panel bundle.
 *
 * Four surfaces, all fed by the Host half's read-only endpoints:
 *   conversation.composer.dock  memory pill — rendered ONLY inside a vault
 *                               session; outside the vault it renders nothing,
 *                               so other projects see zero knowledge-base UI.
 *   sidebar.workspaces.session.menu.item
 *                               the manual entry point: rows inside one session's
 *                               "..." menu, mounted only while that menu is open,
 *                               so an out-of-vault session carries zero
 *                               knowledge-base UI until it is asked for.
 *   sidebar.panellist           knowledge-base icon, always available.
 *   main (key 'kb')             the knowledge-base page: search, layer filter,
 *                               note list, note body.
 *
 * Text is Simplified Chinese only, matching the rest of this bundle.
 */
window.__ModuleLoader__.load({
  id: '@local/kb-panel',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useMemo, useRef } = React;

    /**
     * Soft-refresh event: mounted panel surfaces re-read their read-only Host
     * snapshots without unloading the page or touching any running session.
     */
    const REFRESH_EVENT = 'kb:refresh';

    const LAYER_LABEL = { raw: '原文', digest: '摘要', canon: '结论' };
    // P3.3: the Host rotates a per-process CSRF token; the panel snapshot is
    // the only same-origin place to read it. Every `/kb/*` POST echoes it.
    let kbCsrfToken = '';
    const nativeFetch = typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : null;
    function rememberCsrf(data) {
      if (data && data.csrfToken) kbCsrfToken = String(data.csrfToken);
      return data;
    }
    if (nativeFetch) {
      window.fetch = (input, init = {}) => {
        const url = typeof input === 'string' ? input : String((input && input.url) || '');
        const method = String((init && init.method) || 'GET').toUpperCase();
        if (url.startsWith('/kb/') && method === 'POST' && kbCsrfToken) {
          const headers = new Headers(init.headers || {});
          headers.set('x-kb-csrf', kbCsrfToken);
          init = { ...init, headers };
        }
        return nativeFetch(input, init);
      };
    }
    /** Only pages that need to be told apart from atoms get an extra badge. */
    const TYPE_LABEL = { work: '工作页' };
    const STATUS_LABEL = {
      inbox: '收件箱',
      active: '活跃',
      review: '待复查',
      stale: '停滞',
      promoted: '已晋升',
      archived: '归档',
      canon: '定稿',
    };
    const MODE_LABEL = {
      on: '知识库开启',
      off: '知识库关闭',
      unknown: '知识库未判定',
    };
    /** Scope shown in Chinese; project slug keeps its Latin name by design. */
    const scopeLabel = (scope) => {
      if (!scope) return '未分类';
      if (scope === 'global') return '全局';
      if (scope === 'system') return '系统';
      if (scope === 'unclassified') return '未分类';
      return `项目 ${String(scope).replace(/^project:/, '')}`;
    };

    /**
     * Bumped whenever this file changes. On activation the module reports it to
     * the Host, because there is no browser control here: without this the only
     * way to tell whether a page reload picked up new client code is to ask the
     * user what they see.
     */
    const CLIENT_BUILD = '2026-10-29-c21';

    /**
     * panel.json URL that also carries this build. The Host records it, so the
     * live client version stays observable across plugin reloads (the one-shot
     * activation report is lost when the Host restarts, this poll is not).
     */
    function panelUrl(sessionId) {
      const params = new URLSearchParams();
      if (sessionId) params.set('session', String(sessionId));
      params.set('build', CLIENT_BUILD);
      return `/kb/panel.json?${params.toString()}`;
    }

    /** Set by the composer chip; the page reads it to address this session. */
    let currentSessionId = null;
    /** Client layout service, captured in apply(). */
    let layout = null;
    /** In-flight panel reads, one per session, shared by the two menu rows. */
    const sessionPanelPending = new Map();
    /** Session-mode change listeners; the chip reloads its own session only. */
    const modeWatchers = new Set();

    const S = {
      wrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' },
      pill: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '1px 8px',
        font: 'inherit',
        fontSize: '13px',
        lineHeight: '20px',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'transparent',
        border: 'none',
        borderRadius: '8px',
        cursor: 'pointer',
      },
      pillHover: { background: 'var(--dsw-alias-bg-layer-2)' },
      dot: { width: '6px', height: '6px', borderRadius: '50%', flex: 'none' },
      count: { color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums' },
      chevron: { width: '12px', height: '12px', flex: 'none', color: 'var(--dsw-alias-label-secondary)' },
      chevronOpen: { transform: 'rotate(180deg)' },
      panel: {
        width: 'min(560px, calc(100vw - 32px))',
        maxHeight: 'min(60vh, 520px)',
        overflowY: 'auto',
        boxSizing: 'border-box',
        padding: '12px',
        fontSize: '12px',
        lineHeight: '20px',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-overlay)',
        border: '0.5px solid var(--dsw-alias-border-l2)',
        borderRadius: '16px',
      },
      head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' },
      title: { fontSize: '14px', lineHeight: '20px', fontWeight: 500 },
      muted: { color: 'var(--dsw-alias-label-secondary)' },
      row: { display: 'flex', gap: '8px', flexWrap: 'wrap', padding: '2px 0' },
      section: { marginTop: '8px', paddingTop: '8px', borderTop: '0.5px solid var(--dsw-alias-border-l1)' },
      list: { margin: '4px 0 0', padding: 0, listStyle: 'none' },
      item: { display: 'flex', gap: '8px', alignItems: 'baseline', padding: '3px 0' },
      itemTitle: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      id: { flex: 'none', color: 'var(--dsw-alias-label-secondary)', fontSize: '11px' },
      btn: {
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '18px',
        height: '28px',
        padding: '0 10px',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'transparent',
        border: '0.5px solid var(--dsw-alias-border-l2)',
        borderRadius: '8px',
        cursor: 'pointer',
      },
      btnHover: { background: 'var(--dsw-alias-bg-layer-2)' },
      core: {
        marginTop: '6px',
        paddingLeft: '12px',
        borderLeft: '2px solid var(--dsw-alias-border-l2)',
        color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'pre-wrap',
      },
      actions: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' },

      // --- session "..." menu rows ------------------------------------------
      // Host menu-item metrics, kept local so this package does not require
      // ui-primitives: one row is one plain `role="menuitem"` button.
      menuItem: {
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        width: '100%',
        minHeight: '34px',
        padding: '6px 8px',
        font: 'inherit',
        fontSize: '13px',
        lineHeight: '20px',
        textAlign: 'left',
        color: 'var(--dsw-alias-label-primary)',
        background: 'transparent',
        border: 'none',
        borderRadius: '12px',
        cursor: 'pointer',
      },
      menuItemHover: { background: 'var(--dsw-alias-bg-layer-2)' },
      menuItemDisabled: { opacity: 0.4, cursor: 'not-allowed' },
      menuIcon: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        width: '14px',
        height: '14px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      menuLabel: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

      // --- sidebar footer action --------------------------------------------
      // Metrics match the adjacent Settings row: 34px tall, 6px/8px padding,
      // 13px text. The collapsed sidebar (56px) shows the icon alone.
      reloadBtn: {
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        minHeight: '34px',
        padding: '6px 8px',
        font: 'inherit',
        fontSize: '13px',
        lineHeight: '20px',
        textAlign: 'left',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'transparent',
        border: 'none',
        borderRadius: '12px',
        cursor: 'pointer',
      },
      reloadBtnCollapsed: { justifyContent: 'center' },
      reloadBtnHover: { background: 'var(--dsw-alias-bg-layer-2)' },
      // Armed state: unmistakable, so nobody mistakes it for the plain button.
      reloadBtnArmed: {
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-state-warn-primary)',
        outline: '1px solid var(--dsw-alias-state-warn-primary)',
      },
      reloadIcon: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        width: '16px',
        height: '16px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      reloadLabel: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      // The reload action is a split control: the main button is always a
      // non-destructive soft refresh; the caret exposes the guarded full reload.
      reloadWrap: { position: 'relative', display: 'flex', alignItems: 'center', gap: '2px' },
      reloadCaret: {
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        width: '24px',
        minHeight: '34px',
        padding: 0,
        font: 'inherit',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'transparent',
        border: 'none',
        borderRadius: '12px',
        cursor: 'pointer',
      },
      reloadMenu: {
        position: 'absolute',
        left: 0,
        bottom: 'calc(100% + 6px)',
        zIndex: 30,
        width: '248px',
        boxSizing: 'border-box',
        padding: '6px',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-overlay)',
        border: '0.5px solid var(--dsw-alias-border-l2)',
        borderRadius: '12px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
      },
      reloadMenuNote: {
        padding: '6px 8px',
        fontSize: '11px',
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-secondary)',
      },

      // --- page -------------------------------------------------------------
      page: {
        boxSizing: 'border-box',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-base)',
      },
      pageHead: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '16px',
        padding: '28px clamp(24px, 4vw, 48px) 16px',
        flex: 'none',
      },
      pageTitle: { fontSize: '20px', lineHeight: '28px', fontWeight: 500 },
      pageLead: { marginTop: '4px', fontSize: '13px', lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)' },
      pageMeta: { display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
      pageBody: { display: 'flex', gap: '16px', padding: '0 clamp(24px, 4vw, 48px) 24px', flex: 1, minHeight: 0 },
      column: {
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        border: '0.5px solid var(--dsw-alias-border-l2)',
        borderRadius: '16px',
        background: 'var(--dsw-alias-bg-layer-1)',
        overflow: 'hidden',
      },
      searchWrap: { padding: '12px 12px 8px', flex: 'none' },
      input: {
        boxSizing: 'border-box',
        width: '100%',
        height: '36px',
        font: 'inherit',
        fontSize: '13px',
        lineHeight: '20px',
        padding: '0 10px',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-base)',
        border: '0.5px solid var(--dsw-alias-border-l2)',
        borderRadius: '12px',
        outline: 'none',
      },
      inputFocus: { borderColor: 'var(--dsw-alias-brand-primary)' },
      filters: { display: 'flex', gap: '8px', padding: '0 12px 10px', flexWrap: 'wrap', flex: 'none' },
      hotRow: { display: 'flex', gap: '6px', padding: '0 12px 10px', flexWrap: 'wrap', alignItems: 'center', flex: 'none' },
      chip: {
        font: 'inherit',
        fontSize: '13px',
        lineHeight: '20px',
        height: '28px',
        padding: '0 10px',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'transparent',
        border: 'none',
        borderRadius: '14px',
        cursor: 'pointer',
      },
      chipHover: { background: 'var(--dsw-alias-bg-layer-2)' },
      chipOn: {
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-2)',
      },
      noteList: { margin: 0, padding: '0 8px 10px', listStyle: 'none', overflowY: 'auto', flex: 1, minHeight: 0 },
      noteBtn: {
        display: 'block',
        width: '100%',
        boxSizing: 'border-box',
        textAlign: 'left',
        font: 'inherit',
        fontSize: '14px',
        lineHeight: '22px',
        padding: '8px',
        marginBottom: '2px',
        color: 'var(--dsw-alias-label-primary)',
        background: 'transparent',
        border: 'none',
        borderRadius: '12px',
        cursor: 'pointer',
      },
      noteHover: { background: 'var(--dsw-alias-bg-layer-2)' },
      noteMeta: { display: 'flex', gap: '6px', alignItems: 'baseline', marginTop: '2px', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
      noteId: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      badge: {
        flex: 'none',
        fontSize: '11px',
        lineHeight: '17px',
        padding: '1px 8px',
        borderRadius: '999px',
        border: '0.5px solid var(--dsw-alias-border-l2)',
        color: 'var(--dsw-alias-label-secondary)',
      },
      detailHead: { padding: '16px 20px 10px', flex: 'none', borderBottom: '0.5px solid var(--dsw-alias-border-l1)' },
      confirmRow: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '10px' },
      detailTitle: { fontSize: '18px', lineHeight: '26px', fontWeight: 500 },
      detailBody: { padding: '16px 20px 24px', overflowY: 'auto', flex: 1, minHeight: 0, fontSize: '14px', lineHeight: '1.6' },
      mdHead: { fontWeight: 600, margin: '20px 0 8px', fontSize: '16px', lineHeight: '1.5' },
      mdPara: { margin: '0 0 12px', whiteSpace: 'pre-wrap' },
      mdItem: { margin: '0 0 4px', paddingLeft: '18px', position: 'relative', whiteSpace: 'pre-wrap' },
      empty: { padding: '48px 20px', fontSize: '14px', lineHeight: '1.6', color: 'var(--dsw-alias-label-secondary)', textAlign: 'center' },

      // --- pipeline health strip -------------------------------------------
      health: {
        display: 'flex',
        gap: '7px',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        margin: '0 24px 10px',
        padding: '5px 10px',
        fontSize: '11px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
      },
      healthSep: { opacity: 0.5 },
      healthBad: { color: 'var(--dsw-alias-state-error-primary)' },
      healthWarn: { color: 'var(--dsw-alias-state-warn-primary)' },
      healthVerdict: {
        flex: '1 1 100%',
        color: 'var(--dsw-alias-label-secondary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      sessionBar: {
        display: 'flex',
        gap: '10px',
        alignItems: 'center',
        flexWrap: 'wrap',
        margin: '0 clamp(24px, 4vw, 48px) 16px',
        padding: '12px 14px',
        fontSize: '12px',
        lineHeight: '20px',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        borderRadius: '10px',
      },
      sessionBarNote: { marginLeft: 'auto' },
    };

    function counts(object, labels) {
      return Object.keys(object || {})
        .filter((key) => object[key])
        .map((key) => `${labels[key] || key} ${object[key]}`);
    }

    /** Host "sm" control: 28px capsule, 0.5px hairline, hover wash of its own. */
    function KbButton(props) {
      const [hovered, setHovered] = useState(false);
      const disabled = props.disabled === true;
      const style = disabled
        ? { ...S.btn, opacity: 0.6, cursor: 'not-allowed' }
        : hovered
          ? { ...S.btn, ...S.btnHover }
          : S.btn;
      return h(
        'button',
        {
          type: 'button',
          style,
          disabled,
          onMouseEnter: disabled ? undefined : () => setHovered(true),
          onMouseLeave: disabled ? undefined : () => setHovered(false),
          onClick: disabled ? undefined : props.onClick,
        },
        props.children,
      );
    }

    async function postMode(session, enabled) {
      const response = await fetch('/kb/mode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session, enabled }),
      });
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    }

    function modeText(session) {
      if (!session || !session.id) return '无会话';
      if (session.mode === 'on') return session.manual ? '本会话：知识库已手动开启' : '本会话：在知识库内，自动开启';
      if (session.mode === 'off') return session.manual ? '本会话：知识库已手动关闭' : '本会话：库外项目，不注入记忆';
      return '本会话：知识库未判定';
    }

    // --- session "..." menu rows --------------------------------------------

    /** Host addresses sessions by bare id; the Client may pass either form. */
    function bareSessionId(value) {
      if (value === undefined || value === null) return '';
      return String(value).replace(/^session-/, '');
    }

    /** Visible label of the mode row, derived from the live session snapshot. */
    function menuRowLabel(session) {
      if (!session) return '知识库：读取中…';
      if (session.mode === 'on') return session.manual ? '知识库：已手动开启' : '知识库：已开启（自动）';
      if (session.mode === 'off') return session.manual ? '知识库：已关闭' : '知识库：未启用（库外）';
      return '知识库：未判定';
    }

    /**
     * Read the panel snapshot for one session when its menu mounts.
     * Both rows mount together, so concurrent reads share one request; every
     * menu opening reads again, so the rows always show the live mode.
     */
    function loadSessionPanel(sessionId) {
      const pending = sessionPanelPending.get(sessionId);
      if (pending) return pending;
      const request = fetch(panelUrl(sessionId), { cache: 'no-store' })
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status));
          return response.json().then(rememberCsrf);
        })
        .finally(() => {
          sessionPanelPending.delete(sessionId);
        });
      sessionPanelPending.set(sessionId, request);
      return request;
    }

    function watchModeChanges(listener) {
      modeWatchers.add(listener);
      return () => {
        modeWatchers.delete(listener);
      };
    }

    function emitModeChange(sessionId) {
      for (const listener of Array.from(modeWatchers)) {
        try {
          listener(sessionId);
        } catch {
          /* one listener must not break the others */
        }
      }
    }

    async function submitMode(sessionId, enabled) {
      try {
        await postMode(sessionId, enabled);
        emitModeChange(sessionId);
      } catch (error) {
        try {
          console.warn('[kb-panel] 切换本会话知识库模式失败', error);
        } catch {
          /* logging is best effort */
        }
      }
    }

    async function submitModeReset(sessionId) {
      try {
        const response = await fetch('/kb/mode', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session: sessionId, reset: true }),
        });
        if (!response.ok) throw new Error(String(response.status));
        emitModeChange(sessionId);
      } catch (error) {
        try {
          console.warn('[kb-panel] 恢复自动判定失败', error);
        } catch {
          /* logging is best effort */
        }
      }
    }

    // --- composer chip ------------------------------------------------------

    function Panel({ data, onRefresh, onOpen, onDisable }) {
      const layers = counts(data.layers, LAYER_LABEL);
      const statuses = counts(data.statuses, STATUS_LABEL);
      return h(
        'div',
        { style: S.panel },
        h(
          'div',
          { style: S.head },
          h('span', { style: S.title }, '知识库 · memory/'),
          h(
            'span',
            { style: { display: 'inline-flex', gap: '8px', alignItems: 'center' } },
            h('span', { style: S.muted }, new Date(data.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })),
            h(KbButton, { onClick: onRefresh }, '刷新'),
          ),
        ),
        h(
          'div',
          { style: S.row },
          h('span', null, `笔记 ${data.total}`),
          h('span', { style: S.muted }, '·'),
          h('span', null, `索引 ${data.catalog}`),
          h('span', { style: S.muted }, '·'),
          h('span', null, `归档 ${data.archive}`),
          h('span', { style: S.muted }, '·'),
          h('span', { style: data.review ? { color: 'var(--dsw-alias-state-warn-primary)' } : null }, `待复查 ${data.review}`),
        ),
        layers.length ? h('div', { style: S.row }, h('span', { style: S.muted }, '分层'), h('span', null, layers.join(' / '))) : null,
        statuses.length ? h('div', { style: S.row }, h('span', { style: S.muted }, '状态'), h('span', null, statuses.join(' / '))) : null,
        data.recent && data.recent.length
          ? h(
              'div',
              { style: S.section },
              h('div', { style: S.muted }, '最近更新'),
              h(
                'ul',
                { style: S.list },
                data.recent.map((note) =>
                  h(
                    'li',
                    { key: note.id, style: S.item },
                    h('span', { style: S.id }, note.id),
                    h('span', { style: S.itemTitle }, note.title || note.summary || note.id),
                    h('span', { style: { ...S.muted, marginLeft: 'auto' } }, STATUS_LABEL[note.status] || note.status),
                  ),
                ),
              ),
            )
          : null,
        data.core ? h('div', { style: S.section }, h('div', { style: S.muted }, '核心记忆'), h('div', { style: S.core }, data.core)) : null,
        h(
          'div',
          { style: S.actions },
          h(KbButton, { onClick: onOpen }, '打开知识库'),
          onDisable ? h(KbButton, { onClick: onDisable }, '本会话关闭记忆') : null,
        ),
      );
    }

    function KbChip(props) {
      const sessionId = props && props.sessionId ? String(props.sessionId) : null;
      // Keep the latest session addressable for the page's session controls.
      currentSessionId = sessionId;

      const [data, setData] = useState(null);
      const [failed, setFailed] = useState(false);
      const [open, setOpen] = useState(false);
      const [hovered, setHovered] = useState(false);

      const load = useCallback(async () => {
        try {
          const response = await fetch(panelUrl(sessionId), { cache: 'no-store' });
          if (!response.ok) throw new Error(String(response.status));
          setData(rememberCsrf(await response.json()));
          setFailed(false);
        } catch {
          setFailed(true);
        }
      }, [sessionId]);

      useEffect(() => {
        load();
        const timer = setInterval(load, 30000);
        return () => clearInterval(timer);
      }, [load]);

      // A session menu row changed this session's mode: refresh now. This adds
      // no polling and leaves the visibility decision below untouched.
      useEffect(() => {
        if (!sessionId) return undefined;
        return watchModeChanges((changed) => {
          if (bareSessionId(changed) === bareSessionId(sessionId)) load();
        });
      }, [load, sessionId]);

      // Soft refresh from the sidebar action: re-read only, never unload.
      useEffect(() => {
        const onRefresh = () => load();
        window.addEventListener(REFRESH_EVENT, onRefresh);
        return () => window.removeEventListener(REFRESH_EVENT, onRefresh);
      }, [load]);

      if (failed) return null;
      if (!data) return null;
      if (!data.session || !data.session.id) return null;
      // Outside the vault — or undecidable — the knowledge base leaves no trace.
      if (data.session.mode !== 'on') return null;

      const label = data.session.manual ? '记忆 · 已开启' : '记忆';
      return h(
        'div',
        { style: S.wrap },
        h(
          'button',
          {
            type: 'button',
            style: hovered ? { ...S.pill, ...S.pillHover } : S.pill,
            'aria-expanded': open,
            title: data.workspace,
            onClick: () => setOpen((value) => !value),
            onMouseEnter: () => setHovered(true),
            onMouseLeave: () => setHovered(false),
          },
          h('span', { style: { ...S.dot, background: 'var(--dsw-alias-state-success-primary)' } }),
          h('span', null, label),
          h('span', { style: S.count }, `${data.total} 篇 / 索引 ${data.catalog}`),
          h(
            'svg',
            {
              width: 12,
              height: 12,
              viewBox: '0 0 12 12',
              fill: 'none',
              'aria-hidden': 'true',
              style: open ? { ...S.chevron, ...S.chevronOpen } : S.chevron,
            },
            h('path', { d: 'M3 4.5L6 7.5L9 4.5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
          ),
        ),
        open
          ? h(Panel, {
              data,
              onRefresh: load,
              onOpen: () => {
                if (layout && typeof layout.selectPanel === 'function') layout.selectPanel('kb');
              },
              onDisable: sessionId
                ? () => {
                    postMode(sessionId, false)
                      .then(load)
                      .catch(() => {});
                  }
                : null,
            })
          : null,
      );
    }

    // --- session "..." menu rows --------------------------------------------

    /** One menu row: the single `role="menuitem"` button an entry renders. */
    function KbMenuRow(props) {
      const [active, setActive] = useState(false);
      const disabled = props.disabled === true;
      const style = disabled
        ? { ...S.menuItem, ...S.menuItemDisabled }
        : active
          ? { ...S.menuItem, ...S.menuItemHover }
          : S.menuItem;
      return h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          style,
          disabled,
          onMouseEnter: disabled ? undefined : () => setActive(true),
          onMouseLeave: disabled ? undefined : () => setActive(false),
          onFocus: disabled ? undefined : () => setActive(true),
          onBlur: disabled ? undefined : () => setActive(false),
          onClick: disabled ? undefined : props.onSelect,
        },
        h('span', { style: S.menuIcon }, h(KbIcon, { size: 14 })),
        h('span', { style: S.menuLabel }, props.label),
      );
    }

    /** Read the live session posture when the menu mounts this row. */
    function useSessionPanel(sessionId) {
      const [state, setState] = useState({ status: sessionId ? 'loading' : 'hidden', session: null });

      useEffect(() => {
        if (!sessionId) {
          setState({ status: 'hidden', session: null });
          return undefined;
        }
        let alive = true;
        setState({ status: 'loading', session: null });
        try {
          loadSessionPanel(sessionId)
            .then((data) => {
              if (!alive) return;
              const session = data && data.session;
              if (session && session.id) setState({ status: 'ready', session });
              else setState({ status: 'hidden', session: null });
            })
            .catch(() => {
              if (alive) setState({ status: 'failed', session: null });
            });
        } catch {
          setState({ status: 'failed', session: null });
        }
        return () => {
          alive = false;
        };
      }, [sessionId]);

      return state;
    }

    /**
     * Toggle row. It only mounts while the "..." menu is open, so the panel
     * read happens exactly then; an out-of-vault session pays nothing before.
     */
    function KbMemoryMenuItem(props) {
      // Root-scope owners always supply the slot-level hook; anything else
      // renders nothing instead of throwing inside the menu's list.
      if (!props || typeof props.useMenuOpenState !== 'function') return null;
      return h(KbMemoryRow, props);
    }

    function KbMemoryRow(props) {
      const [, setMenuOpen] = props.useMenuOpenState();
      const raw = props.sessionId === undefined || props.sessionId === null ? null : String(props.sessionId);
      const state = useSessionPanel(raw);

      const closeMenu = () => {
        try {
          setMenuOpen(false);
        } catch {
          /* the menu owns its open state */
        }
      };

      if (state.status === 'loading') return h(KbMenuRow, { label: menuRowLabel(null), disabled: true });
      if (state.status !== 'ready') return null;
      const session = state.session;
      if (!session || session.mode === 'unknown') return null;

      const on = session.mode === 'on';
      return h(KbMenuRow, {
        label: menuRowLabel(session),
        onSelect: () => {
          closeMenu();
          void submitMode(raw, !on);
        },
      });
    }

    /** Second row, present only while the session carries a manual override. */
    function KbMemoryResetMenuItem(props) {
      if (!props || typeof props.useMenuOpenState !== 'function') return null;
      return h(KbMemoryResetRow, props);
    }

    function KbMemoryResetRow(props) {
      const [, setMenuOpen] = props.useMenuOpenState();
      const raw = props.sessionId === undefined || props.sessionId === null ? null : String(props.sessionId);
      const state = useSessionPanel(raw);

      const closeMenu = () => {
        try {
          setMenuOpen(false);
        } catch {
          /* the menu owns its open state */
        }
      };

      if (state.status !== 'ready') return null;
      const session = state.session;
      if (!session || session.manual !== true) return null;

      return h(KbMenuRow, {
        label: '恢复自动判定',
        onSelect: () => {
          closeMenu();
          void submitModeReset(raw);
        },
      });
    }

    // --- sidebar icon -------------------------------------------------------

    function KbIcon(props) {
      const size = (props && props.size) || 18;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          'aria-hidden': 'true',
          focusable: 'false',
          role: 'presentation',
        },
        h('rect', { key: 'a', x: 3.5, y: 3.8, width: 17, height: 4.2, rx: 2.1, fill: 'currentColor' }),
        h('rect', { key: 'b', x: 5.5, y: 9.7, width: 13, height: 3.8, rx: 1.9, fill: 'currentColor', opacity: 0.78 }),
        h('rect', { key: 'c', x: 7.5, y: 15.2, width: 9, height: 3.4, rx: 1.7, fill: 'currentColor', opacity: 0.56 }),
        h('circle', { key: 'd', cx: 12, cy: 21, r: 1.4, fill: 'currentColor', opacity: 0.4 }),
      );
    }

    // --- sidebar footer action ----------------------------------------------

    /**
     * Sidebar refresh action.
     *
     * The main button is a soft refresh: mounted panel surfaces re-read their
     * snapshots and the page is never unloaded, so running turns cannot be
     * interrupted. The caret exposes the full reload, which asks the Host first:
     * idle -> reload now; busy -> queue and poll until idle. A busy full reload
     * is never forced. `Ctrl+R` remains a browser-level escape hatch.
     */
    function KbReloadAction(props) {
      const wide = !props || props.wide !== false;
      const [hovered, setHovered] = useState(false);
      const [menuOpen, setMenuOpen] = useState(false);
      const [queued, setQueued] = useState(false);
      const [busyCount, setBusyCount] = useState(0);
      const [flash, setFlash] = useState('');
      const wrapRef = useRef(null);

      useEffect(() => {
        if (!flash) return undefined;
        const timer = setTimeout(() => setFlash(''), 1600);
        return () => clearTimeout(timer);
      }, [flash]);

      useEffect(() => {
        if (!menuOpen) return undefined;
        const close = (event) => {
          if (wrapRef.current && !wrapRef.current.contains(event.target)) setMenuOpen(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
      }, [menuOpen]);

      // A queued full reload waits for every running turn to end. It never
      // forces a reload while `/kb/busy` reports work in progress.
      useEffect(() => {
        if (!queued) return undefined;
        let cancelled = false;
        const tick = async () => {
          try {
            const response = await fetch('/kb/busy', { cache: 'no-store' });
            if (!response.ok) throw new Error(String(response.status));
            const info = await response.json();
            const count = Number(info && info.busy) || 0;
            if (cancelled) return;
            if (count === 0) {
              try {
                window.location.reload();
              } catch {
                if (!cancelled) {
                  setQueued(false);
                  setFlash('重载失败');
                }
              }
              return;
            }
            setBusyCount(count);
          } catch {
            if (!cancelled) {
              setQueued(false);
              setFlash('检查失败');
            }
          }
        };
        tick();
        const timer = setInterval(tick, 2000);
        return () => {
          cancelled = true;
          clearInterval(timer);
        };
      }, [queued]);

      const softRefresh = () => {
        setMenuOpen(false);
        window.dispatchEvent(new Event(REFRESH_EVENT));
        setFlash('已刷新');
      };

      const startFullReload = async () => {
        setMenuOpen(false);
        try {
          const response = await fetch('/kb/busy', { cache: 'no-store' });
          if (!response.ok) throw new Error(String(response.status));
          const info = await response.json();
          const count = Number(info && info.busy) || 0;
          if (count === 0) {
            try {
              window.location.reload();
            } catch {
              setFlash('重载失败');
            }
            return;
          }
          setBusyCount(count);
          setQueued(true);
        } catch {
          setFlash('检查失败');
        }
      };

      const label = queued ? (busyCount ? `等待空闲 ${busyCount}` : '等待空闲') : flash || '刷新界面';
      const title = queued
        ? `有 ${busyCount} 个对话在运行；空闲后自动完整重载。点击主按钮仍可软刷新`
        : wide
          ? '刷新界面（软刷新，不中断对话）；点右侧箭头可完整重载'
          : '刷新界面（软刷新，不中断对话）；展开侧栏可完整重载';
      const style = {
        ...S.reloadBtn,
        ...(wide ? { flex: '1 1 auto' } : S.reloadBtnCollapsed),
        ...(hovered ? S.reloadBtnHover : null),
        ...(queued ? S.reloadBtnArmed : null),
      };
      return h(
        'div',
        { ref: wrapRef, style: S.reloadWrap },
        h(
          'button',
          {
            type: 'button',
            style,
            title,
            'aria-label': title,
            onMouseEnter: () => setHovered(true),
            onMouseLeave: () => setHovered(false),
            onFocus: () => setHovered(true),
            onBlur: () => setHovered(false),
            onClick: softRefresh,
          },
          h(
            'span',
            { style: S.reloadIcon, 'aria-hidden': 'true' },
            h(
              'svg',
              {
                width: 16,
                height: 16,
                viewBox: '0 0 24 24',
                fill: 'none',
                focusable: 'false',
                role: 'presentation',
              },
              h('path', {
                d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5',
                stroke: 'currentColor',
                strokeWidth: 1.5,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              }),
            ),
          ),
          wide ? h('span', { style: S.reloadLabel }, label) : null,
        ),
        wide
          ? h(
              'button',
              {
                type: 'button',
                style: S.reloadCaret,
                title: queued ? '等待空闲后完整重载' : '完整重载界面',
                'aria-label': '完整重载界面',
                'aria-haspopup': 'menu',
                'aria-expanded': menuOpen,
                onClick: () => setMenuOpen((value) => !value),
              },
              '▾',
            )
          : null,
        wide && menuOpen
          ? h(
              'div',
              { style: S.reloadMenu, role: 'menu' },
              h(
                'div',
                { style: S.reloadMenuNote },
                queued
                  ? `正在等待 ${busyCount} 个对话结束；完成后自动完整重载`
                  : '完整重载会刷新页面；有对话运行时会等待空闲，不会强制中断',
              ),
              h(
                'button',
                {
                  type: 'button',
                  role: 'menuitem',
                  style: S.menuItem,
                  onClick: queued
                    ? () => {
                        setQueued(false);
                        setMenuOpen(false);
                        setFlash('已取消');
                      }
                    : startFullReload,
                },
                queued ? '取消等待重载' : '完整重载界面',
              ),
            )
          : null,
      );
    }

    // --- knowledge-base page ------------------------------------------------

    /** Minimal block renderer: headings, list items and paragraphs. No HTML. */
    function renderBody(body) {
      if (!body) return [h('div', { key: 'empty', style: S.empty }, '（无正文）')];
      const nodes = [];
      const lines = body.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const key = `l${index}`;
        if (!line.trim()) {
          nodes.push(h('div', { key, style: { height: '6px' } }));
          continue;
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
          nodes.push(h('div', { key, style: { ...S.mdHead, fontSize: heading[1].length <= 2 ? '18px' : '16px' } }, heading[2]));
          continue;
        }
        if (/^\s*[-*+]\s+/.test(line)) {
          nodes.push(h('div', { key, style: S.mdItem }, `• ${line.replace(/^\s*[-*+]\s+/, '')}`));
          continue;
        }
        if (/^\s*>\s?/.test(line)) {
          nodes.push(h('div', { key, style: { ...S.mdPara, paddingLeft: '12px', borderLeft: '2px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-secondary)' } }, line.replace(/^\s*>\s?/, '')));
          continue;
        }
        nodes.push(h('p', { key, style: S.mdPara }, line));
      }
      return nodes;
    }

    function KbPage() {
      const [data, setData] = useState(null);
      const [failed, setFailed] = useState(false);
      const [query, setQuery] = useState('');
      const [layer, setLayer] = useState('all');
      const [selected, setSelected] = useState(null);
      const [detail, setDetail] = useState(null);
      const [detailBusy, setDetailBusy] = useState(false);
      const [statusBusy, setStatusBusy] = useState(false);
      const [busy, setBusy] = useState(false);
      /** Host rejection message; a failed action must never look successful. */
      const [actionError, setActionError] = useState('');
      const [health, setHealth] = useState(null);
      const [searchFocused, setSearchFocused] = useState(false);
      const [hoveredFilter, setHoveredFilter] = useState(null);
      const [hoveredNote, setHoveredNote] = useState(null);

      const load = useCallback(async () => {
        try {
          const [panelResponse, healthResponse] = await Promise.all([
            fetch(panelUrl(currentSessionId), { cache: 'no-store' }),
            fetch('/kb/ingest.json', { cache: 'no-store' }),
          ]);
          if (!panelResponse.ok) throw new Error(String(panelResponse.status));
          setData(rememberCsrf(await panelResponse.json()));
          if (healthResponse.ok) {
            try {
              setHealth(await healthResponse.json());
            } catch {
              setHealth(null);
            }
          }
          setFailed(false);
        } catch {
          setFailed(true);
        }
      }, []);

      useEffect(() => {
        load();
        const timer = setInterval(load, 30000);
        return () => clearInterval(timer);
      }, [load]);

      // Soft refresh from the sidebar action: keep query/filter/selection and
      // re-read the snapshots only.
      useEffect(() => {
        const onRefresh = () => load();
        window.addEventListener(REFRESH_EVENT, onRefresh);
        return () => window.removeEventListener(REFRESH_EVENT, onRefresh);
      }, [load]);

      const openNote = useCallback(async (id) => {
        setSelected(id);
        setDetailBusy(true);
        setDetail(null);
        try {
          const response = await fetch(`/kb/note.json?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
          if (!response.ok) throw new Error(String(response.status));
          setDetail(await response.json());
        } catch {
          setDetail(null);
        } finally {
          setDetailBusy(false);
        }
      }, []);

      /** POST one lifecycle action; surfaces the Host's error text on failure. */
      const postAction = useCallback(async (url, body) => {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (response.ok) {
          setActionError('');
          return true;
        }
        let message = `操作被拒绝（HTTP ${response.status}）`;
        try {
          const payload = await response.json();
          if (payload && payload.error) message = String(payload.error).slice(0, 200);
        } catch {
          /* keep the status message */
        }
        setActionError(message);
        return false;
      }, []);

      /**
       * Confirm / reclassify / archive one note. This is the only path from
       * `inbox` to `active`, i.e. the only way a memory may reach the model.
       */
      const applyStatus = useCallback(
        async (id, status, scope, clearScope) => {
          setStatusBusy(true);
          try {
            if (!(await postAction('/kb/atom', { id, status, scope, clearScope: clearScope === true }))) return;
            await load();
            await openNote(id);
          } catch {
            /* keep the previous view */
          } finally {
            setStatusBusy(false);
          }
        },
        [load, openNote, postAction],
      );

      /**
       * Batch lifecycle transitions from the 整理 row: one request, one index
       * rebuild on the Host side.
       */
      const batchApply = useCallback(
        async (ids, status, scope) => {
          if (!Array.isArray(ids) || !ids.length) return;
          setBusy(true);
          try {
            if (!(await postAction('/kb/atoms/batch', { ids, status, scope }))) return;
            await load();
          } catch {
            /* keep the previous view */
          } finally {
            setBusy(false);
          }
        },
        [load, postAction],
      );

      /**
       * Choose which project this session reads memories from. `global` is the
       * default; a project scope adds that project's memories on top.
       */
      const changeScope = useCallback(
        async (scope) => {
          if (!currentSessionId) return;
          setBusy(true);
          try {
            await fetch('/kb/scope', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ session: currentSessionId, scope }),
            });
            await load();
          } catch {
            /* keep the previous scope visible */
          } finally {
            setBusy(false);
          }
        },
        [load],
      );

      const notes = useMemo(() => {
        const all = (data && data.notes) || [];
        const q = query.trim().toLowerCase();
        return all.filter((note) => {
          if (layer !== 'all' && note.level !== layer) return false;
          if (!q) return true;
          const haystack = `${note.id} ${note.title} ${note.summary} ${(note.tags || []).join(' ')}`.toLowerCase();          return haystack.includes(q);
        });
      }, [data, query, layer]);

      useEffect(() => {
        if (!notes.length) {
          setSelected(null);
          setDetail(null);
          return;
        }
        if (!selected || !notes.some((note) => note.id === selected)) openNote(notes[0].id);
      }, [notes, selected, openNote]);

      const toggleMode = useCallback(
        async (enabled) => {
          if (!currentSessionId) return;
          setBusy(true);
          try {
            await postMode(currentSessionId, enabled);
            await load();
          } catch {
            /* leave the previous posture visible */
          } finally {
            setBusy(false);
          }
        },
        [load],
      );

      const resetMode = useCallback(async () => {
        if (!currentSessionId) return;
        setBusy(true);
        try {
          await fetch('/kb/mode', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ session: currentSessionId, reset: true }),
          });
          await load();
        } catch {
          /* keep the previous posture */
        } finally {
          setBusy(false);
        }
      }, [load]);

      const session = data && data.session;
      const canToggle = Boolean(session && session.id);
      const layers = [['all', '全部'], ['raw', '原文'], ['digest', '摘要'], ['canon', '结论']];

      const header = h(
        'div',
        { style: S.pageHead },
        h(
          'div',
          null,
          h('div', { style: S.pageTitle }, '知识库'),
          h('div', { style: S.pageLead }, data ? data.workspace : '读取中…'),
        ),
        h(
          'div',
          { style: S.pageMeta },
          h('span', null, data ? `笔记 ${data.total} · 索引 ${data.catalog} · 注入 ${data.injected || 0} · 待确认 ${data.inbox || 0} · 待复查 ${data.review}` : ''),
          h(KbButton, { onClick: load }, '刷新'),
        ),
      );

      const sessionBar = h(
        'div',
        { style: S.sessionBar },
        h(
          'span',
          {
            style: {
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background:
                session && session.mode === 'on'
                  ? 'var(--dsw-alias-state-success-primary)'
                  : session && session.mode === 'off'
                    ? 'var(--dsw-alias-state-idle-primary)'
                    : 'var(--dsw-alias-state-warn-primary)',
            },
          }),
        h('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, modeText(session)),
        canToggle
          ? h(
              KbButton,
              { disabled: busy, onClick: () => toggleMode(!(session.mode === 'on')) },
              session.mode === 'on' ? '关闭本会话记忆' : '在本会话启用记忆',
            )
          : h('span', null, '打开一个会话后可在这里切换注入'),
        session && session.manual ? h(KbButton, { disabled: busy, onClick: resetMode }, '恢复自动判定') : null,
        canToggle && data
          ? h(
              'span',
              { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } },
              h('span', null, '本会话范围'),
              ['global'].concat(data.scopes || []).map((scope) =>
                h(
                  KbButton,
                  { key: scope, disabled: busy, onClick: () => changeScope(scope) },
                  `${(session.scope || 'global') === scope ? '✓ ' : ''}${scope === 'global' ? '全局' : scope.replace('project:', '')}`,
                ),
              ),
            )
          : null,
        h('span', { style: S.sessionBarNote }, '关闭后该会话不再注入 core.md，也不影响其它会话'),
      );

      const projectBar = h(
        'div',
        { style: { ...S.sessionBar, flexWrap: 'wrap' } },
        h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '已接入项目：'),
        (data && Array.isArray(data.projects) ? data.projects : []).length
          ? (data.projects || []).map((project) =>
              h(
                'span',
                {
                  key: project.slug,
                  title: project.path,
                  style: {
                    color:
                      session && project.path === session.projectRoot
                        ? 'var(--dsw-alias-label-primary)'
                        : 'var(--dsw-alias-label-secondary)',
                  },
                },
                `${session && project.path === session.projectRoot ? '当前 ' : ''}${project.slug} · ${project.writable ? '可写' : '只读'}`,
              ),
            )
          : h('span', null, '无；在项目库运行 kb attach 显式接入'),
        data && data.globalRoot
          ? h('span', { style: S.sessionBarNote }, `全局库 ${data.globalRoot}`)
          : null,
      );

      const body = failed
        ? h('div', { style: { ...S.empty, padding: '24px' } }, '读取失败：Host 接口 /kb/panel.json 不可用')
        : h(
            'div',
            { style: S.pageBody },
            h(
              'div',
              { style: { ...S.column, width: '320px', flex: 'none' } },
              h(
                'div',
                { style: S.searchWrap },
                h('input', {
                  style: searchFocused ? { ...S.input, ...S.inputFocus } : S.input,
                  value: query,
                  placeholder: '搜索 id / 标题 / 摘要 / 标签',
                  onChange: (event) => setQuery(event.target.value),
                  onFocus: () => setSearchFocused(true),
                  onBlur: () => setSearchFocused(false),
                }),
              ),
              h(
                'div',
                { style: S.filters },
                layers.map(([value, text]) =>
                  h(
                    'button',
                    {
                      key: value,
                      type: 'button',
                      style: { ...S.chip, ...(layer === value ? S.chipOn : hoveredFilter === value ? S.chipHover : null) },
                      onMouseEnter: () => setHoveredFilter(value),
                      onMouseLeave: () => setHoveredFilter(null),
                      onClick: () => setLayer(value),
                    },
                    text,
                  ),
                ),
              ),
              (() => {
                // Frequently recalled notes come from access.jsonl via the Host.
                // Only ids that are still in the index are offered.
                const known = new Map(((data && data.notes) || []).map((note) => [note.id, note]));
                const hot = ((data && data.hot) || []).filter((row) => known.has(row.id)).slice(0, 4);
                return hot.length
                  ? h(
                      'div',
                      { style: S.hotRow },
                      h('span', { style: { ...S.muted, fontSize: '11px', flex: 'none' } }, '常读'),
                      hot.map((row) =>
                        h(
                          'button',
                          {
                            key: row.id,
                            type: 'button',
                            style: S.chip,
                            title: `${row.id} · 召回 ${row.count} 次`,
                            onClick: () => openNote(row.id),
                          },
                          `${(known.get(row.id).title || row.id).slice(0, 10)} ×${row.count}`,
                        ),
                      ),
                    )
                  : null;
              })(),
              notes.length
                ? h(
                    'ul',
                    { style: S.noteList },
                    notes.map((note) =>
                      h(
                        'li',
                        { key: note.id },
                        h(
                          'button',
                          {
                            type: 'button',
                            style: { ...S.noteBtn, ...(selected === note.id || hoveredNote === note.id ? S.noteHover : null) },
                            onMouseEnter: () => setHoveredNote(note.id),
                            onMouseLeave: () => setHoveredNote(null),
                            onClick: () => openNote(note.id),
                          },
                          h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, note.title || note.id),
                          h(
                            'div',
                            { style: S.noteMeta },
                            h('span', { style: S.badge }, LAYER_LABEL[note.level] || note.level || '—'),
                            note.type === 'work' ? h('span', { style: S.badge }, TYPE_LABEL.work) : null,
                            h('span', { style: S.badge }, STATUS_LABEL[note.status] || note.status || '—'),
                            h('span', { style: S.noteId }, note.id),
                          ),
                        ),
                      ),
                    ),
                  )
                : h('div', { style: S.empty }, '没有匹配的笔记'),
            ),
            h(
              'div',
              { style: { ...S.column, flex: 1 } },
              detailBusy
                ? h('div', { style: S.empty }, '读取中…')
                : detail
                  ? h(
                      React.Fragment,
                      null,
                      h(
                        'div',
                        { style: S.detailHead },
                        h('div', { style: S.detailTitle }, detail.title || detail.id),
                        h(
                          'div',
                          { style: { ...S.noteMeta, marginTop: '4px' } },
                          h('span', { style: S.badge }, LAYER_LABEL[detail.level] || detail.level || '—'),
                          detail.type === 'work' ? h('span', { style: S.badge }, TYPE_LABEL.work) : null,
                          h('span', { style: S.badge }, STATUS_LABEL[detail.status] || detail.status || '—'),
                          h('span', { style: S.badge }, scopeLabel(detail.scope)),
                          h('span', null, detail.id),
                          h('span', null, detail.updated || ''),
                          h('span', { style: { marginLeft: 'auto' } }, detail.file),
                        ),
                        detail.level === 'digest' && detail.type !== 'work'
                          ? h(
                              'div',
                              { style: S.confirmRow },
                              h(
                                'span',
                                { style: { ...S.muted, fontSize: '11px' } },
                                detail.status === 'active'
                                  ? '归类（误点可直接改）：'
                                  : detail.status === 'archived'
                                    ? '已归档，可恢复或改归类：'
                                    : detail.status === 'inbox'
                                      ? '未确认，不会进入对话：'
                                      : '当前状态不会进入对话：',
                              ),
                              ['global', 'system']
                                .concat(data && Array.isArray(data.scopes) ? data.scopes : [])
                                .map((scope) =>
                                  h(
                                    KbButton,
                                    {
                                      key: scope,
                                      disabled: statusBusy,
                                      onClick: () => applyStatus(detail.id, 'active', scope),
                                    },
                                    `${detail.scope === scope ? '✓ ' : ''}${scope === 'global' ? '全局' : scope === 'system' ? '系统' : scope.replace('project:', '')}`,
                                  ),
                                ),
                              detail.scope
                                ? h(
                                    KbButton,
                                    { disabled: statusBusy, onClick: () => applyStatus(detail.id, 'active', '', true) },
                                    detail.scope === 'global' ? '取消全局' : '取消范围',
                                  )
                                : null,
                              h(
                                KbButton,
                                { disabled: statusBusy, onClick: () => applyStatus(detail.id, 'inbox', detail.scope || '') },
                                '退回待确认',
                              ),
                              h(
                                KbButton,
                                { disabled: statusBusy, onClick: () => applyStatus(detail.id, 'archived') },
                                '归档',
                              ),
                            )
                          : null,
                        detail.type === 'work'
                          ? h(
                              'div',
                              { style: S.confirmRow },
                              h(
                                'span',
                                { style: { ...S.muted, fontSize: '11px' } },
                                detail.status === 'active'
                                  ? '工作页不注入；项目结束可归档，文件与历史保留：'
                                  : '已归档；恢复后重新出现在工作页列表：',
                              ),
                              h(
                                KbButton,
                                {
                                  disabled: statusBusy,
                                  onClick: () => applyStatus(detail.id, detail.status === 'active' ? 'archived' : 'active'),
                                },
                                detail.status === 'active' ? '归档' : '恢复为活跃',
                              ),
                            )
                          : null,
                      ),
                      h('div', { style: S.detailBody }, renderBody(detail.body)),
                    )
                  : h('div', { style: S.empty }, notes.length ? '选择左侧一篇笔记' : '还没有笔记'),
            ),
          );

      const judge = health && health.judgeWorker ? health.judgeWorker : null;
      const clockOf = (iso) => {
        try {
          return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        } catch {
          return '—';
        }
      };
      const lastReason = judge && judge.lastVerdict && judge.lastVerdict.reason ? String(judge.lastVerdict.reason) : '';
      const healthBar = health
        ? h(
            'div',
            { style: S.health },
            h('span', null, `队列 ${judge && judge.queue ? judge.queue.pending : 0}`),
            h('span', { style: S.healthSep }, '·'),
            h('span', null, `已写 ${judge && judge.queue ? judge.queue.written : 0}`),
            h('span', { style: S.healthSep }, '·'),
            h('span', null, `已拒 ${judge && judge.queue ? judge.queue.rejected : 0}`),
            judge && judge.queue && judge.queue.dry
              ? h('span', { style: S.healthSep }, '·')
              : null,
            judge && judge.queue && judge.queue.dry
              ? h('span', { title: 'dry 模式时期的历史裁决（只读审计）' }, `dry ${judge.queue.dry}`)
              : null,
            h('span', { style: S.healthSep }, '·'),
            h('span', null, `抽取 ${judge && judge.lastRunAt ? clockOf(judge.lastRunAt) : '待跑'}`),
            h('span', { style: S.healthSep }, '·'),
            h('span', null, `整理 ${health.consolidate && health.consolidate.at ? clockOf(health.consolidate.at) : '未跑'}`),
            h('span', { style: S.healthSep }, '·'),
            h('span', null, `界面 ${(health.ui && health.ui.build) || '未知'}`),
            judge && judge.lastError ? h('span', { style: S.healthBad }, `错误：${judge.lastError}`) : null,
            lastReason ? h('div', { style: S.healthVerdict }, `最近裁决：${lastReason}`) : null,
          )
        : null;

      const pendingIds = (data && data.pendingIds) || [];
      const reviewIds = (data && data.reviewIds) || [];
      const tidyBar =
        data && (pendingIds.length || reviewIds.length)
          ? h(
              'div',
              { style: S.health },
              h('span', { style: { ...S.muted } }, '整理'),
              pendingIds.length ? h('span', null, `待确认 ${pendingIds.length}`) : null,
              pendingIds.length
                ? h(KbButton, { disabled: busy, onClick: () => batchApply(pendingIds, 'active', 'global') }, '批量确认为全局')
                : null,
              pendingIds.length ? h(KbButton, { disabled: busy, onClick: () => batchApply(pendingIds, 'archived') }, '批量归档') : null,
              reviewIds.length ? h('span', null, `待复查 ${reviewIds.length}`) : null,
              reviewIds.length ? h(KbButton, { disabled: busy, onClick: () => batchApply(reviewIds, 'active') }, '恢复 active') : null,
              reviewIds.length ? h(KbButton, { disabled: busy, onClick: () => batchApply(reviewIds, 'archived') }, '批量归档') : null,
            )
          : null;

      return h(
        'div',
        { style: S.page },
        header,
        sessionBar,
        projectBar,
        tidyBar,
        actionError
          ? h(
              'div',
              {
                style: {
                  color: 'var(--dsw-alias-state-error-primary)',
                  fontSize: '12px',
                  lineHeight: '1.5',
                  margin: '4px 0',
                },
              },
              actionError,
            )
          : null,
        healthBar,
        body,
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          layout = ctx.get('layout');
        } catch {
          layout = null;
        }
        // Tell the Host which build this page loaded (best effort, never blocks).
        try {
          void fetch('/kb/ui', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ build: CLIENT_BUILD, at: new Date().toISOString() }),
          }).catch(() => {});
        } catch {
          /* the report is diagnostic only */
        }
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register({ name: 'conversation.composer.dock', id: 'kb-memory', order: 2 }, KbChip),
        );
        ctx.slots.inject('sidebar.workspaces.session.menu.item', function* () {
          yield ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.menu.item',
              id: 'kb-memory',
              order: 500,
              label: () => '知识库',
            },
            KbMemoryMenuItem,
          );
          yield ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.menu.item',
              id: 'kb-memory-reset',
              order: 510,
              label: () => '恢复自动判定',
            },
            KbMemoryResetMenuItem,
          );
        });
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: 'kb', order: 5, label: () => '知识库' }, KbIcon),
        );
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'kb-reload', order: 10, label: () => '刷新界面' },
            KbReloadAction,
          ),
        );
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'kb' }, KbPage));
      },
    };
  },
});
