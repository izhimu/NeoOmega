export type ThemeMode = 'auto' | 'light' | 'dark';

export function applyTheme(theme?: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const isDark =
    theme === 'dark' ||
    (theme !== 'light' &&
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export function initThemeListener(getTheme: () => ThemeMode | undefined): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = () => {
    const current = getTheme();
    if (current === 'auto' || !current) {
      applyTheme('auto');
    }
  };
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
