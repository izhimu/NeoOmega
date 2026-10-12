import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';
    const permissions = [
      'proxy',
      'storage',
      'alarms',
      'webRequest',
      'scripting',
      'privacy',
      'tabs',
    ];
    if (!isFirefox) {
      permissions.push('webRequestAuthProvider', 'sidePanel');
    }

    return {
      name: '__MSG_extName__',
      description: '__MSG_extDesc__',
      default_locale: 'en',
      permissions,
      host_permissions: ['<all_urls>'],
      action: {
        default_title: '__MSG_extName__',
      },
      options_ui: {
        open_in_tab: true,
      },
      ...(isFirefox
        ? {
            browser_specific_settings: {
              gecko: {
                id: 'neo-omega@izhimu.cn',
                strict_min_version: '142.0',
                data_collection_permissions: {
                  required: ['none'],
                },
              },
            },
          }
        : {}),
    };
  },
});
