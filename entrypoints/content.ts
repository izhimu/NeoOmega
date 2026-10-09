export default defineContentScript({
  matches: ['*://*/*'],
  runAt: 'document_idle',
  main() {
    if (window.top !== window.self) return; // Only run in top-level frame

    const isZh = (navigator.language || '').toLowerCase().startsWith('zh');
    const failedHosts = new Set<string>();

    let hostEl: HTMLDivElement | null = null;
    let shadow: ShadowRoot | null = null;
    let toastEl: HTMLDivElement | null = null;
    let timer: number | null = null;

    const createToastDom = () => {
      if (hostEl) return;
      hostEl = document.createElement('div');
      hostEl.id = 'neo-omega-toast-root';
      shadow = hostEl.attachShadow({ mode: 'closed' });

      const style = document.createElement('style');
      style.textContent = `
        :host { all: initial; }
        .toast {
          position: fixed;
          top: 14px;
          right: 20px;
          z-index: 2147483647;
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-width: 280px;
          max-width: 380px;
          padding: 12px 14px;
          background: rgba(255, 255, 255, 0.98);
          color: #0f172a;
          border-radius: 14px;
          box-shadow: 0 12px 32px -4px rgba(0, 0, 0, 0.16), 0 4px 12px -2px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.08);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 13px;
          line-height: 1.4;
          opacity: 0;
          transform: translateY(-16px) scale(0.96);
          transform-origin: top right;
          transition: opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1), transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
          pointer-events: none;
          box-sizing: border-box;
        }
        @media (prefers-color-scheme: dark) {
          .toast {
            background: rgba(15, 23, 42, 0.96);
            color: #f8fafc;
            box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.12);
          }
        }
        .toast.show {
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
        .title-box {
          display: flex;
          align-items: center;
          gap: 7px;
          font-weight: 600;
          font-size: 13px;
        }
        .badge-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #ef4444;
          box-shadow: 0 0 6px rgba(239, 68, 68, 0.6);
          flex-shrink: 0;
        }
        .close-btn {
          border: none;
          background: transparent;
          color: #94a3b8;
          font-size: 16px;
          line-height: 1;
          cursor: pointer;
          padding: 2px 4px;
          border-radius: 6px;
        }
        .close-btn:hover {
          color: #ef4444;
          background: rgba(239, 68, 68, 0.1);
        }
        .body {
          font-size: 12px;
          color: #64748b;
          word-break: break-all;
          max-height: 48px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        @media (prefers-color-scheme: dark) {
          .body { color: #94a3b8; }
        }
        .actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 2px;
        }
        .action-btn {
          border: none;
          background: #2563eb;
          color: #ffffff;
          padding: 5px 12px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .action-btn:hover {
          background: #1d4ed8;
        }
        .action-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .status-msg {
          font-size: 12px;
          color: #10b981;
          font-weight: 500;
        }
        .status-msg.err {
          color: #ef4444;
        }
      `;
      shadow.appendChild(style);

      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.addEventListener('mouseenter', () => {
        clearTimeout(timer);
      });
      toastEl.addEventListener('mouseleave', () => {
        resetDismissTimer();
      });

      shadow.appendChild(toastEl);
      (document.body || document.documentElement).appendChild(hostEl);
    };

    const resetDismissTimer = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => hideToast(), 6500);
    };

    const hideToast = () => {
      if (!toastEl) return;
      toastEl.classList.remove('show');
      clearTimeout(timer);
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
      const hostPreview = hosts.slice(0, 3).join(', ') + (hosts.length > 3 ? '...' : '');

      const titleText = isZh
        ? `NeoOmega: ${count} 个域名无法访问`
        : `NeoOmega: ${count} unreachable host${count > 1 ? 's' : ''}`;
      const btnText = isZh ? '一键添加代理' : 'Proxy hosts';

      toastEl.innerHTML = `
        <div class="header">
          <div class="title-box">
            <span class="badge-dot"></span>
            <span>${titleText}</span>
          </div>
          <button class="close-btn" title="Dismiss">&times;</button>
        </div>
        <div class="body">${hostPreview}</div>
        <div class="actions">
          <button class="action-btn">${btnText}</button>
        </div>
      `;

      toastEl.querySelector('.close-btn')?.addEventListener('click', () => {
        hideToast();
      });

      const actionBtn = toastEl.querySelector('.action-btn') as HTMLButtonElement | null;
      actionBtn?.addEventListener('click', async () => {
        if (!actionBtn) return;
        actionBtn.disabled = true;
        actionBtn.textContent = isZh ? '添加中...' : 'Adding...';

        let successCount = 0;
        let lastError = '';

        for (const host of hosts) {
          try {
            const res = await new Promise<{ success: boolean; error?: string }>((resolve) => {
              chrome.runtime.sendMessage(
                { type: 'ADD_HOST_RULE', pattern: host, profileId: 'proxy' },
                (r) => resolve(r || { success: false })
              );
            });
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
              isZh ? `已添加 ${successCount} 个规则，刷新生效` : `Added ${successCount} rules, refresh to apply`
            }</span>`;
            window.setTimeout(() => hideToast(), 3000);
          } else {
            actionsEl.innerHTML = `<span class="status-msg err">${
              lastError || (isZh ? '添加失败' : 'Failed to add')
            }</span>`;
            window.setTimeout(() => renderToast(), 3000);
          }
        }
      });

      // Show toast
      requestAnimationFrame(() => {
        toastEl?.classList.add('show');
      });
      resetDismissTimer();
    };

    // Listen for real-time error notifications from background
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'TAB_FAILED_RESOURCES' && message.host) {
        failedHosts.add(message.host);
        renderToast();
      }
    });

    // Check existing errors on page load
    chrome.runtime.sendMessage({ type: 'GET_MY_ERRORS' }, (res) => {
      if (res?.errors && Array.isArray(res.errors) && res.errors.length > 0) {
        for (const err of res.errors) {
          if (err.host) failedHosts.add(err.host);
        }
        renderToast();
      }
    });
  },
});
