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

    const safeSendMessage = <T = unknown>(message: unknown, callback?: (res: T) => void) => {
      if (!isContextValid()) return;
      try {
        chrome.runtime.sendMessage(message, (res) => {
          const err = chrome.runtime.lastError;
          if (err) return;
          callback?.(res);
        });
      } catch {
        // Extension context invalidated (reloaded or updated)
      }
    };


    let hostEl: HTMLDivElement | null = null;
    let shadow: ShadowRoot | null = null;
    let toastEl: HTMLDivElement | null = null;
    let timer: number | null = null;

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
          padding: 12px 14px 14px 14px;
          display: flex;
          flex-direction: column;
          gap: 9px;
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
          margin-top: 3px;
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
          margin-top: 2px;
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
        pauseDismissTimer();
      });
      toastEl.addEventListener('mouseleave', () => {
        resumeDismissTimer();
      });

      shadow.appendChild(wrapper);
      (document.body || document.documentElement).appendChild(hostEl);
    };

    let dismissTimer: number | null = null;
    let dismissTimeRemaining = 7000;
    let dismissStartedAt = 0;

    const startDismissTimer = (duration = 7000) => {
      clearTimeout(dismissTimer ?? undefined);
      dismissTimeRemaining = duration;
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
        startDismissTimer(7000);
      });
    };

    const hideToast = () => {
      if (!toastEl) return;
      clearTimeout(dismissTimer ?? undefined);
      toastEl.classList.remove('show');
    };

    const renderToast = () => {
      if (failedHosts.size === 0) {
        hideToast();
        return;
      }
      createToastDom();
      if (!toastEl) return;

      const hosts = Array.from(failedHosts);
      const count = hosts.length;
      const titleText = isZh ? `${count} 个域名无法访问` : `${count} Unreachable Host${count > 1 ? 's' : ''}`;
      const btnText = isZh ? '一键添加代理' : 'Proxy Hosts';

      const chipsHtml = hosts
        .slice(0, 4)
        .map((h) => `<span class="host-chip" title="${h}">${h}</span>`)
        .join('') + (hosts.length > 4 ? `<span class="host-chip">+${hosts.length - 4}</span>` : '');

      toastEl.innerHTML = `
        <div class="header">
          <div class="header-left">
            ${LOGO_SVG}
            <span class="title-text">${titleText}</span>
          </div>
          <button class="close-btn" title="Dismiss">
            <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="body-content">
          <div class="host-chip-list">${chipsHtml}</div>
        </div>
        <div class="actions">
          <button class="ui-btn primary action-btn">${btnText}</button>
        </div>

      `;

      toastEl.querySelector('.close-btn')?.addEventListener('click', hideToast);

      const actionBtn = toastEl.querySelector('.action-btn') as HTMLButtonElement | null;
      actionBtn?.addEventListener('click', async () => {
        if (!actionBtn) return;
        actionBtn.disabled = true;
        actionBtn.textContent = isZh ? '添加中...' : 'Adding...';

        let successCount = 0;
        let lastError = '';

        for (const host of hosts) {
          try {
            const { promise: addPromise, resolve: addResolve } = Promise.withResolvers<{ success: boolean; error?: string }>();
            safeSendMessage<{ success: boolean; error?: string }>(
              { type: 'ADD_HOST_RULE', pattern: host, profileId: 'proxy' },
              (r) => addResolve(r || { success: false })
            );
            const res = await addPromise;
            if (res.success) {
              successCount++;
              failedHosts.delete(host);
            } else if (res.error) {
              lastError = res.error;
            }
          } catch (e) {
            lastError = String(e);
          }
        }

        const actionsEl = toastEl?.querySelector('.actions');
        if (actionsEl) {
          if (successCount > 0) {
            actionsEl.innerHTML = `<span class="status-msg">✓ ${
              isZh ? `已添加 ${successCount} 条规则，刷新生效` : `Added ${successCount} rules`
            }</span>`;
            window.setTimeout(() => hideToast(), 2500);
          } else {
            actionsEl.innerHTML = `<span class="status-msg err">${
              lastError || (isZh ? '添加失败' : 'Failed to add')
            }</span>`;
            window.setTimeout(() => renderToast(), 2500);
          }
        }
      });

      showToast();
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

    const renderSpeedRecommendation = (rec: SpeedRecommendation) => {
      createToastDom();
      if (!toastEl) return;

      const titleText = isZh ? '加速建议' : 'Speed Boost';
      const applyText = isZh ? '应用加速' : 'Apply Speedup';
      const dismissText = isZh ? '忽略' : 'Ignore';
      const speedupPct = Math.round(((rec.currentLatency - rec.recommendedLatency) / rec.currentLatency) * 100);

      toastEl.innerHTML = `
        <div class="header">
          <div class="header-left">
            ${LOGO_SVG}
            <span class="title-text">${titleText}</span>
          </div>
          <button class="close-btn" title="Dismiss">
            <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="body-content">
          <div style="margin-bottom: 3px; font-weight: 500; font-family: ui-monospace, monospace;">${rec.host}</div>
          <div class="telemetry-row">
            <div class="tele-item">
              <span class="tele-name">${rec.currentProfileName}</span>
              <span class="tele-num">${rec.currentLatency}ms</span>
            </div>
            <div class="tele-arrow">➔</div>
            <div class="tele-item right">
              <span class="tele-name">${rec.recommendedProfileName}</span>
              <span class="tele-num fast">${rec.recommendedLatency}ms${speedupPct > 0 ? ` (-${speedupPct}%)` : ''}</span>
            </div>
          </div>
        </div>
        <div class="actions">
          <button class="ui-btn ghost dismiss-btn">${dismissText}</button>
          <button class="ui-btn primary action-btn speed-btn">${applyText}</button>
        </div>

      `;

      toastEl.querySelector('.close-btn')?.addEventListener('click', hideToast);
      toastEl.querySelector('.dismiss-btn')?.addEventListener('click', hideToast);

      const actionBtn = toastEl.querySelector('.action-btn.speed-btn') as HTMLButtonElement | null;
      actionBtn?.addEventListener('click', async () => {
        if (!actionBtn) return;
        actionBtn.disabled = true;
        actionBtn.textContent = isZh ? '应用中...' : 'Applying...';
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
        const actionsEl = toastEl?.querySelector('.actions');
        if (actionsEl) {
          if (res.success) {
            actionsEl.innerHTML = `<span class="status-msg">✓ ${
              isZh ? `已添加规则：${rec.host}` : `Rule added: ${rec.host}`
            }</span>`;
            window.setTimeout(hideToast, 2500);
          } else {
            actionsEl.innerHTML = `<span class="status-msg err">${
              res.error || (isZh ? '应用失败' : 'Failed')
            }</span>`;
            window.setTimeout(hideToast, 3000);
          }
        }
      });

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
    const THRESHOLD = 1200;

    const reportSlowHost = (h: string, dur: number) => {
      if (isExcluded(h) || reportedSlowHosts.has(h)) return;
      reportedSlowHosts.add(h);
      console.log('[NeoOmega] Detected slow host:', h, `${dur}ms`);
      safeSendMessage({
        type: 'ANALYZE_SLOW_HOSTS',
        hosts: [{ host: h, duration: dur }],
        url: window.location.href,
      });
    };

    const scanExistingTimings = () => {
      if (typeof performance === 'undefined' || !performance.getEntriesByType) return;
      try {
        const navs = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
        if (navs.length > 0) {
          const nav = navs[0];
          const dur = nav.duration || (nav.responseEnd - nav.startTime);
          if (dur > THRESHOLD && window.location.hostname) {
            reportSlowHost(window.location.hostname, Math.round(dur));
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
                reportSlowHost(u.hostname, Math.round(dur));
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
                  reportSlowHost(u.hostname, Math.round(dur));
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
        renderToast();
      }
      if (message?.type === 'SPEED_RECOMMENDATION' && message.recommendation) {
        renderSpeedRecommendation(message.recommendation);
      }
    });

    // Check existing errors on page load
    safeSendMessage<{ errors?: Array<{ host: string }> }>({ type: 'GET_MY_ERRORS' }, (res) => {
      if (res?.errors && Array.isArray(res.errors) && res.errors.length > 0) {
        for (const err of res.errors) {
          if (err.host) failedHosts.add(err.host);
        }
        renderToast();
      }
    });
  },
});
