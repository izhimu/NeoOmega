import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDesc__',
    default_locale: 'en',
    version: '1.0.0',
    permissions: [
      'proxy',
      'storage',
      'alarms',
      'webRequest',
      'webRequestAuthProvider',
      'sidePanel',
      'scripting',
      'privacy',
    ],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: '__MSG_extName__',
    },
    options_ui: {
      open_in_tab: true,
    },
  },
});
