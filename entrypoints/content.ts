export default defineContentScript({
  matches: ['*://*/*'],
  runAt: 'document_idle',
  main() {
    if (window.top !== window.self) return; // Only run in top-level frame

    const isZh = (navigator.language || '').toLowerCase().startsWith('zh');
    const failedHosts = new Set<string>();
    const isContextValid = () => {
      try {
        return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
      } catch {
        return false;
      }
    };

    const esc = (s: unknown) =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const setActionStatus = (el: Element, text: string, isErr = false) => {
      el.replaceChildren();
      const span = document.createElement('span');
      span.className = isErr ? 'status-msg err' : 'status-msg';
      span.textContent = text;
      el.appendChild(span);
    };

    const safeSendMessage = <T = unknown>(message: unknown, callback?: (res: T | undefined) => void) => {
      if (!isContextValid()) {
        callback?.(undefined);
        return;
      }
      try {
        chrome.runtime.sendMessage(message, (res) => {
          const err = chrome.runtime.lastError;
          if (err) {
            callback?.(undefined);
            return;
          }
          callback?.(res);
        });
      } catch {
        // Extension context invalidated (reloaded or updated)
        callback?.(undefined);
      }
    };


    let hostEl: HTMLDivElement | null = null;
    let shadow: ShadowRoot | null = null;
    let toastEl: HTMLDivElement | null = null;

    const LOGO_SVG = `
      <svg viewBox="0 0 32 32" fill="none" class="app-icon" xmlns="http://www.w3.org/2000/svg">
        <line x1="9" y1="8" x2="23" y2="24" stroke="#0ea5e9" stroke-width="3" stroke-opacity="0.3" stroke-linecap="round"/>
        <line x1="9" y1="8" x2="23" y2="24" stroke="#0284c7" stroke-width="2.6" stroke-linecap="round"/>
        <line x1="9" y1="8" x2="9" y2="24" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
        <line x1="23" y1="8" x2="23" y2="24" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
      </svg>
    `;

    const createToastDom = () => {
      if (hostEl) return;
      // Re-injection (extension reload/update) leaves the old root behind.
      document.getElementById('neo-omega-toast-root')?.remove();
      hostEl = document.createElement('div');
      hostEl.id = 'neo-omega-toast-root';
      shadow = hostEl.attachShadow({ mode: 'closed' });

      const style = document.createElement('style');
      style.textContent = `
        :host { all: initial; }
        * { box-sizing: border-box; margin: 0; padding: 0; }

        .toast-wrapper {
          position: fixed;
          top: 16px;
          right: 20px;
          z-index: 2147483647;
          display: flex;
          justify-content: flex-end;
          align-items: flex-start;
          pointer-events: none;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        }

        .toast-card {
          position: relative;
          width: 350px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.72);
          backdrop-filter: blur(24px) saturate(190%);
          -webkit-backdrop-filter: blur(24px) saturate(190%);
          border: 1px solid rgba(255, 255, 255, 0.6);
          box-shadow: 0 12px 36px -4px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.05);
          color: #0f172a;
          overflow: hidden;
          opacity: 0;
          transform: translateY(-12px) scale(0.97);
          transform-origin: top right;
          pointer-events: none;
          transition:
            opacity 0.24s cubic-bezier(0.16, 1, 0.3, 1),
            transform 0.24s cubic-bezier(0.16, 1, 0.3, 1);
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        @media (prefers-color-scheme: dark) {
          .toast-card {
            background: rgba(15, 23, 42, 0.72);
            border: 1px solid rgba(255, 255, 255, 0.14);
            box-shadow: 0 16px 40px -8px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.08);
            color: #f8fafc;
          }
        }

        .toast-card.show {
          opacity: 1;
          transform: translateY(0) scale(1);
          pointer-events: auto;
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .header-left {
          display: flex;
          align-items: center;
          gap: 7px;
          min-width: 0;
        }
        .app-icon {
          width: 18px;
          height: 18px;
          display: block;
          flex-shrink: 0;
          color: #0f172a;
        }
        @media (prefers-color-scheme: dark) {
          .app-icon { color: #f8fafc; }
        }

        .title-text {
          font-size: 13px;
          font-weight: 600;
          line-height: 18px;
          height: 18px;
          display: flex;
          align-items: center;
          color: #0f172a;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        @media (prefers-color-scheme: dark) {
          .title-text { color: #f8fafc; }
        }

        .close-btn {
          border: none;
          background: transparent;
          color: #94a3b8;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s ease;
          flex-shrink: 0;
        }
        .close-btn:hover {
          color: #0f172a;
          background: rgba(0, 0, 0, 0.05);
        }
        @media (prefers-color-scheme: dark) {
          .close-btn:hover {
            color: #ffffff;
            background: rgba(255, 255, 255, 0.1);
          }
        }

        .body-content {
          font-size: 11.5px;
          line-height: 1.45;
          color: #64748b;
          word-break: break-all;
        }
        @media (prefers-color-scheme: dark) {
          .body-content { color: #94a3b8; }
        }

        .host-chip-list {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          max-height: 48px;
          overflow: hidden;
        }
        .host-chip {
          background: rgba(0, 0, 0, 0.04);
          border: 1px solid rgba(0, 0, 0, 0.06);
          color: #334155;
          padding: 1.5px 6px;
          border-radius: 4px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 10.5px;
          max-width: 155px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        @media (prefers-color-scheme: dark) {
          .host-chip {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #cbd5e1;
          }
        }

        .telemetry-row {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 6px;
          background: rgba(0, 0, 0, 0.03);
          border: 1px solid rgba(0, 0, 0, 0.06);
          border-radius: 6px;
          padding: 6px 10px;
        }
        @media (prefers-color-scheme: dark) {
          .telemetry-row {
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.08);
          }
        }

        .tele-item {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .tele-item.right {
          align-items: flex-end;
          text-align: right;
        }
        .tele-name {
          font-size: 9.5px;
          color: #94a3b8;
        }
        .tele-num {
          font-size: 11.5px;
          font-weight: 600;
          font-family: ui-monospace, SFMono-Regular, monospace;
          color: #64748b;
        }
        .tele-num.fast {
          color: #2563eb;
        }
        @media (prefers-color-scheme: dark) {
          .tele-num.fast { color: #60a5fa; }
        }
        .tele-arrow {
          color: #94a3b8;
          font-size: 12px;
        }

        .actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
        }
        .ui-btn {
          border: none;
          border-radius: 6px;
          padding: 5px 12px;
          font-size: 11.5px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .ui-btn.primary {
          background: #2563eb;
          color: #ffffff;
        }
        .ui-btn.primary:hover {
          background: #1d4ed8;
        }
        .ui-btn.ghost {
          background: #f1f5f9;
          color: #475569;
          border: 1px solid #e2e8f0;
        }
        .ui-btn.ghost:hover {
          background: #e2e8f0;
        }
        @media (prefers-color-scheme: dark) {
          .ui-btn.primary {
            background: #3b82f6;
          }
          .ui-btn.primary:hover {
            background: #2563eb;
          }
          .ui-btn.ghost {
            background: rgba(255, 255, 255, 0.08);
            color: #cbd5e1;
            border: 1px solid rgba(255, 255, 255, 0.12);
          }
          .ui-btn.ghost:hover {
            background: rgba(255, 255, 255, 0.14);
          }
        }
        .ui-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .section-title {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: #64748b;
          margin: 0;
        }
        .section-divider {
          border-top: 1px solid #e2e8f0;
          margin: 0;
        }
        @media (prefers-color-scheme: dark) {
          .section-title { color: #94a3b8; }
          .section-divider { border-top-color: rgba(255, 255, 255, 0.1); }
        }

        .status-msg {
          font-size: 11.5px;
          font-weight: 500;
          color: #16a34a;
        }
        @media (prefers-color-scheme: dark) {
          .status-msg { color: #4ade80; }
        }
        .status-msg.err {
          color: #dc2626;
        }
        @media (prefers-color-scheme: dark) {
          .status-msg.err { color: #f87171; }
        }

      `;
      shadow.appendChild(style);

      const wrapper = document.createElement('div');
      wrapper.className = 'toast-wrapper';

      toastEl = document.createElement('div');
      toastEl.className = 'toast-card';
      wrapper.appendChild(toastEl);

      toastEl.addEventListener('mouseenter', () => {
        isHovered = true;
        pauseDismissTimer();
      });
      toastEl.addEventListener('mouseleave', () => {
        isHovered = false;
        resumeDismissTimer();
      });

      shadow.appendChild(wrapper);
      (document.body || document.documentElement).appendChild(hostEl);
    };

    let dismissTimer: number | null = null;
    let dismissTimeRemaining = 7000;
    let dismissStartedAt = 0;
    let isHovered = false;

    const startDismissTimer = (duration = 7000) => {
      clearTimeout(dismissTimer ?? undefined);
      dismissTimer = null;
      dismissTimeRemaining = duration;
      if (isHovered) return;
      dismissStartedAt = Date.now();
      dismissTimer = window.setTimeout(() => hideToast(), duration);
    };

    const pauseDismissTimer = () => {
      if (dismissTimer) {
        clearTimeout(dismissTimer);
        dismissTimer = null;
        dismissTimeRemaining -= Date.now() - dismissStartedAt;
      }
    };

    const resumeDismissTimer = () => {
      // Toast already hidden (e.g. close-click followed by mouseleave): don't
      // schedule a timer that would prematurely dismiss a future toast.
      if (!toastEl?.classList.contains('show')) return;
      if (dismissTimeRemaining > 400) {
        startDismissTimer(dismissTimeRemaining);
      } else {
        hideToast();
      }
    };


    const showToast = () => {
      if (!toastEl) return;
      requestAnimationFrame(() => {
        toastEl?.classList.add('show');
        if (!isHovered) {
          startDismissTimer(7000);
        } else {
          // Re-render while hovered: refresh the budget so mouseleave doesn't
          // inherit a stale near-zero remainder from the previous render.
          dismissTimeRemaining = 7000;
        }
      });
    };

    // clear=true only for explicit user dismissal (X button): auto-dismiss
    // keeps failedHosts/currentSpeedRec so unseen errors aren't lost forever
    // (background dedups per tab and won't re-notify them).
    const hideToast = (clear = false) => {
      if (!toastEl) return;
      isHovered = false;
      clearTimeout(dismissTimer ?? undefined);
      dismissTimer = null;
      if (clear) {
        currentSpeedRec = null;
        speedRecApplied = false;
        failedHosts.clear();
      }
      toastEl.classList.remove('show');
    };

    interface SpeedRecommendation {
      host: string;
      currentProfileId: string;
      currentProfileName: string;
      recommendedProfileId: string;
      recommendedProfileName: string;
      currentLatency: number;
      recommendedLatency: number;
    }

    let currentSpeedRec: SpeedRecommendation | null = null;
    let speedRecApplied = false;

    // One toast, one section per notification type. A new notification of the
    // same type merges into its section; a different type appends a section
    // instead of replacing the visible one.
    const renderAll = () => {
      const hosts = Array.from(failedHosts);
      const rec = currentSpeedRec;
      if (hosts.length === 0 && !rec) {
        hideToast();
        return;
      }
      createToastDom();
      if (!toastEl) return;

      const both = hosts.length > 0 && !!rec;
      const failureTitle = isZh
        ? `${hosts.length} 个域名无法访问`
        : `${hosts.length} Unreachable Host${hosts.length > 1 ? 's' : ''}`;
      const speedTitle = isZh ? '加速建议' : 'Speed Boost';
      const headerTitle = both ? 'NeoOmega' : hosts.length > 0 ? failureTitle : speedTitle;

      const sections: string[] = [];

      if (hosts.length > 0) {
        const btnText = isZh ? '一键添加代理' : 'Proxy Hosts';
        const muteText = isZh ? '不再提示' : "Don't Show Again";
        const chipsHtml = hosts
          .slice(0, 4)
          .map((h) => `<span class="host-chip" title="${esc(h)}">${esc(h)}</span>`)
          .join('') + (hosts.length > 4 ? `<span class="host-chip">+${hosts.length - 4}</span>` : '');
        sections.push(`
          <div class="section failure-section">
            ${both ? `<div class="section-title">${esc(failureTitle)}</div>` : ''}
            <div class="body-content">
              <div class="host-chip-list">${chipsHtml}</div>
            </div>
            <div class="actions">
              <button class="ui-btn ghost mute-btn">${esc(muteText)}</button>
              <button class="ui-btn primary action-btn">${esc(btnText)}</button>
            </div>
          </div>
        `);
      }

      if (rec) {
        const applyText = isZh ? '应用加速' : 'Apply Speedup';
        const dismissText = isZh ? '忽略' : 'Ignore';
        const speedupPct = Math.round(((rec.currentLatency - rec.recommendedLatency) / rec.currentLatency) * 100);
        sections.push(`
          <div class="section speed-section">
            ${both ? `<div class="section-title">${esc(speedTitle)}</div>` : ''}
            <div class="body-content">
              <div style="margin-bottom: 3px; font-weight: 500; font-family: ui-monospace, monospace;">${esc(rec.host)}</div>
              <div class="telemetry-row">
                <div class="tele-item">
                  <span class="tele-name">${esc(rec.currentProfileName)}</span>
                  <span class="tele-num">${esc(rec.currentLatency)}ms</span>
                </div>
                <div class="tele-arrow">➔</div>
                <div class="tele-item right">
                  <span class="tele-name">${esc(rec.recommendedProfileName)}</span>
                  <span class="tele-num fast">${esc(rec.recommendedLatency)}ms${speedupPct > 0 ? ` (-${esc(speedupPct)}%)` : ''}</span>
                </div>
              </div>
            </div>
            <div class="actions">
              <button class="ui-btn ghost dismiss-btn">${esc(dismissText)}</button>
              ${speedRecApplied
                ? `<span class="status-msg">✓ ${esc(isZh ? `已添加规则：${rec.host}` : `Rule added: ${rec.host}`)}</span>`
                : `<button class="ui-btn primary action-btn speed-btn">${esc(applyText)}</button>`}
            </div>
          </div>
        `);
      }

      const toastDoc = new DOMParser().parseFromString(
        `
        <div class="header">
          <div class="header-left">
            ${LOGO_SVG}
            <span class="title-text">${esc(headerTitle)}</span>
          </div>
          <button class="close-btn" title="Dismiss">
            <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        ${sections.join('<div class="section-divider"></div>')}
        `,
        'text/html'
      );
      toastEl.replaceChildren(...toastDoc.body.childNodes);

      toastEl.querySelector('.close-btn')?.addEventListener('click', () => hideToast(true));

      const failureSection = toastEl.querySelector('.failure-section');
      if (failureSection && hosts.length > 0) {
        const muteBtn = failureSection.querySelector('.mute-btn') as HTMLButtonElement | null;
        muteBtn?.addEventListener('click', () => {
          if (!muteBtn) return;
          muteBtn.disabled = true;
          safeSendMessage({ type: 'MUTE_FAILURE_HOSTS', hosts });
          for (const h of hosts) failedHosts.delete(h);
          renderAll();
        });

        const actionBtn = failureSection.querySelector('.action-btn') as HTMLButtonElement | null;
        actionBtn?.addEventListener('click', async () => {
          if (!actionBtn) return;
          actionBtn.disabled = true;
          actionBtn.textContent = isZh ? '添加中...' : 'Adding...';

          // One batch message: background saves settings + recompiles PAC once
          const { promise: addPromise, resolve: addResolve } = Promise.withResolvers<{ success: boolean; count?: number; hosts?: string[]; error?: string }>();
          safeSendMessage<{ success: boolean; count?: number; hosts?: string[]; error?: string }>(
            { type: 'ADD_HOST_RULE', patterns: [...hosts], profileId: 'proxy' },
            (r) => addResolve(r || { success: false })
          );
          const res = await addPromise;
          const successCount = res.success ? (res.count ?? 0) : 0;
          const lastError = res.error || '';
          for (const h of res.hosts ?? []) failedHosts.delete(h);

          // Stale: renderAll() rebuilt the toast DOM while the IPC was in
          // flight — refresh the live DOM instead of writing detached nodes.
          if (!failureSection.isConnected) {
            renderAll();
            return;
          }
          const actionsEl = failureSection.querySelector('.actions');
          if (actionsEl) {
            if (successCount > 0) {
              setActionStatus(
                actionsEl,
                `✓ ${isZh ? `已添加 ${successCount} 条规则，刷新生效` : `Added ${successCount} rules`}`
              );
              window.setTimeout(() => renderAll(), 2500);
            } else {
              actionBtn.disabled = false;
              setActionStatus(actionsEl, lastError || (isZh ? '添加失败' : 'Failed to add'), true);
              window.setTimeout(() => renderAll(), 2500);
            }
          } else {
            actionBtn.disabled = false;
          }
        });
      }

      const speedSection = toastEl.querySelector('.speed-section');
      if (speedSection && rec) {
        speedSection.querySelector('.dismiss-btn')?.addEventListener('click', () => {
          currentSpeedRec = null;
          speedRecApplied = false;
          renderAll();
        });

        const speedBtn = speedSection.querySelector('.action-btn.speed-btn') as HTMLButtonElement | null;
        speedBtn?.addEventListener('click', async () => {
          if (!speedBtn) return;
          speedBtn.disabled = true;
          speedBtn.textContent = isZh ? '应用中...' : 'Applying...';
          const { promise: applyPromise, resolve: applyResolve } = Promise.withResolvers<{ success: boolean; error?: string; profileName?: string }>();
          safeSendMessage<{ success: boolean; error?: string; profileName?: string }>(
            {
              type: 'APPLY_SPEED_RECOMMENDATION',
              host: rec.host,
              profileId: rec.recommendedProfileId,
            },
            (res) => applyResolve(res || { success: false })
          );

          const res = await applyPromise;
          // Stale: a newer recommendation or dismiss replaced this one while
          // the IPC was in flight — don't clobber its state/DOM.
          if (currentSpeedRec !== rec) return;
          // A renderAll during the await detached this section — re-render.
          if (!speedSection.isConnected) {
            renderAll();
            return;
          }
          const actionsEl = speedSection.querySelector('.actions');
          if (actionsEl) {
            if (res.success) {
              speedRecApplied = true;
              renderAll();
              const appliedRec = rec;
              window.setTimeout(() => {
                if (currentSpeedRec === appliedRec) {
                  currentSpeedRec = null;
                  speedRecApplied = false;
                  renderAll();
                }
              }, 2500);
            } else {
              speedBtn.disabled = false;
              setActionStatus(actionsEl, res.error || (isZh ? '应用失败' : 'Failed'), true);
              window.setTimeout(() => renderAll(), 3000);
            }
          } else {
            speedBtn.disabled = false;
          }
        });
      }

      showToast();
    };
    let slowAnalysisDone = false;
    const isExcluded = (h: string) =>
      !h ||
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '::1' ||
      h.startsWith('192.168.') ||
      h.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      h.endsWith('.local') ||
      h.endsWith('.internal') ||
      h.endsWith('.lan');

    const reportedSlowHosts = new Set<string>();
    const THRESHOLD = 3000;

    const reportSlowHost = (h: string, dur: number, protocol = window.location.protocol) => {
      if (isExcluded(h) || reportedSlowHosts.has(h)) return;
      reportedSlowHosts.add(h);
      console.log('[NeoOmega] Detected slow host:', h, `${dur}ms`);
      safeSendMessage({
        type: 'ANALYZE_SLOW_HOSTS',
        protocol,
        hosts: [{ host: h, duration: dur, protocol }],
        url: window.location.href,
      });
    };

    const scanExistingTimings = () => {
      if (typeof performance === 'undefined' || !performance.getEntriesByType) return;
      try {
        const navs = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
        if (navs.length > 0) {
          const nav = navs[0];
          if (!nav) return;
          const dur = nav.duration || (nav.responseEnd - nav.startTime);
          if (dur > THRESHOLD && window.location.hostname) {
            reportSlowHost(window.location.hostname, Math.round(dur), window.location.protocol);
          }
        }
      } catch {}

      try {
        const resList = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        for (const r of resList) {
          const dur = r.duration || (r.responseEnd - r.startTime);
          if (dur > THRESHOLD && r.name) {
            try {
              const u = new URL(r.name);
              if (u.protocol === 'http:' || u.protocol === 'https:') {
                reportSlowHost(u.hostname, Math.round(dur), u.protocol);
              }
            } catch {}
          }
        }
      } catch {}
    };

    try {
      if (typeof PerformanceObserver !== 'undefined') {
        const observer = new PerformanceObserver((list) => {
          if (!isContextValid()) {
            observer.disconnect();
            return;
          }
          for (const entry of list.getEntries()) {
            const dur = entry.duration;
            if (dur > THRESHOLD && entry.name) {
              try {
                const u = new URL(entry.name);
                if (u.protocol === 'http:' || u.protocol === 'https:') {
                  reportSlowHost(u.hostname, Math.round(dur), u.protocol);
                }
              } catch {}
            }
          }
        });
        observer.observe({ type: 'resource', buffered: true });
      }
    } catch {}

    scanExistingTimings();
    window.setTimeout(scanExistingTimings, 1500);
    window.setTimeout(scanExistingTimings, 4000);

    // Listen for real-time error notifications from background
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'TAB_FAILED_RESOURCES' && message.host) {
        failedHosts.add(message.host);
        renderAll();
      }
      if (message?.type === 'TAB_ERROR_RETRACTED' && message.host) {
        failedHosts.delete(message.host);
        renderAll();
      }
      if (message?.type === 'SPEED_RECOMMENDATION' && message.recommendation) {
        currentSpeedRec = message.recommendation;
        speedRecApplied = false;
        renderAll();
      }
      // Background wiped per-tab errors on navigation (incl. SPA pushState):
      // drop local state so the toast doesn't show the old host's errors.
      if (message?.type === 'URL_CHANGED') {
        failedHosts.clear();
        currentSpeedRec = null;
        speedRecApplied = false;
        hideToast();
      }
    });

    // Check existing errors on page load
    safeSendMessage<{ errors?: Array<{ host: string }> }>({ type: 'GET_MY_ERRORS' }, (res) => {
      if (res?.errors && Array.isArray(res.errors) && res.errors.length > 0) {
        for (const err of res.errors) {
          if (err.host) failedHosts.add(err.host);
        }
        renderAll();
      }
    });
  },
});
