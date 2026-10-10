import { createApp } from 'vue';
import '../../assets/main.css';
import './style.css';
import App from './App.vue';
import { getSettings } from '../../src/core/storage/storage';
import { applyTheme } from '../../src/core/theme';
import { setLocale, resolveLocale } from '../../src/core/i18n';

try {
  const settings = await getSettings();
  applyTheme(settings?.theme);
  setLocale(resolveLocale(settings?.language));
} catch {}

createApp(App).mount('#app');
